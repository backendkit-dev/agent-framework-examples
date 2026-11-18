/**
 * The checks of the audit that need no Redis: correctness against what was planted, why the consolidation is needed, the
 * conditional report, a failed shard, approval and resume with a journal in files, and scale. The Redis side is `npm run redis:check`.
 *
 *   npm run smoke
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApprovalHandler, NdjsonRunJournal, MemoryApprovalStore, runFlow, stepApprovalId, type StepExecutor } from '@backendkit-labs/agent-core';
import { runAudit } from './audit-run';
import { auditFlow } from './audit-flow';
import { AuditExecutor, dataFor } from './audit-executor';
import { scanShard } from './analysis';
import { shardsOf } from './dataset';

let passed = 0; let failed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
    try { await fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`); }
}

async function main(): Promise<void> {
    console.log('Expense audit: a durable flow over shards of records (no Redis)\n');

    await check('finds everything that was planted and nothing else; subscriptions that look like duplicates are cleared', async () => {
        const { score, result } = await runAudit({ seed: 7 });
        assert.equal(result.status, 'completed');
        assert.deepEqual(score.missed, []);
        assert.deepEqual(score.invented, []);
        assert.equal(score.planted, 68);
        assert.equal(score.decoysCleared, 10, 'the recurring subscriptions were not cleared');
    });

    await check('other seeds too: 100% precision and recall', async () => {
        for (const seed of [1, 2, 3, 11, 42]) {
            const { score } = await runAudit({ seed });
            assert.equal(score.recall, 1, `seed ${seed} missed ${score.missed.join(' ')}`);
            assert.equal(score.precision, 1, `seed ${seed} invented ${score.invented.join(' ')}`);
        }
    });

    await check('the consolidation is needed: duplicates and split purchases span shards, and no shard sees them alone', async () => {
        const data = dataFor(7, 2400);
        const shardOf = new Map<number, number>();
        shardsOf(data.records, 100).forEach((s, i) => s.forEach(r => shardOf.set(r.id, i)));
        const crossing = data.truth.filter(k => /^(duplicate|split_purchase):/.test(k)).filter(k => new Set(k.split(':')[1].split(',').map(id => shardOf.get(Number(id)))).size > 1);
        assert.ok(crossing.length > 0, 'nothing crosses a shard: the check proves nothing');
        for (const [i, s] of shardsOf(data.records, 100).entries()) {
            assert.ok(scanShard(i, s).local.every(c => c.kind !== 'duplicate' && c.kind !== 'split_purchase'), 'a shard reported a cross-record finding on its own');
        }
        // and with one shard per record batch of everything there is nothing to cross: the same answer
        const { score } = await runAudit({ seed: 7, shardSize: 5000 });
        assert.equal(score.recall, 1);
    });

    await check('a clean book: nothing confirmed, so the report is skipped by its condition and nobody is asked to approve', async () => {
        const data = dataFor(5, 800, { duplicate: 0, outlier: 0, missing_approval: 0, self_approval: 0, split_purchase: 0, decoys: 0 });
        let asked = 0;
        const { result, score } = await runAudit({ data, shardSize: 100, flowOptions: { approve: async () => { asked++; return true; } } });
        assert.equal(result.status, 'completed');
        assert.equal(score.found, 0);
        assert.equal(result.steps.report.status, 'skipped');
        assert.equal(asked, 0);
    });

    await check('a shard that fails stops the audit from claiming it is complete: no report goes out', async () => {
        const data = dataFor(7, 2400);
        const inner = new AuditExecutor({ data, shardSize: 100 });
        const executor: StepExecutor = { run: async (s, i) => { if (s.id === 'shard-005') throw new Error('the worker died'); return inner.run(s, i); } };
        const { result } = await runAudit({ data, executor });
        assert.equal(result.status, 'failed');
        assert.equal(result.steps['shard-005'].status, 'failed');
        for (const id of ['merge', 'verify', 'report']) assert.equal(result.steps[id].status, 'skipped', `${id} ran on an incomplete audit`);
    });

    await check('the report waits for a person; deciding and running again with the same id finishes it without scanning again', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'audit-'));
        try {
            const data = dataFor(7, 2400); const runs: string[] = [];
            const inner = new AuditExecutor({ data, shardSize: 100, onRun: s => { runs.push(s.id); } });
            const store = new MemoryApprovalStore(); const journal = new NdjsonRunJournal(dir);
            const opts = { journal, approvals: { store }, runId: 'audit-2026', payload: { audit: 'x' }, executor: inner };
            const flow = auditFlow(Math.ceil(data.records.length / 100));
            const first = await runFlow(flow, opts);
            assert.equal(first.status, 'awaiting_approval');
            assert.equal(runs.length, 29 - 1, 'everything but the report should have run');
            await createApprovalHandler(store).decide(stepApprovalId('audit-2026', 'report'), { decision: 'approve', by: { kind: 'human', id: 'ana' }, reason: 'read it' });
            runs.length = 0;
            const second = await runFlow(flow, opts);
            assert.equal(second.status, 'completed');
            assert.deepEqual(runs, ['report'], 'resuming scanned again');
            assert.match(second.steps.report.content, /^# Audit report/);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    await check('a person can refuse the report: the run ends rejected', async () => {
        const data = dataFor(7, 2400); const store = new MemoryApprovalStore(); const journal = new NdjsonRunJournal(mkdtempSync(join(tmpdir(), 'audit-')));
        const opts = { journal, approvals: { store }, runId: 'refused', payload: { audit: 'x' }, executor: new AuditExecutor({ data, shardSize: 100 }) };
        const flow = auditFlow(Math.ceil(data.records.length / 100));
        await runFlow(flow, opts);
        await createApprovalHandler(store).decide(stepApprovalId('refused', 'report'), { decision: 'reject', by: { kind: 'human', id: 'ana' }, reason: 'numbers off' });
        assert.equal((await runFlow(flow, opts)).status, 'rejected');
    });

    await check('scale: 20 000 records in 80 shards, same answer, still exact', async () => {
        const { score, result, data } = await runAudit({ data: dataFor(9, 20000, { duplicate: 120, outlier: 80, missing_approval: 80, self_approval: 60, split_purchase: 40, decoys: 60 }), shardSize: 250 });
        assert.ok(data.records.length > 20000);
        assert.equal(result.status, 'completed');
        assert.equal(score.recall, 1); assert.equal(score.precision, 1);
        assert.equal(Object.keys(result.steps).length, Math.ceil(data.records.length / 250) + 3);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
