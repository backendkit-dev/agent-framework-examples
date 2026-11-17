/**
 * A synthetic market. Same seed, same candles: the whole bench is reproducible.
 *
 * Three regimes alternate. In a `range` the price is pulled back to an anchor and, now and then, spikes through the recent
 * high and falls back at once (a false breakout). In a trend, breakouts keep going. The regime is never shown to the bot: it
 * has to find out, from its own trades, which breakouts are worth taking.
 */

export interface Candle {
    bar: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export type Regime = 'trend_up' | 'trend_down' | 'range';

/** mulberry32: small, fast and the same on every machine. */
export function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const gauss = (rand: () => number): number => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

const hash = (text: string): number => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
};

export interface MarketOptions {
    seed: number;
    bars: number;
    symbols?: string[];
}

export class Market {
    readonly symbols: string[];
    private readonly series = new Map<string, Candle[]>();
    private readonly regimes = new Map<string, Regime[]>();

    constructor(readonly options: MarketOptions) {
        this.symbols = options.symbols ?? ['AAA-SIM', 'BBB-SIM'];
        for (const symbol of this.symbols) {
            const { candles, regimes } = generate(options.seed + hash(symbol), options.bars);
            this.series.set(symbol, candles);
            this.regimes.set(symbol, regimes);
        }
    }

    get bars(): number { return this.options.bars; }

    candle(symbol: string, bar: number): Candle {
        const c = this.series.get(symbol)?.[bar];
        if (!c) throw new Error(`No candle for ${symbol} at bar ${bar}`);
        return c;
    }

    /** The candles up to and including `bar`: the bot never sees the future. */
    history(symbol: string, bar: number, count = 60): Candle[] {
        const all = this.series.get(symbol);
        if (!all) throw new Error(`Unknown symbol ${symbol}`);
        return all.slice(Math.max(0, bar - count + 1), bar + 1);
    }

    /** Only for the report: the regime the price was in. The bot is never told. */
    regimeAt(symbol: string, bar: number): Regime {
        return this.regimes.get(symbol)![bar];
    }
}

function generate(seed: number, bars: number): { candles: Candle[]; regimes: Regime[] } {
    const rand = prng(seed);
    const candles: Candle[] = [];
    const regimes: Regime[] = [];
    let price = 100;
    let regime: Regime = 'range';
    let left = 0;
    let anchor = price;
    let revert = 0;

    for (let bar = 0; bar < bars; bar++) {
        if (left <= 0) {
            const r = rand();
            regime = r < 0.5 ? 'range' : r < 0.82 ? 'trend_up' : 'trend_down';
            left = 30 + Math.floor(rand() * 40);
            anchor = price;
        }
        left--;

        let drift = 0;
        let vol = 0.01;
        if (regime === 'trend_up') { drift = 0.0035; }
        else if (regime === 'trend_down') { drift = -0.003; }
        else {
            vol = 0.011;
            drift = -0.25 * (price - anchor) / anchor;
            if (revert !== 0) { drift += revert; revert = 0; }
            else if (rand() < 0.16) { drift += 0.03; revert = -0.028; }
        }

        const open = price;
        const close = Math.max(1, open * (1 + drift + vol * gauss(rand)));
        const high = Math.max(open, close) * (1 + Math.abs(gauss(rand)) * 0.003);
        const low = Math.min(open, close) * (1 - Math.abs(gauss(rand)) * 0.003);
        candles.push({ bar, open, high, low, close, volume: Math.round(1000 + rand() * 1000) });
        regimes.push(regime);
        price = close;
    }
    return { candles, regimes };
}
