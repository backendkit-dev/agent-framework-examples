/**
 * The release check as a flow, built from the package graph: the shape of the flow IS the shape of the monorepo. A build waits for the
 * builds of the packages it needs; the checks that do not need a build (registry, tags, ranges) run from the start, in parallel with them.
 * It is a plain `FlowDefinition`: `validateFlow` checks it, and a run of it can be saved, killed and resumed.
 */
import { FlowDefinitionSchema, validateFlow, type FlowDefinition } from '@backendkit-labs/agent-core';
import { needs, type Pkg } from './workspace';

export const AGENTS = ['inspector', 'git', 'registry', 'builder', 'packer', 'tester', 'planner', 'verifier', 'writer'] as const;

export interface FlowOptions {
    /** Also run the tests of every package (after its build). Default false: they take the longest. */
    tests?: boolean;
    buildTimeoutMs?: number;
    testTimeoutMs?: number;
}

export const stepOf = (kind: string, pkg: Pkg): string => `${kind}-${pkg.id}`;

export function releaseFlow(pkgs: Pkg[], opts: FlowOptions = {}, name = 'release-check'): FlowDefinition {
    const byName = new Map(pkgs.map(p => [p.name, p]));
    const buildable = new Set(pkgs.filter(p => p.scripts.build).map(p => p.id));
    const steps: Array<Record<string, unknown>> = [
        { id: 'inspect', agent: 'inspector', prompt: 'Check that every range a package asks of another package of the workspace includes the version the workspace has.' },
        { id: 'tags', agent: 'git', prompt: 'See what changed in each package since its last release tag.' },
    ];
    const gates: string[] = ['inspect', 'tags'];

    for (const p of pkgs) {
        if (!buildable.has(p.id)) continue;
        // A build waits for the builds of what the package needs; a package that has no build step is not waited for.
        const after = needs(p).map(n => byName.get(n)!).filter(d => buildable.has(d.id)).map(d => stepOf('build', d));
        steps.push({ id: stepOf('build', p), agent: 'builder', prompt: `Build ${p.name}.`, after, timeoutMs: opts.buildTimeoutMs ?? 600_000 });
        gates.push(stepOf('build', p));
        if (opts.tests && p.scripts.test) {
            steps.push({ id: stepOf('test', p), agent: 'tester', prompt: `Run the tests of ${p.name}.`, after: [stepOf('build', p)], timeoutMs: opts.testTimeoutMs ?? 900_000 });
            gates.push(stepOf('test', p));
        }
    }
    for (const p of pkgs) {
        if (p.private) continue; // nobody publishes it
        steps.push({ id: stepOf('registry', p), agent: 'registry', prompt: `Is ${p.name}@${p.version} already on the registry?`, timeoutMs: 60_000 });
        gates.push(stepOf('registry', p));
        if (buildable.has(p.id)) {
            steps.push({ id: stepOf('pack', p), agent: 'packer', prompt: `Check what npm would publish of ${p.name}.`, after: [stepOf('build', p)], timeoutMs: 120_000 });
            gates.push(stepOf('pack', p));
        }
    }

    steps.push(
        { id: 'plan', agent: 'planner', prompt: 'Decide what to publish, in dependency order.', after: gates },
        // The one that checks is not the one that planned: it derives the order and the dependencies again from the graph.
        { id: 'verify', agent: 'verifier', prompt: 'Check the plan against the graph, on its own.', after: ['plan'] },
        {
            id: 'report', agent: 'writer', prompt: 'Write the release checklist.', after: ['verify'],
            // Only when the plan is sound; and a person reads it before anything is published.
            when: { step: 'verify', matches: '^VERIFY: ok' },
            gate: { approval: 'human' },
        },
    );

    const def = FlowDefinitionSchema.parse({ flow: name, version: 1, trigger: { type: 'manual' }, steps });
    const issues = validateFlow(def);
    if (issues.length) throw new Error(`the release flow is not valid: ${issues.join('; ')}`);
    return def;
}
