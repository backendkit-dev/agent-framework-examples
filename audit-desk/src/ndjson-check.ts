/**
 * The `NdjsonRunJournal` of the SDK (SPEC-0024) with real processes and a hard kill, and no Redis: an audit runs in a process, the process is
 * killed in the middle (SIGKILL: no goodbye, no release) and another one takes the run over AT ONCE (no TTL to wait for), without repeating
 * what was done. Also: a live holder is respected, and a write cut in the middle is cut off.
 *
 *   npm run ndjson:check
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NdjsonRunJournal } from '@backendkit-labs/agent-core';

const ROOT = join(__dirname, '..');
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
let passed = 0; let failed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
    const t0 = Date.now();
    try { await fn(); passed++; console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`); }
}

interface Proc { child: ChildProcess; lines: string[]; exited: Promise<number | null>; kill(): void; has(prefix: string): boolean }
function start(env: Record<string, string>): Proc {
    const child = spawn(process.execPath, ['--import', 'tsx', join('src', 'audit-local-orchestrator.ts')], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines: string[] = []; let buf = '';
    const eat = (d: Buffer): void => { buf += d.toString(); const parts = buf.split('\n'); buf = parts.pop() ?? ''; lines.push(...parts.map(l => l.trim()).filter(Boolean)); };
    child.stdout?.on('data', eat); child.stderr?.on('data', eat);
    return { child, lines, exited: new Promise(res => child.on('exit', c => res(c))), kill: () => { child.kill('SIGKILL'); }, has: p => lines.some(l => l.startsWith(p)) };
}
async function until(pred: () => boolean | Promise<boolean>, ms: number, what: string): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await pred()) return; await sleep(40); }
    throw new Error(`timed out waiting for ${what}`);
}
const resultOf = (p: Proc) => JSON.parse((p.lines.find(l => l.startsWith('RESULT ')) ?? 'RESULT {}').slice(7)) as { status: string; score: { precision: number; recall: number } };
const executions = (dir: string): string[][] => (existsSync(join(dir, 'executions.log')) ? readFileSync(join(dir, 'executions.log'), 'utf8').split('\n').filter(Boolean).map(l => l.split('|')) : []);

async function main(): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'ndjson-check-'));
    const journal = new NdjsonRunJournal(dir);
    const runId = 'audit-kill';
    const env = { DIR: dir, RUN_ID: runId, DELAY_MS: '900', CONCURRENCY: '4' };
    const doneSteps = async (): Promise<string[]> => Object.entries((await journal.get(runId))?.steps ?? {}).filter(([, s]) => s.status === 'done').map(([id]) => id);
    const procs: Proc[] = [];
    console.log('NdjsonRunJournal, real processes, no Redis:\n');

    let doneAtKill: string[] = []; let execAtKill = 0; let killedAt = 0;

    await check('while the process that runs the audit is alive (and slow), another one is refused: its lock is respected, no TTL involved', async () => {
        const a = start(env); procs.push(a);
        await until(async () => (await doneSteps()).length >= 3, 30_000, 'three shards done');
        const b = start(env); procs.push(b);
        assert.equal(await Promise.race([b.exited, sleep(20_000).then(() => 'timeout' as const)]), 3, 'the second process was not refused');
        assert.ok(b.has('CLAIM_ERROR'));
        assert.equal(b.lines.filter(l => l.startsWith('T ')).length, 0, 'the refused process ran something');
        await until(async () => (await doneSteps()).length >= 9, 30_000, 'nine shards done');
        doneAtKill = await doneSteps(); execAtKill = executions(dir).length; killedAt = Date.now();
        a.kill(); await a.exited; // SIGKILL
        assert.ok(!a.has('RESULT'), 'it had already finished');
        assert.ok(doneAtKill.length < 26);
    });

    await check('a write cut in the middle by the kill is cut off by the next writer (the cut is simulated: a kill rarely lands inside a write)', async () => {
        const path = join(dir, `${runId}.ndjson`);
        appendFileSync(path, '{"n":999,"event":{"kind":"step","at":"x","stepId":"shard-0','utf8');
        const r = await new NdjsonRunJournal(dir).get(runId);
        assert.ok(r, 'the run was not readable');
        assert.equal(Object.keys(r!.steps).filter(id => r!.steps[id].status === 'done').length, doneAtKill.length, 'the torn line counted as an event');
    });

    await check('the run is free the instant its holder is dead: a probe takes the claim in milliseconds (with Redis the TTL of 3 s had to lapse)', async () => {
        const t0 = Date.now();
        const release = await journal.claim(runId, 'probe', 3_000);
        const took = Date.now() - t0;
        assert.ok(release, 'the claim of the dead process was still held');
        assert.ok(took < 250, `taking the claim took ${took} ms`);
        await release!();
        console.log(`       claim taken ${Date.now() - killedAt} ms after the kill, the call itself took ${took} ms`);
    });

    await check('another process takes the run over and finishes the audit without losing a finding', async () => {
        const d = start(env); procs.push(d);
        await until(() => d.lines.some(l => l.startsWith('T ')), 30_000, 'the new process to start working');
        assert.ok(!d.has('CLAIM_ERROR'), 'the dead process still held the run');
        assert.equal(await Promise.race([d.exited, sleep(90_000).then(() => 'timeout' as const)]), 0, d.lines.slice(-3).join(' | '));
        const r = resultOf(d);
        assert.equal(r.status, 'completed');
        assert.equal(r.score.recall, 1, 'a finding was lost across the crash'); assert.equal(r.score.precision, 1);
    });

    await check('what was done before the kill was not run again; the run ends done and its chain is valid', async () => {
        const after = executions(dir).slice(execAtKill);
        const reran = after.filter(([id]) => doneAtKill.includes(id));
        assert.equal(reran.length, 0, `these steps ran again after the crash: ${reran.map(r => r[0]).join(', ')}`);
        assert.equal((await new NdjsonRunJournal(dir).get(runId))?.status, 'done');
        const ranTwice = Object.entries(executions(dir).reduce<Record<string, number>>((m, [id]) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {})).filter(([, n]) => n > 1).map(([id]) => id);
        console.log(`       ${doneAtKill.length} steps were done at the kill; steps that ran twice (in flight when it died): ${ranTwice.join(', ') || 'none'}`);
        assert.ok(ranTwice.every(id => !doneAtKill.includes(id)));
        assert.ok(!existsSync(join(dir, `${runId}.lock`)), 'the lock was left behind');
    });

    for (const p of procs) p.kill();
    await Promise.all(procs.map(p => p.exited));
    rmSync(dir, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
