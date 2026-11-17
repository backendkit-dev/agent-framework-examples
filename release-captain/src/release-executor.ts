/** The `StepExecutor` of the release check: each step runs as the agent it names, with real commands for the ones that touch the repo. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowStep, StepExecutor, StepInput, StepOutput } from '@backendkit-labs/agent-core';
import { runCommand, type CommandResult } from './proc';
import {
    extraManifests, planProblems, publishPlan, rangeIssues, tagInfo, topoOrder,
    type Issue, type PlanEntry, type Pkg, type TagInfo,
} from './workspace';

export interface ReleaseExecutorOptions {
    root: string;
    pkgs: Pkg[];
    /** Folders of manifests outside the workspace that ask for workspace packages (`packages/templates/base`). */
    extraFolders?: string[];
    /** Is `name@version` already on the registry? Default: `npm view`. A test passes its own. */
    registry?: (pkg: Pkg, signal: AbortSignal) => Promise<boolean>;
    /** Largest package that is acceptable to publish, in bytes. Default 20 MB. */
    maxPackBytes?: number;
    /** Other commands for a step (a test wants a build that takes 300 ms, not an npm that takes 3 s). `cwd` is relative to the root. */
    commands?: Partial<Record<'build' | 'test' | 'pack' | 'prepublish', (pkg: Pkg) => Command>>;
}

/**
 * What an `npm ... --json` command printed, when scripts of the package (`prepack` of a package that builds its templates, say) wrote to the
 * same stdout before it: the JSON is the last thing, and it starts on a line of its own.
 */
export function parseJsonTail(stdout: string): unknown {
    try { return JSON.parse(stdout); } catch { /* there is noise before it */ }
    const starts = [...stdout.matchAll(/^[[{]\s*$/gm)].map(m => m.index!).reverse();
    for (const at of starts) { try { return JSON.parse(stdout.slice(at)); } catch { /* an inner bracket: try the one before */ } }
    throw new Error('no JSON in the output');
}

export interface Command { command: string; args: string[]; cwd?: string }

/**
 * What a package must not ship: environment files (an `.env.example` is meant to be shipped), private keys, `.npmrc`, coverage output, a nested
 * `.git` or `node_modules`. The file patterns end the name (a prefix is not a match); the folders are matched by their name and a slash.
 */
export const FORBIDDEN_IN_PACKAGE = /(^|\/)((\.env(\.(?!example$|sample$|template$)[^/]*)?|[^/]*\.(pem|key|p12|pfx)|id_rsa[^/]*|\.npmrc)$|(coverage|\.git|node_modules)\/)/;

/** The blocks a step receives as its context: `[step-id]:\n<output>` separated by a blank line. */
export function blocks(context: string | undefined): Map<string, string> {
    const out = new Map<string, string>();
    for (const part of (context ?? '').split(/\n\n(?=\[[^\]\n]+\]:\n)/)) {
        const m = /^\[([^\]\n]+)\]:\n([\s\S]*)$/.exec(part);
        if (m) out.set(m[1], m[2]);
    }
    return out;
}

const fail = (what: string, r: CommandResult): Error =>
    new Error(r.signal === 'timeout' ? `${what} timed out` : r.signal === 'aborted' ? `${what} was cancelled` : `${what} failed (exit ${r.code})\n${r.tail}`);

export class ReleaseExecutor implements StepExecutor {
    private readonly byId: Map<string, Pkg>;
    constructor(private readonly o: ReleaseExecutorOptions) { this.byId = new Map(o.pkgs.map(p => [p.id, p])); }

    private pkgOf(step: FlowStep): Pkg {
        const p = this.byId.get(step.id.slice(step.id.indexOf('-') + 1));
        if (!p) throw new Error(`no package for step ${step.id}`);
        return p;
    }

    async run(step: FlowStep, input: StepInput): Promise<StepOutput> {
        const { root } = this.o;
        switch (step.agent) {
            case 'inspector': {
                const issues: Issue[] = rangeIssues(this.o.pkgs, extraManifests(root, this.o.extraFolders ?? []));
                return { content: JSON.stringify({ issues }) };
            }
            case 'git': return { content: JSON.stringify(await this.tags(input.signal)) };
            case 'registry': {
                const p = this.pkgOf(step);
                const published = await (this.o.registry ?? this.npmView)(p, input.signal);
                return { content: JSON.stringify({ name: p.name, version: p.version, published }) };
            }
            case 'builder': {
                const p = this.pkgOf(step);
                const r = await this.exec('build', p, input.signal);
                if (r.code !== 0) throw fail(`the build of ${p.name}`, r);
                return { content: JSON.stringify({ ms: r.ms }) };
            }
            case 'tester': {
                const p = this.pkgOf(step);
                const r = await this.exec('test', p, input.signal);
                if (r.code !== 0) throw fail(`the tests of ${p.name}`, r);
                return { content: JSON.stringify({ ms: r.ms }) };
            }
            case 'packer': return { content: JSON.stringify(await this.pack(this.pkgOf(step), input.signal)) };
            case 'planner': return { content: JSON.stringify(this.plan(blocks(input.context))) };
            case 'verifier': return { content: this.verify(blocks(input.context)) };
            case 'writer': return { content: this.report(blocks(input.context)) };
            default: throw new Error(`unknown agent ${step.agent}`);
        }
    }

    private exec(kind: 'build' | 'test' | 'pack' | 'prepublish', p: Pkg, signal: AbortSignal): Promise<CommandResult> {
        const c = this.o.commands?.[kind]?.(p) ?? (kind === 'pack'
            ? { command: 'npm', args: ['pack', '--dry-run', '--json'], cwd: p.dir }
            : { command: 'npm', args: ['run', kind === 'prepublish' ? 'prepublishOnly' : kind, '-w', p.dir] });
        return runCommand(c.command, c.args, { cwd: join(this.o.root, c.cwd ?? ''), signal });
    }

    // ── git ──────────────────────────────────────────────────────────────────

    private async tags(signal: AbortSignal): Promise<Record<string, TagInfo>> {
        const { root, pkgs } = this.o;
        const all = await runCommand('git', ['tag', '-l'], { cwd: root, signal });
        if (all.code !== 0) throw fail('git tag', all);
        const tags = all.stdout.split('\n').map(t => t.trim()).filter(Boolean);
        // What is uncommitted counts as changed: a release from a dirty tree is the kind of surprise this is here to prevent.
        const status = await runCommand('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, signal });
        if (signal.aborted) throw new Error('cancelled');
        const dirty = status.stdout.split('\n').filter(l => l.length > 3).map(l => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()!);
        // One `git diff` per package, all at once: a process start is the slow part (a second each on some systems), and a cancelled run does not wait for them.
        const entries = await Promise.all(pkgs.filter(p => !p.private).map(async (p): Promise<[string, TagInfo]> => {
            const newest = tagInfo(p, tags, []).tag; // a tag that is not a version is not a release: the package counts as untagged
            let changed: string[] = dirty.filter(f => f.startsWith(`${p.dir}/`));
            if (newest) {
                const d = await runCommand('git', ['diff', '--name-only', `${newest}..HEAD`, '--', p.dir], { cwd: root, signal });
                if (signal.aborted) throw new Error('cancelled');
                if (d.code !== 0) throw fail(`git diff since ${newest}`, d);
                changed = [...new Set([...changed, ...d.stdout.split('\n').map(f => f.trim()).filter(Boolean)])];
            }
            return [p.id, tagInfo(p, tags, changed)];
        }));
        return Object.fromEntries(entries);
    }

    // ── registry ─────────────────────────────────────────────────────────────

    private npmView = async (p: Pkg, signal: AbortSignal): Promise<boolean> => {
        const r = await runCommand('npm', ['view', `${p.name}@${p.version}`, 'version', '--json'], { cwd: this.o.root, signal, timeoutMs: 45_000 });
        if (r.code === 0 && r.stdout.trim()) return true;
        if (/E404|404 Not Found|is not in this registry/i.test(r.stdout + r.tail)) return false; // that version (or the package) does not exist yet
        throw fail(`npm view ${p.name}@${p.version}`, r);
    };

    // ── pack ─────────────────────────────────────────────────────────────────

    private async pack(p: Pkg, signal: AbortSignal): Promise<{ files: number; kb: number }> {
        // `npm publish` runs `prepublishOnly` and then packs (running `prepack`): do the same, so that what is checked is what would go out. (`npm publish --dry-run`
        // cannot be used: it refuses a version that is already on the registry, which is most of the time.) A package may build its library only there.
        if (p.scripts.prepublishOnly) {
            const pre = await this.exec('prepublish', p, signal);
            if (pre.code !== 0) throw fail(`the prepublishOnly of ${p.name}`, pre);
        }
        const r = await this.exec('pack', p, signal);
        if (r.code !== 0) throw fail(`npm pack of ${p.name}`, r);
        let info: { files?: Array<{ path: string }>; size?: number; unpackedSize?: number };
        try { [info] = parseJsonTail(r.stdout) as Array<typeof info>; } catch { throw new Error(`npm pack of ${p.name} did not answer JSON:\n${r.tail}`); }
        const paths = (info?.files ?? []).map(f => f.path.replace(/\\/g, '/'));
        const problems: string[] = [];
        for (const f of paths) if (FORBIDDEN_IN_PACKAGE.test(f)) problems.push(`it would publish ${f}`);
        const entry = this.mainFile(p);
        if (entry && !paths.includes(entry)) problems.push(`"main" is ${entry} and it is not in the package (was it built?)`);
        const bytes = info?.unpackedSize ?? info?.size ?? 0;
        if (bytes > (this.o.maxPackBytes ?? 20_000_000)) problems.push(`it weighs ${(bytes / 1e6).toFixed(1)} MB unpacked`);
        if (paths.length === 0) problems.push('it would publish nothing');
        if (problems.length) throw new Error(`${p.name} is not fit to publish: ${problems.join('; ')}`);
        return { files: paths.length, kb: Math.round(bytes / 1024) };
    }

    private mainFile(p: Pkg): string | undefined {
        const j = JSON.parse(readFileSync(join(this.o.root, p.dir, 'package.json'), 'utf8')) as { main?: string };
        return j.main?.replace(/^\.\//, '');
    }

    // ── plan, verify, report: pure, over what the other steps found ──────────

    private facts(ctx: Map<string, string>): { published: Set<string>; tags: Record<string, TagInfo>; issues: Issue[] } {
        const published = new Set<string>();
        for (const [id, text] of ctx) if (id.startsWith('registry-')) { const r = JSON.parse(text) as { name: string; version: string; published: boolean }; if (r.published) published.add(`${r.name}@${r.version}`); }
        return {
            published,
            tags: JSON.parse(ctx.get('tags') ?? '{}') as Record<string, TagInfo>,
            issues: (JSON.parse(ctx.get('inspect') ?? '{"issues":[]}') as { issues: Issue[] }).issues,
        };
    }

    private plan(ctx: Map<string, string>): { plan: PlanEntry[]; published: string[]; issues: Issue[] } {
        const f = this.facts(ctx);
        return { plan: publishPlan(this.o.pkgs, f.published, f.tags), published: [...f.published], issues: f.issues };
    }

    /** Does not trust the plan: it takes the facts again and derives the order and the dependencies from the graph. */
    private verify(ctx: Map<string, string>): string {
        const given = JSON.parse(ctx.get('plan') ?? '{}') as { plan: PlanEntry[]; published: string[]; issues: Issue[] };
        const problems = [
            ...given.issues.map(i => `${i.package}: ${i.message}`),
            ...planProblems(this.o.pkgs, given.plan, new Set(given.published)),
        ];
        const toPublish = given.plan.filter(e => e.action === 'publish').length;
        // The plan travels on: the report only receives this step's output.
        const body = JSON.stringify({ problems, plan: given.plan });
        return problems.length === 0 ? `VERIFY: ok ${toPublish} to publish\n${body}` : `VERIFY: blocked ${problems.length} problems\n${body}`;
    }

    private report(ctx: Map<string, string>): string {
        const verify = ctx.get('verify') ?? '';
        const { plan } = JSON.parse(verify.slice(verify.indexOf('\n') + 1) || '{"plan":[]}') as { plan: PlanEntry[] };
        const topo = topoOrder(this.o.pkgs).map(p => p.id);
        const todo = plan.filter(e => e.action === 'publish');
        const lines = ['# Release checklist', ''];
        if (todo.length === 0) lines.push('Nothing to publish: every public package is already on the registry at its version.');
        else {
            lines.push(`Publish ${todo.length} package${todo.length > 1 ? 's' : ''}, in this order (each after the one above it has appeared on the registry):`, '');
            todo.forEach((e, i) => lines.push(`${i + 1}. \`cd ${e.dir} && npm publish --access public\`   # ${e.name}@${e.version}`));
            lines.push('', 'Then tag the merge commit:', '');
            for (const e of todo) lines.push(`- \`git tag -a ${e.name.replace(/^@[^/]+\//, '')}@${e.version} -m "${e.name.replace(/^@[^/]+\//, '')}@${e.version}" <merge-commit>\``);
        }
        const skipped = plan.filter(e => e.action === 'already-published').map(e => e.id).sort((a, b) => topo.indexOf(a) - topo.indexOf(b));
        if (skipped.length) lines.push('', `Already on the registry at their version, nothing to do: ${skipped.join(', ')}.`);
        const docs = plan.filter(e => e.action === 'docs-changed');
        if (docs.length) {
            lines.push('', 'Only documentation changed since their last release (nothing blocks; npm keeps showing the old README until the package is published again):');
            for (const e of docs) lines.push(`- ${e.id}: ${(e.reason ?? '').replace(/^only documentation changed since /, '')}`);
        }
        const priv = plan.filter(e => e.action === 'private').map(e => e.id);
        if (priv.length) lines.push('', `Private, never published: ${priv.join(', ')}.`);
        lines.push('', 'This tool published nothing.');
        return lines.join('\n');
    }
}
