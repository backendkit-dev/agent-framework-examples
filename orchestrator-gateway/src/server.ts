import 'dotenv/config';
import * as path    from 'node:path';
import * as fs      from 'node:fs';
import express, { Request, Response } from 'express';
import { OrchestratorMcpClient } from './mcp-client';
import { parseFlowResult }       from './parser';

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.GATEWAY_PORT ?? '3400', 10);

const ORCHESTRATOR_SERVER = process.env.ORCHESTRATOR_SERVER
    ?? path.resolve(__dirname, '../../../backendkit-agents/packages/orchestrator-mcp-agent/dist/server.js');

const ORCHESTRATOR_CONFIG = process.env.ORCHESTRATOR_CONFIG
    ?? path.resolve(__dirname, '../../workflow.mcp-agents/orchestrator-mcp.yaml');

if (!fs.existsSync(ORCHESTRATOR_SERVER)) {
    console.error(`[gateway] orchestrator not built: ${ORCHESTRATOR_SERVER}`);
    console.error('Run: cd ../../../backendkit-agents/packages/orchestrator-mcp-agent && npm run build');
    process.exit(1);
}

// ── MCP singleton ─────────────────────────────────────────────────────────────

const mcp = new OrchestratorMcpClient(ORCHESTRATOR_SERVER, ORCHESTRATOR_CONFIG, {
    TRIAGE_PORT:          process.env.TRIAGE_PORT          ?? '3301',
    FORMATTER_PORT:       process.env.FORMATTER_PORT       ?? '3302',
    CURATOR_PORT:         process.env.CURATOR_PORT         ?? '3200',
    SYNTHESIZER_PORT:     process.env.SYNTHESIZER_PORT     ?? '3303',
    VAULT_PATH:           process.env.VAULT_PATH           ?? '',
    CURATOR_HTTP_API_KEY: process.env.CURATOR_HTTP_API_KEY ?? '',
});

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// POST /api/run — start a flow
app.post('/api/run', async (req: Request, res: Response) => {
    const { flow_id = 'knowledge-search-llm', input = {} } = req.body as {
        flow_id?: string;
        input?:   Record<string, unknown>;
    };
    try {
        const text   = await mcp.callTool('run_flow', { flow_id, input }, 180_000);
        res.json(parseFlowResult(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/approve — approve a paused gate
app.post('/api/approve', async (req: Request, res: Response) => {
    const { run_id, feedback } = req.body as { run_id: string; feedback?: string };
    if (!run_id) { res.status(400).json({ error: 'run_id required' }); return; }
    try {
        const text   = await mcp.callTool('orchestrator_approve', { run_id, feedback }, 180_000);
        res.json(parseFlowResult(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/reject — reject a paused gate
app.post('/api/reject', async (req: Request, res: Response) => {
    const { run_id, feedback } = req.body as { run_id: string; feedback?: string };
    if (!run_id) { res.status(400).json({ error: 'run_id required' }); return; }
    try {
        const text = await mcp.callTool('orchestrator_reject', { run_id, feedback }, 10_000);
        res.json({ status: 'rejected', message: text });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/retry — retry a waiting_retry run
app.post('/api/retry', async (req: Request, res: Response) => {
    const { run_id, feedback } = req.body as { run_id: string; feedback?: string };
    if (!run_id) { res.status(400).json({ error: 'run_id required' }); return; }
    try {
        const text = await mcp.callTool('orchestrator_retry', { run_id, feedback }, 180_000);
        res.json(parseFlowResult(text));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/health — gateway + agent health
app.get('/api/health', async (_req: Request, res: Response) => {
    try {
        const agents = await mcp.callTool('list_agents', {}, 10_000);
        res.json({ ok: true, gateway: `http://localhost:${PORT}`, agents });
    } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────

mcp.start()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`[orchestrator-gateway] ready on :${PORT}`);
            console.log(`  POST /api/run     — start a flow`);
            console.log(`  POST /api/approve — approve a gate`);
            console.log(`  POST /api/reject  — reject a gate`);
            console.log(`  POST /api/retry   — retry a failed step`);
            console.log(`  GET  /api/health  — agent status`);
        });
    })
    .catch(err => {
        console.error('[gateway] failed to start orchestrator:', err.message);
        process.exit(1);
    });

process.on('SIGINT',  () => { mcp.stop(); process.exit(0); });
process.on('SIGTERM', () => { mcp.stop(); process.exit(0); });
