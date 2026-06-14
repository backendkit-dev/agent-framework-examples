import 'dotenv/config';
import { AgentServer } from '@backendkit-labs/agent-protocol';
import type { CapabilityDefinition } from '@backendkit-labs/agent-protocol';
import { synthesize } from './engine';

const PORT = parseInt(process.env.SYNTHESIZER_PORT ?? '3303', 10);

function buildPrompt(input: Record<string, unknown>): string {
    const priorResults = (input['prior_results'] as Array<{ step: string; agent: string; output: string }>) ?? [];
    const flowInput    = (input['flow_input']    as Record<string, unknown>) ?? {};

    const classifyResult = priorResults.find(r => r.step === 'classify');
    const searchResult   = priorResults.find(r => r.step === 'search');

    let classify: Record<string, string> = {};
    try { classify = JSON.parse(classifyResult?.output ?? '{}'); } catch { /* not JSON */ }

    const question     = classify['original'] ?? String(flowInput['question'] ?? 'Sin pregunta');
    const category     = classify['category'] ?? 'general';
    const searchQuery  = classify['query']    ?? question;
    const vaultContent = searchResult?.output ?? 'No vault results found.';

    return `Synthesize a knowledge base response for the following:

Original question: ${question}
Category: ${category}
Search query used: ${searchQuery}

Vault search results:
---
${vaultContent}
---

Analyze the question and vault content, then delegate to the writer with precise instructions
to produce a complete, accurate answer. The writer must respond in the same language as the question.`;
}

const executeDefinition: CapabilityDefinition = {
    name:        'execute',
    description: 'Synthesize vault search results into a coherent answer using planner + writer LLM agents',
    async:       false,
    input: {
        task:          { type: 'string', required: false, description: 'Task description from the orchestrator' },
        flow_input:    { type: 'object', required: false, description: 'Original flow input data' },
        prior_results: { type: 'array',  required: false, description: 'Results from previous steps (classify, search)' },
    },
    output: {
        result: { type: 'string', required: true, description: 'Synthesized markdown answer' },
    },
};

const server = new AgentServer({
    name:        'synthesizer',
    version:     '1.0.0',
    description: 'LLM multi-agent synthesizer: planner + writer produce coherent answers from vault content',
    port:        PORT,
});

server.register({
    definition: executeDefinition,
    execute:    async (input) => {
        const result = await synthesize(buildPrompt(input));
        return result || 'No se pudo sintetizar una respuesta.';
    },
});

void (async () => {
    await server.start();
    process.stderr.write(`[synthesizer-agent] ready on :${PORT}\n`);
})();
