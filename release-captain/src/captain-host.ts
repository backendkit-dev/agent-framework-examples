/**
 * What the captain agent controls: the release checks of one or more monorepos, hosted as flows (`createFlowHandler`) and exposed to a
 * model as tools (`createFlowTools`). This file has no model in it: it is the body, and `captain-agent.ts` puts a model on top.
 *
 * Every monorepo is two flows, `<alias>` and `<alias>+tests`. They share one journal (`NdjsonRunJournal`), one approval store
 * (`FileApprovalStore`) and one limiter, so builds of different runs queue against the same caps: two runs at once do not
 * double the load of the machine.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
    createApprovalHandler, createFlowHandler, createFlowTools, defineTool, FileApprovalStore, flowFromDefinition,
    KeyedConcurrencyLimiter, NdjsonRunJournal,
    type FlowHandlerPort, type InProcessFlow, type ToolDefinition,
} from '@backendkit-labs/agent-core';
import { z } from 'zod';
import { releaseFlow } from './release-flow';
import { ReleaseExecutor, type ReleaseExecutorOptions } from './release-executor';
import { discover, rangeIssues, extraManifests, topoOrder } from './workspace';

export interface Monorepo {
    root: string;
    /** Manifests outside the workspace that ask for workspace packages (templates). */
    extraFolders?: string[];
    registry?: ReleaseExecutorOptions['registry'];
    commands?: ReleaseExecutorOptions['commands'];
    buildTimeoutMs?: number;
}

export interface CaptainHostOptions {
    monorepos: Record<string, Monorepo>;
    /** Where runs and approvals are kept. */
    stateDir: string;
    /** Builds at the same time, across all runs. Default 3. */
    jobs?: number;
}

export interface CaptainHost {
    handler: FlowHandlerPort;
    journal: NdjsonRunJournal;
    store: FileApprovalStore;
    /** The tools the model gets: flows, approvals (read, and the decision it can never make) and the monorepo ones. */
    tools: ToolDefinition[];
    monorepos: Record<string, Monorepo>;
    close(): Promise<void>;
}

const text = (v: unknown): string => JSON.stringify(v, null, 2);

export function createCaptainHost(o: CaptainHostOptions): CaptainHost {
    mkdirSync(o.stateDir, { recursive: true });
    const journal = new NdjsonRunJournal(join(o.stateDir, 'runs'));
    const store = new FileApprovalStore(join(o.stateDir, 'approvals'));
    const jobs = o.jobs ?? 3;
    const limiter = new KeyedConcurrencyLimiter({ max: key => key === 'builder' ? jobs : key === 'tester' ? 2 : key === 'registry' ? 6 : key === 'packer' ? 4 : undefined });

    const flows: Record<string, InProcessFlow> = {};
    for (const [alias, m] of Object.entries(o.monorepos)) {
        const root = resolve(m.root);
        const pkgs = discover(root);
        for (const tests of [false, true]) {
            const name = tests ? `${alias}+tests` : alias;
            const def = releaseFlow(pkgs, { tests, ...(m.buildTimeoutMs ? { buildTimeoutMs: m.buildTimeoutMs } : {}) }, name);
            flows[name] = {
                description: `Is "${alias}" (${pkgs.length} packages) ready to release${tests ? ', running every package\'s tests too' : ''}? Builds in dependency order, checks registry/tags/ranges/tarballs, plans and verifies the publication; a person approves the report. Publishes nothing.`,
                ...flowFromDefinition(def, {
                    executor: new ReleaseExecutor({ root, pkgs, extraFolders: m.extraFolders, registry: m.registry, commands: m.commands }),
                    journal, approvals: { store }, limiter, maxConcurrency: Math.max(8, pkgs.length * 4),
                }),
            };
        }
    }
    const { handler, host } = createFlowHandler(flows, { cancelGraceMs: 5000 });

    // The model reads approvals and may try to decide one, but the decision is made "as" a service: an approval that needs a
    // human (the report of a release) answers FORBIDDEN, whatever the model says. The engine's policy denies the call even earlier.
    const flowTools = createFlowTools({ flows: handler, approvals: createApprovalHandler(store), approver: { kind: 'service', id: 'captain' } });

    const monorepoTools: ToolDefinition[] = [
        defineTool({
            name: 'monorepo_info', readOnly: true,
            description: 'The packages of a registered monorepo and what uses what, in the order they must be built and published, with the version-range problems that can be seen without building. Cheap: no build, no network.',
            input: z.object({ alias: z.string().min(1).describe('name of the monorepo, from flow_list (the flow is called the same, plus "+tests")') }),
            execute: async ({ alias }) => {
                const m = o.monorepos[alias];
                if (!m) return `Error: no monorepo "${alias}". Known: ${Object.keys(o.monorepos).join(', ')}`;
                const pkgs = discover(resolve(m.root));
                const issues = rangeIssues(pkgs, m.extraFolders ? extraManifests(resolve(m.root), m.extraFolders) : []);
                return text({
                    alias, packages: topoOrder(pkgs).map(p => ({ id: p.id, name: p.name, version: p.version, private: p.private, uses: p.uses.map(u => u.dep) })),
                    rangeIssues: issues,
                });
            },
        }),
        defineTool({
            name: 'run_report', readOnly: true,
            description: 'What a finished (or stopped) release run found: the verdict of the verification with its problems, the publication plan in order, and the error of every failed step. Use it after flow_wait says the run is done, failed or awaiting approval.',
            input: z.object({ flowRunId: z.string().min(1) }),
            execute: async ({ flowRunId }) => {
                const run = await journal.get(flowRunId);
                if (!run) return `Error: no run "${flowRunId}" in the journal`;
                const out = (id: string): string | undefined => run.steps[id]?.output;
                const verify = out('verify');
                const report: Record<string, unknown> = {
                    flow: run.flow, status: run.status,
                    failed: Object.entries(run.steps).filter(([, s]) => s.status === 'failed').map(([id, s]) => ({ step: id, error: (s.error ?? '').split('\n').slice(0, 12).join('\n') })),
                    skipped: Object.entries(run.steps).filter(([, s]) => s.status === 'skipped').map(([id]) => id),
                };
                if (verify) {
                    const nl = verify.indexOf('\n');
                    report.verdict = verify.slice(0, nl < 0 ? undefined : nl);
                    try { report.problems = (JSON.parse(verify.slice(nl + 1)) as { problems: string[] }).problems; } catch { /* verdict only */ }
                }
                const plan = out('plan');
                if (plan) { try { report.plan = (JSON.parse(plan) as { plan: unknown }).plan; } catch { report.plan = plan.slice(0, 2000); } }
                if (run.waiting) report.waitingForPerson = run.waiting;
                return text(report);
            },
        }),
    ];

    return {
        handler, journal, store, monorepos: o.monorepos,
        tools: [...flowTools, ...monorepoTools],
        close: async () => { await host.close(); },
    };
}
