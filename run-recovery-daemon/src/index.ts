import 'dotenv/config';
import * as path from 'path';
import * as os   from 'os';
import { createAutonomousAgent, createMemorySystem, StdoutTransport } from '@backendkit-labs/agent-core';
import { OpenAICompatibleProvider } from '@backendkit-labs/agent-coding';
import { RECOVERY_AGENT }      from './agents/recovery-agent';
import { getWaitingRunsTool }  from './tools/get-waiting-runs';
import { checkAgentHealthTool } from './tools/check-agent-health';
import { retryFlowRunTool }    from './tools/retry-flow-run';

// ── Validate config ────────────────────────────────────────────────────────────

const API_KEY  = process.env.LLM_API_KEY ?? '';
const DATA_DIR = process.env.ORCHESTRATOR_DATA_DIR ?? '';

if (!API_KEY)  { console.error('[run-recovery-daemon] LLM_API_KEY is required'); process.exit(1); }
if (!DATA_DIR) { console.error('[run-recovery-daemon] ORCHESTRATOR_DATA_DIR is required'); process.exit(1); }

// ── Provider ───────────────────────────────────────────────────────────────────

const provider = new OpenAICompatibleProvider({
    apiKey:      API_KEY,
    baseUrl:     process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
    model:       process.env.LLM_MODEL    ?? 'deepseek-chat',
    temperature: 0.1,   // low temp — deterministic recovery decisions
    maxTokens:   1024,
});

// ── Memory — tracks recovered runs across trigger executions ──────────────────

const APP_DIR = path.join(os.homedir(), '.run-recovery-daemon');
const memory  = createMemorySystem({
    episodic:  { provider: 'json', path: path.join(APP_DIR, 'memory', 'episodes.json') },
    retention: { maxEpisodes: 500 },
});

// ── Daemon ─────────────────────────────────────────────────────────────────────

const daemon = createAutonomousAgent({
    providers:       { llm: provider },
    defaultProvider: 'llm',
    agents:          [RECOVERY_AGENT],
    defaultAgent:    'recovery',
    tools:           [getWaitingRunsTool, checkAgentHealthTool, retryFlowRunTool],
    memorySystem:    memory,
    maxIterations:   15,
    transport:       new StdoutTransport(),

    goal: 'Monitor flow runs in waiting_retry state and automatically retry them when the failing agents recover',

    triggers: [
        {
            // Poll every 30 seconds
            type: 'schedule',
            cron: '*/30 * * * * *',
            task: 'Check for flow runs waiting for retry and recover them if possible.',
        },
        {
            // React immediately when an agent.recovered event is emitted
            type:  'event',
            topic: 'agent.recovered',
            buildPrompt: (data: unknown) => {
                const d = data as { agentId?: string; url?: string };
                return `Agent "${d.agentId ?? 'unknown'}" at ${d.url ?? '?'} just came back online. `
                    + `Check immediately for waiting_retry runs associated with it and retry them.`;
            },
        },
    ],

    webhookPort: parseInt(process.env.WEBHOOK_PORT ?? '3401', 10),
});

// ── Start ──────────────────────────────────────────────────────────────────────

void (async () => {
    await daemon.start();

    console.log('[run-recovery-daemon] started');
    console.log(`[run-recovery-daemon] watching: ${DATA_DIR}/runs`);
    console.log('[run-recovery-daemon] schedule: every 30s');
    console.log('[run-recovery-daemon] event:    agent.recovered');

    process.on('SIGTERM', async () => { await daemon.stop(); process.exit(0); });
    process.on('SIGINT',  async () => { await daemon.stop(); process.exit(0); });
})();
