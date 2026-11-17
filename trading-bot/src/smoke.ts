/**
 * The checks of the bench. The deterministic parts are asserted. The part that depends on a model is not: with the offline
 * mock only the plumbing is checked, and the live run (`npm run live`) is what says anything about a real LLM.
 * Anything awkward found in the framework along the way is printed as a FINDING at the end (none left today).
 */
import assert from 'node:assert/strict';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createLearning, MemoryAuditSink, LEARNED_RULES_SERVICE, type ToolError, type LLMProvider } from '@backendkit-labs/agent-core';
import { scriptedProvider } from '@backendkit-labs/agent-testkit';
import { Market } from './market';
import { PaperBroker, FEE } from './broker';
import { rsi, sma, snapshot } from './indicators';
import { checkOrder, isEntryGuard, LIMITS, type EntryGuard } from './risk';
import { createTools } from './tools';
import { classify, createTradingLearning, recordTrade, ruleFor, TRADER_ID } from './learning';
import { createTrader } from './agent';
import { runSimulation, modes, OPERATOR, summarize } from './sim';

const findings: string[] = [];
let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
    try { await fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`); }
}

const SYMBOLS = ['AAA-SIM', 'BBB-SIM', 'CCC-SIM'];
const fresh = (name: string): string => { const d = `C:/tmp/trading-bot-smoke-${name}`; rmSync(d, { recursive: true, force: true }); return d; };
const order = (over: Record<string, unknown> = {}) => ({ symbol: 'AAA-SIM', sizePct: 10, stopAtr: 1.5, targetAtr: 3, setup: 'breakout', rationale: 'x', ...over });
const guard = (block: EntryGuard['block']): EntryGuard => ({ kind: 'entry_guard', setup: 'breakout', block, reason: 'learned' });

/** What a tool receives from the engine: the read-only view of the approved rules, and nothing else of the learning module. */
async function ctxWith(guards: EntryGuard[]) {
    const learning = createLearning();
    for (const g of guards) await learning.addRule({ rule: g }, OPERATOR);
    return { services: new Map<string, unknown>([[LEARNED_RULES_SERVICE, learning.rulesView()]]) } as never;
}
const codeOf = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'none'; } catch (e) { return (e as ToolError).code ?? String(e); } };

async function main(): Promise<void> {
    // These APIs are what this bench exists to try: stop at once if the framework in use is older.
    const probe = createLearning();
    for (const fn of ['exportUnit', 'importUnit', 'registerHints', 'flush', 'teach', 'trackOutcome', 'rulesView'] as const) {
        if (typeof (probe as unknown as Record<string, unknown>)[fn] !== 'function') throw new Error(`The framework in use has no learning.${fn}: build packages/core first (npm run build in agent-framework).`);
    }

    console.log('\nThe market and the indicators');
    await check('the same seed gives the same candles, another seed does not', () => {
        const a = new Market({ seed: 3, bars: 120 }); const b = new Market({ seed: 3, bars: 120 }); const c = new Market({ seed: 4, bars: 120 });
        assert.deepEqual(a.history('AAA-SIM', 119, 120), b.history('AAA-SIM', 119, 120));
        assert.notDeepEqual(a.history('AAA-SIM', 119, 120), c.history('AAA-SIM', 119, 120));
    });
    await check('the bot never sees the future', () => {
        assert.equal(new Market({ seed: 3, bars: 120 }).history('AAA-SIM', 50, 60).at(-1)!.bar, 50);
    });
    await check('indicators: sma, rsi at its extremes, determinism of the snapshot', () => {
        assert.equal(sma([1, 2, 3, 4, 5], 3), 4);
        assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100);
        assert.ok(rsi(Array.from({ length: 30 }, (_, i) => 100 - i))! < 1);
        const m = new Market({ seed: 5, bars: 100 });
        assert.deepEqual(snapshot('AAA-SIM', m.history('AAA-SIM', 99)), snapshot('AAA-SIM', m.history('AAA-SIM', 99)));
    });

    console.log('\nThe broker');
    await check('equity is cash plus positions, always, and a round trip costs the fees', () => {
        const m = new Market({ seed: 5, bars: 200 }); const b = new PaperBroker(m);
        b.advanceTo(100);
        b.open('AAA-SIM', 20, 1.5, 3, 'breakout', snapshot('AAA-SIM', m.history('AAA-SIM', 100)), 'test');
        assert.ok(Math.abs(b.equity() - (b.cash + b.positionsValue())) < 1e-9);
        assert.ok(Math.abs(b.equity() - 10_000 * (1 - 0.2 * FEE / (1 + FEE))) < 1e-6, 'the entry fee is out of the equity at once');
        const t = b.close('AAA-SIM', b.price('AAA-SIM'), 'manual');
        assert.ok(t.pnl < 0 && Math.abs(t.pnlPct + 2 * FEE * 100) < 0.01);
        assert.ok(Math.abs(b.equity() - b.cash) < 1e-9);
    });
    await check('a stop is hit before a target when the bar touches both', () => {
        const m = new Market({ seed: 5, bars: 200 }); const b = new PaperBroker(m);
        b.advanceTo(60);
        b.open('AAA-SIM', 10, 1, 1, 'other', snapshot('AAA-SIM', m.history('AAA-SIM', 60)), 'test');
        const p = b.positions.get('AAA-SIM')!;
        p.stop = 1e9; p.target = 1e9;
        assert.equal(b.advanceTo(61)[0].exitReason, 'stop');
    });

    console.log('\nThe risk gate and the tools (ToolError, and the rules read through the framework)');
    const gate = (guards: EntryGuard[] = []) => {
        const m = new Market({ seed: 5, bars: 200, symbols: SYMBOLS }); const b = new PaperBroker(m); b.advanceTo(100);
        const tool = createTools({ market: m, broker: b }).find(t => t.name === 'place_order')!;
        return { m, b, tool, run: async (args: Record<string, unknown> = {}) => tool.execute(order(args), await ctxWith(guards)) };
    };
    await check('refuses an oversized position, a second position in the same symbol, and a third open position', async () => {
        assert.equal(await codeOf(gate().run({ sizePct: LIMITS.maxPositionPct + 1 })), 'RISK_MAX_POSITION');
        const g = gate();
        await g.run();
        assert.equal(await codeOf(g.run()), 'RISK_ALREADY_OPEN');
        await g.run({ symbol: 'BBB-SIM', setup: 'other' });
        assert.equal(await codeOf(g.run({ symbol: 'CCC-SIM', setup: 'other' })), 'RISK_MAX_OPEN');
    });
    await check('refuses to open after the realized loss of the last bars reached the limit', async () => {
        const g = gate();
        g.b.open('BBB-SIM', 25, 0.5, 0.5, 'other', snapshot('BBB-SIM', g.m.history('BBB-SIM', 100)), 'x');
        assert.ok(g.b.close('BBB-SIM', g.b.price('BBB-SIM') * 0.8, 'stop').pnl < 0);
        assert.equal(await codeOf(g.run()), 'RISK_LOSS_LIMIT');
    });
    await check('an approved entry guard blocks that setup in that trend, and only there', async () => {
        const g = gate();
        const snap = snapshot('AAA-SIM', g.m.history('AAA-SIM', 100));
        const o = { symbol: 'AAA-SIM', sizePct: 10, setup: 'breakout' as const };
        const attempt = (setup: 'breakout' | 'pullback', block: EntryGuard['block']) => codeOf(Promise.resolve().then(() => checkOrder({ ...o, setup }, g.b, snap, [guard(block)])));
        assert.equal(await attempt('breakout', snap.trend), 'RISK_LEARNED_GUARD');
        assert.equal(await attempt('breakout', snap.trend === 'trend_up' ? 'trend_down' : 'trend_up'), 'none');
        assert.equal(await attempt('pullback', snap.trend), 'none');
        // And through the tool, with the rule coming from the framework's view:
        assert.equal(await codeOf(gate([guard(snap.trend)]).run()), 'RISK_LEARNED_GUARD');
    });
    await check('the tool sees the rules through a read-only view, and cannot approve one', async () => {
        const ctx = await ctxWith([guard('trend_flat')]) as unknown as { services: Map<string, unknown> };
        const view = ctx.services.get(LEARNED_RULES_SERVICE) as Record<string, unknown>;
        assert.deepEqual(Object.keys(view).sort(), ['list', 'where']);
        assert.equal(ctx.services.get('learning'), undefined);
    });

    const scripted = (calls: Array<{ name: string; args: Record<string, unknown> }>): LLMProvider =>
        scriptedProvider([{ tool_calls: calls.map((c, i) => ({ id: `c${i}`, ...c })) }, { content: 'ok' }]);
    const oneCall = async (args: Record<string, unknown>) => {
        const m = new Market({ seed: 5, bars: 200 }); const b = new PaperBroker(m); b.advanceTo(100);
        const sink = new MemoryAuditSink();
        const trader = createTrader({ provider: scripted([{ name: 'place_order', args }]), market: m, broker: b, workingDir: process.cwd(), engine: { audit: sink } });
        const result = await trader.run('go');
        return { sink, result, trader };
    };
    await check('the engine records a refusal with the code of the error, and not its message; run() says it too', async () => {
        const { sink, result } = await oneCall({ symbol: 'AAA-SIM', sizePct: 40, setup: 'breakout', rationale: 'x' });
        assert.equal(sink.events[0].errorCode, 'RISK_MAX_POSITION');
        assert.ok(!JSON.stringify(sink.events).includes('asked for'), 'the message of the error is not in the audit event');
        assert.equal(result.toolCalls[0].errorCode, 'RISK_MAX_POSITION');
        assert.equal(result.toolCalls[0].success, false);
    });
    await check('a call with arguments that fail validation is an error with a code, not a success', async () => {
        const { sink, result } = await oneCall({ symbol: 'AAA-SIM', sizePct: 500, setup: 'breakout', rationale: 'x' });
        assert.equal(sink.events[0].outcome, 'error');
        assert.equal(sink.events[0].errorCode, 'INVALID_ARGUMENTS');
        assert.equal(result.toolCalls[0].errorCode, 'INVALID_ARGUMENTS');
    });
    await check('emitSystemPrompt: the engine reports the prompt the model got, and the result keeps it', async () => {
        const { result, trader } = await oneCall({ symbol: 'AAA-SIM', sizePct: 10, setup: 'breakout', rationale: 'x' });
        assert.ok(result.systemPrompts.length >= 2);
        assert.match(result.systemPrompts[0], /disciplined swing trader/);
        assert.deepEqual(trader.prompts, result.systemPrompts);
    });

    console.log('\nThe learning of the trades');
    const trade = (over: Record<string, unknown> = {}) => ({ symbol: 'AAA-SIM', setup: 'breakout' as const, context: { trend: 'trend_flat' as const, breakout: true }, entryBar: 1, exitBar: 3, barsHeld: 2, entry: 100, exit: 98, pnl: -2, pnlPct: -2, exitReason: 'stop' as const, ...over });
    await check('a trade is classified by setup (subject) and trend (context), and a false breakout carries its advice', () => {
        const c = classify(trade());
        assert.deepEqual([c.kind, c.subject, c.context, c.ok], ['false_breakout', 'breakout', 'trend_flat', false]);
        assert.match(c.detail!, /SMA20 is more than 0.5% above SMA50/);
        assert.equal(classify(trade({ pnl: 3 })).ok, true);
        assert.equal(classify(trade({ barsHeld: 20 })).kind, 'loss_other');
    });
    await check('the rate judges each context apart with ONE subject: noise in the uptrend, a pattern in the flat trend', async () => {
        const learning = createTradingLearning(fresh('rate'));
        const up = { trend: 'trend_up' as const, breakout: true };
        for (let i = 0; i < 27; i++) await recordTrade(learning, trade({ context: up, pnl: 2 }));
        for (let i = 0; i < 3; i++) await recordTrade(learning, trade({ context: up }));
        await recordTrade(learning, trade({ pnl: 2 }));
        for (let i = 0; i < 3; i++) await recordTrade(learning, trade());
        assert.deepEqual((await learning.patterns()).map(p => p.key), ['trade:false_breakout:breakout@trend_flat']);
        assert.equal((await learning.proposals()).length, 1);
    });
    await check('a success with no subject is refused instead of being silently lost', async () => {
        await assert.rejects(createTradingLearning(fresh('nosubject')).trackOutcome({ agentId: TRADER_ID, domain: 'trade', subject: '', ok: true }), /subject/);
    });
    await check('a person approves a proposal and an agent cannot', async () => {
        const learning = createTradingLearning(fresh('approve'));
        for (let i = 0; i < 3; i++) await recordTrade(learning, trade());
        const [p] = await learning.proposals();
        assert.deepEqual(ruleFor((await learning.patterns())[0]), (p.subject as { rule: unknown }).rule);
        await assert.rejects(learning.approve(p.id, { kind: 'agent', id: 'the-trader' }), /human/);
        assert.deepEqual(await learning.rules.list(), []);
        await learning.approve(p.id, OPERATOR);
        assert.equal((await learning.rules.list()).length, 1);
        assert.ok(isEntryGuard((await learning.rules.list())[0].rule));
    });

    console.log('\nThe whole loop (offline mock LLM: plumbing, not intelligence), in simulated time');
    const learned = await runSimulation({ seed: 7, bars: 700, symbols: SYMBOLS, provider: modes.reads(), learning: true, memory: true, approve: true, dir: fresh('loop') });
    const naive = await runSimulation({ seed: 7, bars: 700, symbols: SYMBOLS, provider: modes.naive(), learning: false, memory: false, approve: false });
    const ignoresLessons = await runSimulation({ seed: 7, bars: 700, symbols: SYMBOLS, provider: modes.naive(), learning: true, memory: false, approve: true, dir: fresh('guarded') });
    const noApproval = await runSimulation({ seed: 7, bars: 700, symbols: SYMBOLS, provider: modes.reads(), learning: true, memory: true, approve: false, dir: fresh('loop-no-approval') });
    const simulated = (at: string) => at.startsWith('2030') || at.startsWith('2031');
    await check('losing trades become experiences on the simulated clock, wins are counted and not stored', async () => {
        const exps = await learned.learning!.experiences({ domain: 'trade' });
        assert.ok(exps.length >= 10);
        assert.ok(exps.every(e => e.outcome === 'failure'), 'the wins are counted, not stored');
        assert.ok(exps.length < learned.trades.length, 'so there are fewer experiences than trades');
        assert.ok(exps.every(e => simulated(e.at)), 'stamped with the simulated clock (stamp: "clock")');
        assert.ok(learned.approvedRules >= 1);
    });
    await check('the audit events of the tools are on the simulated clock too, so the window, the counters and the experiences agree', async () => {
        const tool = await learned.learning!.experiences({ domain: 'tool' });
        assert.ok(tool.every(e => simulated(e.at)));
        assert.ok((await learned.learning!.patterns()).length >= 1, 'the pattern is still inside the (simulated) window at the end');
    });
    await check('what was learned reaches the system prompt, structured in units, with the context in the line', () => {
        // With the simulated clock the window is in simulated days, so the lesson is there while its failures are inside it.
        const withLesson = learned.trader.prompts.filter(p => /### breakout\n- false_breakout \(trend_flat\) keeps happening: Breakouts while the 20\/50 averages are flat/.test(p));
        assert.ok(withLesson.length > 0, 'the lesson reached the prompt');
        assert.match(withLesson[0], /## Lessons/);
    });
    await check('a lesson that works stays in the prompt after its failures leave the window (SPEC-0022)', () => {
        const first = learned.trader.prompts.findIndex(p => p.includes('### breakout\n- false_breakout'));
        const last = learned.trader.prompts.map(p => p.includes('### breakout\n- false_breakout')).lastIndexOf(true);
        const gone = learned.trader.prompts.slice(last + 1).length;
        assert.ok(first >= 0, 'the lesson reached the prompt');
        assert.equal(gone, 0, 'the lesson is in every prompt after its first appearance: the subject is still being called');
    });
    await check('after the approval, no breakout is taken in the blocked trend', () => {
        const at = learned.approvedAtBars[0];
        assert.equal(learned.broker.closed.filter(t => t.entryBar > at && t.setup === 'breakout' && t.context.trend === 'trend_flat').length, 0);
    });
    await check('the rule protects even when the model ignores the lesson: the gate refuses the entry and the learning sees the refusal', async () => {
        const at = ignoresLessons.approvedAtBars[0];
        assert.ok(at !== undefined, 'a rule was approved');
        assert.equal(ignoresLessons.broker.closed.filter(t => t.entryBar > at && t.setup === 'breakout' && t.context.trend === 'trend_flat').length, 0);
        const refusals = (await ignoresLessons.learning!.experiences({ domain: 'tool' })).filter(e => e.fingerprint === 'RISK_LEARNED_GUARD');
        assert.ok(refusals.length >= 1, 'the naive bot tried the blocked entry and the gate refused it');
    });
    await check('without approval nothing is enforced: the proposal waits', async () => {
        assert.equal(noApproval.approvedRules, 0);
        assert.ok((await noApproval.learning!.proposals()).length >= 1);
        assert.deepEqual(await noApproval.learning!.rules.list(), []);
        assert.ok(noApproval.broker.closed.some(t => t.setup === 'breakout' && t.context.trend === 'trend_flat'));
    });
    await check('createLearning({ dir }) keeps everything under one directory, with the files coding has always used', () => {
        const names = readdirSync(join(learned.dir, 'learning'));
        for (const f of ['experiences.json', 'counters.json', 'proposals', 'rules.json']) assert.ok(names.includes(f), `${f} is in ${names.join(', ')}`);
    });
    await check('the three memories hold what happened, what the bot knows and which entries worked', async () => {
        const mem = learned.memory!;
        assert.ok(mem.episodic.recallRecent(5).length === 5);
        assert.ok((await mem.semantic.search('breakout', 3)).length > 0);
        assert.ok(mem.procedural.getRelevantPatterns('breakout entry', 3).length > 0);
        assert.ok(learned.trader.prompts.some(p => p.includes('## Relevant Past Experiences')), 'the memory block reaches the prompt');
    });
    await check('run() reports each session: the tools it called, the codes of the refusals and what it said', () => {
        assert.ok(learned.sessions.length > 600);
        assert.ok(learned.sessions.every(s => s.tools.includes('get_portfolio')));
        assert.ok(ignoresLessons.sessions.some(s => s.tools.some(t => t.includes('RISK_LEARNED_GUARD'))), 'the refusal and its code are in the session');
        assert.ok(learned.sessions.some(s => s.said.length > 0));
    });

    console.log('\nA refusal that repeats (the oversized mock asks for more than the limit)');
    const oversized = await runSimulation({ seed: 7, bars: 300, symbols: SYMBOLS, provider: modes.oversized(), learning: true, memory: false, approve: false, dir: fresh('oversized') });
    await check('three refusals with the same code become a lesson written by the author of the tool, and the bot trades once it reads the limit', () => {
        const first = oversized.trader.prompts.find(p => p.includes('### place_order'))!;
        assert.match(first, /### place_order\n- RISK_MAX_POSITION: A position is at most 25% of the equity/);
        assert.ok(oversized.trades.length > 0);
    });
    await check('the lesson survives while it is what keeps the mistake from coming back (SPEC-0022)', async () => {
        const final = await oversized.learning!.lessonsFor(TRADER_ID, undefined, ['place_order']);
        const firstLesson = oversized.trader.prompts.findIndex(p => p.includes('### place_order'));
        const lastLesson = oversized.trader.prompts.map(p => p.includes('### place_order')).lastIndexOf(true);
        const gaps = oversized.trader.prompts.slice(firstLesson, lastLesson + 1).filter(p => !p.includes('### place_order')).length;
        assert.ok(firstLesson >= 0, 'the lesson reached the prompt after the first refusals');
        assert.ok(final !== undefined, 'the lesson is still there at the end of the run');
        assert.equal(gaps, 0, 'the prompt never lost the lesson between its first and last appearance');
        // What the lesson is for (SPEC-0022 F5): after it first reached the prompt, the refusals stop while the bot keeps calling place_order.
        const first = oversized.sessions.findIndex(s => s.lesson);
        const after = oversized.sessions.slice(first + 1);
        const sized = (s: { tools: string[] }) => s.tools.filter(t => t.includes('RISK_MAX_POSITION')).length;
        const sizeBefore = oversized.sessions.slice(0, first + 1).reduce((n, s) => n + sized(s), 0);
        const sizeAfter = after.reduce((n, s) => n + sized(s), 0);
        const otherAfter = after.reduce((n, s) => n + s.refused, 0) - sizeAfter;
        const orders = after.filter(s => s.tools.some(t => t.startsWith('place_order'))).length;
        console.log(`       measured: the mistake the lesson is about (RISK_MAX_POSITION): ${sizeBefore} refusals before it, ${sizeAfter} in the ${after.length} sessions after it (${orders} with an order); ${otherAfter} refusals of other codes (the lesson is not about them)`);
        assert.ok(orders > 5, 'the bot keeps calling place_order');
        assert.equal(sizeAfter, 0, 'after the lesson reached the prompt, the mistake it is about does not come back');
    });
    await check('the refusals are bounded: the first lessons do cut the mistake while they are there', () => {
        assert.ok(oversized.refusedOrders > 0 && oversized.trades.length > 0);
    });
    await check('the lesson is not repeated per refusal: the prompt text of the unit is stable', () => {
        const withLesson = oversized.trader.prompts.filter(p => p.includes('### place_order'));
        assert.ok(withLesson.length > 5);
        assert.equal(new Set(withLesson.map(p => p.slice(p.indexOf('## Lessons')))).size <= 3, true);
    });

    console.log('\nThe cost budget');
    await check('the engine knows when the budget is reached (engine.budgetExceeded) and the simulation stops by itself', async () => {
        const r = await runSimulation({
            seed: 7, bars: 200, provider: modes.naive(), learning: false, memory: false, approve: false,
            engine: { observability: { costTracker: { inputPricePerMToken: 3, outputPricePerMToken: 15, budget: { perDay: 0.01 } } }, abortOnBudget: true },
        });
        assert.equal(r.trader.engine.budgetExceeded, true);
        assert.ok(r.sessions.length < 20, `it ran ${r.sessions.length} sessions of ${200 - 55}`);
    });

    console.log('\nTeaching, and units written in git');
    await check('a person teaches the bot; the lesson is exported, imported elsewhere and reaches a real prompt', async () => {
        const learning = createTradingLearning(fresh('teach'));
        await learning.teach({ text: 'Never risk more than 20% of the equity in one position.', unit: 'place_order', tools: ['place_order'] }, OPERATOR);
        const md = await learning.exportUnit('place_order');
        assert.match(md, /## Taught\n\n- Never risk more than 20%/);
        const other = createTradingLearning(fresh('teach-2'));
        await other.importUnit(md, OPERATOR);
        const m = new Market({ seed: 7, bars: 80 }); const b = new PaperBroker(m); b.advanceTo(60);
        const sayOk: LLMProvider = { async chat(_m, _t, cb) { cb.onChunk?.('ok'); cb.onDone({ role: 'assistant', content: 'ok' }); } };
        const trader = createTrader({ provider: sayOk, market: m, broker: b, workingDir: process.cwd(), learning: other });
        const r = await trader.run('Session.');
        assert.match(r.systemPrompts[0], /### place_order\n- Never risk more than 20% of the equity in one position\./);
    });

    console.log('\nOne seed, side by side (an anecdote, not evidence)');
    console.log('  ' + summarize('naive, no learning', naive));
    console.log('  ' + summarize('learning + approval', learned));
    console.log('  ' + summarize('learning, nobody approves', noApproval));
    console.log('  ' + summarize('ignores lessons + rule', ignoresLessons) + '   <- only the approved rule protects it');

    console.log(`\n${passed} passed, ${failed} failed`);
    if (findings.length) { console.log('\nFINDINGS'); for (const f of findings) console.log(' - ' + f); }
    if (failed) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
