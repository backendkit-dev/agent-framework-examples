import { defineTool, z } from '@backendkit-labs/agent-core';

export const checkAgentHealthTool = defineTool({
    name:        'check_agent_health',
    description: 'Checks if an agent HTTP endpoint is alive and responding',
    input:   z.object({
        url: z.string().describe('Base URL of the agent, e.g. http://localhost:3200'),
    }),
    execute: async ({ url }): Promise<string> => {
        try {
            const res = await fetch(`${url}/v1/agent/health`, {
                signal: AbortSignal.timeout(3_000),
            });
            return JSON.stringify({ healthy: res.ok });
        } catch (err) {
            return JSON.stringify({ healthy: false, error: (err as Error).message });
        }
    },
});
