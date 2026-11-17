/**
 * A stand-in for the models of the desk, offline and deterministic: it reads the ROLE in the system prompt and behaves as that
 * agent. It checks the plumbing of the flow (parallel steps, context between steps, approval, resume), NOT the intelligence of a
 * model: only `desk-live.ts` says anything about a real LLM.
 */
import type { LLMMessage, LLMProvider, LLMStreamCallbacks } from '@backendkit-labs/agent-core';

const json = <T>(text: string | null | undefined): T | undefined => { try { return text ? JSON.parse(text) as T : undefined; } catch { return undefined; } };

function say(cb: LLMStreamCallbacks, calls: Array<{ name: string; args: Record<string, unknown> }>, text = ''): void {
    cb.onMetrics?.(800, 80);
    if (calls.length === 0) { cb.onChunk?.(text); cb.onDone({ role: 'assistant', content: text }); return; }
    const tool_calls = calls.map((c, i) => ({ id: `d-${Date.now()}-${i}`, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } }));
    for (const c of tool_calls) cb.onToolCall?.(c.function.name, c.function.arguments, c.id);
    cb.onDone({ role: 'assistant', content: null, tool_calls });
}

export interface DeskMockOptions {
    /** Size the decider asks for when it enters. */
    sizePct?: number;
    /** Enter on any breakout, not only in an uptrend (a naive decider). */
    anyBreakout?: boolean;
}

export function createDeskMock(options: DeskMockOptions = {}): LLMProvider {
    const size = options.sizePct ?? 15;
    return {
        async chat(messages: LLMMessage[], _tools, cb) {
            const system = messages.find(m => m.role === 'system')?.content ?? '';
            const lastUser = messages.map(m => m.role).lastIndexOf('user');
            const user = messages[lastUser]?.content ?? '';
            const symbol = /Symbol (\S+?),/.exec(user)?.[1] ?? '';
            const turn = messages.slice(lastUser + 1);
            const rounds = turn.filter(m => m.role === 'assistant' && m.tool_calls?.length).length;
            const toolResult = turn.filter(m => m.role === 'tool').pop()?.content ?? '';
            const role = /ROLE:(\w+)/.exec(system)?.[1];

            switch (role) {
                case 'technical': {
                    if (rounds === 0) return say(cb, [{ name: 'get_indicators', args: { symbol } }]);
                    const i = json<{ breakout: boolean; trend: string; rsi14?: number }>(toolResult);
                    const verdict = !i ? 'NEUTRAL' : i.trend === 'trend_down' ? 'BEARISH' : i.breakout && (i.trend === 'trend_up' || options.anyBreakout) ? 'BULLISH' : 'NEUTRAL';
                    return say(cb, [], `VERDICT: ${verdict}. breakout=${i?.breakout} trend=${i?.trend} rsi=${i?.rsi14}`);
                }
                case 'regime': {
                    if (rounds === 0) return say(cb, [{ name: 'get_candles', args: { symbol, bars: 20 } }]);
                    const c = json<Array<{ c: number }>>(toolResult) ?? [];
                    const r = c.slice(1).map((x, k) => x.c / c[k].c - 1);
                    const mean = r.reduce((a, b) => a + b, 0) / (r.length || 1);
                    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length || 1));
                    return say(cb, [], `REGIME: ${sd > 0.015 ? 'volatile' : 'calm'}. daily sd ${(sd * 100).toFixed(2)}% over ${c.length} bars`);
                }
                case 'risk': {
                    if (rounds === 0) return say(cb, [{ name: 'get_portfolio', args: {} }]);
                    const p = json<{ positions: Array<{ symbol: string }>; limits: { maxOpen: number } }>(toolResult);
                    const open = p?.positions.length ?? 0;
                    const holding = p?.positions.some(x => x.symbol === symbol);
                    return say(cb, [], `ROOM: ${p && open < p.limits.maxOpen && !holding ? 'yes' : 'no'}. open=${open}${holding ? ` (already in ${symbol})` : ''}`);
                }
                case 'decider': {
                    const missing = ['VERDICT', 'REGIME', 'ROOM'].filter(k => !user.includes(`${k}:`));
                    if (missing.length) return say(cb, [], `DECISION: SKIP (incomplete analysis: missing ${missing.join(', ')})`);
                    const ok = user.includes('VERDICT: BULLISH') && user.includes('ROOM: yes') && !user.includes('REGIME: volatile');
                    return say(cb, [], ok ? `DECISION: ENTER size=${size} setup=breakout stopAtr=1.5 targetAtr=3` : 'DECISION: SKIP (conditions not met)');
                }
                case 'executor': {
                    if (rounds === 0) {
                        const m = /DECISION: ENTER size=(\d+) setup=(\w+) stopAtr=([\d.]+) targetAtr=([\d.]+)/.exec(user);
                        if (!m) return say(cb, [], 'Nothing to execute.');
                        return say(cb, [{ name: 'place_order', args: { symbol, sizePct: Number(m[1]), setup: m[2], stopAtr: Number(m[3]), targetAtr: Number(m[4]), rationale: 'desk decision' } }]);
                    }
                    return say(cb, [], toolResult.startsWith('Error') ? `Refused: ${toolResult.slice(0, 100)}` : `Order placed: ${toolResult.slice(0, 100)}`);
                }
                default:
                    return say(cb, [], 'unknown role');
            }
        },
    };
}
