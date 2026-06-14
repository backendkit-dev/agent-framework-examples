import { spawn } from 'child_process';
import { defineTool, z } from '@backendkit-labs/agent-core';

// Spawns the orchestrator MCP process, sends orchestrator_retry, returns the result.
function callOrchestratorRetry(runId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const configPath = process.env.ORCHESTRATOR_CONFIG ?? 'orchestrator-mcp.yaml';
        const cwd        = process.env.ORCHESTRATOR_CWD    ?? process.cwd();
        const cmdString  = process.env.ORCHESTRATOR_CMD    ?? 'npx @backendkit-labs/orchestrator-mcp-agent';

        const [cmd, ...extraArgs] = cmdString.split(' ');
        const args = [...extraArgs, configPath];

        const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], cwd });

        let buf         = '';
        let initialized = false;
        let callId      = 1;

        const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + '\n');

        proc.stdout.on('data', (chunk: Buffer) => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line) as { id?: number; result?: unknown };
                    if (!initialized && msg.id === 1) {
                        initialized = true;
                        send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
                        callId = 2;
                        send({ jsonrpc: '2.0', id: callId, method: 'tools/call', params: {
                            name:      'orchestrator_retry',
                            arguments: { run_id: runId },
                        }});
                    } else if (msg.id === callId) {
                        proc.kill();
                        const content = ((msg.result as Record<string, unknown[]> | undefined)
                            ?.['content']?.[0] as Record<string, string> | undefined)?.['text'];
                        resolve(content ?? JSON.stringify(msg.result));
                    }
                } catch { /* non-JSON line, skip */ }
            }
        });

        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code !== 0 && code !== null) reject(new Error(`Orchestrator exited ${code}`));
        });

        send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
            protocolVersion: '2024-11-05',
            capabilities:    {},
            clientInfo:      { name: 'run-recovery-daemon', version: '1.0.0' },
        }});
    });
}

export const retryFlowRunTool = defineTool({
    name:        'retry_flow_run',
    description: 'Retries a flow run stuck in waiting_retry state via the orchestrator MCP',
    input:   z.object({
        run_id: z.string().describe('The run ID to retry'),
    }),
    execute: async ({ run_id }): Promise<string> => {
        try {
            const message = await callOrchestratorRetry(run_id);
            return JSON.stringify({ success: true, message });
        } catch (err) {
            return JSON.stringify({ success: false, message: (err as Error).message });
        }
    },
});
