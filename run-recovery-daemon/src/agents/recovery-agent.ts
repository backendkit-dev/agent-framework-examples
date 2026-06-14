import type { AgentProfile } from '@backendkit-labs/agent-core';

// Agent URLs injected at runtime from .env
const agentUrls: Record<string, string> = {
    curator:     process.env.CURATOR_URL     ?? 'http://localhost:3200',
    triage:      process.env.TRIAGE_URL      ?? 'http://localhost:3301',
    synthesizer: process.env.SYNTHESIZER_URL ?? 'http://localhost:3303',
    formatter:   process.env.FORMATTER_URL   ?? 'http://localhost:3302',
};

const urlMap = Object.entries(agentUrls)
    .map(([id, url]) => `- ${id}: ${url}`)
    .join('\n');

export const RECOVERY_AGENT: AgentProfile = {
    id:          'recovery',
    name:        'Recovery Agent',
    icon:        '🔄',
    description: 'Monitors for failed flow runs and retries them when agents recover',
    allowedTools: ['get_waiting_runs', 'check_agent_health', 'retry_flow_run'],
    delegatesTo:  [],
    systemPrompt: `You are an autonomous recovery daemon for a multi-agent orchestration system.

When triggered, you must:
1. Call get_waiting_runs — find all flow runs in "waiting_retry" state
2. For each run, use failedStepId to determine which agent failed
3. Check that agent's health via check_agent_health
4. If healthy → call retry_flow_run with the run_id
5. Report a concise summary: what was retried, what is still down

Known agent URLs (by step ID):
${urlMap}

If no runs are waiting, report: "No runs waiting for retry."
Be brief — one line per run.`,
};
