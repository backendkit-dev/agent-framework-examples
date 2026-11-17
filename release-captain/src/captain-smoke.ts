/**
 * The checks of the captain agent: a model (here a deterministic stand-in) drives real release flows over small monorepos on disk (real git,
 * builds that are real processes). They check what the framework has to guarantee around a model: several runs at once under one cap, a
 * model that cannot approve nor cancel on its own, a run that waits for a person and goes on after the decision, a failure the
 * model can read. Nothing here says how smart a real model is: `npm run agent:live` does.
 *
 *   npm run agent:smoke
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApprovalHandler, stepApprovalId } from '@backendkit-labs/agent-core';
import { createCaptain } from './captain-agent';
import { createCaptainHost, type CaptainHost } from './captain-host';
import { createCaptainMock, type CaptainMockOptions } from './captain-mock-llm';
import { fastCommands, makeFixture, type Fixture } from './fixture';

let passed = 0; let failed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
    const t0 = Date.now();
    try { await fn(); passed++; console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`); }
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function withCaptain<T>(aliases: string[], opts: { mock?: CaptainMockOptions; confirm?: (tool: string) => Promise<boolean>; jobs?: number; setup?: (fx: Record<string, Fixture>) => void },
    fn: (c: { fx: Record<string, Fixture>; host: CaptainHost; ask: (q: string) => ReturnType<ReturnType<typeof createCaptain>['ask']> }) => Promise<T>): Promise<T> {
    const fx: Record<string, Fixture> = Object.fromEntries(aliases.map(a => [a, makeFixture()]));
    opts.setup?.(fx);
    const stateDir = mkdtempSync(join(tmpdir(), 'captain-state-'));
    const host = createCaptainHost({
        stateDir, jobs: opts.jobs ?? 2,
        monorepos: Object.fromEntries(aliases.map(a => [a, { root: fx[a].root, registry: async () => false, commands: fastCommands }])),
    });
    const { ask } = createCaptain({ host, provider: createCaptainMock(opts.mock), ...(opts.confirm ? { confirm: opts.confirm } : {}) });
    try { return await fn({ fx, host, ask }); }
    finally {
        await host.close();
        for (const f of Object.values(fx)) f.cleanup();
        rmSync(stateDir, { recursive: true, force: true });
    }
}
const names = (r: { toolCalls: Array<{ name: string }> }): string[] => r.toolCalls.map(c => c.name);
const runIds = (text: string): string[] => [...text.matchAll(/\[([0-9a-f-]{36})\]/g)].map(m => m[1]);

async function main(): Promise<void> {
    console.log('Release captain agent: a model over the flows\n');

    await check('it starts every run first and then waits for them: the runs overlap, under one cap of builds', async () => {
        await withCaptain(['alpha', 'beta'], { jobs: 2 }, async ({ fx, ask }) => {
            for (const f of Object.values(fx)) for (const id of ['core', 'solo', 'util']) f.delay(id, 250);
            const r = await ask('Check alpha and beta.');
            const n = names(r);
            assert.deepEqual(n.slice(0, 3), ['flow_list', 'flow_start', 'flow_start'], `both runs are started before any wait: ${n.join(',')}`);
            assert.equal(n.filter(x => x === 'flow_status').length, 0, 'it waits with flow_wait, it does not poll');
            assert.ok(n.includes('flow_wait') && n.includes('run_report'));
            assert.ok(r.toolCalls.every(c => c.success), `no tool failed: ${JSON.stringify(r.toolCalls.filter(c => !c.success))}`);
            // builds of BOTH monorepos together never exceed the cap: the limiter is shared by the runs
            const all = [...fx.alpha.builds(), ...fx.beta.builds()];
            assert.ok(all.length >= 10, `both monorepos built (${all.length} builds)`);
            const ev = all.flatMap(b => [[b.start, 1], [b.end, -1]] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            let cur = 0; let max = 0; for (const [, d] of ev) { cur += d; max = Math.max(max, cur); }
            assert.equal(max, 2, `at most 2 builds at once across the two runs (saw ${max})`);
            const alphaOnly = fx.alpha.builds(); const betaOnly = fx.beta.builds();
            assert.ok(Math.min(...betaOnly.map(b => b.start)) < Math.max(...alphaOnly.map(b => b.end)), 'the runs overlapped in time');
            assert.equal(runIds(r.text).length, 2, `the answer names both runs: ${r.text}`);
            assert.match(r.text, /VERIFY: ok/);
            assert.match(r.text, /needs a person: approval/);
        });
    });

    await check('the model cannot approve: the policy denies it, the tool would refuse it, the approval stays pending', async () => {
        await withCaptain(['alpha'], { mock: { tryApprove: true } }, async ({ host, ask }) => {
            const r = await ask('Check alpha.');
            const decide = r.toolCalls.filter(c => c.name === 'approval_decide');
            assert.equal(decide.length, 1, 'it tried');
            assert.equal(decide[0].success, false, 'and the call did not go through');
            const pending = await host.store.list({ status: 'pending' });
            assert.equal(pending.length, 1, 'the report still waits for a person');
            assert.match(r.text, /refused/);
            // second layer, with no policy in front: the tool decides as a service, and a service cannot satisfy "human"
            const tool = host.tools.find(t => t.name === 'approval_decide')!;
            await assert.rejects(Promise.resolve(tool.execute({ id: pending[0].id, decision: 'approve' }, {} as never)), /human|accept|FORBIDDEN/i);
            assert.equal((await host.store.list({ status: 'pending' })).length, 1);
        });
    });

    await check('a person approves outside the model and the run goes on from where it stopped (the id is the same for everyone)', async () => {
        await withCaptain(['alpha'], {}, async ({ fx, host, ask }) => {
            const r = await ask('Check alpha.');
            const [runId] = runIds(r.text);
            const builds = fx.alpha.builds().length;
            const v = await host.handler.status(runId);
            assert.equal(v.status, 'awaiting_approval');
            assert.equal(v.steps.find(s => s.name === 'report')!.status, 'awaiting_approval');
            const id = stepApprovalId(runId, 'report');
            await createApprovalHandler(host.store).decide(id, { decision: 'approve', by: { kind: 'human', id: 'ana' }, reason: 'read the plan' });
            await host.handler.resume(runId);
            let end = await host.handler.status(runId);
            for (let i = 0; i < 50 && end.status === 'running'; i++) { await sleep(100); end = await host.handler.status(runId); }
            assert.equal(end.status, 'done', JSON.stringify(end));
            assert.equal(fx.alpha.builds().length, builds, 'nothing was built again');
            assert.match(end.output ?? '', /publish/i);
        });
    });

    await check('a build that fails is explained from the report, and what depends on it was skipped', async () => {
        await withCaptain(['alpha'], {}, async ({ fx, ask }) => {
            fx.alpha.fail('core');
            const r = await ask('Check alpha.');
            assert.match(r.text, /build-core failed/);
            assert.ok(names(r).includes('run_report'));
            assert.ok(!/needs a person/.test(r.text), 'a failed run asks nobody');
        });
    });

    await check('a range problem blocks the plan: the verdict says why and nobody is asked', async () => {
        await withCaptain(['alpha'], { setup: fx => {
            fx.alpha.edit('web', j => { j.dependencies['@fx/core'] = '^2.0.0'; });
            fx.alpha.git('commit', '-qam', 'bad range');
        } }, async ({ ask }) => {
            const r = await ask('Check alpha.');
            assert.match(r.text, /VERIFY: blocked/);
            assert.match(r.text, /\^2\.0\.0/);
            assert.ok(!/needs a person/.test(r.text));
        });
    });

    await check('cancelling needs a person: refused, the run goes on; confirmed, the run stops', async () => {
        await withCaptain(['alpha'], { mock: { cancelFirst: true }, confirm: async () => false }, async ({ fx, host, ask }) => {
            fx.alpha.delay('core', 600);
            const r = await ask('Check alpha, then cancel it.');
            const cancel = r.toolCalls.find(c => c.name === 'flow_cancel')!;
            assert.equal(cancel.success, false, 'the operator said no');
            const [started] = r.toolCalls.filter(c => c.name === 'flow_start');
            assert.ok(started);
            await sleep(100);
            const runs = (await Promise.all([...await listRuns(host)].map(id => host.handler.status(id))));
            assert.ok(runs.every(x => x.status !== 'cancelled'), 'not cancelled');
            for (const x of runs) await host.handler.cancel(x.flowRunId); // cleanup
        });
        await withCaptain(['alpha'], { mock: { cancelFirst: true }, confirm: async () => true }, async ({ fx, host, ask }) => {
            fx.alpha.delay('core', 3000);
            const r = await ask('Check alpha, then cancel it.');
            assert.ok(r.toolCalls.find(c => c.name === 'flow_cancel')!.success, 'the operator said yes');
            const ids = await listRuns(host);
            const s = await host.handler.status([...ids][0]);
            assert.equal(s.status, 'cancelled');
            await sleep(200);
            assert.ok(fx.alpha.builds().length < 6, 'the builds stopped');
        });
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

/** The runs of the journal (the host keeps no list of its own). */
async function listRuns(host: CaptainHost): Promise<Set<string>> {
    return new Set((await host.journal.list()).map(r => r.runId));
}

main().catch(e => { console.error(e); process.exit(1); });
