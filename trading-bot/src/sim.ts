/** The simulation loop: a bar at a time, the broker settles, the bot decides, what happened is remembered and learned. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Learning, LLMProvider, MemorySystem } from '@backendkit-labs/agent-core';
import { Market } from './market';
import { PaperBroker, type ClosedTrade } from './broker';
import { createTrader, type Trader } from './agent';
import { createTradingLearning, DAY_MS, recordTrade, SIM_START } from './learning';
import { createTradingMemory, rememberTrade, seedPlaybook } from './memory';
import { createMockTrader } from './mock-llm';

export const OPERATOR = { kind: 'human', id: 'sim-operator' } as const;

export interface SimOptions {
    seed: number;
    bars: number;
    symbols?: string[];
    /** The first bar the bot trades at (the indicators need history). */
    startBar?: number;
    provider: LLMProvider;
    learning: boolean;
    memory: boolean;
    /** A person approves every proposed rule (the simulated operator). */
    approve: boolean;
    /** Where the memory and the learning keep their files. Default: a temporary directory that is removed at the end. */
    dir?: string;
    engine?: Record<string, unknown>;
    /** The memory and learning files in `dir` already exist (a bot with a track record): do not seed the playbook again. */
    warm?: boolean;
    /** Checked before each session: return true to stop the run. A cost budget needs nothing here: the engine knows (`engine.budgetExceeded`). */
    stop?: () => boolean;
    log?: (line: string) => void;
}

export interface SimReport {
    market: Market;
    broker: PaperBroker;
    trader: Trader;
    learning?: Learning;
    memory?: MemorySystem;
    trades: ClosedTrade[];
    finalEquity: number;
    returnPct: number;
    falseBreakouts: number;
    refusedOrders: number;
    approvedRules: number;
    /** What the bot did in each session: the tools it called (a refused one is marked) and what it said at the end. */
    sessions: Array<{ bar: number; tools: string[]; said: string; refused: number; lesson: boolean }>;
    /** The bars at which a person approved a rule. */
    approvedAtBars: number[];
    dir: string;
}

export const modes = {
    naive: () => createMockTrader({ readsLessons: false, naiveSizePct: 25 }),
    reads: () => createMockTrader({ readsLessons: true, naiveSizePct: 25 }),
    /** Asks for more than the risk gate allows, until a lesson tells it the limit. */
    oversized: () => createMockTrader({ readsLessons: true, naiveSizePct: 40 }),
};

export async function runSimulation(o: SimOptions): Promise<SimReport> {
    const own = !o.dir;
    const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'trading-bot-'));
    const market = new Market({ seed: o.seed, bars: o.bars, ...(o.symbols ? { symbols: o.symbols } : {}) });
    const broker = new PaperBroker(market);
    // The simulation has its own clock, and the learning runs on it: one bar is one day.
    let simNow = new Date(SIM_START);
    const learning = o.learning ? createTradingLearning(join(dir, 'learning'), () => simNow) : undefined;
    const memory = o.memory ? createTradingMemory(join(dir, 'memory')) : undefined;
    if (memory && !o.warm) await seedPlaybook(memory);

    const trader = createTrader({ provider: o.provider, market, broker, workingDir: dir, memory, learning, engine: o.engine });
    let refusedOrders = 0;

    let approved = 0;
    const approvedAtBars: number[] = [];
    const sessions: SimReport['sessions'] = [];
    const start = o.startBar ?? 55;
    broker.advanceTo(start - 1);
    for (let bar = start; bar < o.bars; bar++) {
        if (o.stop?.() || trader.engine.budgetExceeded) { o.log?.(`stopped before bar ${bar}${trader.engine.budgetExceeded ? ' (budget reached)' : ''}`); break; }
        simNow = new Date(SIM_START + bar * DAY_MS);
        for (const trade of broker.advanceTo(bar)) {
            if (learning) await recordTrade(learning, trade);
            if (memory) rememberTrade(memory, trade);
        }
        const run = await trader.run(`Session bar ${bar}. Symbols: ${market.symbols.join(', ')}.`);
        refusedOrders += run.toolCalls.filter(c => c.name === 'place_order' && !c.success).length;
        sessions.push({
            bar,
            tools: run.toolCalls.map(c => `${c.name}${c.success ? '' : ` (refused${c.errorCode ? ` ${c.errorCode}` : ''})`}`),
            said: run.text.replace(/\s+/g, ' ').slice(-220),
            refused: run.toolCalls.filter(c => c.name === 'place_order' && !c.success).length,
            /** The system prompt of the session carried a lesson. */
            lesson: run.systemPrompts.some(p => p.includes('## Lessons')),
        });
        if (learning && o.approve) {
            for (const p of await learning.proposals()) {
                await learning.approve(p.id, OPERATOR, 'simulated operator');
                approved++;
                approvedAtBars.push(bar);
                o.log?.(`bar ${bar}: approved ${JSON.stringify((p.subject as { rule: unknown }).rule)}`);
            }
        }
    }
    await learning?.flush();

    const trades = broker.closed;
    const report: SimReport = {
        market, broker, trader, learning, memory, trades, finalEquity: broker.equity(), returnPct: (broker.equity() / broker.startingCash - 1) * 100,
        falseBreakouts: trades.filter(t => t.pnl <= 0 && t.setup === 'breakout' && t.exitReason === 'stop' && t.barsHeld <= 6).length,
        refusedOrders,
        approvedRules: approved, approvedAtBars, sessions, dir,
    };
    if (own && process.env.KEEP_TRADING_BOT_DIR !== '1') rmSync(dir, { recursive: true, force: true });
    return report;
}

export const summarize = (label: string, r: SimReport): string =>
    `${label.padEnd(26)} equity ${r.finalEquity.toFixed(0).padStart(6)}  return ${r.returnPct.toFixed(1).padStart(6)}%  trades ${String(r.trades.length).padStart(3)}  ` +
    `false breakouts ${String(r.falseBreakouts).padStart(2)}  refused orders ${String(r.refusedOrders).padStart(2)}  rules approved ${r.approvedRules}`;

async function main(): Promise<void> {
    const seed = Number(process.argv[2] ?? 7);
    const bars = Number(process.argv[3] ?? 260);
    const log = (l: string) => console.log('  ' + l);
    console.log(`seed ${seed}, ${bars} bars, simulated market, paper money, offline mock LLM\n`);
    const baseline = await runSimulation({ seed, bars, provider: modes.naive(), learning: false, memory: false, approve: false });
    console.log(summarize('naive, no learning', baseline));
    const withMemory = await runSimulation({ seed, bars, provider: modes.naive(), learning: false, memory: true, approve: false });
    console.log(summarize('naive + memory', withMemory));
    const learned = await runSimulation({ seed, bars, provider: modes.reads(), learning: true, memory: true, approve: true, log });
    console.log(summarize('learning + approval', learned));
    const noApproval = await runSimulation({ seed, bars, provider: modes.reads(), learning: true, memory: true, approve: false });
    console.log(summarize('learning, nobody approves', noApproval));
    console.log('\nOne seed is an anecdote, not evidence. Run `npm run smoke` for the checks of the mechanics.');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
