import { applyToolGuards } from '../src/security/apply-tool-guards';
import { ToolDefinitionLike } from '../src/security/tool-guards';

/** Definiciones minimas con la forma que entrega el framework. */
function fakeTools(names = ['read_file', 'write_file', 'edit_file', 'list_directory', 'run_command']): ToolDefinitionLike[] {
    return names.map((name) => ({
        name,
        description: `descripcion de ${name}`,
        parameters: { type: 'object', properties: { marker: { type: 'string' } } },
        execute: async () => `original:${name}`,
    }));
}

const options = { onSensitiveRead: async () => true };

describe('applyToolGuards', () => {
    it('envuelve las herramientas de archivos dentro del array', () => {
        const tools = fakeTools();
        const result = applyToolGuards(tools, options);
        expect(result.applied.sort()).toEqual(['edit_file', 'list_directory', 'read_file', 'write_file']);
        expect(result.missing).toEqual([]);
    });

    it('no altera la cantidad ni el orden de las herramientas', () => {
        const tools = fakeTools();
        const before = tools.map((t) => t.name);
        applyToolGuards(tools, options);
        expect(tools.map((t) => t.name)).toEqual(before);
    });

    it('conserva nombre, descripcion y schema originales', () => {
        const tools = fakeTools();
        const original = { ...tools[0] };
        applyToolGuards(tools, options);
        const guarded = tools.find((t) => t.name === 'read_file')!;
        expect(guarded.description).toBe(original.description);
        expect(guarded.parameters).toEqual(original.parameters);
    });

    it('deja intactas las herramientas que no son de archivos', () => {
        const tools = fakeTools();
        const runCommand = tools.find((t) => t.name === 'run_command')!;
        applyToolGuards(tools, options);
        expect(tools.find((t) => t.name === 'run_command')).toBe(runCommand);
    });

    it('la entrada del array queda realmente envuelta (no es una copia aparte)', async () => {
        const tools = fakeTools();
        const originalExecute = tools.find((t) => t.name === 'read_file')!.execute;
        const asked: string[] = [];
        applyToolGuards(tools, { onSensitiveRead: async (p) => { asked.push(p); return false; } });

        const guarded = tools.find((t) => t.name === 'read_file')!;
        expect(guarded.execute).not.toBe(originalExecute);

        // Ejecutando la definicion del array: un archivo sensible se deniega...
        const denied = await guarded.execute({ file_path: '.env' }, { workingDir: process.cwd() });
        expect(asked).toEqual(['.env']);
        expect(denied).toMatch(/credenciales/);

        // ...y una ruta normal delega en la implementacion original.
        const ok = await guarded.execute({ file_path: 'src/index.ts' }, { workingDir: process.cwd() });
        expect(ok).toBe('original:read_file');
    });

    it('informa las herramientas faltantes en lugar de fallar en silencio', () => {
        const tools = fakeTools(['read_file']);
        const result = applyToolGuards(tools, options);
        expect(result.applied).toEqual(['read_file']);
        expect(result.missing.sort()).toEqual(['edit_file', 'list_directory', 'write_file']);
    });

    it('tolera un array vacio', () => {
        const result = applyToolGuards([], options);
        expect(result.applied).toEqual([]);
        expect(result.missing).toHaveLength(4);
    });

    it('tolera un valor que no es array', () => {
        const result = applyToolGuards(undefined as unknown as ToolDefinitionLike[], options);
        expect(result.applied).toEqual([]);
        expect(result.missing).toHaveLength(4);
    });
});
