import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ContextLoader, LoadedContext } from '../../src/bootstrap/context-loader-v2';

describe('ContextLoader', () => {
    let tmpDir: string;
    let originalHome: string | undefined;
    let originalProfile: string | undefined;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctx-loader-test-'));
        // Redirigir HOME para que loadUserMd no encuentre el USER.md global real
        originalHome    = process.env.HOME;
        originalProfile = process.env.USERPROFILE;
        process.env.HOME        = tmpDir;
        process.env.USERPROFILE = tmpDir;
    });

    afterEach(async () => {
        process.env.HOME        = originalHome;
        process.env.USERPROFILE = originalProfile;
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('load() returns null fields when files do not exist', async () => {
        const loader = new ContextLoader({ cwd: tmpDir });
        const loaded = await loader.load();

        expect(loaded.agentMd).toBeNull();
        expect(loaded.userMd).toBeNull();
        expect(loaded.contextMarkdown).toBeNull();
        expect(loaded.lessonsMemo).toBeNull();
    });

    it('load() reads AGENT.md and USER.md when present', async () => {
        await fs.writeFile(path.join(tmpDir, 'AGENT.md'), '# Agent instructions');
        await fs.writeFile(path.join(tmpDir, 'USER.md'), '# User preferences');

        const loader = new ContextLoader({ cwd: tmpDir });
        const loaded = await loader.load();

        expect(loaded.agentMd).toBe('# Agent instructions');
        expect(loaded.userMd).toBe('# User preferences');
    });

    it('load() passes contextMarkdown from options', async () => {
        const loader = new ContextLoader({ cwd: tmpDir, contextMarkdown: '# Project context' });
        const loaded = await loader.load();

        expect(loaded.contextMarkdown).toBe('# Project context');
    });

    it('load() returns only agentMd when only AGENT.md exists', async () => {
        await fs.writeFile(path.join(tmpDir, 'AGENT.md'), 'agent content');

        const loader = new ContextLoader({ cwd: tmpDir });
        const loaded = await loader.load();

        expect(loaded.agentMd).toBe('agent content');
        expect(loaded.userMd).toBeNull();
    });

    it('reload() reflects file changes without reconstructing the loader', async () => {
        const loader = new ContextLoader({ cwd: tmpDir });

        const first = await loader.load();
        expect(first.agentMd).toBeNull();

        await fs.writeFile(path.join(tmpDir, 'AGENT.md'), 'updated agent');
        const second = await loader.reload();

        expect(second.agentMd).toBe('updated agent');
    });

    it('reload() with partial opts updates contextMarkdown', async () => {
        const loader = new ContextLoader({ cwd: tmpDir, contextMarkdown: 'v1' });
        const second = await loader.reload({ contextMarkdown: 'v2' });

        expect(second.contextMarkdown).toBe('v2');
    });

    it('load() runs contextFiles and lessonsMemo in parallel (no sequential delay)', async () => {
        await fs.writeFile(path.join(tmpDir, 'AGENT.md'), 'parallel');
        await fs.writeFile(path.join(tmpDir, 'USER.md'), 'parallel');

        const start = Date.now();
        const loader = new ContextLoader({ cwd: tmpDir });
        await loader.load();
        const elapsed = Date.now() - start;

        // Both reads happen in parallel — total should be well under 200ms in any env
        expect(elapsed).toBeLessThan(500);
    });
});
