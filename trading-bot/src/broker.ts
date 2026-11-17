/** A paper broker: long only, fills at the close, stops and targets checked against the next bars. No real money. */
import type { Market } from './market';
import type { Snapshot, TrendBucket } from './indicators';

export type Setup = 'breakout' | 'pullback' | 'other';

export interface EntryContext {
    trend: TrendBucket;
    rsi?: number;
    atr?: number;
    breakout: boolean;
}

export interface Position {
    symbol: string;
    qty: number;
    entry: number;
    stop: number;
    target: number;
    openedBar: number;
    setup: Setup;
    context: EntryContext;
    rationale: string;
}

export type ExitReason = 'stop' | 'target' | 'manual' | 'end';

export interface ClosedTrade {
    symbol: string;
    setup: Setup;
    context: EntryContext;
    entryBar: number;
    exitBar: number;
    barsHeld: number;
    entry: number;
    exit: number;
    pnl: number;
    pnlPct: number;
    exitReason: ExitReason;
}

export const FEE = 0.001;

export class PaperBroker {
    cash: number;
    readonly positions = new Map<string, Position>();
    readonly closed: ClosedTrade[] = [];
    readonly startingCash: number;
    /** The bar the broker is at: the last one it has processed. */
    bar = 0;

    constructor(readonly market: Market, startingCash = 10_000) {
        this.cash = startingCash;
        this.startingCash = startingCash;
    }

    price(symbol: string): number {
        return this.market.candle(symbol, this.bar).close;
    }

    positionsValue(): number {
        let total = 0;
        for (const p of this.positions.values()) total += p.qty * this.price(p.symbol);
        return total;
    }

    /** Cash plus the market value of the positions. Fees are already out of the cash. */
    equity(): number {
        return this.cash + this.positionsValue();
    }

    open(symbol: string, sizePct: number, stopAtr: number, targetAtr: number, setup: Setup, snap: Snapshot, rationale: string): Position {
        const price = this.price(symbol);
        const atr = snap.atr14 ?? price * 0.02;
        const value = this.equity() * sizePct / 100;
        const qty = value / (price * (1 + FEE));
        this.cash -= qty * price * (1 + FEE);
        const position: Position = {
            symbol, qty, entry: price, stop: price - stopAtr * atr, target: price + targetAtr * atr, openedBar: this.bar, setup,
            context: { trend: snap.trend, rsi: snap.rsi14, atr: snap.atr14, breakout: snap.breakout }, rationale,
        };
        this.positions.set(symbol, position);
        return position;
    }

    close(symbol: string, price: number, reason: ExitReason): ClosedTrade {
        const p = this.positions.get(symbol);
        if (!p) throw new Error(`No position in ${symbol}`);
        this.positions.delete(symbol);
        const proceeds = p.qty * price * (1 - FEE);
        this.cash += proceeds;
        const cost = p.qty * p.entry * (1 + FEE);
        const trade: ClosedTrade = {
            symbol, setup: p.setup, context: p.context, entryBar: p.openedBar, exitBar: this.bar, barsHeld: this.bar - p.openedBar,
            entry: p.entry, exit: price, pnl: proceeds - cost, pnlPct: (proceeds - cost) / cost * 100, exitReason: reason,
        };
        this.closed.push(trade);
        return trade;
    }

    /** Moves to `bar`, closes what the bar's range hit (the stop first when it hit both), and returns those trades. */
    advanceTo(bar: number): ClosedTrade[] {
        this.bar = bar;
        const out: ClosedTrade[] = [];
        for (const p of [...this.positions.values()]) {
            const c = this.market.candle(p.symbol, bar);
            if (c.low <= p.stop) out.push(this.close(p.symbol, Math.min(p.stop, c.open), 'stop'));
            else if (c.high >= p.target) out.push(this.close(p.symbol, Math.max(p.target, c.open), 'target'));
        }
        return out;
    }

    /** Realized loss over the last `bars` bars, as a share of the equity (0 when there was none). */
    recentLossPct(bars: number): number {
        const since = this.bar - bars;
        const loss = this.closed.filter(t => t.exitBar > since && t.pnl < 0).reduce((s, t) => s - t.pnl, 0);
        return loss / this.equity() * 100;
    }
}
