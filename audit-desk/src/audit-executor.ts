/** The `StepExecutor` of the audit: runs a step as the agent it names, on data regenerated from the seed. */
import type { FlowStep, StepExecutor, StepInput, StepOutput } from '@backendkit-labs/agent-core';
import { generate, shardsOf, type Dataset, type GenerateOptions } from './dataset';
import { consolidate, parseVerify, report, scanShard, verify, verifyText, type ShardOut } from './analysis';

export interface AuditExecutorOptions {
    data: Dataset;
    shardSize: number;
    /** How long scanning a shard takes (a real analysis does take time). Default 0. */
    delayMs?: number;
    /** Called before every step runs, with its idempotency key: a worker uses it to count executions. */
    onRun?: (step: FlowStep, key: string) => void | Promise<void>;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class AuditExecutor implements StepExecutor {
    private readonly shards;
    constructor(private readonly o: AuditExecutorOptions) {
        this.shards = shardsOf(o.data.records, o.shardSize);
    }

    async run(step: FlowStep, input: StepInput): Promise<StepOutput> {
        await this.o.onRun?.(step, input.idempotencyKey);
        switch (step.agent) {
            case 'scanner': {
                const i = Number(/^shard-(\d+)$/.exec(step.id)?.[1]);
                const records = this.shards[i];
                if (!records) throw new Error(`no such shard: ${step.id}`);
                if (this.o.delayMs) await sleep(this.o.delayMs);
                return { content: JSON.stringify(scanShard(i, records)) };
            }
            case 'consolidator': {
                // The context is the output of every shard: `[shard-000]:\n{json}\n\n[shard-001]:\n...`
                const outs: ShardOut[] = [...(input.context ?? '').matchAll(/\[shard-\d+\]:\n(\{.*\})/g)].map(m => JSON.parse(m[1]) as ShardOut);
                return { content: JSON.stringify(consolidate(outs)) };
            }
            case 'verifier': {
                const candidates = JSON.parse(/\[merge\]:\n(\[.*\])/.exec(input.context ?? '')?.[1] ?? '[]');
                const byId = new Map(this.o.data.records.map(r => [r.id, r]));
                return { content: verifyText(verify(candidates, ids => ids.map(id => byId.get(id)!).filter(Boolean))) };
            }
            case 'writer': {
                const text = (input.context ?? '').replace(/^\[verify\]:\n/, '');
                return { content: report(parseVerify(text)) };
            }
            default: throw new Error(`unknown agent ${step.agent}`);
        }
    }
}

export const dataFor = (seed: number, records: number, plant?: GenerateOptions['plant']): Dataset => generate({ seed, records, ...(plant ? { plant } : {}) });
