/**
 * The checks of the research desk: what the flow engine of the framework does when several agents work at once. The models are
 * the offline mock (`desk-mock-llm.ts`), so what is asserted is the orchestration: parallel steps, order between them, the cap
 * per agent, failure, approval, resume after a crash, and a plan written by a "model". Not the intelligence of a model.
 *
 *   npm run desk:smoke
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createApprovalHandler, FileRunJournal, KeyedConcurrencyLimiter, MemoryApprovalStore, MemoryRunJournal, planFlow, runFlow, stepApprovalId,
    type FlowResult, type LLMMessage,
} from '@backendkit-labs/agent-core';
import { Market } from './market';
import { PaperBroker } from './broker';
import { snapshot } from './indicators';
import { entryFlow, DESK_AGENTS } from './desk-flow';
import { DeskExecutor, type DeskExecutorOptions } from './desk-agents';
import { createDeskMock } from './desk-mock-llm';
import { runDesk, withinLimit } from './desk-sim';

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
    try { await fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`); }
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const SYMBOLS = ['AAA-SIM', 'BBB-SIM', 'CCC-SIM'];
const jest_fn = () => { const f = async () => { f.calls++; return true; }; f.calls = 0; return f; };
const OPERATOR = { kind: 'human', id: 'ana' } as const;

function world(seed = 7, bar = 120) {
    const market = new Market({ seed, bars: 400, symbols: SYMBOLS });
    const broker = new PaperBroker(market);
    broker.advanceTo(bar);
    return { market, broker };
}
const desk = (w: ReturnType<typeof world>, extra: Partial<DeskExecutorOptions> = {}) =>
    new DeskExecutor({ provider: createDeskMock({ anyBreakout: true }), market: w.market, broker: w.broker, workingDir: tmpdir(), ...extra });
const trace = (ex: DeskExecutor, step: string, flow?: string) => ex.traces.filter(t => t.step === step && (!flow || t.flow === flow));

/** A (bar, symbol) where the desk decides to ENTER: found by running the analysis with nobody approving. */
async function findEntry(): Promise<{ bar: number; symbol: string }> {
    for (let bar = 60; bar < 400; bar++) {
        const w = world(7, bar);
        for (const symbol of SYMBOLS) {
            if (!snapshot(symbol, w.market.history(symbol, bar)).breakout) continue;
            const r = await runFlow(entryFlow(symbol), { executor: desk(w), payload: { symbol, bar }, approve: async () => false });
            if (r.steps.decision?.content.includes('ENTER')) return { bar, symbol };
        }
    }
    throw new Error('the seed has no entry for the desk');
}

async function main(): Promise<void> {
    console.log('Research desk: orchestration of five agents on a simulated market (offline mock models)\n');

    await check('the three analysts run at the same time; the decision waits for all of them, the execution for the decision', async () => {
        const { bar, symbol } = await findEntry();
        const w = world(7, bar); const ex = desk(w, { delayMs: 60 });
        const r = await runFlow(entryFlow(symbol), { executor: ex, journal: new MemoryRunJournal(), payload: { symbol, bar }, approve: async () => true });
        assert.equal(r.status, 'completed');
        const a = ['technical', 'regime', 'exposure'].map(s => trace(ex, s)[0]);
        const spread = Math.max(...a.map(t => t.start)) - Math.min(...a.map(t => t.start));
        const together = Math.max(...a.map(t => t.end)) - Math.min(...a.map(t => t.start));
        assert.ok(spread < 40, `the analysts started ${spread} ms apart`);
        assert.ok(together < 150, `three 60 ms analysts took ${together} ms: they ran one after another`);
        const decision = trace(ex, 'decision')[0], execute = trace(ex, 'execute')[0];
        assert.ok(decision.start >= Math.max(...a.map(t => t.end)), 'the decision started before an analyst finished');
        assert.ok(execute.start >= decision.end, 'the execution started before the decision');
    });

    await check('the decider sees what the analysts found (context between steps)', async () => {
        const { bar, symbol } = await findEntry();
        const w = world(7, bar); const ex = desk(w);
        const r = await runFlow(entryFlow(symbol), { executor: ex, payload: { symbol, bar }, approve: async () => true });
        assert.match(r.steps.decision.content, /^DECISION: ENTER size=15/);
        assert.match(r.steps.technical.content, /VERDICT: BULLISH/);
        assert.equal(w.broker.positions.size, 1);
        assert.match(r.steps.execute.content, /^Order placed/);
    });

    await check('three symbols at once: a cap of 1 per agent is respected and every flow still finishes', async () => {
        const w = world(); const ex = desk(w, { delayMs: 20 });
        const limiter = new KeyedConcurrencyLimiter({ max: 1 });
        const results = await Promise.all(SYMBOLS.map(symbol => runFlow(entryFlow(symbol), { executor: ex, limiter, payload: { symbol, bar: 120 }, runId: `cap-${symbol}`, approve: async () => true })));
        assert.deepEqual(results.map(r => r.status), ['completed', 'completed', 'completed']);
        for (const agent of DESK_AGENTS) assert.ok((ex.maxActive.get(agent) ?? 0) <= 1, `${agent} ran ${ex.maxActive.get(agent)} at once`);
        const free = desk(world(), { delayMs: 20 });
        await Promise.all(SYMBOLS.map(symbol => runFlow(entryFlow(symbol), { executor: free, payload: { symbol, bar: 120 }, approve: async () => true })));
        assert.equal(free.maxActive.get('technical'), 3, 'without a cap the three flows should overlap');
    });

    await check('an analyst that is down does not stop the flow: the decider is told what is missing and does not trade', async () => {
        const w = world(); const ex = desk(w, { failAgents: new Set(['technical']) });
        const r = await runFlow(entryFlow('AAA-SIM'), { executor: ex, payload: { symbol: 'AAA-SIM', bar: 120 }, onStepFailure: 'continue', approve: async () => true });
        assert.equal(r.status, 'failed');
        assert.equal(r.steps.technical.status, 'failed');
        assert.match(r.steps.decision.content, /SKIP \(incomplete analysis: missing VERDICT/);
        assert.equal(w.broker.positions.size, 0);
        const skipped = await runFlow(entryFlow('AAA-SIM'), { executor: desk(world(), { failAgents: new Set(['technical']) }), payload: { symbol: 'AAA-SIM', bar: 120 }, approve: async () => true });
        assert.equal(skipped.steps.decision.status, 'skipped', 'with the default policy the decision is skipped');
    });

    await check('an order waits for a person: the run stops, nothing is traded, a decision resumes it, and the order is placed once', async () => {
        const { bar, symbol } = await findEntry();
        const w = world(7, bar); const ex = desk(w);
        const store = new MemoryApprovalStore(); const journal = new MemoryRunJournal();
        const opts = { executor: ex, journal, approvals: { store }, runId: 'wait-1', payload: { symbol, bar } };
        const first = await runFlow(entryFlow(symbol), opts);
        assert.equal(first.status, 'awaiting_approval');
        assert.equal(w.broker.positions.size, 0, 'an order was placed before the approval');
        const handler = createApprovalHandler(store);
        const id = stepApprovalId('wait-1', 'execute');
        assert.deepEqual((await handler.list({ status: 'pending' })).map(a => a.id), [id]);
        await handler.decide(id, { decision: 'approve', by: OPERATOR, reason: 'within limits' });
        const analystsBefore = ex.traces.filter(t => ['technical', 'regime', 'exposure', 'decision'].includes(t.step)).length;
        const second = await runFlow(entryFlow(symbol), opts);
        assert.equal(second.status, 'completed');
        assert.equal(w.broker.positions.size, 1);
        assert.equal(ex.traces.filter(t => ['technical', 'regime', 'exposure', 'decision'].includes(t.step)).length, analystsBefore, 'resuming ran the analysis again');
        assert.equal(trace(ex, 'execute').length, 1);
        // Running it a third time finds it done: nothing is traded twice.
        await runFlow(entryFlow(symbol), opts);
        assert.equal(w.broker.positions.size, 1);
    });

    await check('a person can say no: the run is rejected and no order exists', async () => {
        const { bar, symbol } = await findEntry();
        const w = world(7, bar); const store = new MemoryApprovalStore();
        const opts = { executor: desk(w), journal: new MemoryRunJournal(), approvals: { store }, runId: 'no-1', payload: { symbol, bar } };
        await runFlow(entryFlow(symbol), opts);
        await createApprovalHandler(store).decide(stepApprovalId('no-1', 'execute'), { decision: 'reject', by: OPERATOR, reason: 'too risky today' });
        const r = await runFlow(entryFlow(symbol), opts);
        assert.equal(r.status, 'rejected');
        assert.equal(w.broker.positions.size, 0);
    });

    await check('the process dies in the middle of the decision: another process resumes and does not repeat the analysts', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'desk-crash-'));
        try {
            const w = world(); const journal = new FileRunJournal(dir);
            const dying = desk(w, { hangAgents: new Set(['decider']) });
            // The first process: it never finishes the decision, and it does not renew its claim (as a process that died does not).
            void runFlow(entryFlow('AAA-SIM'), { executor: dying, journal, owner: 'process-1', claimTtlMs: 50, claimRenewMs: 0, runId: 'crash-1', payload: { symbol: 'AAA-SIM', bar: 120 }, approve: async () => true }).catch(() => undefined);
            while (trace(dying, 'decision').length === 0) await sleep(10);
            await sleep(120);
            const second = desk(w);
            const r = await runFlow(entryFlow('AAA-SIM'), { executor: second, journal, owner: 'process-2', runId: 'crash-1', payload: { symbol: 'AAA-SIM', bar: 120 }, approve: async () => true });
            assert.equal(r.status, 'completed');
            for (const s of ['technical', 'regime', 'exposure']) assert.equal(trace(second, s).length, 0, `${s} ran again after the crash`);
            assert.equal(trace(second, 'decision').length, 1, 'the interrupted step runs again (at least once)');
            assert.equal((await journal.get('crash-1'))?.status, 'done');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    await check('a SKIP never reaches a person: the order step is skipped by its condition and nobody is asked', async () => {
        const w = world(); const approve = jest_fn();
        const r = await runFlow(entryFlow('AAA-SIM'), { executor: desk(w), payload: { symbol: 'AAA-SIM', bar: 120 }, approve });
        assert.match(r.steps.decision.content, /^DECISION: SKIP/);
        assert.equal(r.steps.execute.status, 'skipped');
        assert.equal(approve.calls, 0, 'a person was asked to approve doing nothing');
        assert.equal(r.status, 'completed');
        assert.match(r.transitions.find(t => t.stepId === 'execute' && t.event === 'skipped')?.detail ?? '', /condition not met/);
    });

    await check('a decision slower than the claim is not taken over: the claim is renewed while the run lives', async () => {
        const w = world(); const journal = new MemoryRunJournal();
        const slow = desk(w, { delayMs: 200 });
        const running = runFlow(entryFlow('AAA-SIM'), { executor: slow, journal, owner: 'p1', claimTtlMs: 60, runId: 'slow-1', payload: { symbol: 'AAA-SIM', bar: 120 }, approve: async () => true });
        await sleep(300); // several TTLs in, in the middle of the decision (the analysts take 200 ms, the decision another 200)
        await assert.rejects(runFlow(entryFlow('AAA-SIM'), { executor: desk(w), journal, owner: 'p2', runId: 'slow-1', payload: { symbol: 'AAA-SIM', bar: 120 } }), /held by another owner/);
        assert.equal((await running).status, 'completed');
        assert.equal(trace(slow, 'decision').length, 1, 'the decision ran twice');
    });

    await check('a plan written by a model becomes a flow: a wrong agent is rejected and asked again, unresolved steps are reported', async () => {
        const plans = [
            { summary: 'bad', subtasks: [{ id: 't1', agent_id: 'wizard', task: 'Symbol AAA-SIM, bar 120. Predict.', depends_on: [] }] },
            {
                summary: 'Research AAA-SIM',
                subtasks: [
                    { id: 't1', agent_id: 'technical', task: 'Symbol AAA-SIM, bar 120. Read the indicators and give your technical verdict.', depends_on: [] },
                    { id: 't2', agent_id: 'risk', task: 'Symbol AAA-SIM, bar 120. Read the portfolio and say whether there is room.', depends_on: [] },
                    { id: 't3', agent_id: 'decider', task: 'Symbol AAA-SIM, bar 120. Decide with the analysis you were given.', depends_on: ['t1', 't2'] },
                    { id: 't4', agent_id: 'unresolved', task: 'Check the earnings calendar', depends_on: [] },
                ],
            },
        ];
        let calls = 0; let lastPrompt = '';
        const planned = await planFlow('Should we enter AAA-SIM today?', {
            agents: DESK_AGENTS.map(id => ({ id, description: `desk agent ${id}` })), retries: 1,
            chat: async (messages: LLMMessage[]) => { lastPrompt = String(messages[messages.length - 1].content); return JSON.stringify(plans[calls++]); },
        });
        assert.equal(calls, 2);
        assert.match(lastPrompt, /unknown agent_id: wizard/, 'the model was not told what was wrong');
        assert.deepEqual(planned.unresolved.length, 1);
        assert.equal(planned.flow.steps.find(s => s.id === 't3')?.after.join(), 't1,t2');
        const ex = desk(world());
        const r = await runFlow({ ...planned.flow, steps: planned.flow.steps.filter(s => s.agent !== 'unresolved') }, { executor: ex });
        assert.equal(r.status, 'completed');
        assert.match(r.steps.t3.content, /^DECISION:/);
    });

    await check('the whole desk over a market: every flow finishes, orders stay within the risk gate, and the parallelism pays', async () => {
        const r = await runDesk({ seed: 7, bars: 140, symbols: SYMBOLS, delayMs: 15, journal: new MemoryRunJournal() });
        assert.ok(r.results.every(x => x.status === 'completed' || x.status === 'rejected'), 'a flow did not finish');
        assert.ok(r.entered > 0, 'the desk never entered: the check proves nothing');
        assert.ok(r.broker.positions.size <= 2, 'the risk gate was bypassed');
        assert.ok(r.stepMs / r.wallMs > 1.5, `step time ${r.stepMs} ms against wall ${r.wallMs} ms: it did not run in parallel`);
        const sized = withinLimit('DECISION: ENTER size=40');
        assert.equal(sized, false);
        const rejected = await runDesk({ seed: 7, bars: 140, symbols: SYMBOLS, journal: new MemoryRunJournal(), provider: createDeskMock({ sizePct: 40 }) });
        assert.equal(rejected.entered, 0, 'an order over the limit was placed');
        assert.ok(rejected.rejected > 0, 'the person never saw an oversized order');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
export type { FlowResult };
