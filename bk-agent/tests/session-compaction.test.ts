/**
 * TASK-06 — sesion-actual.md size limit + auto-compaction
 * Verifica que updateSessionMemory compacta el archivo cuando supera 8KB.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { updateSessionMemory, updateEngineInsights } from '../src/memory/updater';

const SESSION_MAX_BYTES = 8192;

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'task06-'));
}

function buildLargeSession(projectName: string, date: string, extras: string): string {
    return [
        '---',
        'tags: [memoria, deepseek-code, sesion-actual]',
        `fecha_actualizacion: ${date}`,
        `proyecto: ${projectName}`,
        '---',
        '',
        `# Sesion Actual — ${projectName}`,
        '',
        '## Feature en Curso',
        '- **Nombre:** feature-importante',
        '- **Progreso:** 60%',
        '',
        '---',
        '',
        '## Issues Activos',
        '1. issue uno',
        '2. issue dos',
        '3. issue tres',
        '4. issue cuatro',
        '5. issue cinco',
        '6. issue seis',
        '7. issue siete',
        '8. issue ocho',
        '',
        '---',
        '',
        '## Proximos Pasos',
        '1. Paso importante',
        '',
        '---',
        '',
        '## Decisiones',
        '- decision uno sobre arquitectura',
        '- decision dos sobre base de datos',
        '- decision tres sobre CI',
        '- decision cuatro sobre testing',
        '- decision cinco sobre deploy',
        '- decision seis sobre monitoreo',
        '- decision siete sobre seguridad',
        '',
        '---',
        '',
        '## Aprendizajes del Engine',
        '- **type_a** (audit, Alta, x3) — accion recomendada',
        '- **type_b** (test, Media, x2) — accion recomendada',
        '- **type_c** (agent, Alta, x4) — accion recomendada',
        '- **type_d** (commit, Baja, x1) — accion recomendada',
        '',
        '---',
        '',
        extras,
        '',
        `*Creado por DeepSeek Code el ${date}*`,
    ].join('\n');
}

describe('TASK-06 — sesion-actual.md auto-compaction', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        fs.mkdirSync(path.join(tmpDir, 'checkpoints'), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('no compacta cuando el archivo esta bajo el limite (8KB)', async () => {
        const date = '2026-05-10';
        const smallContent = buildLargeSession('proj', date, '');
        fs.writeFileSync(path.join(tmpDir, 'sesion-actual.md'), smallContent);

        await updateSessionMemory(tmpDir, { progreso: '70%' });

        const result = fs.readFileSync(path.join(tmpDir, 'sesion-actual.md'), 'utf-8');
        // Debe tener los 8 issues sin truncar
        expect(result).toContain('8. issue ocho');
    });

    it('trunca Issues Activos a las ultimas 5 cuando supera 8KB', async () => {
        const date = '2026-05-10';
        // Pad con notas largas para forzar superar 8KB
        const padding = '- nota larga: ' + 'x'.repeat(150) + '\n';
        const bigNotes = Array(60).fill(padding).join('');
        const largeContent = buildLargeSession('proj', date, `## Notas\n${bigNotes}`);

        expect(Buffer.byteLength(largeContent, 'utf-8')).toBeGreaterThan(8192);
        fs.writeFileSync(path.join(tmpDir, 'sesion-actual.md'), largeContent);

        await updateSessionMemory(tmpDir, { progreso: '80%' });

        const result = fs.readFileSync(path.join(tmpDir, 'sesion-actual.md'), 'utf-8');
        // Issues Activos debe tener maximo 5 entradas
        const issueMatches = result.match(/^\d+\. issue/gm) ?? [];
        expect(issueMatches.length).toBeLessThanOrEqual(5);
        // Debe conservar los ultimos 5 (4..8)
        expect(result).toContain('issue cuatro');
        expect(result).toContain('issue ocho');
        // Los primeros 3 deben haber sido eliminados
        expect(result).not.toContain('issue uno');
        expect(result).not.toContain('issue dos');
        expect(result).not.toContain('issue tres');
    });

    it('trunca Decisiones a las ultimas 5 cuando supera 8KB', async () => {
        const date = '2026-05-10';
        const padding = '- nota: ' + 'x'.repeat(150) + '\n';
        const bigNotes = Array(60).fill(padding).join('');
        const largeContent = buildLargeSession('proj', date, `## Notas\n${bigNotes}`);
        fs.writeFileSync(path.join(tmpDir, 'sesion-actual.md'), largeContent);

        await updateSessionMemory(tmpDir, { progreso: '80%' });

        const result = fs.readFileSync(path.join(tmpDir, 'sesion-actual.md'), 'utf-8');
        const decisionMatches = result.match(/^- decision/gm) ?? [];
        expect(decisionMatches.length).toBeLessThanOrEqual(5);
        // Conserva las ultimas 5 (tres..siete)
        expect(result).toContain('decision tres');
        expect(result).toContain('decision siete');
        // Elimina las primeras 2
        expect(result).not.toContain('decision uno');
        expect(result).not.toContain('decision dos');
    });

    it('renumera correctamente Issues Activos tras truncado', async () => {
        const date = '2026-05-10';
        const padding = '- nota: ' + 'x'.repeat(150) + '\n';
        const bigNotes = Array(60).fill(padding).join('');
        const largeContent = buildLargeSession('proj', date, `## Notas\n${bigNotes}`);
        fs.writeFileSync(path.join(tmpDir, 'sesion-actual.md'), largeContent);

        await updateSessionMemory(tmpDir, { progreso: '80%' });

        const result = fs.readFileSync(path.join(tmpDir, 'sesion-actual.md'), 'utf-8');
        // Debe empezar desde 1. despues del truncado
        expect(result).toMatch(/1\. issue/m);
        expect(result).toMatch(/5\. issue/m);
        // No debe haber un 6. issue (era el issue seis que quedo como 4 → renumerado)
        const highNumbers = result.match(/^[6-9]\. issue/gm) ?? [];
        expect(highNumbers.length).toBe(0);
    });

    it('preserva Feature en Curso y Proximos Pasos intactos tras compactacion', async () => {
        const date = '2026-05-10';
        const padding = '- nota: ' + 'x'.repeat(150) + '\n';
        const bigNotes = Array(60).fill(padding).join('');
        const largeContent = buildLargeSession('proj', date, `## Notas\n${bigNotes}`);
        fs.writeFileSync(path.join(tmpDir, 'sesion-actual.md'), largeContent);

        await updateSessionMemory(tmpDir, { progreso: '80%' });

        const result = fs.readFileSync(path.join(tmpDir, 'sesion-actual.md'), 'utf-8');
        expect(result).toContain('feature-importante');
        expect(result).toContain('Paso importante');
    });

    it('updateEngineInsights tambien compacta cuando supera 8KB', async () => {
        const date = '2026-05-10';
        const padding = '- nota: ' + 'x'.repeat(150) + '\n';
        const bigNotes = Array(60).fill(padding).join('');
        const largeContent = buildLargeSession('proj', date, `## Notas\n${bigNotes}`);
        fs.writeFileSync(path.join(tmpDir, 'sesion-actual.md'), largeContent);

        await updateEngineInsights(tmpDir, [
            { failureType: 'new_type', domain: 'audit', severity: 'high', count: 1 },
        ]);

        const result = fs.readFileSync(path.join(tmpDir, 'sesion-actual.md'), 'utf-8');
        const issueMatches = result.match(/^\d+\. issue/gm) ?? [];
        expect(issueMatches.length).toBeLessThanOrEqual(5);
    });

    it('no compacta issues cuando el archivo esta justo por debajo de 8KB', async () => {
        const date = '2026-05-10';
        // Padding moderado que mantiene el archivo bajo 8KB — compactacion no debe dispararse
        const padding = '- nota: ' + 'x'.repeat(60) + '\n';
        const moderateNotes = Array(30).fill(padding).join('');
        const content = buildLargeSession('proj', date, `## Notas\n${moderateNotes}`);

        expect(Buffer.byteLength(content, 'utf-8')).toBeLessThan(8192);
        fs.writeFileSync(path.join(tmpDir, 'sesion-actual.md'), content);

        await updateSessionMemory(tmpDir, { progreso: '80%' });

        const result = fs.readFileSync(path.join(tmpDir, 'sesion-actual.md'), 'utf-8');
        // Sin compactacion los 8 issues siguen presentes
        const issueMatches = result.match(/^\d+\. issue/gm) ?? [];
        expect(issueMatches.length).toBe(8);
    });
});
