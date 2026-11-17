/** Running a command as a step: cancellable (the whole process tree is killed, not just the shell), with a deadline and the tail of its output. */
import { spawn } from 'node:child_process';

export interface CommandResult {
    code: number | null;
    ms: number;
    /** The last of stdout and stderr together, for a person to read. */
    tail: string;
    /** Everything stdout said (up to 4 MB), for a program to parse. */
    stdout: string;
    signal: 'aborted' | 'timeout' | undefined;
}

/** Arguments are never built from untrusted text here: names and folders come from the package.json of the repo being checked and are validated first. */
export const SAFE_ARG = /^[A-Za-z0-9@/._:=+-]+$/;

const TAIL_CHARS = 3000;
const STDOUT_MAX = 4_000_000;

function killTree(pid: number): void {
    try {
        // Not spawnSync: killing the builds of a cancelled run one at a time, each taking a second, would hold the whole process.
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => undefined);
        else process.kill(-pid, 'SIGKILL');
    } catch { /* already gone */ }
}

export function runCommand(command: string, args: string[], opts: { cwd: string; signal?: AbortSignal; timeoutMs?: number; env?: Record<string, string> }): Promise<CommandResult> {
    for (const a of [command, ...args]) if (!SAFE_ARG.test(a)) throw new Error(`refusing an unsafe argument: ${JSON.stringify(a)}`);
    return new Promise(resolve => {
        const t0 = Date.now();
        // `npm` is `npm.cmd` on Windows, which needs a shell: there the command is one string (the arguments were checked above), which is also
        // what keeps Node from warning about arguments that are not escaped.
        const common = { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], windowsHide: true };
        const child = process.platform === 'win32'
            ? spawn([command, ...args].join(' '), { ...common, shell: true })
            : spawn(command, args, { ...common, detached: true });
        let out = ''; let stdout = '';
        const eat = (d: Buffer): void => { out = (out + d.toString()).slice(-TAIL_CHARS * 2); };
        child.stdout?.on('data', (d: Buffer) => { eat(d); if (stdout.length < STDOUT_MAX) stdout += d.toString(); });
        child.stderr?.on('data', eat);
        let signal: CommandResult['signal'];
        const stop = (why: 'aborted' | 'timeout'): void => { signal ??= why; if (child.pid) killTree(child.pid); };
        const onAbort = (): void => stop('aborted');
        if (opts.signal?.aborted) onAbort(); else opts.signal?.addEventListener('abort', onAbort, { once: true });
        const timer = opts.timeoutMs ? setTimeout(() => stop('timeout'), opts.timeoutMs) : undefined;
        const finish = (code: number | null): void => {
            if (timer) clearTimeout(timer);
            opts.signal?.removeEventListener('abort', onAbort);
            resolve({ code, ms: Date.now() - t0, tail: out.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-TAIL_CHARS), stdout, signal });
        };
        child.on('error', err => { out += `\n${err.message}`; finish(null); });
        child.on('close', code => finish(code));
    });
}
