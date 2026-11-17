/**
 * The research desk over a simulated market: each bar, one flow per symbol runs at the same time (three analysts in parallel
 * inside each), the broker settles, and a person approves every order. Compare with `sim.ts`, where one agent does it all.
 *
 *   npm run desk            # offline, deterministic
 *   npm run desk -- 7 200   # seed, bars
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyedConcurrencyLimiter, MemoryRunJournal, runFlow, type ConcurrencyLimiter, type FlowResult, type LLMProvider, type RunJournal, type StepExecutor } from '@backendkit-labs/agent-core';
import { Market } from './market';
import { PaperBroker, type ClosedTrade } from './broker';
import { entryFlow } from './desk-flow';
import { DeskExecutor } from './desk-agents';
import { createDeskMock } from './desk-mock-llm';

export interface DeskOptions {
    seed: number;
    bars: number;
    startBar?: number;
    symbols?: string[];
    provider?: LLMProvider;
    /** Replaces the local executor: a queue, a remote worker. It must still produce what the desk executor produces. */
    executor?: (local: DeskExecutor) => StepExecutor;
    journal?: RunJournal;
    limiter?: ConcurrencyLimiter;
    delayMs?: number;
    failAgents?: Set<string>;
    /** The person's answer to an order, given the decision text. Default: approve what is within 25% of the equity. */
    approve?: (decision: string) => boolean;
    dir?: string;
    log?: (line: string) => void;
}

export interface DeskReport {
    market: Market;
    broker: PaperBroker;
    executor: DeskExecutor;
    trades: ClosedTrade[];
    results: FlowResult[];
    finalEquity: number;
    returnPct: number;
    entered: number;
    skipped: number;
    rejected: number;
    wallMs: number;
    /** What the steps would have taken one after another. */
    stepMs: number;
}

const sizeOf = (decision: string): number => Number(/size=(\d+)/.exec(decision)?.[1] ?? 0);
export const withinLimit = (decision: string): boolean => !decision.includes('ENTER') || sizeOf(decision) <= 25;

export async function runDesk(o: DeskOptions): Promise<DeskReport> {
    const own = !o.dir;
    const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'desk-'));
    const market = new Market({ seed: o.seed, bars: o.bars, ...(o.symbols ? { symbols: o.symbols } : {}) });
    const broker = new PaperBroker(market);
    const local = new DeskExecutor({
        provider: o.provider ?? createDeskMock(), market, broker, workingDir: dir,
        ...(o.delayMs ? { delayMs: o.delayMs } : {}), ...(o.failAgents ? { failAgents: o.failAgents } : {}),
    });
    const executor = o.executor ? o.executor(local) : local;
    const journal = o.journal ?? new MemoryRunJournal();
    const limiter = o.limiter ?? new KeyedConcurrencyLimiter({ max: 4 });
    const approve = o.approve ?? withinLimit;

    const results: FlowResult[] = [];
    let rejected = 0;
    const start = o.startBar ?? 55;
    broker.advanceTo(start - 1);
    const t0 = Date.now();
    for (let bar = start; bar < o.bars; bar++) {
        broker.advanceTo(bar);
        // One flow per symbol, all at once: this is the multitask part.
        const done = await Promise.all(market.symbols.map(symbol => runFlow(entryFlow(symbol), {
            executor, journal, limiter, payload: { symbol, bar }, runId: `bar${bar}-${symbol}`,
            onStepFailure: 'continue',
            approve: async (_step, previous) => approve(previous.decision ?? ''),
        })));
        for (const r of done) {
            results.push(r);
            if (r.steps.execute?.status === 'rejected') rejected++;
        }
        if (bar % 20 === 0) o.log?.(`bar ${bar}: equity ${broker.equity().toFixed(0)}, open ${broker.positions.size}`);
    }
    const wallMs = Date.now() - t0;
    const report: DeskReport = {
        market, broker, executor: local, trades: broker.closed, results, finalEquity: broker.equity(),
        returnPct: (broker.equity() / broker.startingCash - 1) * 100, entered: local.orders.placed, skipped: results.length - local.orders.placed - rejected, rejected, wallMs,
        stepMs: local.traces.reduce((a, t) => a + (t.end - t.start), 0),
    };
    if (own) rmSync(dir, { recursive: true, force: true });
    return report;
}

async function main(): Promise<void> {
    const seed = Number(process.argv[2] ?? 7);
    const bars = Number(process.argv[3] ?? 200);
    const r = await runDesk({ seed, bars, symbols: ['AAA-SIM', 'BBB-SIM', 'CCC-SIM'], delayMs: 5, log: l => console.log('  ' + l) });
    const steps = r.executor.traces.length;
    console.log(`\nseed ${seed}, ${bars} bars, 3 symbols, offline mock models, paper money`);
    console.log(`flows ${r.results.length} (${steps} steps)  entered ${r.entered}  skipped ${r.skipped}  rejected by the person ${r.rejected}`);
    console.log(`trades ${r.trades.length}  equity ${r.finalEquity.toFixed(0)}  return ${r.returnPct.toFixed(1)}%`);
    console.log(`max at once per agent: ${[...r.executor.maxActive].map(([a, n]) => `${a}=${n}`).join(' ')}`);
    console.log(`step time ${r.stepMs} ms, wall ${r.wallMs} ms (x${(r.stepMs / Math.max(1, r.wallMs)).toFixed(1)} from running in parallel)`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
