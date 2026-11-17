/**
 * The risk gate: deterministic, and the last word. The LLM proposes; this decides. Besides its fixed limits it enforces the
 * entry guards that a person approved after the bot's own trades suggested them (rules of the learning module).
 */
import { ToolError } from '@backendkit-labs/agent-core';
import type { PaperBroker, Setup } from './broker';
import type { Snapshot, TrendBucket } from './indicators';

export const LIMITS = { maxPositionPct: 25, maxOpen: 2, lossLimitPct: 3, lossWindowBars: 5 } as const;

/** What a person approved after seeing a pattern of losing trades: do not enter this setup in this kind of trend. */
export interface EntryGuard {
    kind: 'entry_guard';
    setup: Setup;
    block: TrendBucket;
    reason: string;
}

export const isEntryGuard = (value: unknown): value is EntryGuard => {
    const r = value as Partial<EntryGuard> | null;
    return !!r && r.kind === 'entry_guard' && typeof r.setup === 'string' && typeof r.block === 'string';
};

export interface OrderRequest {
    symbol: string;
    sizePct: number;
    setup: Setup;
}

/** `guards` are the approved rules of the bot: the tool reads them from the framework (`learnedRules`), this does not own a store. */
export function checkOrder(order: OrderRequest, broker: PaperBroker, snap: Snapshot, guards: EntryGuard[]): void {
    if (snap.atr14 === undefined) throw new ToolError('RISK_NO_DATA', 'Not enough history to size the stop yet.');
    if (broker.positions.has(order.symbol)) throw new ToolError('RISK_ALREADY_OPEN', `Already holding ${order.symbol}.`);
    if (order.sizePct > LIMITS.maxPositionPct) {
        throw new ToolError('RISK_MAX_POSITION', `A position is at most ${LIMITS.maxPositionPct}% of the equity; asked for ${order.sizePct}%.`);
    }
    if (broker.positions.size >= LIMITS.maxOpen) throw new ToolError('RISK_MAX_OPEN', `At most ${LIMITS.maxOpen} positions at once.`);
    if (broker.recentLossPct(LIMITS.lossWindowBars) >= LIMITS.lossLimitPct) {
        throw new ToolError('RISK_LOSS_LIMIT', `Realized loss of the last ${LIMITS.lossWindowBars} bars reached ${LIMITS.lossLimitPct}% of the equity.`);
    }
    for (const guard of guards) {
        if (guard.setup === order.setup && guard.block === snap.trend) {
            throw new ToolError('RISK_LEARNED_GUARD', `An approved rule blocks ${order.setup} entries when the trend is ${snap.trend}: ${guard.reason}`);
        }
    }
}
