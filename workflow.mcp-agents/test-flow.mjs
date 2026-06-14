#!/usr/bin/env node
/**
 * test-flow.mjs — end-to-end test for workflow.mcp-agents
 *
 * Starts triage-agent and formatter-agent locally, then connects to
 * orchestrator-mcp-agent via MCP stdio.  curator-codex must be running
 * separately (see .env.example).
 *
 * Usage:
 *   node test-flow.mjs                          # default question
 *   node test-flow.mjs "how does agent protocol work?"
 *   QUESTION="qué es RAG?" node test-flow.mjs
 *
 * Requirements:
 *   1. npm install (installs @backendkit-labs/agent-protocol for triage/formatter)
 *   2. curator-codex HTTP server running on CURATOR_PORT (default 3200)
 *   3. orchestrator-mcp-agent built: cd ../../backendkit-agents/packages/orchestrator-mcp-agent && npm run build
 */

import { spawn }           from 'node:child_process';
import { createInterface } from 'node:readline';
import * as path           from 'node:path';
import * as fs             from 'node:fs';
import * as url            from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ── Env loading ────────────────────────────────────────────────────────────────

function loadDotEnv(dir) {
    const file = path.join(dir, '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && m[2] && !(m[1] in process.env))
            process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}
loadDotEnv(__dirname);

// ── Config ─────────────────────────────────────────────────────────────────────

const TRIAGE_PORT      = parseInt(process.env.TRIAGE_PORT      ?? '3301', 10);
const FORMATTER_PORT   = parseInt(process.env.FORMATTER_PORT   ?? '3302', 10);
const CURATOR_PORT     = parseInt(process.env.CURATOR_PORT     ?? '3200', 10);
const SYNTHESIZER_PORT = parseInt(process.env.SYNTHESIZER_PORT ?? '3303', 10);

const ORCHESTRATOR_SERVER = path.resolve(
    __dirname,
    '../../backendkit-agents/packages/orchestrator-mcp-agent/dist/server.js',
);
const ORCHESTRATOR_CONFIG = path.resolve(__dirname, 'orchestrator-mcp.yaml');

const QUESTION = process.argv[2] ?? process.env.QUESTION ?? 'How does the Agent HTTP Protocol work?';
const FLOW_ID  = process.env.FLOW_ID ?? 'knowledge-search-llm';

// Inject port env vars so YAML ${VAR} expansion works
process.env.TRIAGE_PORT      = String(TRIAGE_PORT);
process.env.FORMATTER_PORT   = String(FORMATTER_PORT);
process.env.CURATOR_PORT     = String(CURATOR_PORT);
process.env.SYNTHESIZER_PORT = String(SYNTHESIZER_PORT);

// ── HTTP health check ─────────────────────────────────────────────────────────

async function waitForAgent(name, port, maxMs = 15_000) {
    const url     = `http://localhost:${port}/v1/agent/health`;
    const start   = Date.now();
    const headers = process.env.AGENT_API_KEY
        ? { Authorization: `Bearer ${process.env.AGENT_API_KEY}` }
        : {};
    while (Date.now() - start < maxMs) {
        try {
            const r = await fetch(url, { headers });
            if (r.ok) return;
        } catch {}
        await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`${name} on :${port} did not become healthy within ${maxMs}ms`);
}

// ── MCP Client ─────────────────────────────────────────────────────────────────

class McpClient {
    constructor(serverPath, configPath) {
        this._nextId  = 1;
        this._pending = new Map();

        this._proc = spawn('node', [serverPath], {
            stdio: ['pipe', 'pipe', 'inherit'],
            env:   {
                ...process.env,
                ORCHESTRATOR_CONFIG: configPath,
                VAULT_PATH: process.env.VAULT_PATH ?? '',
            },
        });

        const rl = createInterface({ input: this._proc.stdout });
        rl.on('line', line => {
            if (!line.trim()) return;
            try {
                const msg = JSON.parse(line);
                if (msg.id !== undefined && this._pending.has(msg.id)) {
                    const { resolve, reject } = this._pending.get(msg.id);
                    this._pending.delete(msg.id);
                    if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
                    else resolve(msg.result);
                }
            } catch {}
        });

        this._proc.on('error', err => console.error('[MCP] process error:', err.message));
        this._proc.on('exit', code => { if (code) console.error(`[MCP] exited with code ${code}`); });
    }

    _send(msg) { this._proc.stdin.write(JSON.stringify(msg) + '\n'); }

    async initialize() {
        const id = this._nextId++;
        const p  = new Promise((res, rej) => this._pending.set(id, { resolve: res, reject: rej }));
        this._send({ jsonrpc: '2.0', id, method: 'initialize', params: {
            protocolVersion: '2024-11-05',
            capabilities:    {},
            clientInfo:      { name: 'test-flow', version: '0.1.0' },
        }});
        await p;
        this._send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    }

    async callTool(name, args, timeoutMs = 60_000) {
        const id = this._nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`Timeout calling tool '${name}' after ${timeoutMs}ms`));
            }, timeoutMs);
            this._pending.set(id, {
                resolve: r  => { clearTimeout(timer); resolve(r); },
                reject:  e  => { clearTimeout(timer); reject(e); },
            });
            this._send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
        });
    }

    close() {
        try { this._proc.stdin.end(); } catch {}
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const text = r => r?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? String(r);

function banner(title, content) {
    const line = '─'.repeat(70);
    console.log(`\n${line}\n  ${title}\n${line}`);
    console.log(content);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const children = [];

async function main() {
    // ── Preflight checks ─────────────────────────────────────────────────────
    if (!fs.existsSync(ORCHESTRATOR_SERVER)) {
        console.error(`\n[ERROR] orchestrator-mcp-agent not built.\nExpected: ${ORCHESTRATOR_SERVER}`);
        console.error('Run: cd ../../backendkit-agents/packages/orchestrator-mcp-agent && npm run build');
        process.exit(1);
    }
    if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
        console.error('\n[ERROR] node_modules missing. Run: npm install');
        process.exit(1);
    }

    // ── Start local agents ───────────────────────────────────────────────────
    console.log('\nStarting triage-agent, formatter-agent and synthesizer-agent...');

    const synthDir = path.resolve(__dirname, '../synthesizer-agent');

    const triageProc = spawn('node', ['agents/triage-agent.mjs'], {
        cwd:   __dirname,
        stdio: ['ignore', 'ignore', 'inherit'],
        env:   { ...process.env },
    });
    children.push(triageProc);

    const formatterProc = spawn('node', ['agents/formatter-agent.mjs'], {
        cwd:   __dirname,
        stdio: ['ignore', 'ignore', 'inherit'],
        env:   { ...process.env },
    });
    children.push(formatterProc);

    const synthProc = spawn(process.execPath, ['dist/server.js'], {
        cwd:   synthDir,
        stdio: ['ignore', 'ignore', 'inherit'],
        env:   { ...process.env },
    });
    synthProc.on('error', err => console.error('[synthesizer] spawn error:', err.message));
    children.push(synthProc);

    // ── Wait for agents to be healthy ────────────────────────────────────────
    await Promise.all([
        waitForAgent('triage-agent',      TRIAGE_PORT),
        waitForAgent('formatter-agent',   FORMATTER_PORT),
        waitForAgent('synthesizer-agent', SYNTHESIZER_PORT, 20_000),
    ]);
    console.log(`  triage-agent      :${TRIAGE_PORT}  [ok]`);
    console.log(`  formatter-agent   :${FORMATTER_PORT}  [ok]`);
    console.log(`  synthesizer-agent :${SYNTHESIZER_PORT}  [ok]`);

    // ── Verify curator-codex ─────────────────────────────────────────────────
    try {
        await waitForAgent('curator-codex', CURATOR_PORT, 3_000);
        console.log(`  curator-codex   :${CURATOR_PORT}  [ok]`);
    } catch {
        console.warn(`\n[WARN] curator-codex not responding on :${CURATOR_PORT}`);
        console.warn('       The search step will fail but orchestration will still be tested.');
    }

    // ── Connect to orchestrator-mcp-agent ────────────────────────────────────
    console.log('\nConnecting to orchestrator-mcp-agent...');
    const mcp = new McpClient(ORCHESTRATOR_SERVER, ORCHESTRATOR_CONFIG);
    children.push(mcp._proc);

    try {
        await mcp.initialize();
        console.log('  MCP: connected [ok]\n');

        // ── List agents ──────────────────────────────────────────────────────
        banner('AGENTS', text(await mcp.callTool('list_agents', {})));

        // ── Run flow ─────────────────────────────────────────────────────────
        console.log(`\nRunning flow: ${FLOW_ID}`);
        console.log(`Question: "${QUESTION}"\n`);

        const runResult = text(await mcp.callTool('run_flow', {
            flow_id: FLOW_ID,
            input:   { question: QUESTION, vault_path: process.env.VAULT_PATH ?? '' },
        }, 180_000));

        banner('FLOW RESULT', runResult);

        // ── Auto-approve gate if hit ─────────────────────────────────────────
        const runIdMatch = runResult.match(/Run ID:\s*([a-f0-9-]{36})/i);
        if (runIdMatch) {
            const runId = runIdMatch[1];
            console.log(`\nGate hit (run: ${runId}) — auto-approving...`);

            await new Promise(r => setTimeout(r, 1000));

            const approveResult = text(await mcp.callTool('orchestrator_approve', {
                run_id:   runId,
                feedback: 'Auto-approved by test-flow.mjs',
            }, 120_000));

            banner('FINAL RESULT', approveResult);
        }

    } finally {
        mcp.close();
    }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanup() {
    for (const c of children) {
        try { c.kill(); } catch {}
    }
}

process.on('exit',    cleanup);
process.on('SIGINT',  () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

main().catch(err => {
    console.error('\n[FATAL]', err.message);
    cleanup();
    process.exit(1);
});
