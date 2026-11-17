/**
 * Runs the audit and scores it against what was planted.
 *
 *   npm run audit                       # in this process, 2400 records
 *   npm run audit -- 7 20000 250        # seed, records, shard size
 */
import { runFlow, type ConcurrencyLimiter, type FlowResult, type FlowRunStatus, type RunFlowOptions, type StepExecutor } from '@backendkit-labs/agent-core';
import { auditFlow } from './audit-flow';
import { AuditExecutor, dataFor } from './audit-executor';
import { keyOf, parseVerify } from './analysis';
import type { Dataset } from './dataset';

export interface AuditOptions {
    seed?: number;
    records?: number;
    shardSize?: number;
    delayMs?: number;
    /** Replaces the local executor: a queue to workers. */
    executor?: StepExecutor;
    runId?: string;
    flowOptions?: Partial<RunFlowOptions>;
    limiter?: ConcurrencyLimiter;
    data?: Dataset;
}

export interface Score {
    planted: number; found: number; correct: number; missed: string[]; invented: string[];
    precision: number; recall: number; cleared: number; decoysCleared: number;
}

export function score(data: Dataset, result: FlowResult): Score {
    const verify = result.steps.verify;
    const v = verify?.status === 'completed' ? parseVerify(verify.content) : { confirmed: [], cleared: [] };
    const found = new Set(v.confirmed.map(keyOf));
    const truth = new Set(data.truth);
    const correct = [...found].filter(k => truth.has(k));
    return {
        planted: truth.size, found: found.size, correct: correct.length,
        missed: [...truth].filter(k => !found.has(k)), invented: [...found].filter(k => !truth.has(k)),
        precision: found.size ? correct.length / found.size : 1, recall: truth.size ? correct.length / truth.size : 1,
        cleared: v.cleared.length, decoysCleared: v.cleared.filter(x => x.reason === 'a monthly recurring charge').length,
    };
}

export async function runAudit(o: AuditOptions = {}): Promise<{ data: Dataset; result: FlowResult; score: Score; wallMs: number; status: FlowRunStatus }> {
    const seed = o.seed ?? 7; const records = o.records ?? 2400; const shardSize = o.shardSize ?? 100;
    const data = o.data ?? dataFor(seed, records);
    const shards = Math.ceil(data.records.length / shardSize);
    const executor = o.executor ?? new AuditExecutor({ data, shardSize, delayMs: o.delayMs ?? 0 });
    const t0 = Date.now();
    const result = await runFlow(auditFlow(shards), {
        executor, payload: { audit: `seed-${seed}` }, maxConcurrency: 64,
        ...(o.runId ? { runId: o.runId } : {}), ...(o.limiter ? { limiter: o.limiter } : {}),
        approve: async () => true,
        ...(o.flowOptions ?? {}),
    });
    return { data, result, score: score(data, result), wallMs: Date.now() - t0, status: result.status };
}

async function main(): Promise<void> {
    const seed = Number(process.argv[2] ?? 7); const records = Number(process.argv[3] ?? 2400); const shardSize = Number(process.argv[4] ?? 100);
    const { data, result, score: s, wallMs } = await runAudit({ seed, records, shardSize });
    const shards = Math.ceil(data.records.length / shardSize);
    console.log(`seed ${seed}: ${data.records.length} records in ${shards} shards, ${s.planted} anomalies planted, ${data.decoys} subscriptions that look like duplicates`);
    console.log(`flow ${result.status} in ${wallMs} ms (${Object.keys(result.steps).length} steps)`);
    console.log(`confirmed ${s.found}: right ${s.correct}, missed ${s.missed.length}, invented ${s.invented.length}  (precision ${(s.precision * 100).toFixed(0)}%, recall ${(s.recall * 100).toFixed(0)}%)`);
    console.log(`cleared ${s.cleared} candidates, ${s.decoysCleared} of them recurring subscriptions`);
    console.log('\n' + (result.steps.report?.content ?? '(no report)'));
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
