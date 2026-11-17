/**
 * The monorepo as data: its packages, the graph between them and what git and the registry say about each. Everything here is plain
 * computation over the files of the repo (and `git`), so the flow can be built from it and checked by tests.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import semver from 'semver';

export type DepKind = 'dependencies' | 'peerDependencies' | 'devDependencies';

export interface Pkg {
    /** The folder name: unique in the workspace, and what the steps are called after (`build-core`). */
    id: string;
    name: string;
    /** Relative to the root, with `/`. */
    dir: string;
    version: string;
    private: boolean;
    scripts: Record<string, string>;
    /** The workspace packages it uses, with the range it asks for. */
    uses: Array<{ dep: string; range: string; kind: DepKind }>;
}

const KINDS: DepKind[] = ['dependencies', 'peerDependencies', 'devDependencies'];

const readJson = (path: string): Record<string, any> => JSON.parse(readFileSync(path, 'utf8'));

/** Folders that npm workspaces name: `packages/*` (one level) or a plain folder. */
function workspaceDirs(root: string, patterns: string[]): string[] {
    const out: string[] = [];
    for (const p of patterns) {
        if (p.endsWith('/*')) {
            const base = p.slice(0, -2);
            if (!existsSync(join(root, base))) continue;
            for (const d of readdirSync(join(root, base)).sort()) {
                if (statSync(join(root, base, d)).isDirectory() && existsSync(join(root, base, d, 'package.json'))) out.push(`${base}/${d}`);
            }
        } else if (existsSync(join(root, p, 'package.json'))) out.push(p);
    }
    return out;
}

export function discover(root: string): Pkg[] {
    const rootJson = readJson(join(root, 'package.json'));
    const patterns: string[] = Array.isArray(rootJson.workspaces) ? rootJson.workspaces : (rootJson.workspaces?.packages ?? []);
    if (patterns.length === 0) throw new Error(`${root} has no "workspaces" in its package.json: it is not an npm workspaces monorepo`);
    const raw = workspaceDirs(root, patterns).map(dir => ({ dir, json: readJson(join(root, dir, 'package.json')) }));
    const names = new Set(raw.map(r => r.json.name as string));
    return raw.map(({ dir, json }) => ({
        id: basename(dir), name: json.name, dir, version: json.version ?? '0.0.0', private: json.private === true, scripts: json.scripts ?? {},
        uses: KINDS.flatMap(kind => Object.entries((json[kind] ?? {}) as Record<string, string>).filter(([dep]) => names.has(dep)).map(([dep, range]) => ({ dep, range, kind }))),
    }));
}

/** The packages a package needs built first: what it depends on, asks a peer of, or uses to build. */
export const needs = (pkg: Pkg): string[] => [...new Set(pkg.uses.map(u => u.dep))].filter(d => d !== pkg.name);

/** Dependencies before dependents, stable by folder name. Throws on a cycle, naming it. */
export function topoOrder(pkgs: Pkg[]): Pkg[] {
    const byName = new Map(pkgs.map(p => [p.name, p]));
    const out: Pkg[] = []; const state = new Map<string, 'visiting' | 'done'>(); const path: string[] = [];
    const visit = (p: Pkg): void => {
        if (state.get(p.name) === 'done') return;
        if (state.get(p.name) === 'visiting') throw new Error(`dependency cycle: ${[...path.slice(path.indexOf(p.name)), p.name].join(' -> ')}`);
        state.set(p.name, 'visiting'); path.push(p.name);
        for (const d of needs(p).sort()) visit(byName.get(d)!);
        path.pop(); state.set(p.name, 'done'); out.push(p);
    };
    for (const p of [...pkgs].sort((a, b) => a.id.localeCompare(b.id))) visit(p);
    return out;
}

// ── consistency: what a release trips over ──────────────────────────────────

export interface Issue { package: string; message: string }

/**
 * The range a package asks of a workspace package must include the version the workspace has: in `0.x` a `^0.42.0` does not cover `0.43.0`,
 * and an install in CI then fetches the old one (or a version that does not exist yet) instead of linking the workspace.
 */
export function rangeIssues(pkgs: Pkg[], extra: Array<{ where: string; deps: Record<string, string> }> = []): Issue[] {
    const version = new Map(pkgs.map(p => [p.name, p.version]));
    const issues: Issue[] = [];
    const check = (where: string, dep: string, range: string): void => {
        const v = version.get(dep);
        if (!v || range.startsWith('workspace:') || range === '*' || range === 'latest') return;
        if (!semver.validRange(range)) { issues.push({ package: where, message: `${dep}: "${range}" is not a valid range` }); return; }
        if (!semver.satisfies(v, range, { includePrerelease: true })) issues.push({ package: where, message: `${dep}: the range "${range}" does not include the workspace version ${v}` });
    };
    for (const p of pkgs) for (const u of p.uses) check(`${p.id} (${u.kind})`, u.dep, u.range);
    for (const e of extra) for (const [dep, range] of Object.entries(e.deps)) check(e.where, dep, range);
    return issues;
}

/** The manifests under each folder (`templates/base/*`) that ask for workspace packages: they are not in the workspace and still have to match it. */
export function extraManifests(root: string, folders: string[]): Array<{ where: string; deps: Record<string, string> }> {
    const out: Array<{ where: string; deps: Record<string, string> }> = [];
    for (const f of folders) {
        const base = join(root, f);
        if (!existsSync(base)) continue;
        for (const d of readdirSync(base).sort()) {
            const p = join(base, d, 'package.json');
            if (!existsSync(p)) continue;
            const j = readJson(p);
            out.push({ where: `${f}/${d}`, deps: { ...(j.dependencies ?? {}), ...(j.peerDependencies ?? {}), ...(j.devDependencies ?? {}) } });
        }
    }
    return out;
}

// ── git: what changed since the last release of each package ────────────────

export interface TagInfo {
    tag?: string; tagVersion?: string; changed: string[];
    /** Everything that changed is documentation (`.md`): it does not change what the package does. */
    docsOnly: boolean;
    needsBump: boolean;
}

/** Test files, locks, build output and coverage do not need a release; everything else in the folder does. */
export const IGNORED_CHANGE = /(^|\/)(__tests__|coverage|dist|node_modules)\/|\.test\.[cm]?[jt]sx?$|\.tsbuildinfo$|(^|\/)package-lock\.json$/;

export const shortName = (name: string): string => name.replace(/^@[^/]+\//, '');

/** Pure: given the tags of a package (`<short>@<version>`) and the files changed since the newest one. */
export function tagInfo(pkg: Pkg, tags: string[], changedFiles: string[]): TagInfo {
    const prefix = `${shortName(pkg.name)}@`;
    const versions = tags.filter(t => t.startsWith(prefix)).map(t => t.slice(prefix.length)).filter(v => semver.valid(v)).sort(semver.rcompare);
    if (versions.length === 0) return { changed: [], docsOnly: false, needsBump: false };
    const tagVersion = versions[0];
    const changed = changedFiles.filter(f => !IGNORED_CHANGE.test(f));
    // A README that changed is not a reason to block a release: the version already out does what it did. It is worth saying (npm shows the README
    // of the published version), so it is reported on its own.
    const docsOnly = changed.length > 0 && changed.every(f => /\.md$/i.test(f));
    return { tag: `${prefix}${tagVersion}`, tagVersion, changed, docsOnly, needsBump: changed.length > 0 && !docsOnly && pkg.version === tagVersion };
}

// ── the publish plan ────────────────────────────────────────────────────────

/** `docs-changed`: on the registry at its version, and only its documentation changed since: nothing blocks, but npm still shows the old README. */
export type Action = 'publish' | 'already-published' | 'docs-changed' | 'needs-bump' | 'private';
export interface PlanEntry { id: string; name: string; dir: string; version: string; action: Action; reason?: string }

/** Decides what to do with each package, in dependency order. `published` says which `name@version` the registry already has. */
export function publishPlan(pkgs: Pkg[], published: Set<string>, tags: Record<string, TagInfo>): PlanEntry[] {
    return topoOrder(pkgs).map(p => {
        const base = { id: p.id, name: p.name, dir: p.dir, version: p.version };
        if (p.private) return { ...base, action: 'private' as const };
        if (tags[p.id]?.needsBump) return { ...base, action: 'needs-bump' as const, reason: `changed since ${tags[p.id].tag} (${tags[p.id].changed.length} files) and still ${p.version}` };
        if (published.has(`${p.name}@${p.version}`)) {
            return tags[p.id]?.docsOnly && p.version === tags[p.id].tagVersion
                ? { ...base, action: 'docs-changed' as const, reason: `only documentation changed since ${tags[p.id].tag}: ${tags[p.id].changed.join(', ')}` }
                : { ...base, action: 'already-published' as const };
        }
        return { ...base, action: 'publish' as const };
    });
}

/**
 * Checks a plan on its own, from the graph: a package may only be published after the workspace packages it needs, and what it needs must
 * be either published at a version its range accepts or earlier in the plan. Returns the problems (empty: the plan is sound).
 */
export function planProblems(pkgs: Pkg[], plan: PlanEntry[], published: Set<string>): string[] {
    const problems: string[] = [];
    const byName = new Map(pkgs.map(p => [p.name, p]));
    const position = new Map(plan.map((e, i) => [e.name, i]));
    for (const e of plan) {
        if (e.action === 'needs-bump') problems.push(`${e.name}: ${e.reason}`);
        if (e.action !== 'publish') continue;
        for (const u of byName.get(e.name)!.uses) {
            if (u.kind === 'devDependencies') continue; // not part of what a consumer installs
            const dep = byName.get(u.dep)!;
            const there = plan[position.get(u.dep)!];
            const inPlanBefore = there?.action === 'publish' && position.get(u.dep)! < position.get(e.name)!;
            const alreadyOut = published.has(`${dep.name}@${dep.version}`);
            if (!inPlanBefore && !alreadyOut) problems.push(`${e.name} needs ${dep.name}@${dep.version}, which is not published and is not published before it in the plan`);
        }
    }
    const order = plan.map(e => e.name);
    const expected = topoOrder(pkgs).map(p => p.name);
    if (order.join() !== expected.join()) problems.push('the plan is not in dependency order');
    return problems;
}
