/** The agent: an LLM that reasons, the deterministic tools that act, memory, and learning. */
import { createBaseEngine, type AgentEngine, type AgentEvent, type AgentProfile, type Learning, type LLMProvider, type MemorySystem, type RunResult } from '@backendkit-labs/agent-core';
import { mockTransport } from '@backendkit-labs/agent-testkit';
import type { Market } from './market';
import type { PaperBroker } from './broker';
import { createTools } from './tools';
import { TRADER_ID } from './learning';

export const MEMORY_TOOLS = ['memory_remember', 'memory_recall', 'memory_save_knowledge', 'memory_search_knowledge'];

export const TRADER_PROMPT = `You are a disciplined swing trader of a PAPER portfolio: the market is simulated and no real money is involved.
Each session you receive the latest daily bar. Work like this:
1. get_portfolio, then get_indicators for every symbol.
2. Use memory_recall to remember how similar trades went before you open one.
3. Open at most one new position per session with place_order, stating the setup honestly (breakout, pullback or other) and a one-line rationale. Or close one with close_position. Or do nothing: not trading is a decision too.
4. Answer with one line: what you did and why.
Position sizes are a percentage of the equity. The risk gate may refuse an order: read why and adjust, never send the same order again.`;

export function traderProfile(allowedTools: string[]): AgentProfile {
    return {
        id: TRADER_ID, name: 'Trader', icon: '$', description: 'Paper-trading agent', systemPrompt: TRADER_PROMPT,
        allowedTools, delegatesTo: [],
    };
}

export interface TraderOptions {
    provider: LLMProvider;
    market: Market;
    broker: PaperBroker;
    workingDir: string;
    memory?: MemorySystem;
    learning?: Learning;
    /** Extra options for the engine, e.g. a cost budget for a live run. */
    engine?: Record<string, unknown>;
}

export interface Trader {
    engine: AgentEngine;
    /** The system prompt of every LLM call, in order (the engine reports them: `emitSystemPrompt`). */
    prompts: string[];
    /** Every event of the engine. */
    events: AgentEvent[];
    /** Runs a session and keeps its prompts. */
    run(input: string): Promise<RunResult>;
}

export function createTrader(o: TraderOptions): Trader {
    const { transport, events } = mockTransport();
    const tools = createTools({ market: o.market, broker: o.broker });
    const prompts: string[] = [];
    const engine = createBaseEngine({
        providers: { main: o.provider }, defaultProvider: 'main',
        agents: [traderProfile([...tools.map(t => t.name), ...(o.memory ? MEMORY_TOOLS : [])])], defaultAgent: TRADER_ID,
        tools,
        ...(o.memory ? { memorySystem: o.memory } : {}),
        ...(o.learning ? { learning: o.learning } : {}),
        transport, emitSystemPrompt: true,
        workingDir: o.workingDir, iterationMode: 'auto', maxIterations: 8,
        ...(o.engine ?? {}),
    });
    return {
        engine, prompts, events,
        async run(input) {
            const result = await engine.run(input);
            prompts.push(...result.systemPrompts);
            return result;
        },
    };
}
