/**
 * A worker process: serves the queues of the audit agents and runs the steps that arrive. It keeps a log of every execution in
 * Redis (`<prefix>:execlog`) and a count per step (`<prefix>:exec`), so that a test can tell what ran, where and how many times.
 *
 *   REDIS_URL=redis://127.0.0.1:6390 PREFIX=audit-x SEED=7 npx tsx src/audit-worker.ts
 */
import { Redis } from 'ioredis';
import { createStepWorker } from '@backendkit-labs/agent-flow-queue';
import { AuditExecutor, dataFor } from './audit-executor';
import { AGENTS } from './audit-flow';

const env = (k: string, d?: string): string => { const v = process.env[k] ?? d; if (v === undefined) throw new Error(`${k} is required`); return v; };

async function main(): Promise<void> {
    const url = env('REDIS_URL'); const prefix = env('PREFIX'); const name = env('WORKER_NAME', `worker-${process.pid}`);
    const data = dataFor(Number(env('SEED', '7')), Number(env('RECORDS', '2400')));
    const log = new Redis(url);
    const executor = new AuditExecutor({
        data, shardSize: Number(env('SHARD', '100')), delayMs: Number(env('DELAY_MS', '0')),
        onRun: async (step, key) => {
            await log.hincrby(`${prefix}:exec`, step.id, 1);
            await log.rpush(`${prefix}:execlog`, `${step.id}|${key}|${name}|${Date.now()}`);
        },
    });
    const workers = createStepWorker({
        redis: url, prefix, agents: [...AGENTS], executor, concurrency: Number(env('CONCURRENCY', '3')),
        onError: (agent, err) => console.error(`ERR ${agent} ${err.message}`),
    });
    console.log(`READY ${name}`);
    const stop = async (): Promise<void> => { await workers.close(); log.disconnect(); process.exit(0); };
    process.on('SIGTERM', () => { void stop(); });
    process.on('SIGINT', () => { void stop(); });
}

main().catch(e => { console.error(e); process.exit(1); });
