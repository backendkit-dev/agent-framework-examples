// Quick manual test for code-explainer MCP server
// Run with: node test-manual.mjs

const BASE = 'http://127.0.0.1:3011/mcp';

async function rpc(sessionId, id, method, params) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;

    const res = await fetch(BASE, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });

    const sessionIdOut = res.headers.get('mcp-session-id');
    const text = await res.text();
    // SSE format: "data: {...}\n\n"
    const dataLine = text.split('\n').find(l => l.startsWith('data:'));
    const json = dataLine ? JSON.parse(dataLine.slice(5).trim()) : JSON.parse(text);
    return { sessionId: sessionIdOut, json };
}

// 1. Initialize
const init = await rpc(null, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' },
});
const sid = init.sessionId;
console.log('Session:', sid);
console.log('Server:', init.json.result?.serverInfo?.name, init.json.result?.serverInfo?.version);

// 2. List tools
const listed = await rpc(sid, 2, 'tools/list', {});
const tools = listed.json.result?.tools ?? [];
console.log('\nTools:', tools.map(t => t.name).join(', '));

// 3. Call explain
const CODE = `
export class AgentMCPServer {
    private httpServer?: ReturnType<typeof createServer>;
    constructor(private readonly opts: AgentMCPServerOptions) {}

    private runWithEngine(prompt: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let output = '';
            const transport = new CallbackTransport((event) => {
                if (event.type === 'token') output += event.content;
                if (event.type === 'done')  resolve(output.trim() || '(no output)');
                if (event.type === 'error') reject(new Error(event.message));
            });
            const engine = this.opts.engineFactory(transport);
            engine.run(prompt).catch(reject);
        });
    }
}
`.trim();

console.log('\n--- Calling explain ---');
const explained = await rpc(sid, 3, 'tools/call', {
    name: 'explain',
    arguments: { code: CODE, language: 'typescript' },
});
const explainResult = explained.json.result?.content?.[0]?.text ?? explained.json;
console.log(explainResult);

// 4. Call review with focus=security
const REVIEW_CODE = `
async function loadUser(id: string) {
    const query = \`SELECT * FROM users WHERE id = '\${id}'\`;
    return db.execute(query);
}
`.trim();

console.log('\n--- Calling review (focus: security) ---');
const reviewed = await rpc(sid, 4, 'tools/call', {
    name: 'review',
    arguments: { code: REVIEW_CODE, language: 'typescript', focus: 'security' },
});
const reviewResult = reviewed.json.result?.content?.[0]?.text ?? reviewed.json;
console.log(reviewResult);

// 5. Call add_docstrings
const DOC_CODE = `
function calculateRetry(attempt: number, baseMs: number): number {
    return Math.min(baseMs * Math.pow(2, attempt), 30000);
}
`.trim();

console.log('\n--- Calling add_docstrings ---');
const docced = await rpc(sid, 5, 'tools/call', {
    name: 'add_docstrings',
    arguments: { code: DOC_CODE, language: 'typescript', style: 'JSDoc' },
});
const docResult = docced.json.result?.content?.[0]?.text ?? docced.json;
console.log(docResult);

console.log('\n=== Done ===');
