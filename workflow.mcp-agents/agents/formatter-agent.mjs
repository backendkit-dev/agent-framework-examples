#!/usr/bin/env node
/**
 * formatter-agent — takes flow results and formats them into a structured response.
 * Uses @backendkit-labs/agent-protocol (AgentServer) via CommonJS import.
 *
 * Env: FORMATTER_PORT (default 3302), AGENT_API_KEY (optional)
 */

import agentProtocol from '@backendkit-labs/agent-protocol';
const { AgentServer } = agentProtocol;

const PORT = parseInt(process.env.FORMATTER_PORT ?? '3302', 10);

const server = new AgentServer({
    name:        'formatter-agent',
    version:     '0.1.0',
    description: 'Formats flow step results into clear, structured markdown responses',
    port:        PORT,
    apiKey:      process.env.AGENT_API_KEY,
});

server.register({
    definition: {
        name:        'execute',
        description: 'Format prior step outputs into a structured markdown response',
        async:       false,
        input:  { task: 'string', flow_input: 'object?', prior_results: 'array?' },
        output: 'string (markdown)',
    },
    async execute(input) {
        const flowInput    = (input.flow_input ?? {});
        const priorResults = (input.prior_results ?? []);
        const question     = String(flowInput.question ?? flowInput.query ?? input.task ?? '');

        const classify = priorResults.find(r => r.step === 'classify');
        const search   = priorResults.find(r => r.step === 'search');

        let classifyData = null;
        if (classify?.output) {
            try { classifyData = JSON.parse(classify.output); } catch { /* raw string */ }
        }

        const hr   = '---';
        const lines = [`# Respuesta`];

        if (question) lines.push(``, `**Pregunta:** ${question}`);

        if (classifyData) {
            lines.push(
                `**Categoría:** \`${classifyData.category}\``,
                `**Prioridad:** \`${classifyData.priority}\``,
                `**Query de búsqueda:** \`${classifyData.query}\``,
            );
        }

        if (search?.output && String(search.output).trim()) {
            lines.push(``, `## Conocimiento Relevante`, ``);
            lines.push(String(search.output));
        } else {
            lines.push(``, `> No se encontraron resultados en el vault para esta consulta.`);
        }

        lines.push(``, hr, `*Generado por \`workflow.mcp-agents\` · orchestrator-mcp-agent*`);

        return lines.join('\n');
    },
});

await server.start();
process.stderr.write(`[formatter-agent] ready on :${PORT}\n`);
