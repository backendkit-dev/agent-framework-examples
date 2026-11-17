/** The agents of the desk and the `StepExecutor` that runs a flow step as one of them. */
import { createBaseEngine, type AgentProfile, type FlowStep, type LLMProvider, type StepExecutor, type StepInput, type StepOutput } from '@backendkit-labs/agent-core';
import { mockTransport } from '@backendkit-labs/agent-testkit';
import type { Market } from './market';
import type { PaperBroker } from './broker';
import { createTools } from './tools';
import type { DeskAgent } from './desk-flow';

interface Role { prompt: string; tools: string[] }

export const ROLES: Record<DeskAgent, Role> = {
    technical: {
        tools: ['get_indicators'],
        prompt: 'ROLE:technical. You are a technical analyst. Call get_indicators for the symbol and answer in one line: "VERDICT: BULLISH|NEUTRAL|BEARISH" and why (breakout, trend, RSI).',
    },
    regime: {
        tools: ['get_candles'],
        prompt: 'ROLE:regime. You study volatility. Call get_candles (20 bars) for the symbol and answer in one line: "REGIME: calm|volatile" and the evidence.',
    },
    risk: {
        tools: ['get_portfolio'],
        prompt: 'ROLE:risk. You watch exposure. Call get_portfolio and answer in one line: "ROOM: yes|no" (is there room for a new position under the limits) and what is open.',
    },
    decider: {
        tools: [],
        prompt: 'ROLE:decider. You receive the analysis of three analysts and decide. Answer in one line: "DECISION: ENTER size=<pct> setup=<breakout|pullback|other> stopAtr=<n> targetAtr=<n>" or "DECISION: SKIP (<reason>)". If an analysis is missing, be conservative.',
    },
    executor: {
        tools: ['place_order'],
        prompt: 'ROLE:executor. You carry out the decision you are given. For ENTER call place_order with those values. For SKIP do nothing. Answer in one line with what happened.',
    },
};

const profile = (id: DeskAgent): AgentProfile => ({
    id, name: id, icon: '*', description: `Desk agent: ${id}`, systemPrompt: ROLES[id].prompt, allowedTools: ROLES[id].tools, delegatesTo: [],
});

export interface StepTrace { key: string; flow: string; step: string; agent: string; start: number; end: number; ok: boolean }

export interface DeskExecutorOptions {
    provider: LLMProvider;
    market: Market;
    broker: PaperBroker;
    workingDir: string;
    /** Makes each step take a while (a real model does), so that concurrency can be observed. Default 0. */
    delayMs?: number;
    /** Steps by this agent fail on purpose. */
    failAgents?: Set<string>;
    /** Steps by this agent never finish (the process "dies" in them). */
    hangAgents?: Set<string>;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Runs a step as the agent it names: a small engine with that agent's prompt and only its tools. The executor knows nothing
 * about flows, journals or approvals: that is the engine's job, and what makes the desk testable.
 */
export class DeskExecutor implements StepExecutor {
    readonly traces: StepTrace[] = [];
    /** Steps with an external effect use the idempotency key: the same key answers with what it did the first time. */
    private readonly effects = new Map<string, string>();
    private active = new Map<string, number>();
    readonly maxActive = new Map<string, number>();
    /** Orders the executor agent sent, by what the risk gate answered (counted from the tool calls, not from what the model says). */
    readonly orders = { placed: 0, refused: 0 };

    constructor(private readonly o: DeskExecutorOptions) {}

    async run(step: FlowStep, input: StepInput): Promise<StepOutput> {
        const agent = step.agent as DeskAgent;
        const done = this.effects.get(input.idempotencyKey);
        if (agent === 'executor' && done !== undefined) return { content: done };

        const n = (this.active.get(agent) ?? 0) + 1;
        this.active.set(agent, n);
        this.maxActive.set(agent, Math.max(this.maxActive.get(agent) ?? 0, n));
        const trace: StepTrace = { key: input.idempotencyKey, flow: input.idempotencyKey.split(':')[0], step: step.id, agent, start: Date.now(), end: 0, ok: false };
        this.traces.push(trace);
        try {
            if (this.o.delayMs) await sleep(this.o.delayMs);
            if (this.o.hangAgents?.has(agent)) await new Promise<never>(() => undefined);
            if (this.o.failAgents?.has(agent)) throw new Error(`${agent} is down`);

            const { transport } = mockTransport();
            const tools = createTools({ market: this.o.market, broker: this.o.broker });
            const engine = createBaseEngine({
                providers: { main: this.o.provider }, defaultProvider: 'main',
                agents: [profile(agent)], defaultAgent: agent, tools, transport,
                workingDir: this.o.workingDir, iterationMode: 'auto', maxIterations: 6,
            });
            const result = await engine.run(input.context ? `${input.prompt}\n\nAnalysis so far:\n${input.context}` : input.prompt);
            for (const c of result.toolCalls) if (c.name === 'place_order') { if (c.success) this.orders.placed++; else this.orders.refused++; }
            const text = result.text.replace(/\s+/g, ' ').trim();
            if (agent === 'executor') this.effects.set(input.idempotencyKey, text);
            trace.ok = true;
            return { content: text };
        } finally {
            trace.end = Date.now();
            this.active.set(agent, (this.active.get(agent) ?? 1) - 1);
        }
    }
}
