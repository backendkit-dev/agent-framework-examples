/**
 * A short run with a real LLM (DeepSeek) as the reasoning layer, on the same simulated market and paper money.
 * It costs a few cents: the number of sessions and the spend are capped. The key is read from DEEPSEEK_API_KEY and is
 * never printed.
 *
 *   npm run live            # 14 sessions, learning and memory on
 *   npm run live -- 24 7    # sessions, seed
 */
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSimulation, modes, summarize } from './sim';
import { snapshot } from './indicators';

const MAX_USD = 0.25;

async function main(): Promise<void> {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) { console.error('Set DEEPSEEK_API_KEY to run this (it is not needed for `npm run smoke`).'); process.exit(2); }
    const sessions = Number(process.argv[2] ?? 14);
    const seed = Number(process.argv[3] ?? 7);
    // The bot is not born yesterday: a track record of a naive offline bot (bars 55-329) gives the learning something to
    // work with, and the LLM takes over from bar 330 with that memory, those lessons and the proposals still waiting.
    const startBar = 330;
    const dir = mkdtempSync(join(tmpdir(), 'trading-bot-live-'));
    const history = await runSimulation({ seed, bars: startBar, symbols: ['AAA-SIM', 'BBB-SIM', 'CCC-SIM'], provider: modes.naive(), learning: true, memory: true, approve: false, dir });
    console.log(`track record: ${history.trades.length} trades, ${(await history.learning!.proposals()).length} proposed rules waiting for a person\n`);
    const provider = new DeepSeekProvider({ apiKey: key });

    const result = await runSimulation({
        seed, bars: startBar + sessions, startBar, symbols: ['AAA-SIM', 'BBB-SIM', 'CCC-SIM'],
        provider, learning: true, memory: true, approve: true, dir, warm: true,
        engine: {
            observability: {
                costTracker: {
                    inputPricePerMToken: 0.3, outputPricePerMToken: 1.2,
                    budget: { perRun: 0.05, perDay: MAX_USD },
                },
            },
            abortOnBudget: true,
        },
        log: l => console.log('  ' + l),
    });

    console.log(`\n${sessions} sessions with DeepSeek on seed ${seed} (paper money)`);
    console.log(summarize('live', result));
    console.log('\nSession by session (tools it called, and what it said):');
    for (const s of result.sessions) console.log(`  bar ${s.bar}: [${[...new Set(s.tools)].join(', ')}] ${s.said}`);
    const m = result.market;
    const breakouts = result.sessions.filter(s => m.symbols.some(sym => snapshot(sym, m.history(sym, s.bar)).breakout)).map(s => s.bar);
    console.log(`Bars with a breakout on some symbol: ${breakouts.join(', ') || 'none'}`);
    console.log('\nClosed trades:');
    for (const t of result.trades) console.log(`  trade ${t.symbol} ${t.setup}/${t.context.trend} bars ${t.entryBar}-${t.exitBar} ${t.exitReason} ${t.pnlPct.toFixed(2)}%`);
    const l = result.learning!;
    console.log('\nLearned:', (await l.patterns()).map(p => `${p.key} x${p.count}`).join(', ') || 'nothing yet (few sessions)');
    console.log('Lessons now in its prompt:\n' + ((await l.lessonsFor('trader', undefined, ['place_order'])) ?? '  (none)'));
    console.log(`\nspend cap ${MAX_USD} USD (per day) and 0.05 per session: ${result.trader.engine.budgetExceeded ? 'the budget was reached and the run stopped' : 'not reached'}`);
}

main().catch(e => { console.error(String((e as Error).message ?? e).replace(/sk-[A-Za-z0-9]+/g, 'sk-***')); process.exit(1); });
