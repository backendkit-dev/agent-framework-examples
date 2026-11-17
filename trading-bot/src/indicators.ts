/** Indicators: pure functions of the candles, so the same data always gives the same numbers. */
import type { Candle } from './market';

export const sma = (values: number[], period: number): number | undefined => {
    if (values.length < period) return undefined;
    const slice = values.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
};

/** Wilder's RSI. */
export const rsi = (closes: number[], period = 14): number | undefined => {
    if (closes.length <= period) return undefined;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gain += d; else loss -= d;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
};

export const atr = (candles: Candle[], period = 14): number | undefined => {
    if (candles.length <= period) return undefined;
    const ranges = candles.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close)));
    return sma(ranges, period);
};

export type TrendBucket = 'trend_up' | 'trend_flat' | 'trend_down';

export interface Snapshot {
    symbol: string;
    bar: number;
    close: number;
    sma20?: number;
    sma50?: number;
    rsi14?: number;
    atr14?: number;
    /** The highest high of the 20 bars before this one. */
    high20?: number;
    /** The close broke above the highest high of the previous 20 bars. */
    breakout: boolean;
    /** SMA20 against SMA50: up when it is more than 0.5% above, down when more than 0.5% below, flat between. */
    trend: TrendBucket;
}

export function snapshot(symbol: string, candles: Candle[]): Snapshot {
    const closes = candles.map(c => c.close);
    const last = candles[candles.length - 1];
    const before = candles.slice(-21, -1);
    const high20 = before.length === 20 ? Math.max(...before.map(c => c.high)) : undefined;
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    let trend: TrendBucket = 'trend_flat';
    if (sma20 !== undefined && sma50 !== undefined) {
        const spread = (sma20 - sma50) / sma50;
        trend = spread > 0.005 ? 'trend_up' : spread < -0.005 ? 'trend_down' : 'trend_flat';
    }
    return {
        symbol, bar: last.bar, close: last.close, sma20, sma50, rsi14: rsi(closes), atr14: atr(candles),
        high20, breakout: high20 !== undefined && last.close > high20, trend,
    };
}
