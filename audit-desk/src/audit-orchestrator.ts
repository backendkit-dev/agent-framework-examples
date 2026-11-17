/**
 * An orchestrator process: runs the audit flow with the steps going through the queue and the run living in Redis. It can be
 * killed and started again with the same RUN_ID: the second one resumes. Output lines: `T <step> <event>` for each transition,
 * then `RESULT <json>`; if another process holds the run, `CLAIM_ERROR` and exit code 3.
 */
import { FlowClaimError } from '@backendkit-labs/agent-core';
import { QueueStepExecutor, RedisRunJournal } from '@backendkit-labs/agent-flow-queue';
import { runAudit } from './audit-run';
import { dataFor } from './audit-executor';

const env = (k: string, d?: string): string => { const v = process.env[k] ?? d; if (v === undefined) throw new Error(`${k} is required`); return v; };

async function main(): Promise<void> {
    const url = env('REDIS_URL'); const prefix = env('PREFIX'); const runId = env('RUN_ID');
    const seed = Number(env('SEED', '7')); const records = Number(env('RECORDS', '2400')); const shardSize = Number(env('SHARD', '100'));
    const executor = new QueueStepExecutor({ redis: url, prefix, timeoutMs: Number(env('STEP_TIMEOUT_MS', '60000')) });
    const journal = new RedisRunJournal({ redis: url, prefix });
    try {
        const out = await runAudit({
            seed, records, shardSize, runId, executor, data: dataFor(seed, records),
            flowOptions: {
                journal, owner: env('OWNER', `orch-${process.pid}`), claimTtlMs: Number(env('CLAIM_TTL_MS', '3000')), claimRenewMs: Number(env('CLAIM_RENEW_MS', '1000')),
                onTransition: t => console.log(`T ${t.stepId} ${t.event}`),
            },
        });
        const bad = Object.values(out.result.steps).filter(x => x.status !== 'completed').map(x => ({ step: x.stepId, status: x.status, error: x.error }));
        if (bad.length) console.log('BAD ' + JSON.stringify(bad));
        console.log('RESULT ' + JSON.stringify({ status: out.status, score: { ...out.score, missed: out.score.missed.length, invented: out.score.invented.length }, wallMs: out.wallMs }));
        await executor.close(); await journal.close();
        process.exit(0);
    } catch (e) {
        if (e instanceof FlowClaimError) { console.log('CLAIM_ERROR ' + e.message); process.exit(3); }
        throw e;
    }
}

main().catch(e => { console.error(e); process.exit(1); });
