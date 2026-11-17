/**
 * The research desk with a real model (DeepSeek) in every agent, on the same simulated market and paper money. A few sessions,
 * a spend cap that stops the run, and the key read from DEEPSEEK_API_KEY and never printed.
 *
 *   npm run desk:live            # 3 sessions, 2 symbols
 *   npm run desk:live -- 5 3 7   # sessions, symbols, seed
 *
 * With REDIS_URL set, the steps travel through a BullMQ queue to workers in this same process instead of running directly
 * (`agent-flow-queue`), and the runs live in Redis (`RedisRunJournal`): the same desk, other transport.
 */
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';
import { MemoryRunJournal, planFlow, type LLMMessage, type LLMProvider, type LLMStreamCallbacks, type RunJournal, type StepExecutor } from '@backendkit-labs/agent-core';
import { runDesk } from './desk-sim';
import { DESK_AGENTS } from './desk-flow';

const MAX_USD = 0.08;
const PRICE = { input: 0.3, output: 1.2 }; // per million tokens

/** Counts what the model reports and refuses to go on past the cap: a run that costs more than planned stops. */
function capped(inner: LLMProvider, spend: { usd: number; calls: number }): LLMProvider {
    return {
        ...inner,
        chat: async (messages: LLMMessage[], tools, cb: LLMStreamCallbacks, ...rest) => {
            if (spend.usd >= MAX_USD) throw new Error(`spend cap of ${MAX_USD} USD reached`);
            spend.calls++;
            return (inner.chat as (...a: unknown[]) => Promise<void>)(messages, tools, {
                ...cb,
                onMetrics: (i: number, o: number) => { spend.usd += (i * PRICE.input + o * PRICE.output) / 1e6; cb.onMetrics?.(i, o); },
            }, ...rest);
        },
    } as LLMProvider;
}

async function main(): Promise<void> {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) { console.error('Set DEEPSEEK_API_KEY to run this (it is not needed for `npm run desk:smoke`).'); process.exit(2); }
    const sessions = Number(process.argv[2] ?? 3);
    const nSymbols = Number(process.argv[3] ?? 2);
    const seed = Number(process.argv[4] ?? 7);
    const symbols = ['AAA-SIM', 'BBB-SIM', 'CCC-SIM'].slice(0, nSymbols);
    const startBar = 330;
    const spend = { usd: 0, calls: 0 };
    const provider = capped(new DeepSeekProvider({ apiKey: key }), spend);

    console.log('1. A model plans the research of one symbol (planFlow):');
    const planned = await planFlow(`Decide whether to open a position in ${symbols[0]} today. Use the desk: analysts first, then a decision, then execution.`, {
        provider, agents: DESK_AGENTS.map(id => ({ id, description: `desk agent: ${id}` })),
    });
    console.log(`   ${planned.summary}`);
    for (const s of planned.flow.steps) console.log(`   - ${s.id} (${s.agent}) after [${s.after.join(', ')}]`);
    if (planned.unresolved.length) console.log(`   unresolved: ${planned.unresolved.join('; ')}`);

    let executor: ((local: import('./desk-agents').DeskExecutor) => StepExecutor) | undefined;
    let journal: RunJournal = new MemoryRunJournal();
    let cleanup = async (): Promise<void> => undefined;
    if (process.env.REDIS_URL) {
        const { QueueStepExecutor, createStepWorker, RedisRunJournal } = await import('@backendkit-labs/agent-flow-queue');
        const redis = process.env.REDIS_URL;
        const prefix = `desk-${Date.now()}`;
        const queue = new QueueStepExecutor({ redis, prefix, timeoutMs: 120_000 });
        let workers: { close(): Promise<void> } | undefined;
        executor = local => { workers = createStepWorker({ redis, prefix, agents: [...DESK_AGENTS], executor: local, concurrency: 4 }); return queue; };
        const rj = new RedisRunJournal({ redis, prefix });
        journal = rj;
        cleanup = async () => { await workers?.close(); await queue.close(); await rj.close(); };
        console.log(`\n(steps through BullMQ and runs in Redis, prefix ${prefix})`);
    }

    console.log(`\n2. The desk over ${sessions} sessions, ${symbols.length} symbols, DeepSeek in every agent (cap ${MAX_USD} USD):`);
    const r = await runDesk({
        seed, bars: startBar + sessions, startBar, symbols, provider, journal, ...(executor ? { executor } : {}),
        log: l => console.log('  ' + l),
    }).catch(e => { console.error(String((e as Error).message ?? e).replace(/sk-[A-Za-z0-9]+/g, 'sk-***')); return undefined; });
    await cleanup();
    if (!r) process.exit(1);

    for (const f of r.results.slice(0, 6)) {
        console.log(`\n   ${f.runId}: ${f.status}`);
        for (const [id, s] of Object.entries(f.steps)) console.log(`     ${id.padEnd(10)} ${s.status.padEnd(9)} ${s.content.replace(/\s+/g, ' ').slice(0, 110)}${s.error ? ` ERROR ${s.error}` : ''}`);
    }
    const failed = r.results.filter(f => f.status === 'failed').length;
    console.log(`\nflows ${r.results.length} (failed ${failed}), entered ${r.entered}, skipped ${r.skipped}, rejected by the person ${r.rejected}, trades closed ${r.trades.length}`);
    console.log(`model calls ${spend.calls}, spend ${spend.usd.toFixed(4)} USD of ${MAX_USD}`);
    console.log(`step time ${r.stepMs} ms, wall ${r.wallMs} ms (x${(r.stepMs / Math.max(1, r.wallMs)).toFixed(1)} from running in parallel)`);
    console.log('max at once per agent: ' + [...r.executor.maxActive].map(([a, n]) => `${a}=${n}`).join(' '));
}

main().catch(e => { console.error(String((e as Error).message ?? e).replace(/sk-[A-Za-z0-9]+/g, 'sk-***')); process.exit(1); });
