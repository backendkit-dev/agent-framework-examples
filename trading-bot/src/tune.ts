/** Scratch: does the market behave as designed? (breakouts with a flat trend should lose; with a trend, win) */
import { Market } from './market';
import { PaperBroker } from './broker';
import { snapshot } from './indicators';

const stats: Record<string, { n: number; wins: number; pnl: number }> = {};
for (let seed = 1; seed <= 30; seed++) {
    const market = new Market({ seed, bars: 300 });
    const broker = new PaperBroker(market);
    for (let bar = 55; bar < 300; bar++) {
        broker.advanceTo(bar);
        for (const symbol of market.symbols) {
            if (broker.positions.has(symbol)) continue;
            const snap = snapshot(symbol, market.history(symbol, bar));
            if (snap.breakout) broker.open(symbol, 20, 1.5, 3, 'breakout', snap, 'naive');
        }
    }
    for (const t of broker.closed) {
        const k = t.context.trend;
        const s = (stats[k] ??= { n: 0, wins: 0, pnl: 0 });
        s.n++; if (t.pnl > 0) s.wins++; s.pnl += t.pnl;
    }
}
for (const [k, s] of Object.entries(stats)) console.log(k, `n=${s.n}`, `win=${(100 * s.wins / s.n).toFixed(0)}%`, `avgPnl=${(s.pnl / s.n).toFixed(1)}`);
