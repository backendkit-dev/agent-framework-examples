/**
 * Checks of the Redis side of the framework against a REAL Redis, with real processes:
 *  - the Lua scripts of `RedisRunJournal` under contention (not just one caller at a time);
 *  - the BullMQ queue of `QueueStepExecutor` with workers in other processes;
 *  - an orchestrator killed in the middle of the audit (a hard kill, not a simulation) and resumed by another process.
 *
 *   npm run redis:up      # a throwaway container on 127.0.0.1:6390
 *   npm run redis:check   # REDIS_URL overrides the address
 *   npm run redis:down
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { QueueStepExecutor, RedisRunJournal } from '@backendkit-labs/agent-flow-queue';

const URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6390';
const ROOT = join(__dirname, '..');
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
let passed = 0; let failed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
    const t0 = Date.now();
    try { await fn(); passed++; console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`); }
}

// ── processes ────────────────────────────────────────────────────────────────

interface Proc { child: ChildProcess; lines: string[]; exited: Promise<number | null>; kill(): void; has(prefix: string): boolean }
function start(file: string, env: Record<string, string>): Proc {
    const child = spawn(process.execPath, ['--import', 'tsx', join('src', file)], { cwd: ROOT, env: { ...process.env, ...env, REDIS_URL: URL }, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines: string[] = [];
    let buf = '';
    const eat = (d: Buffer): void => { buf += d.toString(); const parts = buf.split('\n'); buf = parts.pop() ?? ''; lines.push(...parts.map(l => l.trim()).filter(Boolean)); };
    child.stdout?.on('data', eat); child.stderr?.on('data', eat);
    const exited = new Promise<number | null>(res => child.on('exit', code => res(code)));
    return { child, lines, exited, kill: () => { child.kill('SIGKILL'); }, has: p => lines.some(l => l.startsWith(p)) };
}
async function until(pred: () => boolean | Promise<boolean>, ms: number, what: string): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await pred()) return; await sleep(50); }
    throw new Error(`timed out waiting for ${what}`);
}

const base = (prefix: string, extra: Record<string, string> = {}): Record<string, string> => ({ PREFIX: prefix, SEED: '7', RECORDS: '2400', SHARD: '100', ...extra });
const resultOf = (p: Proc): { status: string; score: { precision: number; recall: number; missed: number; invented: number; decoysCleared: number } } =>
    JSON.parse((p.lines.find(l => l.startsWith('RESULT ')) ?? 'RESULT {}').slice(7));

async function wipe(redis: Redis, prefix: string): Promise<void> {
    for (const pattern of [`${prefix}*`, `bull:${prefix}.*`]) {
        let cursor = '0';
        do {
            const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
            cursor = next;
            if (keys.length) await redis.del(...keys);
        } while (cursor !== '0');
    }
}

async function main(): Promise<void> {
    const redis = new Redis(URL, { maxRetriesPerRequest: 2, lazyConnect: true });
    try { await redis.connect(); await redis.ping(); } catch { console.error(`No Redis at ${URL}. Start one: npm run redis:up`); process.exit(2); }
    const info = await redis.info('server');
    console.log(`Redis ${/redis_version:(\S+)/.exec(info)?.[1]} at ${URL}\n`);
    const stamp = Date.now();
    const procs: Proc[] = [];
    const prefixes: string[] = [];
    const fresh = (name: string): string => { const p = `audit-${stamp}-${name}`; prefixes.push(p); return p; };

    // ── 1. The Lua scripts under contention ──────────────────────────────────
    console.log('The journal (Lua scripts), many callers at once:');
    const jp = fresh('lua');
    const newRun = (runId: string) => ({ runId, flow: 'f', owner: 'o', steps: [] } as never);

    await check('40 callers begin the same run at once: exactly one wins', async () => {
        const js = Array.from({ length: 40 }, () => new RedisRunJournal({ redis: URL, prefix: jp }));
        const r = await Promise.allSettled(js.map(j => j.begin(newRun('race-begin'))));
        assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
        assert.equal(r.filter(x => x.status === 'rejected').length, 39);
        assert.match(String((r.find(x => x.status === 'rejected') as PromiseRejectedResult).reason), /already exists/);
        await Promise.all(js.map(j => j.close()));
    });

    await check('300 events appended at once to one run: none is lost, the order is a valid fold', async () => {
        const js = Array.from({ length: 10 }, () => new RedisRunJournal({ redis: URL, prefix: jp }));
        await js[0].begin(newRun('race-append'));
        await Promise.all(Array.from({ length: 300 }, (_, i) => js[i % 10].step('race-append', `s${i}`, { status: 'done', attempt: 1, output: `o${i}` } as never)));
        const run = await js[0].get('race-append');
        assert.equal(Object.keys(run!.steps).length, 300, 'a step was lost');
        assert.equal(await redis.llen(`${jp}:run:race-append:log`), 301);
        await Promise.all(js.map(j => j.close()));
    });

    await check('30 owners claim the same run at once: exactly one gets it', async () => {
        const j = new RedisRunJournal({ redis: URL, prefix: jp });
        const got = await Promise.all(Array.from({ length: 30 }, (_, i) => j.claim('race-claim', `owner-${i}`, 30_000)));
        assert.equal(got.filter(Boolean).length, 1);
        await j.close();
    });

    await check('renewal by the owner replaces the claim: a stale release frees nothing, the fresh one does', async () => {
        const j = new RedisRunJournal({ redis: URL, prefix: jp });
        const first = await j.claim('renew', 'A', 30_000);
        const second = await j.claim('renew', 'A', 30_000);
        assert.ok(first && second);
        await first!();
        assert.equal(await j.claim('renew', 'B', 30_000), null, 'the stale release freed the claim');
        await second!();
        assert.notEqual(await j.claim('renew', 'B', 30_000), null, 'the fresh release did not free it');
        await j.close();
    });

    await check('the claim expires on its own (PX) and can be taken over', async () => {
        const j = new RedisRunJournal({ redis: URL, prefix: jp });
        assert.ok(await j.claim('ttl', 'A', 300));
        assert.equal(await j.claim('ttl', 'B', 300), null);
        await sleep(450);
        assert.ok(await j.claim('ttl', 'B', 300));
        await j.close();
    });

    await check('a write to a run that does not exist is refused, and the run list sees every run', async () => {
        const j = new RedisRunJournal({ redis: URL, prefix: jp });
        await assert.rejects(j.step('ghost', 's', { status: 'done' } as never), /does not exist/);
        const ids = (await j.list()).map(r => r.runId);
        for (const id of ['race-begin', 'race-append']) assert.ok(ids.includes(id), `${id} is not listed`);
        await j.close();
    });

    // ── 2. The queue and workers in other processes ──────────────────────────
    console.log('\nThe queue, with workers in other processes:');
    const qp = fresh('queue');
    const workers = [0, 1].map(i => start('audit-worker.ts', { ...base(qp, { DELAY_MS: '150', CONCURRENCY: '3', WORKER_NAME: `w${i}` }) }));
    procs.push(...workers);
    await until(() => workers.every(w => w.has('READY')), 30_000, 'the workers').catch(e => { console.error(e.message, workers.map(w => w.lines)); process.exit(1); });
    await sleep(500);

    await check('the same idempotency key sent twice is one job: the worker runs it once', async () => {
        const q = new QueueStepExecutor({ redis: URL, prefix: qp, timeoutMs: 30_000 });
        const step = { id: 'shard-000', agent: 'scanner', prompt: 'p', after: [] } as never;
        const input = { prompt: 'p', idempotencyKey: 'dedupe:shard-000:1', signal: new AbortController().signal };
        const [a, b] = await Promise.all([q.run(step, input), q.run(step, input)]);
        assert.equal(a.content, b.content);
        assert.equal(await redis.hget(`${qp}:exec`, 'shard-000'), '1', 'the step ran more than once');
        await q.close();
    });

    await check('the whole audit through the queue: 100% precision and recall, every step ran once, and it ran in parallel', async () => {
        const run = `q-${stamp}`;
        const orch = start('audit-orchestrator.ts', { ...base(qp), RUN_ID: run });
        procs.push(orch);
        const code = await Promise.race([orch.exited, sleep(60_000).then(() => 'timeout' as const)]);
        assert.equal(code, 0, `the orchestrator ended with ${code}: ${orch.lines.slice(-3).join(' | ')}`);
        const r = resultOf(orch);
        assert.equal(r.status, 'completed');
        assert.equal(r.score.recall, 1); assert.equal(r.score.precision, 1);
        assert.ok(r.score.decoysCleared >= 10, 'the subscriptions were not cleared');
        const exec = await redis.hgetall(`${qp}:exec`);
        for (const [id, n] of Object.entries(exec)) if (id !== 'shard-000') assert.equal(n, '1', `${id} ran ${n} times`);
        const shards = Object.keys(exec).filter(k => k.startsWith('shard-')).length;
        const wall = Number((JSON.parse(orch.lines.find(l => l.startsWith('RESULT '))!.slice(7)) as { wallMs: number }).wallMs);
        assert.ok(wall < shards * 150 / 3, `wall ${wall} ms for ${shards} shards of 150 ms: it did not run in parallel`);
        const who = new Set((await redis.lrange(`${qp}:execlog`, 0, -1)).map(l => l.split('|')[2]));
        assert.equal(who.size, 2, 'the two workers did not both take part');
    });
    for (const w of workers) w.kill();
    await Promise.all(workers.map(w => w.exited));
    procs.length = 0;

    // ── 3. A process killed in the middle ────────────────────────────────────
    console.log('\nAn orchestrator killed in the middle (hard kill), another one resumes:');
    const kp = fresh('kill');
    const kworkers = [0, 1].map(i => start('audit-worker.ts', { ...base(kp, { DELAY_MS: '1500', CONCURRENCY: '2', WORKER_NAME: `k${i}` }) }));
    procs.push(...kworkers);
    await until(() => kworkers.every(w => w.has('READY')), 30_000, 'the kill-test workers');
    await sleep(500);
    const journal = new RedisRunJournal({ redis: URL, prefix: kp });
    const runId = `kill-${stamp}`;
    const doneSteps = async (): Promise<string[]> => Object.entries((await journal.get(runId))?.steps ?? {}).filter(([, s]) => s.status === 'done').map(([id]) => id);
    let snapshot: Record<string, string> = {}; let doneAtKill: string[] = [];

    await check('while one orchestrator is alive, another one cannot take the run (its claim is renewed past the TTL)', async () => {
        const a = start('audit-orchestrator.ts', { ...base(kp), RUN_ID: runId, OWNER: 'A', CLAIM_TTL_MS: '3000', CLAIM_RENEW_MS: '1000' });
        procs.push(a);
        await until(async () => (await doneSteps()).length >= 3, 20_000, 'three shards done');
        const b = start('audit-orchestrator.ts', { ...base(kp), RUN_ID: runId, OWNER: 'B' });
        procs.push(b);
        assert.equal(await Promise.race([b.exited, sleep(15_000).then(() => 'timeout' as const)]), 3, 'B was not refused');
        assert.ok(b.has('CLAIM_ERROR'));
        // more than the TTL has passed since A took the claim, and A is still in charge
        await until(async () => (await doneSteps()).length >= 8, 20_000, 'eight shards done');
        assert.equal(await journal.claim(runId, 'C', 3000), null, 'the claim lapsed while its owner was alive');
        // kill it: no goodbye, no release
        snapshot = await redis.hgetall(`${kp}:exec`);
        doneAtKill = await doneSteps();
        a.kill();
        await a.exited;
        assert.ok(!a.has('RESULT'), 'it had already finished: nothing was interrupted');
        assert.ok(doneAtKill.length < 26, 'every shard was already done');
    });

    await check('right after the kill the run is still held; it frees itself when the TTL lapses, and then another orchestrator finishes the audit', async () => {
        const t0 = Date.now();
        // the dead process cannot release or renew: for a while nobody else can take the run
        assert.equal(await journal.claim(runId, 'probe', 3000), null, 'the run was free right after the kill');
        let release: (() => Promise<void>) | null = null;
        while (!release && Date.now() - t0 < 10_000) { await sleep(150); release = await journal.claim(runId, 'probe', 3000); }
        assert.ok(release, 'the claim of the dead process never lapsed');
        const waited = Date.now() - t0;
        assert.ok(waited >= 200 && waited <= 4500, `the claim lapsed after ${waited} ms (TTL 3000 ms, last renewal up to 1000 ms before the kill)`);
        await release!();
        const d = start('audit-orchestrator.ts', { ...base(kp), RUN_ID: runId, OWNER: 'D', CLAIM_TTL_MS: '3000', CLAIM_RENEW_MS: '1000' });
        procs.push(d);
        assert.equal(await Promise.race([d.exited, sleep(90_000).then(() => 'timeout' as const)]), 0, d.lines.slice(-3).join(' | '));
        const r = resultOf(d);
        assert.equal(r.status, 'completed', `resumed run ended ${r.status}; last lines: ${d.lines.filter(l => !l.startsWith('T ')).slice(-4).join(' | ')} | ${d.lines.filter(l => l.startsWith('BAD ')).join(' ')}`);
        assert.equal(r.score.recall, 1, 'a finding was lost across the crash'); assert.equal(r.score.precision, 1);
        console.log(`       the dead process's claim lapsed ${waited} ms after the kill`);
    });

    await check('the shards that were done before the kill did not run again; the run ends done in the journal', async () => {
        const exec = await redis.hgetall(`${kp}:exec`);
        for (const id of doneAtKill) assert.equal(exec[id], snapshot[id], `${id} ran again after the crash (${snapshot[id]} -> ${exec[id]})`);
        assert.equal((await journal.get(runId))?.status, 'done');
        const total = Object.values(exec).reduce((a, n) => a + Number(n), 0);
        const distinct = Object.keys(exec).length;
        console.log(`       ${doneAtKill.length} shards were done at the kill; ${distinct} steps ran ${total} times in all (the surplus is work that was in flight, run again at least once)`);
        assert.equal(distinct, 29);
    });

    for (const p of procs) p.kill();
    await Promise.all(procs.map(p => p.exited));
    await journal.close();
    for (const p of prefixes) await wipe(redis, p);
    await redis.quit();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
