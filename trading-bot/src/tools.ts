/** The deterministic tools the LLM acts through. Everything that moves money is here, and checked by the risk gate. */
import { z } from 'zod';
import { defineTool, learnedRules, ToolError, type ToolDefinition } from '@backendkit-labs/agent-core';
import type { Market } from './market';
import type { PaperBroker } from './broker';
import { snapshot } from './indicators';
import { checkOrder, isEntryGuard, LIMITS } from './risk';

const round = (n: number | undefined, digits = 2): number | undefined => n === undefined ? undefined : Math.round(n * 10 ** digits) / 10 ** digits;

export interface ToolDeps {
    market: Market;
    broker: PaperBroker;
}

export function createTools({ market, broker }: ToolDeps): ToolDefinition[] {
    const symbol = z.string().describe(`One of: ${market.symbols.join(', ')}`);
    const known = (s: string): string => {
        if (!market.symbols.includes(s)) throw new ToolError('UNKNOWN_SYMBOL', `Unknown symbol ${s}. Use one of: ${market.symbols.join(', ')}.`);
        return s;
    };

    return [
        defineTool({
            name: 'get_candles', description: 'The latest daily candles of a symbol, up to now.', readOnly: true,
            input: z.object({ symbol, bars: z.number().int().min(1).max(60).default(20) }),
            execute: async ({ symbol: s, bars }) => JSON.stringify(
                market.history(known(s), broker.bar, bars).map(c => ({ bar: c.bar, o: round(c.open), h: round(c.high), l: round(c.low), c: round(c.close), v: c.volume })),
            ),
        }),
        defineTool({
            name: 'get_indicators', description: 'SMA20, SMA50, RSI14, ATR14, the 20-bar high, whether the last close is a breakout, and the trend (SMA20 against SMA50).', readOnly: true,
            input: z.object({ symbol }),
            execute: async ({ symbol: s }) => {
                const snap = snapshot(known(s), market.history(s, broker.bar));
                return JSON.stringify({
                    symbol: s, bar: snap.bar, close: round(snap.close), sma20: round(snap.sma20), sma50: round(snap.sma50), rsi14: round(snap.rsi14, 1),
                    atr14: round(snap.atr14), high20: round(snap.high20), breakout: snap.breakout, trend: snap.trend,
                    holding: broker.positions.has(s),
                });
            },
        }),
        defineTool({
            name: 'get_portfolio', description: 'Cash, equity, open positions with their stop and target, and the last closed trades.', readOnly: true,
            input: z.object({}),
            execute: async () => JSON.stringify({
                bar: broker.bar, cash: round(broker.cash), equity: round(broker.equity()),
                limits: { maxPositionPct: LIMITS.maxPositionPct, maxOpen: LIMITS.maxOpen },
                positions: [...broker.positions.values()].map(p => ({
                    symbol: p.symbol, qty: round(p.qty, 4), entry: round(p.entry), stop: round(p.stop), target: round(p.target), setup: p.setup,
                    unrealizedPct: round((broker.price(p.symbol) - p.entry) / p.entry * 100),
                })),
                lastTrades: broker.closed.slice(-5).map(t => ({ symbol: t.symbol, setup: t.setup, pnlPct: round(t.pnlPct), exit: t.exitReason, bars: t.barsHeld })),
            }),
        }),
        defineTool({
            name: 'place_order', description: `Buy at the last close. The risk gate decides: at most ${LIMITS.maxPositionPct}% of the equity per position, ${LIMITS.maxOpen} positions at once. State the setup honestly.`,
            readOnly: false,
            input: z.object({
                symbol,
                sizePct: z.number().min(1).max(100).describe('Share of the equity to put in, in percent'),
                stopAtr: z.number().min(0.5).max(5).default(1.5).describe('Stop distance in ATRs below the entry'),
                targetAtr: z.number().min(0.5).max(8).default(3).describe('Target distance in ATRs above the entry'),
                setup: z.enum(['breakout', 'pullback', 'other']),
                rationale: z.string().max(200),
            }),
            // What the author of the tool knows about each way an order is refused. The learning module puts the right one in
            // the prompt of the agent when the same refusal keeps happening.
            errorHints: {
                RISK_MAX_POSITION: `A position is at most ${LIMITS.maxPositionPct}% of the equity: send sizePct ${LIMITS.maxPositionPct} or less.`,
                RISK_MAX_OPEN: `At most ${LIMITS.maxOpen} positions at once: close one first, or wait.`,
                RISK_LOSS_LIMIT: `The loss limit of the last ${LIMITS.lossWindowBars} bars is reached: do not open positions until it clears.`,
                RISK_LEARNED_GUARD: 'A rule a person approved blocks this entry: do not retry it unchanged, look for a setup it does not block.',
                '*': 'The risk gate refused the order: read why and change the order; do not send it again as it was.',
            },
            execute: async (order, ctx) => {
                const snap = snapshot(known(order.symbol), market.history(order.symbol, broker.bar));
                // The rules a person approved, through the read-only view the framework gives the tool.
                const guards = (await learnedRules(ctx, isEntryGuard)).map(r => r.rule);
                checkOrder(order, broker, snap, guards);
                const p = broker.open(order.symbol, order.sizePct, order.stopAtr, order.targetAtr, order.setup, snap, order.rationale);
                return JSON.stringify({ opened: { symbol: p.symbol, qty: round(p.qty, 4), entry: round(p.entry), stop: round(p.stop), target: round(p.target) }, equity: round(broker.equity()) });
            },
        }),
        defineTool({
            name: 'close_position', description: 'Sell an open position at the last close.', readOnly: false,
            input: z.object({ symbol, reason: z.string().max(200) }),
            execute: async ({ symbol: s }) => {
                if (!broker.positions.has(known(s))) throw new ToolError('RISK_NO_POSITION', `No open position in ${s}.`);
                const t = broker.close(s, broker.price(s), 'manual');
                return JSON.stringify({ closed: { symbol: s, pnlPct: round(t.pnlPct) }, equity: round(broker.equity()) });
            },
        }),
    ];
}
