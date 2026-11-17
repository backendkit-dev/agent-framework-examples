/**
 * The learning of the bot. A losing trade is not a tool error (the order was accepted), so the audit sink never sees it:
 * when a position closes, deterministic code reports it with `trackOutcome`. Winners are reported too, so that a failure is
 * judged against how often *that* entry works.
 */
import { createLearning, type Learning, type LearnedPattern } from '@backendkit-labs/agent-core';
import type { ClosedTrade } from './broker';
import type { EntryGuard } from './risk';
import type { TrendBucket } from './indicators';

export const TRADER_ID = 'trader';

const ADVICE: Record<TrendBucket, string> = {
    trend_flat: 'Breakouts while the 20/50 averages are flat (no trend) hit the stop within a few bars. Take a breakout only when SMA20 is more than 0.5% above SMA50.',
    trend_down: 'Breakouts against a falling trend fail: do not buy breakouts while SMA20 is more than 0.5% below SMA50.',
    trend_up: 'A breakout in an uptrend still failed: check how stretched the price is from SMA20 before entering.',
};

/**
 * What the trade is about is the setup (`breakout`), and the circumstances are the trend it was taken in (`trend_flat`): the
 * learning module judges a failure against how often *that* entry works, within its context. A breakout stopped out within a
 * few bars is a false breakout.
 */
export function classify(trade: ClosedTrade): { ok: boolean; kind?: string; subject: string; context: string; detail?: string } {
    const base = { subject: trade.setup, context: trade.context.trend };
    if (trade.pnl > 0) return { ok: true, ...base };
    if (trade.setup === 'breakout' && trade.exitReason === 'stop' && trade.barsHeld <= 6) {
        return { ok: false, kind: 'false_breakout', ...base, detail: ADVICE[trade.context.trend] };
    }
    return { ok: false, kind: 'loss_other', ...base };
}

/** The rule a pattern of false breakouts proposes: do not take that setup in that kind of trend. */
export function ruleFor(pattern: LearnedPattern): EntryGuard | undefined {
    if (pattern.domain !== 'trade' || pattern.kind !== 'false_breakout' || pattern.subject !== 'breakout') return undefined;
    if (pattern.context !== 'trend_flat' && pattern.context !== 'trend_down') return undefined;
    return {
        kind: 'entry_guard', setup: 'breakout', block: pattern.context,
        reason: `${pattern.count} breakout entries stopped out within a few bars while the trend was ${pattern.context}`,
    };
}

/** One simulated bar is one simulated day. */
export const SIM_START = Date.UTC(2030, 0, 1);
export const DAY_MS = 86_400_000;

/**
 * The bench runs in simulated time (`stamp: 'clock'`): the experiences, the counters and the window all use the clock of the
 * simulation. The window is measured in simulated days, so it is set to 120 bars: the false breakouts of one kind of trend are
 * far apart, and the default of 30 would forget them before three of them had happened.
 */
export function createTradingLearning(dir: string, now: () => Date = () => new Date(SIM_START)): Learning {
    return createLearning({
        dir, ruleFor, now, stamp: 'clock', window: { days: 120 },
        // A pattern needs to be a real share of the entries of its kind: breakouts in an uptrend lose too, but most of them win.
        rate: { minFailureRate: 0.5, minCalls: 8 },
    });
}

export function recordTrade(learning: Learning, trade: ClosedTrade) {
    const c = classify(trade);
    return learning.trackOutcome({
        agentId: TRADER_ID, domain: 'trade', subject: c.subject, context: c.context, ok: c.ok,
        ...(c.kind ? { kind: c.kind } : {}), ...(c.detail ? { detail: c.detail } : {}),
        severity: c.ok ? 'low' : c.kind === 'false_breakout' ? 'medium' : 'low',
        situation: `${trade.symbol} ${trade.setup} entry (${trade.context.trend})`, action: `buy ${trade.symbol}`,
        meta: { simBar: trade.exitBar, symbol: trade.symbol, pnlPct: Math.round(trade.pnlPct * 100) / 100, barsHeld: trade.barsHeld },
    });
}
