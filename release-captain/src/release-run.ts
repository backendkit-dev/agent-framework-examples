/**
 * Is this monorepo ready to release? Builds what has to be built in dependency order, checks the registry and the tarballs, plans the
 * publication, verifies the plan on its own and, when a person approves it, hands over the checklist. It publishes nothing.
 *
 *   npm run release -- <root> [--tests] [--jobs 3] [--extra packages/templates/base]
 *   npm run release -- <root> --run <id>             # resume that run: what is done is not done again
 *   npm run release -- <root> --run <id> --approve   # approve the report of that run and finish it
 *
 * A run is kept in a state directory (`--state`, by default under the temp folder, one per repo) and has an id; resuming it skips the steps
 * that finished, so after fixing one package only that package and what depends on it are built again. A resume trusts the earlier results:
 * if you changed a package that had already built, start a new run.
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import {
    createApprovalHandler, FileApprovalStore, KeyedConcurrencyLimiter, NdjsonRunJournal, runFlow, stepApprovalId,
    type FlowResult, type FlowTransition,
} from '@backendkit-labs/agent-core';
import { releaseFlow } from './release-flow';
import { ReleaseExecutor, type ReleaseExecutorOptions } from './release-executor';
import { discover, type Pkg } from './workspace';

export interface ReleaseRunOptions {
    root: string;
    /** Where the run and its approvals are kept. Default: a folder under the temp dir, one per repo. */
    stateDir?: string;
    runId?: string;
    tests?: boolean;
    /** Builds at the same time. Default 3. */
    jobs?: number;
    extraFolders?: string[];
    registry?: ReleaseExecutorOptions['registry'];
    commands?: ReleaseExecutorOptions['commands'];
    /** Approve the report of the run `runId` (as this person) before resuming it. */
    approve?: { by: string };
    signal?: AbortSignal;
    buildTimeoutMs?: number;
    onLine?: (line: string) => void;
}

export interface ReleaseRun { runId: string; pkgs: Pkg[]; result: FlowResult; stateDir: string }

export const defaultStateDir = (root: string): string => join(tmpdir(), 'release-captain', createHash('sha1').update(resolve(root)).digest('hex').slice(0, 10));

export async function runRelease(o: ReleaseRunOptions): Promise<ReleaseRun> {
    const root = resolve(o.root);
    const stateDir = o.stateDir ?? defaultStateDir(root);
    mkdirSync(stateDir, { recursive: true });
    const pkgs = discover(root);
    const flow = releaseFlow(pkgs, { tests: o.tests, ...(o.buildTimeoutMs ? { buildTimeoutMs: o.buildTimeoutMs } : {}) });
    const jobs = o.jobs ?? 3;
    const store = new FileApprovalStore(join(stateDir, 'approvals'));
    const runId = o.runId ?? `release-${Date.now().toString(36)}`;

    if (o.approve) {
        const id = stepApprovalId(runId, 'report');
        try { await createApprovalHandler(store).decide(id, { decision: 'approve', by: { kind: 'human', id: o.approve.by }, reason: 'approved from the command line' }); }
        catch (e) { throw new Error(`cannot approve the report of run "${runId}": ${(e as Error).message}`); }
        o.onLine?.(`approved ${id} as ${o.approve.by}`);
    }

    const t0 = Date.now();
    const log = (t: FlowTransition): void => {
        if (t.event === 'started' || t.event === 'completed' || t.event === 'failed' || t.event === 'skipped' || t.event === 'approval_requested') {
            o.onLine?.(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${t.stepId.padEnd(24)} ${t.event}${t.event === 'failed' || t.event === 'skipped' ? (t.detail ? `  ${t.detail.split('\n')[0].slice(0, 90)}` : '') : ''}`);
        }
    };
    const result = await runFlow(flow, {
        executor: new ReleaseExecutor({ root, pkgs, extraFolders: o.extraFolders, registry: o.registry, commands: o.commands }),
        journal: new NdjsonRunJournal(join(stateDir, 'runs')),
        approvals: { store },
        limiter: new KeyedConcurrencyLimiter({ max: key => key === 'builder' ? jobs : key === 'tester' ? 2 : key === 'registry' ? 6 : key === 'packer' ? 4 : undefined }),
        runId, maxConcurrency: Math.max(8, pkgs.length * 4), payload: {}, signal: o.signal, onTransition: log,
    });
    return { runId, pkgs, result, stateDir };
}

export function summary(run: ReleaseRun): string {
    const { result } = run;
    const by = (s: string) => Object.values(result.steps).filter(x => x.status === s);
    const lines = [`run ${run.runId}: ${result.status}`, `${by('completed').length} steps done, ${by('failed').length} failed, ${by('skipped').length} skipped`];
    for (const f of by('failed')) lines.push('', `FAILED ${f.stepId}: ${(f.error ?? '').split('\n').slice(0, 8).join('\n    ')}`);
    const verify = result.steps.verify;
    if (verify?.status === 'completed') {
        const first = verify.content.split('\n')[0];
        lines.push('', first);
        const { problems } = JSON.parse(verify.content.slice(verify.content.indexOf('\n') + 1)) as { problems: string[] };
        for (const p of problems) lines.push(`  - ${p}`);
    }
    return lines.join('\n');
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const flag = (name: string): boolean => args.includes(`--${name}`);
    const value = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
    const root = args.find((a, i) => !a.startsWith('--') && !['--run', '--jobs', '--state', '--extra'].includes(args[i - 1] ?? ''));
    if (!root) { console.error('usage: npm run release -- <root> [--tests] [--jobs 3] [--run <id>] [--approve] [--state <dir>] [--extra packages/templates/base]'); process.exit(2); }

    const ctl = new AbortController();
    process.on('SIGINT', () => { console.error('\ninterrupted: stopping what is running (resume it with --run)'); ctl.abort(); });
    const run = await runRelease({
        root, stateDir: value('state'), runId: value('run'), tests: flag('tests'), jobs: value('jobs') ? Number(value('jobs')) : undefined,
        extraFolders: value('extra') ? value('extra')!.split(',') : undefined,
        approve: flag('approve') ? { by: userInfo().username } : undefined, signal: ctl.signal, onLine: l => console.log(l),
    });
    console.log('\n' + summary(run));
    if (run.result.status === 'awaiting_approval') {
        console.log(`\nWaiting for you to read the plan. Approve it and get the checklist with:\n  npm run release -- ${root} --run ${run.runId} --approve`);
    } else if (run.result.status === 'completed' && run.result.steps.report?.status === 'completed') {
        console.log('\n' + run.result.steps.report.content);
    }
    process.exit(run.result.status === 'completed' ? 0 : 1);
}

if (require.main === module) main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
