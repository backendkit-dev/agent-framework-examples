import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { executeToolCall } from '../../src/agent/tool-executor';
import { getDefaultConfig } from '../../src/bootstrap/config-loader';
import { defaultInstructions } from '../../src/types/config';
import { registerBuiltinHandlers } from '../../src/skills/handlers/builtins';
import { PathAllowlist } from '../../src/skills/handlers/path-allowlist';
import { clearRegistry } from '../../src/skills/registry';

// Registrar handlers y configurar contexto antes de todos los tests
beforeAll(() => {
    clearRegistry(); // evitar duplicados si otro test registra
    registerBuiltinHandlers({
        projectRoot: os.tmpdir(),
        vaultPath: '',
        instructions: defaultInstructions(),
        askConfirmation: async () => true,
        memoryContext: null,
        onMemoryUpdate: null,
        pathAllowlist: new PathAllowlist({
            allowedPaths: [os.tmpdir()],
            allowSubpaths: true,
        }),
    });
});

const baseOpts = {
    config: getDefaultConfig(),
    instructions: defaultInstructions(),
    vaultPath: '',
    askConfirmation: async () => true,
};

function makeToolCall(name: string, args: object) {
    return { id: '1', function: { name, arguments: JSON.stringify(args) } } as any;
}

describe('executeToolCall', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsk-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('read_file: devuelve contenido', async () => {
        const file = path.join(tmpDir, 'hello.txt');
        await fs.writeFile(file, 'hola');
        const result = await executeToolCall(makeToolCall('read_file', { file_path: file }), baseOpts);
        expect(result.success).toBe(true);
        expect((result as any).data).toBe('hola');
    });

    it('read_file: bloquea ruta fuera del proyecto', async () => {
        const result = await executeToolCall(makeToolCall('read_file', { file_path: '/no/existe.txt' }), baseOpts);
        // El handler retorna el mensaje como string, executeSkillHandler lo envuelve en ToolResult.success
        expect(result.success).toBe(true);
        expect((result as any).data).toMatch(/Acceso denegado/);
    });

    it('write_file: escribe archivo con confirmación', async () => {
        const file = path.join(tmpDir, 'out.txt');
        const result = await executeToolCall(makeToolCall('write_file', { file_path: file, content: 'test' }), baseOpts);
        expect(result.success).toBe(true);
        expect((result as any).data).toContain('Escrito en');
        expect(await fs.readFile(file, 'utf-8')).toBe('test');
    });

    it('write_file: escribe archivo con éxito', async () => {
        const file = path.join(tmpDir, 'out.txt');
        const result = await executeToolCall(makeToolCall('write_file', { file_path: file, content: 'test' }), baseOpts);
        expect(result.success).toBe(true);
        expect((result as any).data).toContain('Escrito en');
        expect(await fs.readFile(file, 'utf-8')).toBe('test');
    });

    it('list_directory: lista archivos', async () => {
        await fs.writeFile(path.join(tmpDir, 'a.txt'), '');
        const result = await executeToolCall(makeToolCall('list_directory', { dir_path: tmpDir }), baseOpts);
        expect(result.success).toBe(true);
        expect((result as any).data).toContain('a.txt');
    });

    it('herramienta desconocida retorna mensaje claro', async () => {
        const result = await executeToolCall(makeToolCall('unknown_tool', {}), baseOpts);
        expect(result.success).toBe(false);
        expect((result as any).error).toContain('Handler no registrado');
    });
});


