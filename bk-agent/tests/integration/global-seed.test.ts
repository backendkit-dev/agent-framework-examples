import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { runGlobalSeed } from '../../src/bootstrap/global-seed';

describe('runGlobalSeed', () => {
    let tmpDir: string;
    let originalCwd: string;
    let originalHome: string | undefined;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-test-'));
        originalCwd  = process.cwd();
        originalHome = process.env.USERPROFILE ?? process.env.HOME;

        // Redirigir HOME para no tocar ~/.bk-agent real
        process.env.USERPROFILE = tmpDir;
        process.env.HOME        = tmpDir;

        process.chdir(tmpDir);
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        if (originalHome) {
            process.env.USERPROFILE = originalHome;
            process.env.HOME        = originalHome;
        }
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('crea los directorios globales necesarios', async () => {
        await runGlobalSeed(tmpDir);

        const globalDir = path.join(tmpDir, '.bk-agent');
        await expect(fs.access(globalDir)).resolves.toBeUndefined();
        await expect(fs.access(path.join(globalDir, 'agents'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(globalDir, 'skills'))).resolves.toBeUndefined();
        await expect(fs.access(path.join(globalDir, 'projects'))).resolves.toBeUndefined();
    });

    it('crea el directorio del proyecto en projects/{hash}/', async () => {
        await runGlobalSeed(tmpDir);

        const entries = await fs.readdir(path.join(tmpDir, '.bk-agent', 'projects'));
        expect(entries.length).toBe(1);
    });

    it('crea USER.md global si no existe y reporta createdUserMd=true', async () => {
        const result = await runGlobalSeed(tmpDir);

        expect(result.createdUserMd).toBe(true);
        const userMd = await fs.readFile(path.join(tmpDir, '.bk-agent', 'USER.md'), 'utf-8');
        expect(userMd).toContain('role:');
        expect(userMd).toContain('Perfil');
    });

    it('crea AGENT.md en el proyecto si no existe y reporta createdAgentMd=true', async () => {
        const result = await runGlobalSeed(tmpDir);

        expect(result.createdAgentMd).toBe(true);
        const agentMd = await fs.readFile(path.join(tmpDir, 'AGENT.md'), 'utf-8');
        expect(agentMd).toContain('AGENT.md');
        expect(agentMd).toContain('Stack');
    });

    it('es idempotente — segunda llamada no sobreescribe archivos existentes', async () => {
        await runGlobalSeed(tmpDir);

        const userMdPath  = path.join(tmpDir, '.bk-agent', 'USER.md');
        const agentMdPath = path.join(tmpDir, 'AGENT.md');

        await fs.writeFile(userMdPath,  'custom user content', 'utf-8');
        await fs.writeFile(agentMdPath, 'custom agent content', 'utf-8');

        const result = await runGlobalSeed(tmpDir);

        expect(result.createdUserMd).toBe(false);
        expect(result.createdAgentMd).toBe(false);
        expect(await fs.readFile(userMdPath,  'utf-8')).toBe('custom user content');
        expect(await fs.readFile(agentMdPath, 'utf-8')).toBe('custom agent content');
    });

    it('detecta proyecto Node.js y lo menciona en AGENT.md', async () => {
        await fs.writeFile(
            path.join(tmpDir, 'package.json'),
            JSON.stringify({ devDependencies: { typescript: '^5.0.0', jest: '^29.0.0' } }),
            'utf-8'
        );

        await runGlobalSeed(tmpDir);

        const agentMd = await fs.readFile(path.join(tmpDir, 'AGENT.md'), 'utf-8');
        expect(agentMd).toContain('TypeScript');
        expect(agentMd).toContain('Jest');
    });

    it('detecta proyecto Rust y lo menciona en AGENT.md', async () => {
        await fs.writeFile(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "my-crate"', 'utf-8');

        await runGlobalSeed(tmpDir);

        const agentMd = await fs.readFile(path.join(tmpDir, 'AGENT.md'), 'utf-8');
        expect(agentMd).toContain('Rust');
        expect(agentMd).toContain('Cargo');
    });

    it('detecta proyecto Python y lo menciona en AGENT.md', async () => {
        await fs.writeFile(path.join(tmpDir, 'requirements.txt'), 'fastapi\nuvicorn', 'utf-8');

        await runGlobalSeed(tmpDir);

        const agentMd = await fs.readFile(path.join(tmpDir, 'AGENT.md'), 'utf-8');
        expect(agentMd).toContain('Python');
        expect(agentMd).toContain('pytest');
    });

    it('detecta Rush monorepo y genera AGENT.md con Rush como buildTool', async () => {
        await fs.writeFile(
            path.join(tmpDir, 'rush.json'),
            JSON.stringify({ rushVersion: '5.100.0', projects: [] }),
            'utf-8'
        );

        await runGlobalSeed(tmpDir);

        const agentMd = await fs.readFile(path.join(tmpDir, 'AGENT.md'), 'utf-8');
        expect(agentMd).toContain('Rush');
        expect(agentMd).toContain('rush build');
        expect(agentMd).toContain('rush install');
    });
});
