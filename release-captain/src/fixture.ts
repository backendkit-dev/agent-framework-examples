/**
 * A small npm workspaces monorepo on disk, with git and release tags, whose "builds" are real processes that take a controlled time and can
 * be made to fail. Every build appends a line to `builds.log`, so a test can see what ran, in what order and how much of it overlapped.
 *
 *   core <- util <- web <- cli        docs (private, uses core)        solo (alone)
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BUILD = `
const fs = require('fs'), path = require('path');
const dir = __dirname, root = path.resolve(dir, '..', '..'), id = path.basename(dir), start = Date.now();
const delay = fs.existsSync(path.join(dir, 'delay.txt')) ? Number(fs.readFileSync(path.join(dir, 'delay.txt'), 'utf8')) : 300;
setTimeout(() => {
  const end = Date.now();
  if (fs.existsSync(path.join(dir, 'fail.flag'))) {
    fs.appendFileSync(path.join(root, 'builds.log'), [id, 'fail', start, end].join('|') + '\\n');
    console.error('error TS2322: boom in ' + id);
    process.exit(1);
  }
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'module.exports = { id: ' + JSON.stringify(id) + ' };');
  fs.appendFileSync(path.join(root, 'builds.log'), [id, 'ok', start, end].join('|') + '\\n');
}, delay);
`;

/** What `npm pack --dry-run --json` says, without npm (which takes seconds to start): the files of the package that exist. */
const PACK_FAKE = `
const fs = require('fs'), path = require('path');
const files = [{ path: 'package.json' }];
const walk = (d, rel) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p, rel + f + '/'); else files.push({ path: rel + f }); } };
walk(path.join(process.cwd(), 'dist'), 'dist/');
console.log(JSON.stringify([{ files, unpackedSize: 2048 }]));
`;

const PACKAGES: Array<{ id: string; uses: string[]; private?: boolean }> = [
    { id: 'core', uses: [] }, { id: 'util', uses: ['core'] }, { id: 'web', uses: ['core', 'util'] },
    { id: 'cli', uses: ['web'] }, { id: 'docs', uses: ['core'], private: true }, { id: 'solo', uses: [] },
];

export interface BuildLine { id: string; outcome: 'ok' | 'fail'; start: number; end: number }

export interface Fixture {
    root: string;
    builds(): BuildLine[];
    /** The most builds that were running at the same time. */
    maxOverlap(): number;
    fail(id: string, on?: boolean): void;
    delay(id: string, ms: number): void;
    edit(id: string, change: (pkgJson: Record<string, any>) => void): void;
    write(id: string, file: string, content: string): void;
    git(...args: string[]): void;
    cleanup(): void;
}

const git = (cwd: string, ...args: string[]): void => {
    const r = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
};

export function makeFixture(): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'release-fixture-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['packages/*'] }, null, 2));
    writeFileSync(join(root, 'pack-fake.cjs'), PACK_FAKE);
    writeFileSync(join(root, '.gitignore'), 'dist/\nbuilds.log\nnode_modules/\nfail.flag\ndelay.txt\n');
    for (const p of PACKAGES) {
        const dir = join(root, 'packages', p.id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify({
            name: `@fx/${p.id}`, version: '1.0.0', ...(p.private ? { private: true } : {}), main: 'dist/index.js', files: ['dist'],
            scripts: { build: 'node build.cjs', test: 'node -e "process.exit(0)"' },
            dependencies: Object.fromEntries(p.uses.map(u => [`@fx/${u}`, '^1.0.0'])),
        }, null, 2));
        writeFileSync(join(dir, 'build.cjs'), BUILD);
        writeFileSync(join(dir, 'index.src.js'), `// source of ${p.id}\n`);
    }
    git(root, 'init', '-q'); git(root, 'config', 'user.email', 'fixture@example.com'); git(root, 'config', 'user.name', 'fixture');
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'initial');
    for (const p of PACKAGES) if (!p.private) git(root, 'tag', '-a', `${p.id}@1.0.0`, '-m', `${p.id}@1.0.0`);

    const pkg = (id: string, file = ''): string => join(root, 'packages', id, file);
    const builds = (): BuildLine[] => (existsSync(join(root, 'builds.log')) ? readFileSync(join(root, 'builds.log'), 'utf8').split('\n').filter(Boolean).map(l => {
        const [id, outcome, start, end] = l.split('|');
        return { id, outcome: outcome as 'ok' | 'fail', start: Number(start), end: Number(end) };
    }) : []);
    return {
        root, builds,
        maxOverlap: () => {
            const events = builds().flatMap(b => [[b.start, 1], [b.end, -1]] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            let cur = 0; let max = 0;
            for (const [, d] of events) { cur += d; max = Math.max(max, cur); }
            return max;
        },
        fail: (id, on = true) => { if (on) writeFileSync(pkg(id, 'fail.flag'), ''); else rmSync(pkg(id, 'fail.flag'), { force: true }); },
        delay: (id, ms) => writeFileSync(pkg(id, 'delay.txt'), String(ms)),
        edit: (id, change) => { const j = JSON.parse(readFileSync(pkg(id, 'package.json'), 'utf8')); change(j); writeFileSync(pkg(id, 'package.json'), JSON.stringify(j, null, 2)); },
        write: (id, file, content) => { mkdirSync(join(pkg(id), ...file.split('/').slice(0, -1)), { recursive: true }); writeFileSync(pkg(id, file), content); },
        git: (...args) => git(root, ...args),
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

/** The commands a fast test uses in place of npm: the same builds and a pack that lists the files that exist. */
export const fastCommands = {
    build: (p: { id: string; dir: string }) => ({ command: 'node', args: [`${p.dir}/build.cjs`] }),
    pack: (p: { dir: string }) => ({ command: 'node', args: ['../../pack-fake.cjs'], cwd: p.dir }),
};

export const appendLog = (root: string, line: string): void => appendFileSync(join(root, 'builds.log'), `${line}\n`);
