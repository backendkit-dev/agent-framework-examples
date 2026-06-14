#!/usr/bin/env node
/**
 * triage-agent — classifies an incoming question and extracts a search query.
 * Uses @backendkit-labs/agent-protocol (AgentServer) via CommonJS import.
 *
 * Env: TRIAGE_PORT (default 3301), AGENT_API_KEY (optional)
 */

import agentProtocol from '@backendkit-labs/agent-protocol';
const { AgentServer } = agentProtocol;

const PORT = parseInt(process.env.TRIAGE_PORT ?? '3301', 10);

const server = new AgentServer({
    name:        'triage-agent',
    version:     '0.1.0',
    description: 'Classifies incoming questions and extracts precise search queries',
    port:        PORT,
    apiKey:      process.env.AGENT_API_KEY,
});

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'in', 'on', 'at', 'for', 'to', 'of',
    'and', 'or', 'how', 'what', 'why', 'when', 'where', 'i', 'we',
    'you', 'me', 'my', 'this', 'that', 'with', 'about', 'can',
]);

server.register({
    definition: {
        name:        'execute',
        description: 'Classify a question and extract a precise search query',
        async:       false,
        input:  { task: 'string', flow_input: 'object?', prior_results: 'array?' },
        output: 'string (JSON: { category, query, priority, original })',
    },
    async execute(input) {
        const task      = String(input.task ?? '');
        const flowInput = (input.flow_input ?? {});
        const question  = String(flowInput.question ?? flowInput.query ?? task);

        // Classify by keyword
        let category = 'general';
        let priority = 'normal';

        if (/error|bug|fail|crash|broken|exception|not working/i.test(question)) {
            category = 'technical-issue';
            priority = 'high';
        } else if (/design|architecture|pattern|structure|how.*(build|implement|create)/i.test(question)) {
            category = 'architecture';
        } else if (/\b(agent|mcp|llm|model|embedding|rag|vector|knowledge)\b/i.test(question)) {
            category = 'ai-systems';
        } else if (/how|guide|tutorial|explain|what is|define/i.test(question)) {
            category = 'knowledge';
        }

        // Extract search terms: strip stop words and punctuation
        const query = question
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w))
            .slice(0, 8)
            .join(' ') || question;

        return JSON.stringify({ category, query, priority, original: question }, null, 2);
    },
});

await server.start();
process.stderr.write(`[triage-agent] ready on :${PORT}\n`);
