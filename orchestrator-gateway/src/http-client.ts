/**
 * HTTP client for orchestrator-mcp-agent running in HTTP mode.
 * Replaces OrchestratorMcpClient when ORCHESTRATOR_HTTP_URL is set.
 */
export class OrchestratorHttpClient {
    constructor(private readonly baseUrl: string) {}

    async callTool(name: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<string> {
        const res = await fetch(`${this.baseUrl}/v1/tools/call`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name, arguments: args }),
            signal:  AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
            throw new Error(`Orchestrator HTTP ${res.status}: ${await res.text()}`);
        }
        const body = await res.json() as { ok: boolean; result?: string; error?: string };
        if (!body.ok) throw new Error(body.error ?? 'Unknown orchestrator error');
        return body.result ?? '';
    }

    stop(): void { /* stateless — nothing to clean up */ }
}
