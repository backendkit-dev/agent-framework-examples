/**
 * The checks of the release captain. The graph, the ranges, the tags and the plan are tested as plain functions; the orchestration with a
 * small monorepo on disk (real git, real processes for the builds): the order of the builds, how many run at once, a failure that skips
 * what depends on it, resuming after the fix, a deadline, a cancel that kills the processes, and the approval before the report.
 *
 *   npm run smoke
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FlowStep } from '@backendkit-labs/agent-core';
import { fastCommands, makeFixture, type Fixture } from './fixture';
import { runRelease, summary, type ReleaseRunOptions } from './release-run';
import { blocks, FORBIDDEN_IN_PACKAGE, parseJsonTail, ReleaseExecutor } from './release-executor';
import { releaseFlow } from './release-flow';
import { discover, extraManifests, planProblems, publishPlan, rangeIssues, tagInfo, topoOrder, type Pkg, type PlanEntry } from './workspace';

let passed = 0; let failed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
    const t0 = Date.now();
    try { await fn(); passed++; console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`); }
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const pkg = (id: string, uses: Array<[string, string, ('dependencies' | 'peerDependencies' | 'devDependencies')?]> = [], version = '1.0.0'): Pkg => ({
    id, name: `@fx/${id}`, dir: `packages/${id}`, version, private: false, scripts: { build: 'x' },
    uses: uses.map(([dep, range, kind]) => ({ dep: `@fx/${dep}`, range, kind: kind ?? 'dependencies' })),
});

/** A run on a fixture with the fast commands and a registry that has nothing. */
async function withFixture<T>(fn: (fx: Fixture, run: (extra?: Partial<ReleaseRunOptions>) => ReturnType<typeof runRelease>) => Promise<T>): Promise<T> {
    const fx = makeFixture(); const stateDir = mkdtempSync(join(tmpdir(), 'release-state-'));
    try {
        return await fn(fx, extra => runRelease({ root: fx.root, stateDir, jobs: 2, registry: async () => false, commands: fastCommands, ...extra }));
    } finally { fx.cleanup(); rmSync(stateDir, { recursive: true, force: true }); }
}
const order = (text: string): string[] => [...text.matchAll(/^\d+\. `cd packages\/(\w+)/gm)].map(m => m[1]);

async function main(): Promise<void> {
    console.log('Release captain: a durable flow over a monorepo\n');

    // ── the monorepo as data ─────────────────────────────────────────────────
    await check('the order puts what a package needs before it, and a cycle is named', () => {
        const pkgs = [pkg('web', [['core', '^1.0.0'], ['util', '^1.0.0']]), pkg('util', [['core', '^1.0.0']]), pkg('core'), pkg('solo')];
        assert.deepEqual(topoOrder(pkgs).map(p => p.id), ['core', 'solo', 'util', 'web']);
        const cyclic = [pkg('a', [['b', '^1.0.0']]), pkg('b', [['a', '^1.0.0']])];
        assert.throws(() => topoOrder(cyclic), /dependency cycle: @fx\/a -> @fx\/b -> @fx\/a/);
    });

    await check('a range has to include the workspace version, with the 0.x rule: ^0.42.0 does not cover 0.43.0', () => {
        const pkgs = [pkg('core', [], '0.43.0'), pkg('a', [['core', '^0.42.0']]), pkg('b', [['core', '^0.43.0']]), pkg('c', [['core', '>=0.43.0 <0.45.0', 'peerDependencies']]), pkg('d', [['core', '>=0.24.0 <0.43.0', 'peerDependencies']]), pkg('e', [['core', 'workspace:*']])];
        const issues = rangeIssues(pkgs);
        assert.deepEqual(issues.map(i => i.package).sort(), ['a (dependencies)', 'd (peerDependencies)']);
        assert.match(issues[0].message, /"\^0\.42\.0" does not include the workspace version 0\.43\.0/);
        assert.deepEqual(rangeIssues(pkgs, [{ where: 'templates/base/single', deps: { '@fx/core': '^0.42.0', 'left-pad': '^1.0.0' } }]).filter(i => i.package.startsWith('templates')).length, 1);
    });

    await check('manifests outside the workspace (templates) are read and held to the same ranges', () => {
        const root = mkdtempSync(join(tmpdir(), 'extra-'));
        try {
            for (const [name, range] of [['single', '^1.0.0'], ['old', '^0.9.0']]) {
                mkdirSync(join(root, 'templates', name), { recursive: true });
                writeFileSync(join(root, 'templates', name, 'package.json'), JSON.stringify({ dependencies: { '@fx/core': range } }));
            }
            const extra = extraManifests(root, ['templates', 'nothing-here']);
            assert.deepEqual(extra.map(e => e.where), ['templates/old', 'templates/single']);
            assert.deepEqual(rangeIssues([pkg('core')], extra).map(i => i.package), ['templates/old']);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });

    await check('what changed since the last tag: the newest by version, and tests, locks and build output do not count', () => {
        const core = pkg('core', [], '0.10.0');
        const tags = ['core@0.9.0', 'core@0.10.0', 'core@0.2.0', 'core@not-a-version', 'util@5.0.0'];
        const t = tagInfo(core, tags, ['packages/core/src/a.ts', 'packages/core/src/__tests__/a.test.ts', 'packages/core/package-lock.json', 'packages/core/dist/index.js', 'packages/core/coverage/x.json', 'packages/core/src/b.test.ts']);
        assert.equal(t.tag, 'core@0.10.0');
        assert.deepEqual(t.changed, ['packages/core/src/a.ts']);
        assert.equal(t.needsBump, true);
        assert.equal(tagInfo({ ...core, version: '0.10.1' }, tags, ['packages/core/src/a.ts']).needsBump, false, 'a new version is the bump');
        assert.equal(tagInfo(core, tags, ['packages/core/src/a.test.ts']).needsBump, false);
        assert.deepEqual(tagInfo(pkg('fresh'), tags, ['packages/fresh/x.ts']), { changed: [], docsOnly: false, needsBump: false }, 'no tag: nothing to compare with');
    });

    await check('a change that is only documentation does not block (found on the real monorepo): it is reported, and code next to it still needs the bump', () => {
        const core = pkg('core', [], '0.10.0'); const tags = ['core@0.10.0'];
        const docs = tagInfo(core, tags, ['packages/core/README.md', 'packages/core/docs/guide.md']);
        assert.equal(docs.docsOnly, true);
        assert.equal(docs.needsBump, false);
        assert.equal(tagInfo(core, tags, ['packages/core/README.md', 'packages/core/src/a.ts']).needsBump, true, 'a README does not excuse the code');
        assert.equal(tagInfo(core, tags, []).docsOnly, false);
        const plan = publishPlan([core], new Set(['@fx/core@0.10.0']), { core: docs });
        assert.equal(plan[0].action, 'docs-changed');
        assert.deepEqual(planProblems([core], plan, new Set(['@fx/core@0.10.0'])), [], 'a docs-only change blocks nothing');
        assert.equal(publishPlan([core], new Set(), { core: docs })[0].action, 'publish', 'a version that was never published is published, README or not');
    });

    await check('the plan is in dependency order and says what to do with each package; an unsound plan is caught on its own', () => {
        const pkgs = [pkg('web', [['core', '^1.0.0'], ['util', '^1.0.0']]), pkg('util', [['core', '^1.0.0']]), pkg('core'), { ...pkg('docs', [['core', '^1.0.0']]), private: true }];
        const published = new Set(['@fx/core@1.0.0']);
        const plan = publishPlan(pkgs, published, { util: { tag: 'util@1.0.0', tagVersion: '1.0.0', changed: ['packages/util/a.ts'], docsOnly: false, needsBump: true } });
        assert.deepEqual(plan.map(e => `${e.id}:${e.action}`), ['core:already-published', 'docs:private', 'util:needs-bump', 'web:publish']);
        assert.ok(planProblems(pkgs, plan, published).some(p => /util: changed since util@1\.0\.0/.test(p)));
        assert.ok(planProblems(pkgs, plan, published).some(p => /web needs @fx\/util@1\.0\.0, which is not published/.test(p)));
        const sound = publishPlan(pkgs, published, {});
        assert.deepEqual(planProblems(pkgs, sound, published), []);
        const wrongOrder: PlanEntry[] = [...sound].reverse();
        assert.ok(planProblems(pkgs, wrongOrder, published).includes('the plan is not in dependency order'));
    });

    await check('the context blocks of a step are read back, JSON and all', () => {
        const b = blocks('[tags]:\n{"core":{"changed":[]}}\n\n[registry-core]:\n{"name":"@fx/core","published":false}\n\n[verify]:\nVERIFY: ok 2 to publish\n{"problems":[]}');
        assert.deepEqual([...b.keys()], ['tags', 'registry-core', 'verify']);
        assert.equal(JSON.parse(b.get('registry-core')!).published, false);
        assert.equal(blocks(undefined).size, 0);
    });

    await check('what a package must not ship: secrets and tooling, but an .env.example is meant to be shipped (found on the real monorepo)', () => {
        for (const bad of ['.env', '.env.local', '.env.production', 'templates/base/x/.env', 'server.pem', 'keys/id_rsa', 'id_rsa.pub', 'deploy.key', '.npmrc', 'coverage/lcov.info', 'a/b/node_modules/x/index.js', '.git/config']) {
            assert.ok(FORBIDDEN_IN_PACKAGE.test(bad), `${bad} should be refused`);
        }
        for (const fine of ['.env.example', 'templates/base/autonomous/.env.example', '.env.sample', '.env.template', 'src/coverage.ts', 'src/keyboard.ts', 'docs/environment.md', 'dist/index.js', 'src/.envelope.ts', 'my.key.ts', 'README.md']) {
            assert.ok(!FORBIDDEN_IN_PACKAGE.test(fine), `${fine} should be allowed`);
        }
    });

    await check('the JSON of an npm command is found after the noise a package script printed before it', () => {
        const noise = ['> create-bk-agent@0.24.1 prepack', '> node scripts/copy-templates.js && npm run build', '[copy-templates] done', ''].join('\n');
        const json = JSON.stringify([{ files: [{ path: 'dist/index.js' }], unpackedSize: 10 }], null, 2);
        assert.deepEqual(parseJsonTail(json), JSON.parse(json));
        assert.deepEqual(parseJsonTail(noise + json), JSON.parse(json));
        assert.deepEqual(parseJsonTail(noise + ['[', '  "not it"', ']', ''].join('\n') + json), JSON.parse(json), 'an earlier array is not the answer');
        assert.throws(() => parseJsonTail('only noise'), /no JSON/);
    });

    await check('the flow has the shape of the monorepo: a build waits for the builds it needs, the checks that need no build start at once', async () => {
        await withFixture(async fx => {
            const flow = releaseFlow(discover(fx.root));
            const step = (id: string) => flow.steps.find(s => s.id === id)!;
            assert.deepEqual([...step('build-web').after].sort(), ['build-core', 'build-util']);
            assert.deepEqual(step('build-core').after, []);
            assert.deepEqual(step('registry-cli').after, []);
            assert.deepEqual(step('pack-web').after, ['build-web']);
            assert.equal(flow.steps.some(s => s.id === 'registry-docs' || s.id === 'pack-docs'), false, 'a private package is never published');
            assert.ok(flow.steps.some(s => s.id === 'build-docs'), 'but it is built');
            assert.deepEqual(step('report').when, { step: 'verify', matches: '^VERIFY: ok', not: false });
            assert.equal(releaseFlow(discover(fx.root), { tests: true }).steps.filter(s => s.id.startsWith('test-')).length, 6);
        });
    });

    // ── orchestration, with processes ────────────────────────────────────────
    await check('a green monorepo: builds in dependency order, no more at once than allowed, a plan that waits for a person, and the checklist once approved', async () => {
        await withFixture(async (fx, run) => {
            const first = await run({ runId: 'green' });
            assert.equal(first.result.status, 'awaiting_approval', summary(first));
            const builds = fx.builds();
            assert.deepEqual(builds.map(b => b.id).sort(), ['cli', 'core', 'docs', 'solo', 'util', 'web']);
            const end = (id: string) => builds.find(b => b.id === id)!.end; const start = (id: string) => builds.find(b => b.id === id)!.start;
            for (const [id, deps] of [['util', ['core']], ['web', ['core', 'util']], ['cli', ['web']], ['docs', ['core']]] as const) {
                for (const d of deps) assert.ok(start(id) >= end(d), `${id} started before ${d} finished`);
            }
            assert.equal(fx.maxOverlap(), 2, `builds at once: ${fx.maxOverlap()} (the cap is 2, and independent ones should reach it)`);
            assert.match(first.result.steps.verify.content, /^VERIFY: ok 5 to publish/);
            assert.equal(first.result.steps.report?.status, undefined, 'the report waits for a person');

            const done = await run({ runId: 'green', approve: { by: 'ana' } });
            assert.equal(done.result.status, 'completed', summary(done));
            assert.equal(fx.builds().length, 6, 'approving built again');
            const text = done.result.steps.report.content;
            assert.deepEqual(order(text), ['core', 'util', 'web', 'cli', 'solo']);
            assert.match(text, /git tag -a core@1\.0\.0/);
            assert.ok(!/docs/.test(text.split('Private')[0]), 'a private package is not in the publish list');
            assert.match(text, /Private, never published: docs/);
            assert.match(text, /This tool published nothing\./);
        });
    });

    await check('a build fails: what depends on it is skipped, what does not goes on, and the error says why', async () => {
        await withFixture(async (fx, run) => {
            fx.fail('util');
            const r = await run({ runId: 'red' });
            assert.equal(r.result.status, 'failed');
            const s = r.result.steps;
            assert.equal(s['build-util'].status, 'failed');
            assert.match(s['build-util'].error!, /the build of @fx\/util failed \(exit 1\)\nerror TS2322: boom in util/);
            for (const id of ['build-web', 'build-cli', 'pack-web', 'pack-cli', 'plan', 'verify', 'report']) assert.equal(s[id].status, 'skipped', `${id} should be skipped`);
            for (const id of ['build-core', 'build-solo', 'build-docs', 'pack-core', 'pack-solo']) assert.equal(s[id].status, 'completed', `${id} should have gone on`);
            assert.deepEqual(fx.builds().map(b => b.id).filter(id => id === 'web' || id === 'cli'), [], 'a build that was skipped ran');
        });
    });

    await check('after the fix, resuming the run builds only what was left: what was done is not built again', async () => {
        await withFixture(async (fx, run) => {
            fx.fail('util');
            await run({ runId: 'resume' });
            const before = fx.builds().length; // core, solo, docs, and util (failed)
            fx.fail('util', false);
            const r = await run({ runId: 'resume' });
            assert.equal(r.result.status, 'awaiting_approval', summary(r));
            const after = fx.builds().slice(before).map(b => b.id).sort();
            assert.deepEqual(after, ['cli', 'util', 'web'], `built again: ${after.join(', ')}`);
            assert.equal(fx.builds().filter(b => b.id === 'core').length, 1);
        });
    });

    await check('what is already on the registry is not published again, and its dependents do not wait for it', async () => {
        await withFixture(async (fx, run) => {
            const r = await run({ runId: 'pub', registry: async p => p.name === '@fx/core' });
            assert.match(r.result.steps.verify.content, /^VERIFY: ok 4 to publish/);
            const done = await run({ runId: 'pub', approve: { by: 'ana' }, registry: async p => p.name === '@fx/core' });
            assert.deepEqual(order(done.result.steps.report.content), ['util', 'web', 'cli', 'solo']);
            assert.match(done.result.steps.report.content, /Already on the registry at their version, nothing to do: core\./);
            assert.ok(fx.builds().length > 0);
        });
    });

    await check('a range that does not include the workspace version blocks the plan; the report is skipped by its condition and nobody is asked', async () => {
        await withFixture(async (fx, run) => {
            fx.edit('web', j => { j.dependencies['@fx/core'] = '^2.0.0'; });
            const r = await run({ runId: 'range' });
            assert.equal(r.result.status, 'completed', summary(r)); // a finding is not a failure of the run
            assert.match(r.result.steps.verify.content, /^VERIFY: blocked/);
            assert.match(summary(r), /web \(dependencies\): @fx\/core: the range "\^2\.0\.0" does not include the workspace version 1\.0\.0/);
            assert.equal(r.result.steps.report.status, 'skipped');
        });
    });

    await check('a package changed since its tag and still at the same version needs a bump (committed or not); bumping it clears it', async () => {
        await withFixture(async (fx, run) => {
            fx.write('core', 'src/new.js', '// a change\n'); fx.git('add', '-A'); fx.git('commit', '-q', '-m', 'change core');
            fx.write('util', 'wip.js', '// not committed\n');
            const r = await run({ runId: 'bump1' });
            const problems = (JSON.parse(r.result.steps.verify.content.split('\n')[1]) as { problems: string[] }).problems;
            assert.ok(problems.some(p => /^@fx\/core: changed since core@1\.0\.0/.test(p)), problems.join('\n'));
            assert.ok(problems.some(p => /^@fx\/util: changed since util@1\.0\.0/.test(p)), 'an uncommitted change counts');
            assert.equal(r.result.steps.report.status, 'skipped');

            fx.edit('core', j => { j.version = '1.0.1'; }); fx.edit('util', j => { j.version = '1.0.1'; });
            fx.git('add', '-A'); fx.git('commit', '-q', '-m', 'bump');
            const ok = await run({ runId: 'bump2' });
            assert.match(ok.result.steps.verify.content, /^VERIFY: ok/, summary(ok));
        });
    });

    await check('a build over its deadline fails and its process is killed, without holding up the rest', async () => {
        await withFixture(async (fx, run) => {
            fx.delay('solo', 5000);
            const t0 = Date.now(); let failedAt = 0;
            const r = await run({ runId: 'slow', buildTimeoutMs: 1800, onLine: l => { if (/build-solo\s+failed/.test(l)) failedAt = Date.now() - t0; } }); // a fast build takes ~0.5 s here: starting a shell on Windows is slow
            assert.match(r.result.steps['build-solo'].error ?? '', /timed out/);
            assert.equal(r.result.steps['build-core'].status, 'completed');
            assert.ok(failedAt > 0 && failedAt < 3500, `the slow build was declared failed after ${failedAt} ms (deadline 1800 ms, its work 5000 ms)`);
            await sleep(5000);
            assert.ok(!fx.builds().some(b => b.id === 'solo'), 'the killed build finished anyway');
        });
    });

    await check('cancelling the run kills the builds in progress: nothing finishes afterwards', async () => {
        await withFixture(async (fx, run) => {
            for (const id of ['core', 'solo', 'util', 'web', 'cli', 'docs']) fx.delay(id, 3000);
            const ctl = new AbortController();
            setTimeout(() => ctl.abort(), 900);
            const t0 = Date.now();
            const r = await run({ runId: 'stop', signal: ctl.signal });
            assert.equal(r.result.status, 'cancelled');
            assert.ok(Date.now() - t0 < 2800, `cancelling took ${Date.now() - t0} ms`);
            await sleep(3500);
            assert.deepEqual(fx.builds(), [], 'a build finished after the run was cancelled: its process was not killed');
        });
    });

    await check('real npm pack: a package that would publish a secret is refused, and one that is clean is accepted', async () => {
        await withFixture(async fx => {
            const pkgs = discover(fx.root);
            const executor = new ReleaseExecutor({ root: fx.root, pkgs });
            const step = (id: string) => ({ id, agent: 'packer', prompt: 'x', after: [] } as unknown as FlowStep);
            const input = { prompt: '', idempotencyKey: 'k', signal: new AbortController().signal };
            fx.write('util', 'dist/index.js', 'module.exports = {};');
            const clean = JSON.parse((await executor.run(step('pack-util'), input)).content) as { files: number };
            assert.ok(clean.files >= 2);
            fx.write('util', '.env', 'TOKEN=secret\n'); fx.edit('util', j => { j.files = ['dist', '.env']; });
            await assert.rejects(executor.run(step('pack-util'), input), /util is not fit to publish: it would publish \.env/);
            fx.edit('util', j => { j.files = ['dist']; j.main = 'dist/missing.js'; });
            await assert.rejects(executor.run(step('pack-util'), input), /"main" is dist\/missing\.js and it is not in the package/);
        });
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
