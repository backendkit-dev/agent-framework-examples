import { createBaseEngine, CallbackTransport } from '@backendkit-labs/agent-core';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import { OpenAICompatibleProvider } from '@backendkit-labs/agent-coding';
import { PLANNER } from './agents/planner';
import { WRITER }  from './agents/writer';

// Provider singleton — reused across requests (just an HTTP client wrapper)
const provider = new OpenAICompatibleProvider({
    apiKey:      process.env.LLM_API_KEY  ?? '',
    baseUrl:     process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
    model:       process.env.LLM_MODEL    ?? 'deepseek-chat',
    temperature: 0.4,
    maxTokens:   4096,
});

export async function synthesize(prompt: string): Promise<string> {
    let output = '';

    const transport = new CallbackTransport((event: AgentEvent) => {
        // Capture only the writer's tokens — the final synthesized content.
        // The planner's tokens are coordination overhead; the writer produces the answer.
        if (event.type === 'token' && (event as Record<string, unknown>)['agent_id'] === 'writer') {
            output += event.content;
        }
    });

    const engine = createBaseEngine({
        providers:       { llm: provider },
        defaultProvider: 'llm',
        agents:          [PLANNER, WRITER],
        defaultAgent:    'planner',
        transport,
        maxIterations:   20,
    });

    await engine.run(prompt);
    return output.trim();
}
