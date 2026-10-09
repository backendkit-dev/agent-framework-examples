import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CODING_TOOLS } from '@backendkit-labs/agent-coding';
import { applyToolGuards } from '../src/security/apply-tool-guards';
import type { ToolDefinitionLike, ToolContextLike } from '../src/security/tool-guards';

/**
 * Verificacion contra la implementacion REAL del framework: el guard envuelve la
 * tool original, asi que este test comprueba que (a) la lectura normal sigue
 * funcionando, (b) el sandbox del framework sigue actuando y (c) el guard agrega
 * contencion canonica y aprobacion de rutas sensibles.
 */
function makeCtx(workingDir: string): ToolContextLike {
    return { workingDir, additionalRoots: [] };
}

function guardedCopy(onSensitiveRead: (p: string) => Promise<boolean>): ToolDefinitionLike[] {
    // Copia: no se muta el array exportado por el framework.
    const tools = CODING_TOOLS.map((t) => ({ ...t })) as unknown as ToolDefinitionLike[];
    applyToolGuards(tools, { onSensitiveRead });
    return tools;
}

function readFileOf(tools: ToolDefinitionLike[]): ToolDefinitionLike {
    const tool = tools.find((t) => t.name === 'read_file');
    if (!tool) throw new Error('read_file no esta en CODING_TOOLS: el framework cambio su lista');
    return tool;
}

describe('guards sobre las tools reales del framework', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-guard-real-'));
        fs.writeFileSync(path.join(dir, 'hola.txt'), 'contenido real', 'utf-8');
        fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=secreto', 'utf-8');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('lee un archivo normal delegando en la implementacion del framework', async () => {
        const tool = readFileOf(guardedCopy(async () => false));
        const out = await tool.execute({ file_path: 'hola.txt' }, makeCtx(dir));
        expect(out).toBe('contenido real');
    });

    it('deniega un archivo sensible cuando no se aprueba', async () => {
        const asked: string[] = [];
        const tool = readFileOf(guardedCopy(async (p) => { asked.push(p); return false; }));
        const out = await tool.execute({ file_path: '.env' }, makeCtx(dir));
        expect(asked).toEqual(['.env']);
        expect(out).toMatch(/credenciales/);
        expect(out).not.toContain('secreto');
    });

    it('permite el archivo sensible cuando se aprueba', async () => {
        const tool = readFileOf(guardedCopy(async () => true));
        const out = await tool.execute({ file_path: '.env' }, makeCtx(dir));
        expect(out).toBe('TOKEN=secreto');
    });

    it('mantiene el sandbox del framework para rutas fuera del proyecto', async () => {
        const tool = readFileOf(guardedCopy(async () => true));
        const outside = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts';
        const out = await tool.execute({ file_path: outside }, makeCtx(dir));
        expect(out).toMatch(/denied|Acceso denegado|outside/i);
    });

    it('deniega la lectura a traves de un junction que sale del proyecto', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-guard-out-'));
        fs.writeFileSync(path.join(outside, 'robado.env'), 'SECRETO=1', 'utf-8');
        const link = path.join(dir, 'atajo');
        try {
            fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
        } catch {
            fs.rmSync(outside, { recursive: true, force: true });
            return; // sin permisos para crear el enlace: se omite el caso
        }
        try {
            const tool = readFileOf(guardedCopy(async () => true));
            const out = await tool.execute({ file_path: path.join('atajo', 'robado.env') }, makeCtx(dir));
            expect(out).toMatch(/Acceso denegado|denied/i);
            expect(out).not.toContain('SECRETO');
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('envuelve las cuatro herramientas de archivos del framework', () => {
        const tools = CODING_TOOLS.map((t) => ({ ...t })) as unknown as ToolDefinitionLike[];
        const result = applyToolGuards(tools, { onSensitiveRead: async () => true });
        // Si el framework renombra o quita alguna, este test lo dice explicitamente.
        expect(result.applied.sort()).toEqual(['edit_file', 'list_directory', 'read_file', 'write_file']);
        expect(result.missing).toEqual([]);
    });
});
