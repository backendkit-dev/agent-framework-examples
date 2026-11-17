/**
 * A stand-in for the LLM, so that the bench runs offline, fast and the same every time. It checks the plumbing (tools, memory,
 * learning, the risk gate), NOT the intelligence of a model.
 *
 * It is a naive trader: it buys every breakout with an oversized position. `readsLessons` makes it read its own system
 * prompt and follow what the lessons say (the size the hint gives, the trend a lesson asks for). That is a scripted
 * imitation of a model that reads its prompt, nothing more: whether a real model does it is what `live.ts` is for.
 */
import type { LLMMessage, LLMProvider, LLMStreamCallbacks } from '@backendkit-labs/agent-core';

export interface MockTraderOptions {
    readsLessons: boolean;
    /** What it asks for before it has read any lesson. Above the limit of the risk gate on purpose. */
    naiveSizePct?: number;
}

interface Indicators { symbol: string; breakout: boolean; trend: string; holding: boolean }

const parseJson = <T>(text: string | null): T | undefined => {
    try { return text ? JSON.parse(text) as T : undefined; } catch { return undefined; }
};

export function createMockTrader(options: MockTraderOptions): LLMProvider {
    const naive = options.naiveSizePct ?? 40;

    function say(cb: LLMStreamCallbacks, calls: Array<{ name: string; args: Record<string, unknown> }>, text?: string): void {
        // A real model reports what it used: the budget of the engine runs on it.
        cb.onMetrics?.(1000, 100);
        if (calls.length === 0) {
            cb.onChunk?.(text ?? '');
            cb.onDone({ role: 'assistant', content: text ?? '' });
            return;
        }
        const tool_calls = calls.map((c, i) => ({ id: `mock-${Date.now()}-${i}`, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } }));
        for (const c of tool_calls) cb.onToolCall?.(c.function.name, c.function.arguments, c.id);
        cb.onDone({ role: 'assistant', content: null, tool_calls });
    }

    return {
        async chat(messages: LLMMessage[], _tools, callbacks) {
            const system = messages.find(m => m.role === 'system')?.content ?? '';
            const lastUser = messages.map(m => m.role).lastIndexOf('user');
            const turn = messages.slice(lastUser + 1);
            const rounds = turn.filter(m => m.role === 'assistant' && m.tool_calls?.length).length;
            const symbols = (messages[lastUser]?.content?.match(/Symbols: ([^.]+)\./)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);

            // 1. Look: the portfolio and the indicators of every symbol.
            if (rounds === 0) {
                return say(callbacks, [{ name: 'get_portfolio', args: {} }, ...symbols.map(symbol => ({ name: 'get_indicators', args: { symbol } }))]);
            }

            // 2. Decide: at most one new position per session.
            if (rounds === 1) {
                const seen = turn.filter(m => m.role === 'tool').map(m => parseJson<Indicators>(m.content)).filter((i): i is Indicators => !!i && 'breakout' in i);
                const sizeCap = options.readsLessons ? Number(/sizePct (\d+) or less/.exec(system)?.[1]) || undefined : undefined;
                const wantsTrend = options.readsLessons && /SMA20 is more than 0\.5% above SMA50/.test(system);
                const pick = seen.find(i => i.breakout && !i.holding && (!wantsTrend || i.trend === 'trend_up'));
                if (!pick) return say(callbacks, [], 'No entry today.');
                return say(callbacks, [{
                    name: 'place_order',
                    args: { symbol: pick.symbol, sizePct: sizeCap ?? naive, stopAtr: 1.5, targetAtr: 3, setup: 'breakout', rationale: `Breakout in ${pick.symbol}` },
                }]);
            }

            // 3. Report.
            const result = turn.filter(m => m.role === 'tool').pop()?.content ?? '';
            return say(callbacks, [], result.startsWith('Error') ? `The order was refused: ${result.slice(0, 120)}` : 'Entered.');
        },
    };
}
