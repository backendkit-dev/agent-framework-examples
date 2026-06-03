/**
 * TASK-10 — Checkpoints consultables
 * Verifica listCheckpoints() y readCheckpoint() en updater.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listCheckpoints, readCheckpoint } from '../src/memory/updater';

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'task10-'));
}

function makeCheckpointsDir(base: string): string {
    const dir = path.join(base, 'checkpoints');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

describe('listCheckpoints', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = makeTmpDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('retorna array vacio si no existe el directorio checkpoints', async () => {
        const result = await listCheckpoints(tmpDir);
        expect(result).toEqual([]);
    });

    it('retorna array vacio si la carpeta existe pero esta vacia', async () => {
        makeCheckpointsDir(tmpDir);
        const result = await listCheckpoints(tmpDir);
        expect(result).toEqual([]);
    });

    it('ignora archivos que no siguen el patron checkpoint-*.md', async () => {
        const dir = makeCheckpointsDir(tmpDir);
        fs.writeFileSync(path.join(dir, 'notas.md'), 'algo');
        fs.writeFileSync(path.join(dir, 'checkpoint.txt'), 'otro');
        const result = await listCheckpoints(tmpDir);
        expect(result).toHaveLength(0);
    });

    it('parsea correctamente un checkpoint con nombre simple', async () => {
        const dir = makeCheckpointsDir(tmpDir);
        fs.writeFileSync(path.join(dir, 'checkpoint-2026-05-10-mi-feature.md'), '# cp');
        const result = await listCheckpoints(tmpDir);
        expect(result).toHaveLength(1);
        expect(result[0].date).toBe('2026-05-10');
        expect(result[0].feature).toBe('mi-feature');
        expect(result[0].filename).toBe('checkpoint-2026-05-10-mi-feature.md');
    });

    it('parsea correctamente un checkpoint con nombre compuesto', async () => {
        const dir = makeCheckpointsDir(tmpDir);
        fs.writeFileSync(path.join(dir, 'checkpoint-2026-05-09-reflection-engine-wiring.md'), '# cp');
        const result = await listCheckpoints(tmpDir);
        expect(result[0].feature).toBe('reflection-engine-wiring');
    });

    it('ordena checkpoints de mas reciente a mas antiguo', async () => {
        const dir = makeCheckpointsDir(tmpDir);
        fs.writeFileSync(path.join(dir, 'checkpoint-2026-05-01-alpha.md'), '# a');
        fs.writeFileSync(path.join(dir, 'checkpoint-2026-05-10-beta.md'), '# b');
        fs.writeFileSync(path.join(dir, 'checkpoint-2026-04-20-gamma.md'), '# g');
        const result = await listCheckpoints(tmpDir);
        expect(result[0].date).toBe('2026-05-10');
        expect(result[1].date).toBe('2026-05-01');
        expect(result[2].date).toBe('2026-04-20');
    });

    it('retorna el path absoluto correcto', async () => {
        const dir = makeCheckpointsDir(tmpDir);
        fs.writeFileSync(path.join(dir, 'checkpoint-2026-05-10-test.md'), '# t');
        const result = await listCheckpoints(tmpDir);
        expect(result[0].path).toBe(path.join(dir, 'checkpoint-2026-05-10-test.md'));
    });
});

describe('readCheckpoint', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = makeTmpDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('retorna null si el archivo no existe', async () => {
        makeCheckpointsDir(tmpDir);
        const result = await readCheckpoint(tmpDir, 'checkpoint-2026-05-10-inexistente.md');
        expect(result).toBeNull();
    });

    it('retorna el contenido del archivo si existe', async () => {
        const dir = makeCheckpointsDir(tmpDir);
        const content = '# Checkpoint\n\nContenido de prueba';
        fs.writeFileSync(path.join(dir, 'checkpoint-2026-05-10-feature.md'), content, 'utf-8');
        const result = await readCheckpoint(tmpDir, 'checkpoint-2026-05-10-feature.md');
        expect(result).toBe(content);
    });

    it('retorna null si checkpoints/ no existe', async () => {
        const result = await readCheckpoint(tmpDir, 'checkpoint-2026-05-10-algo.md');
        expect(result).toBeNull();
    });
});
