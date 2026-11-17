/**
 * An orchestrator process with NO Redis: the audit runs in this process (the steps take DELAY_MS each) and the run lives in a directory, in an
 * `NdjsonRunJournal`. Kill it and start it again with the same RUN_ID: the second resumes. Output lines: `T <step> <event>`, `RESULT <json>`, and
 * `CLAIM_ERROR` with exit code 3 if another live process holds the run. Every execution of a step is appended to `<DIR>/executions.log`.
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { FlowClaimError, NdjsonRunJournal } from '@backendkit-labs/agent-core';
import { runAudit } from './audit-run';
import { AuditExecutor, dataFor } from './audit-executor';

const env = (k: string, d?: string): string => { const v = process.env[k] ?? d; if (v === undefined) throw new Error(`${k} is required`); return v; };

async function main(): Promise<void> {
    const dir = env('DIR'); const runId = env('RUN_ID');
    const seed = Number(env('SEED', '7')); const records = Number(env('RECORDS', '2400')); const shardSize = Number(env('SHARD', '100'));
    const data = dataFor(seed, records);
    const executor = new AuditExecutor({
        data, shardSize, delayMs: Number(env('DELAY_MS', '0')),
        onRun: (step, key) => { appendFileSync(join(dir, 'executions.log'), `${step.id}|${key}|${process.pid}|${Date.now()}\n`); },
    });
    const journal = new NdjsonRunJournal(dir);
    try {
        const out = await runAudit({
            seed, records, shardSize, runId, data, executor,
            flowOptions: { journal, maxConcurrency: Number(env('CONCURRENCY', '4')), onTransition: t => console.log(`T ${t.stepId} ${t.event}`) },
        });
        console.log('RESULT ' + JSON.stringify({ status: out.status, score: { ...out.score, missed: out.score.missed.length, invented: out.score.invented.length } }));
        process.exit(0);
    } catch (e) {
        if (e instanceof FlowClaimError) { console.log('CLAIM_ERROR ' + e.message); process.exit(3); }
        throw e;
    }
}

main().catch(e => { console.error(e); process.exit(1); });
