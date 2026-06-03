/**
 * TASK-11 — Pre-commit multi-stack
 * Verifica que runPreCommitTests detecta el stack correcto y ejecuta
 * los comandos adecuados segun el proyecto.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import { runPreCommitTests } from '../src/agent/commit/workflow';

jest.mock('child_process', () => ({
    execSync: jest.fn().mockReturnValue(Buffer.from('')),
    execFileSync: jest.fn(),
}));

const mockedExecSync = childProcess.execSync as jest.MockedFunction<typeof childProcess.execSync>;

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'task11-'));
}

describe('TASK-11 — runPreCommitTests multi-stack', () => {
    let tmpDir: string;
    let originalCwd: string;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        originalCwd = process.cwd();
        process.chdir(tmpDir);
        mockedExecSync.mockReset();
        mockedExecSync.mockReturnValue(Buffer.from(''));
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('ejecuta go build y go test en proyectos Go', async () => {
        fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/app\ngo 1.22\n');

        const result = await runPreCommitTests();

        const calls = mockedExecSync.mock.calls.map(c => c[0] as string);
        expect(calls).toContain('go build ./...');
        expect(calls).toContain('go test ./...');
        expect(result.success).toBe(true);
        expect(result.output).toContain('go');
    });

    it('ejecuta cargo check y cargo test en proyectos Rust', async () => {
        fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "my-crate"\n');

        const result = await runPreCommitTests();

        const calls = mockedExecSync.mock.calls.map(c => c[0] as string);
        expect(calls).toContain('cargo check');
        expect(calls).toContain('cargo test');
        expect(result.success).toBe(true);
        expect(result.output).toContain('rust');
    });

    it('ejecuta pytest en proyectos Python (requirements.txt)', async () => {
        fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'fastapi\n');

        const result = await runPreCommitTests();

        const calls = mockedExecSync.mock.calls.map(c => c[0] as string);
        expect(calls).toContain('python -m pytest --tb=short');
        expect(result.success).toBe(true);
        expect(result.output).toContain('python');
    });

    it('ejecuta rush build y rush test en monorepos Rush', async () => {
        fs.writeFileSync(
            path.join(tmpDir, 'rush.json'),
            JSON.stringify({ rushVersion: '5.100.0', projects: [] }),
        );

        const result = await runPreCommitTests();

        const calls = mockedExecSync.mock.calls.map(c => c[0] as string);
        expect(calls).toContain('rush build');
        expect(calls).toContain('rush test');
        expect(result.success).toBe(true);
        expect(result.output).toContain('rush');
    });

    it('ejecuta tsc y jest en proyectos Node (default — sin archivos de stack)', async () => {
        const result = await runPreCommitTests();

        const calls = mockedExecSync.mock.calls.map(c => c[0] as string);
        expect(calls).toContain('npx tsc --noEmit');
        expect(calls).toContain('npx jest --passWithNoTests --maxWorkers=1');
        expect(result.success).toBe(true);
        expect(result.output).toContain('node');
    });

    it('Rush tiene prioridad sobre package.json cuando ambos existen', async () => {
        fs.writeFileSync(
            path.join(tmpDir, 'rush.json'),
            JSON.stringify({ rushVersion: '5.100.0', projects: [] }),
        );
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: {} }));

        await runPreCommitTests();

        const calls = mockedExecSync.mock.calls.map(c => c[0] as string);
        expect(calls).toContain('rush build');
        expect(calls).not.toContain('npx tsc --noEmit');
    });

    it('retorna success=false con label del comando cuando falla el primer paso', async () => {
        fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/app\ngo 1.22\n');
        mockedExecSync.mockImplementationOnce(() => { throw new Error('build failed'); });

        const result = await runPreCommitTests();

        expect(result.success).toBe(false);
        expect(result.output).toContain('Go build fallo');
    });
});
