import 'dotenv/config';
import * as path    from 'node:path';
import * as fs      from 'node:fs';
import express, { Request, Response } from 'express';
import { OrchestratorMcpClient }  from './mcp-client';
import { OrchestratorHttpClient } from './http-client';
import { parseFlowResult }        from './parser';

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.GATEWAY_PORT ?? '3400', 10);

const ORCHESTRATOR_HTTP_URL = process.env.ORCHESTRATOR_HTTP_URL;   // e.g. http://localhost:3500
const ORCHESTRATOR_SERVER   = process.env.ORCHESTRATOR_SERVER
    ?? path.resolve(__dirname, '../../../backendkit-agents/packages/orchestrator-mcp-agent/dist/server.js');
const ORCHESTRATOR_CONFIG   = process.env.ORCHESTRATOR_CONFIG
    ?? path.resolve(__dirname, '../../workflow.mcp-agents/orchestrator-mcp.yaml');

// ── Orchestrator client (HTTP or stdio) ───────────────────────────────────────

type OrchestratorClient = {
    callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<string>;
    stop(): void;
};

let client: OrchestratorClient;

// ── SSE broadcast ─────────────────────────────────────────────────────────────

const sseClients = new Set<import('express').Response>();
let lastRunsJson  = '';

function broadcastRuns(json: string) {
    const data = `data: ${json}\n\n`;
    for (const res of sseClients) res.write(data);
}

// Poll orchestrator every 1 s; push to SSE clients when runs change
function startRunsPoller() {
    setInterval(async () => {
        try {
            const json = await client.callTool('list_runs', {}, 5_000);
            if (json !== lastRunsJson) {
                lastRunsJson = json;
                broadcastRuns(json);
            }
        } catch { /* ignore transient errors */ }
    }, 1_000);
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// POST /api/run — start a flow (async: returns run_id immediately, kanban polls for progress)
app.post('/api/run', async (req: Request, res: Response) => {
    const { flow_id = 'knowledge-search-llm', input = {} } = req.body as {
        flow_id?: string;
        input?:   Record<string, unknown>;
    };
    try {
        const text   = await client.callTool('start_flow', { flow_id, input }, 15_000);
        const result = JSON.parse(text) as { run_id?: string; status?: string; error?: string };
        if (result.error) { res.status(400).json(result); return; }
        res.status(202).json({ accepted: true, ...result });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/approve — approve a paused gate (async: returns 202 immediately, flow resumes in background)
app.post('/api/approve', async (req: Request, res: Response) => {
    const { run_id, feedback } = req.body as { run_id: string; feedback?: string };
    if (!run_id) { res.status(400).json({ error: 'run_id required' }); return; }
    res.status(202).json({ accepted: true, run_id });
    client.callTool('orchestrator_approve', { run_id, feedback }, 300_000)
        .catch(err => console.error(`[approve background] ${run_id}: ${(err as Error).message}`));
});

// POST /api/reject — reject a paused gate (synchronous: instant state change)
app.post('/api/reject', async (req: Request, res: Response) => {
    const { run_id, feedback } = req.body as { run_id: string; feedback?: string };
    if (!run_id) { res.status(400).json({ error: 'run_id required' }); return; }
    try {
        const text = await client.callTool('orchestrator_reject', { run_id, feedback }, 10_000);
        res.json({ status: 'rejected', message: text });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/retry — retry a waiting_retry run (async: returns 202 immediately, flow resumes in background)
app.post('/api/retry', async (req: Request, res: Response) => {
    const { run_id, feedback } = req.body as { run_id: string; feedback?: string };
    if (!run_id) { res.status(400).json({ error: 'run_id required' }); return; }
    res.status(202).json({ accepted: true, run_id });
    client.callTool('orchestrator_retry', { run_id, feedback }, 300_000)
        .catch(err => console.error(`[retry background] ${run_id}: ${(err as Error).message}`));
});

// GET /api/runs — list all runs (for kanban board)
app.get('/api/runs', async (_req: Request, res: Response) => {
    try {
        const text = await client.callTool('list_runs', {}, 10_000);
        res.json(JSON.parse(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/runs/stream — SSE live feed
app.get('/api/runs/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type',                 'text/event-stream');
    res.setHeader('Cache-Control',                'no-cache');
    res.setHeader('Connection',                   'keep-alive');
    res.setHeader('X-Accel-Buffering',            'no');
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.flushHeaders();

    if (lastRunsJson) res.write(`data: ${lastRunsJson}\n\n`);

    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
});

// POST /api/runs/:id/approve — RESTful alias
app.post('/api/runs/:id/approve', async (req: Request, res: Response) => {
    const { feedback } = req.body as { feedback?: string };
    res.status(202).json({ accepted: true, run_id: req.params.id });
    client.callTool('orchestrator_approve', { run_id: req.params.id, feedback }, 300_000)
        .catch(err => console.error(`[approve background] ${req.params.id}: ${(err as Error).message}`));
});

// POST /api/runs/:id/reject — RESTful alias
app.post('/api/runs/:id/reject', async (req: Request, res: Response) => {
    const { reason } = req.body as { reason?: string };
    try {
        const text = await client.callTool('orchestrator_reject', { run_id: req.params.id, reason }, 10_000);
        res.json({ status: 'rejected', message: text });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/runs/:id/retry — RESTful alias
app.post('/api/runs/:id/retry', async (req: Request, res: Response) => {
    const { feedback } = req.body as { feedback?: string };
    res.status(202).json({ accepted: true, run_id: req.params.id });
    client.callTool('orchestrator_retry', { run_id: req.params.id, feedback }, 300_000)
        .catch(err => console.error(`[retry background] ${req.params.id}: ${(err as Error).message}`));
});

// GET /api/config — full orchestrator config (agents + flows + settings)
app.get('/api/config', async (_req: Request, res: Response) => {
    try {
        const text = await client.callTool('get_config', {}, 10_000);
        res.json(JSON.parse(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/config/agents — create or update agent
app.post('/api/config/agents', async (req: Request, res: Response) => {
    try {
        const text = await client.callTool('save_agent', { agent: JSON.stringify(req.body) }, 10_000);
        res.json(JSON.parse(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// DELETE /api/config/agents/:id — delete agent
app.delete('/api/config/agents/:id', async (req: Request, res: Response) => {
    try {
        const text = await client.callTool('delete_agent', { id: req.params.id }, 10_000);
        res.json(JSON.parse(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/config/flows — create or update flow
app.post('/api/config/flows', async (req: Request, res: Response) => {
    try {
        const text = await client.callTool('save_flow', { flow: JSON.stringify(req.body) }, 10_000);
        res.json(JSON.parse(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// DELETE /api/config/flows/:id — delete flow
app.delete('/api/config/flows/:id', async (req: Request, res: Response) => {
    try {
        const text = await client.callTool('delete_flow', { id: req.params.id }, 10_000);
        res.json(JSON.parse(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/agents — agent health as JSON (for agent-studio)
app.get('/api/agents', async (_req: Request, res: Response) => {
    try {
        const text = await client.callTool('list_agents_json', {}, 10_000);
        res.json(JSON.parse(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/health — gateway + agent health
app.get('/api/health', async (_req: Request, res: Response) => {
    try {
        const agents = await client.callTool('list_agents', {}, 10_000);
        res.json({ ok: true, gateway: `http://localhost:${PORT}`, agents });
    } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
    if (ORCHESTRATOR_HTTP_URL) {
        // ── HTTP mode: orchestrator runs as a separate service ────────────────
        client = new OrchestratorHttpClient(ORCHESTRATOR_HTTP_URL);
        console.log(`[orchestrator-gateway] → orchestrator at ${ORCHESTRATOR_HTTP_URL}`);
    } else {
        // ── Stdio mode: gateway spawns the orchestrator process ───────────────
        if (!fs.existsSync(ORCHESTRATOR_SERVER)) {
            console.error(`[gateway] orchestrator not built: ${ORCHESTRATOR_SERVER}`);
            console.error('Run: cd ../../../backendkit-agents/packages/orchestrator-mcp-agent && npm run build');
            process.exit(1);
        }
        const mcpClient = new OrchestratorMcpClient(ORCHESTRATOR_SERVER, ORCHESTRATOR_CONFIG, {
            TRIAGE_PORT:          process.env.TRIAGE_PORT          ?? '3301',
            FORMATTER_PORT:       process.env.FORMATTER_PORT       ?? '3302',
            CURATOR_PORT:         process.env.CURATOR_PORT         ?? '3200',
            SYNTHESIZER_PORT:     process.env.SYNTHESIZER_PORT     ?? '3303',
            VAULT_PATH:           process.env.VAULT_PATH           ?? '',
            CURATOR_HTTP_API_KEY: process.env.CURATOR_HTTP_API_KEY ?? '',
        });
        await mcpClient.start();
        client = mcpClient;
        console.log(`[orchestrator-gateway] → orchestrator via stdio (embedded)`);
    }

    app.listen(PORT, () => {
        console.log(`[orchestrator-gateway] ready on :${PORT}`);
        console.log(`  POST /api/run              — start a flow`);
        console.log(`  POST /api/approve          — approve a gate`);
        console.log(`  POST /api/reject           — reject a gate`);
        console.log(`  POST /api/retry            — retry a failed step`);
        console.log(`  GET  /api/runs/stream      — SSE live feed`);
        console.log(`  GET  /api/health           — agent status`);
        startRunsPoller();
    });
}

start().catch(err => {
    console.error('[gateway] startup failed:', err.message);
    process.exit(1);
});

process.on('SIGINT',  () => { client?.stop(); process.exit(0); });
process.on('SIGTERM', () => { client?.stop(); process.exit(0); });
