import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    guardFileTools,
    checkCanonicalContainment,
    isInside,
    ToolDefinitionLike,
    ToolRegistryLike,
    ToolContextLike,
} from '../src/security/tool-guards';

/** Registro minimo que imita la API publica de AgentEngine.tools. */
class FakeRegistry implements ToolRegistryLike {
    private tools = new Map<string, ToolDefinitionLike>();
    calls: Array<{ name: string; args: unknown }> = [];

    constructor(defs: Array<{ name: string; argKey: string; result?: string }>) {
        for (const d of defs) {
            this.tools.set(d.name, {
                name: d.name,
                description: 'fake',
                parameters: {},
                execute: async (args) => {
                    this.calls.push({ name: d.name, args });
                    return d.result ?? `original:${d.name}`;
                },
            });
        }
    }
    get(name: string) { return this.tools.get(name); }
    unregister(name: string) { this.tools.delete(name); }
    register(tool: ToolDefinitionLike) { this.tools.set(tool.name, tool); return this; }
}

const ctx = (workingDir: string): ToolContextLike => ({ workingDir });

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'bk-toolguards-'));
}

describe('isInside', () => {
    it('acepta la raiz y sus descendientes', () => {
        const root = path.resolve('C:/proj/app');
        expect(isInside(root, path.join(root, 'src', 'a.ts'))).toBe(true);
        expect(isInside(root, root)).toBe(true);
    });

    it('rechaza rutas hermanas que comparten prefijo', () => {
        const root = path.resolve('C:/proj/app');
        expect(isInside(root, path.resolve('C:/proj/app-evil/x.ts'))).toBe(false);
        expect(isInside(root, path.resolve('C:/other/x.ts'))).toBe(false);
    });
});

describe('checkCanonicalContainment', () => {
    it('permite una ruta dentro de la raiz', () => {
        const dir = makeTmpDir();
        try {
            const r = checkCanonicalContainment([dir], path.join(dir, 'sub', 'nuevo.ts'));
            expect(r.ok).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('deniega una ruta absoluta fuera de la raiz', () => {
        const dir = makeTmpDir();
        try {
            const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
            expect(checkCanonicalContainment([dir], outside).ok).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('deniega el escape por symlink/junction', () => {
        const root = makeTmpDir();
        const outside = makeTmpDir();
        const link = path.join(root, 'salida');
        try {
            fs.writeFileSync(path.join(outside, 'secreto.env'), 'TOKEN=1');
            try {
                fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
            } catch {
                return; // sin permisos para crear el enlace: se omite el caso
            }
            // La ruta es lexicamente interna, pero canonicaliza fuera de la raiz
            const r = checkCanonicalContainment([root], path.join(link, 'secreto.env'));
            expect(r.ok).toBe(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});

describe('guardFileTools', () => {
    const defs = [
        { name: 'read_file', argKey: 'file_path' },
        { name: 'write_file', argKey: 'file_path' },
        { name: 'edit_file', argKey: 'file_path' },
        { name: 'list_directory', argKey: 'path' },
    ];

    it('envuelve las cuatro tools de archivos', () => {
        const registry = new FakeRegistry(defs);
        const wrapped = guardFileTools(registry, { onSensitiveRead: async () => true });
        expect(wrapped.sort()).toEqual(['edit_file', 'list_directory', 'read_file', 'write_file']);
    });

    it('delega en la tool original para rutas normales', async () => {
        const registry = new FakeRegistry(defs);
        guardFileTools(registry, { onSensitiveRead: async () => true });
        const dir = makeTmpDir();
        try {
            const out = await registry.get('read_file')!.execute({ file_path: 'src/a.ts' }, ctx(dir));
            expect(out).toBe('original:read_file');
            expect(registry.calls).toHaveLength(1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('deniega leer fuera del directorio de trabajo', async () => {
        const registry = new FakeRegistry(defs);
        guardFileTools(registry, { onSensitiveRead: async () => true });
        const dir = makeTmpDir();
        try {
            const outside = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd';
            const out = await registry.get('read_file')!.execute({ file_path: outside }, ctx(dir));
            expect(out).toMatch(/Acceso denegado/);
            expect(registry.calls).toHaveLength(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('pide aprobacion para archivos sensibles y deniega si no se da', async () => {
        const registry = new FakeRegistry(defs);
        const asked: string[] = [];
        guardFileTools(registry, {
            onSensitiveRead: async (p) => { asked.push(p); return false; },
        });
        const dir = makeTmpDir();
        try {
            const out = await registry.get('read_file')!.execute({ file_path: '.env' }, ctx(dir));
            expect(asked).toEqual(['.env']);
            expect(out).toMatch(/credenciales/);
            expect(registry.calls).toHaveLength(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('permite la lectura sensible cuando el usuario aprueba', async () => {
        const registry = new FakeRegistry(defs);
        guardFileTools(registry, { onSensitiveRead: async () => true });
        const dir = makeTmpDir();
        try {
            const out = await registry.get('read_file')!.execute({ file_path: '.env' }, ctx(dir));
            expect(out).toBe('original:read_file');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('no consulta la aprobacion sensible en escritura (ya la cubre el gate de mutaciones)', async () => {
        const registry = new FakeRegistry(defs);
        let asked = 0;
        guardFileTools(registry, { onSensitiveRead: async () => { asked++; return false; } });
        const dir = makeTmpDir();
        try {
            const out = await registry.get('write_file')!.execute({ file_path: '.env', content: 'x' }, ctx(dir));
            expect(out).toBe('original:write_file');
            expect(asked).toBe(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('deniega el escape por junction tambien en escritura', async () => {
        const root = makeTmpDir();
        const outside = makeTmpDir();
        const link = path.join(root, 'link');
        try {
            try {
                fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
            } catch {
                return; // sin permisos: se omite
            }
            const registry = new FakeRegistry(defs);
            guardFileTools(registry, { onSensitiveRead: async () => true });
            const out = await registry.get('write_file')!.execute(
                { file_path: path.join(link, 'x.ts'), content: 'x' },
                ctx(root),
            );
            expect(out).toMatch(/Acceso denegado/);
            expect(registry.calls).toHaveLength(0);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('ignora tools ausentes sin romper', () => {
        const registry = new FakeRegistry([{ name: 'read_file', argKey: 'file_path' }]);
        const wrapped = guardFileTools(registry, { onSensitiveRead: async () => true });
        expect(wrapped).toEqual(['read_file']);
    });

    it('delega cuando la ruta no viene en los argumentos', async () => {
        const registry = new FakeRegistry(defs);
        guardFileTools(registry, { onSensitiveRead: async () => true });
        const out = await registry.get('read_file')!.execute({}, ctx('/tmp'));
        expect(out).toBe('original:read_file');
    });
});
