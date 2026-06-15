import { spawn, ChildProcess } from 'node:child_process';
import { createInterface }     from 'node:readline';

interface Pending {
    resolve: (v: unknown) => void;
    reject:  (e: Error)   => void;
    timer:   ReturnType<typeof setTimeout>;
}

/**
 * Persistent JSON-RPC client for the orchestrator MCP stdio server.
 * Spawns the process once and multiplexes all tool calls over it.
 */
export class OrchestratorMcpClient {
    private proc:         ChildProcess | null = null;
    private nextId        = 1;
    private pending       = new Map<number, Pending>();
    private initDone      = false;
    private initResolve!: () => void;
    private initReject!:  (e: Error) => void;
    readonly ready:       Promise<void>;

    constructor(
        private readonly serverPath: string,
        private readonly configPath: string,
        private readonly extraEnv:   Record<string, string> = {},
    ) {
        this.ready = new Promise((res, rej) => {
            this.initResolve = res;
            this.initReject  = rej;
        });
    }

    async start(): Promise<void> {
        this.proc = spawn(process.execPath, [this.serverPath], {
            stdio: ['pipe', 'pipe', 'inherit'],
            env:   { ...process.env, ...this.extraEnv, ORCHESTRATOR_CONFIG: this.configPath },
        });

        const rl = createInterface({ input: this.proc.stdout! });
        rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const msg = JSON.parse(line) as {
                    id?:    number;
                    result?: unknown;
                    error?:  { message?: string };
                };
                if (msg.id == null) return;
                const p = this.pending.get(msg.id);
                if (!p) return;
                this.pending.delete(msg.id);
                clearTimeout(p.timer);
                msg.error
                    ? p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
                    : p.resolve(msg.result);
            } catch { /* non-JSON line */ }
        });

        const onFatal = (err: Error) => {
            if (!this.initDone) this.initReject(err);
            for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
            this.pending.clear();
        };

        this.proc.on('error', onFatal);
        this.proc.on('exit', (code) => onFatal(new Error(`Orchestrator exited (${code})`)));

        // MCP handshake
        await this.rpc('initialize', {
            protocolVersion: '2024-11-05',
            capabilities:    {},
            clientInfo:      { name: 'orchestrator-gateway', version: '1.0.0' },
        }, 15_000);
        this.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        this.initDone = true;
        this.initResolve();
    }

    private send(msg: object): void {
        this.proc?.stdin?.write(JSON.stringify(msg) + '\n');
    }

    private rpc(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP '${method}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.send({ jsonrpc: '2.0', id, method, params });
        });
    }

    async callTool(name: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<string> {
        await this.ready;
        const result = await this.rpc('tools/call', { name, arguments: args }, timeoutMs) as {
            content?: Array<{ type: string; text: string }>;
        };
        return result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
    }

    stop(): void {
        try { this.proc?.stdin?.end(); } catch {}
    }
}
