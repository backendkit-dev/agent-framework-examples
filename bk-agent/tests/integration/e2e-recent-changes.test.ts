/**
 * @description Tests E2E para los cambios recientes:
 *
 * 1. Delegacion: el especialista recibe contexto completo (system + question)
 *    y lo conserva tras tool calls (fix de specialistMessages).
 * 2. Formatters: numeros de linea en bloques de codigo, word-level diff.
 * 3. Interceptor de shell: comandos de lectura van a tools internas sin
 *    confirmar; comandos no-lectura siguen el flujo normal (confirmacion).
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

import { AgentLoop } from '../../src/agent/loop';
import { AgentClient } from '../../src/api/client';
import { Message } from '../../src/api/types';
import { AgentProfile } from '../../src/agent/profiles';
import { getDefaultConfig } from '../../src/bootstrap/config-loader';
import { defaultInstructions } from '../../src/types/config';
import { ToolResult } from '../../src/tools/types';

import { formatMarkdown, formatDiff } from '../../src/ui/formatters';

import { executeToolCall } from '../../src/agent/tool-executor';
import { registerBuiltinHandlers } from '../../src/skills/handlers/builtins';
import { PathAllowlist } from '../../src/skills/handlers/path-allowlist';
import { clearRegistry } from '../../src/skills/registry';

// ── Helpers comunes ──────────────────────────────────────────────────────────

function makeToolCall(name: string, args: object) {
    return { id: 'tc1', function: { name, arguments: JSON.stringify(args) } } as any;
}

// Elimina codigos ANSI para comparar texto plano
function stripAnsi(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;]*m/g, '');
}

const backendProfile: AgentProfile = {
    id: 'backend',
    name: 'Backend Developer',
    icon: 'monitor',
    description: 'APIs, business logic',
    builtin: true,
    systemPromptAddition: '## Backend\nEres un backend developer.',
};

const baseLoopOpts = {
    config: getDefaultConfig(),
    instructions: defaultInstructions(),
    vaultPath: '',
    contextMarkdown: '',
    tools: [],
    askConfirmation: async () => false,
    noQA: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. DELEGACION — contexto que recibe el especialista
// ═══════════════════════════════════════════════════════════════════════════

describe('Delegacion — contexto del especialista', () => {
    it('el especialista recibe [system, user] en la primera llamada', async () => {
        const capturedMessages: Message[][] = [];
        let callIndex = 0;

        const mockClient = {
            chat: jest.fn(async (messages: Message[]) => {
                capturedMessages.push(messages.map(m => ({ ...m })));
                callIndex++;
                if (callIndex === 1) {
                    // General delega al backend
                    return {
                        content: null,
                        tool_calls: [{
                            id: 'tc_ask',
                            function: {
                                name: 'ask_agent',
                                arguments: JSON.stringify({
                                    agent_id: 'backend',
                                    question: 'Implementar endpoint POST /users con validacion Zod',
                                    context: 'Proyecto usa NestJS con TypeORM',
                                }),
                            },
                        }],
                    };
                }
                // Specialist o General segunda vuelta
                return { content: 'Listo.', tool_calls: null };
            }),
            chatStream: jest.fn(),
            getModel: jest.fn(() => 'deepseek-chat'),
            setModel: jest.fn(),
        } as unknown as AgentClient;

        const agent = new AgentLoop({
            ...baseLoopOpts,
            client: mockClient,
            allAgents: [backendProfile],
        });

        await agent.processInput('crear endpoint de usuarios');

        // Call 1: General
        // Call 2: Especialista (primera llamada a executeDelegation)
        expect(capturedMessages.length).toBeGreaterThanOrEqual(2);

        const specialistCall = capturedMessages[1];

        // Debe empezar con system prompt
        expect(specialistCall[0].role).toBe('system');
        expect(typeof specialistCall[0].content).toBe('string');
        expect((specialistCall[0].content as string).length).toBeGreaterThan(10);

        // El segundo mensaje debe ser el user con la question
        expect(specialistCall[1].role).toBe('user');
        expect(specialistCall[1].content).toContain('Implementar endpoint POST /users');
    });

    it('el especialista conserva [system, user] despues de un tool call propio', async () => {
        const capturedMessages: Message[][] = [];
        let callIndex = 0;

        const mockClient = {
            chat: jest.fn(async (messages: Message[]) => {
                capturedMessages.push(messages.map(m => ({ ...m })));
                callIndex++;

                if (callIndex === 1) {
                    // General: delega al backend
                    return {
                        content: null,
                        tool_calls: [{
                            id: 'tc_ask',
                            function: {
                                name: 'ask_agent',
                                arguments: JSON.stringify({
                                    agent_id: 'backend',
                                    question: 'Leer y analizar el archivo de rutas',
                                }),
                            },
                        }],
                    };
                }
                if (callIndex === 2) {
                    // Especialista primera iteracion: hace un tool call
                    return {
                        content: null,
                        tool_calls: [{
                            id: 'tc_read',
                            function: {
                                name: 'read_file',
                                arguments: JSON.stringify({ file_path: '/tmp/routes.ts' }),
                            },
                        }],
                    };
                }
                if (callIndex === 3) {
                    // Especialista segunda iteracion (despues del tool result)
                    return { content: 'Analisis completado.', tool_calls: null };
                }
                return { content: 'ok', tool_calls: null };
            }),
            chatStream: jest.fn(),
            getModel: jest.fn(() => 'deepseek-chat'),
            setModel: jest.fn(),
        } as unknown as AgentClient;

        const agent = new AgentLoop({
            ...baseLoopOpts,
            client: mockClient,
            allAgents: [backendProfile],
        });

        // Proveer un tool executor que siempre retorna exito
        agent.setToolExecutor(async () => ToolResult.success('contenido del archivo'));

        await agent.processInput('analizar rutas del proyecto');

        // Deben haberse producido al menos 3 llamadas
        expect(capturedMessages.length).toBeGreaterThanOrEqual(3);

        // Call 2: especialista primera iteracion — debe tener [system, user]
        const specialistFirst = capturedMessages[1];
        expect(specialistFirst[0].role).toBe('system');
        expect(specialistFirst[1].role).toBe('user');

        // Call 3: especialista segunda iteracion — TODAVIA debe tener [system, user, assistant, tool]
        const specialistSecond = capturedMessages[2];
        expect(specialistSecond[0].role).toBe('system');   // system conservado
        expect(specialistSecond[1].role).toBe('user');     // question conservada
        expect(specialistSecond[2].role).toBe('assistant'); // tool_call del especialista
        expect(specialistSecond[3].role).toBe('tool');      // resultado del tool
    });

    it('la question incluye el contexto adicional que paso General', async () => {
        const capturedMessages: Message[][] = [];
        let callIndex = 0;

        const mockClient = {
            chat: jest.fn(async (messages: Message[]) => {
                capturedMessages.push(messages.map(m => ({ ...m })));
                callIndex++;
                if (callIndex === 1) {
                    return {
                        content: null,
                        tool_calls: [{
                            id: 'tc_ask',
                            function: {
                                name: 'ask_agent',
                                arguments: JSON.stringify({
                                    agent_id: 'backend',
                                    question: 'Implementar repositorio de usuarios',
                                    context: 'Stack: NestJS, TypeORM, PostgreSQL. Archivo: `src/users/users.repository.ts`',
                                }),
                            },
                        }],
                    };
                }
                return { content: 'Implementado.', tool_calls: null };
            }),
            chatStream: jest.fn(),
            getModel: jest.fn(() => 'deepseek-chat'),
            setModel: jest.fn(),
        } as unknown as AgentClient;

        const agent = new AgentLoop({
            ...baseLoopOpts,
            client: mockClient,
            allAgents: [backendProfile],
        });

        await agent.processInput('implementar repositorio');

        const specialistCall = capturedMessages[1];
        const userContent = specialistCall[1].content as string;

        // La question original debe estar presente
        expect(userContent).toContain('Implementar repositorio de usuarios');
        // El contexto adicional debe estar presente
        expect(userContent).toContain('NestJS');
        expect(userContent).toContain('TypeORM');
        // El archivo extraido del contexto debe estar en relevantFiles (o en el mensaje)
        expect(userContent).toContain('src/users/users.repository.ts');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FORMATTERS — numeros de linea y word-level diff
// ═══════════════════════════════════════════════════════════════════════════

describe('Formatters — numeros de linea y word-level diff', () => {
    describe('formatMarkdown — numeros de linea en bloques de codigo', () => {
        it('muestra numero de linea antes de cada linea de codigo', () => {
            const md = '```typescript\nconst x = 1;\nconst y = 2;\n```';
            const result = stripAnsi(formatMarkdown(md));
            // Debe haber numeracion: " 1 │" o "1 │"
            expect(result).toMatch(/1\s*│/);
            expect(result).toMatch(/2\s*│/);
        });

        it('el numero de linea es correcto para bloques de multiples lineas', () => {
            const lines = Array.from({ length: 12 }, (_, i) => `const x${i} = ${i};`);
            const md = '```typescript\n' + lines.join('\n') + '\n```';
            const result = stripAnsi(formatMarkdown(md));
            // Debe tener linea 10 y 12
            expect(result).toMatch(/10\s*│/);
            expect(result).toMatch(/12\s*│/);
        });

        it('bloques sin lenguaje tambien tienen numeros de linea', () => {
            const md = '```\nhola\nmundo\n```';
            const result = stripAnsi(formatMarkdown(md));
            expect(result).toMatch(/1\s*│/);
            expect(result).toMatch(/2\s*│/);
        });
    });

    describe('formatDiff — word-level diff para lineas cambiadas', () => {
        it('detecta solo las palabras que cambiaron entre lineas adyacentes', () => {
            // removed + added consecutivos → word-level
            const result = formatDiff(
                'const nombre = "hello world";',
                'const nombre = "hello universe";'
            );
            const plain = stripAnsi(result);
            // La parte comun debe estar sin marcas especiales
            expect(plain).toContain('hello');
            // Ambas variantes deben aparecer
            expect(plain).toContain('world');
            expect(plain).toContain('universe');
        });

        it('lineas completamente nuevas se marcan como bloque entero', () => {
            // Una linea agregada sin removed previo → bloque completo en verde
            const result = formatDiff(
                'const x = 1;',
                'const x = 1;\nconst y = 2;'
            );
            const plain = stripAnsi(result);
            expect(plain).toContain('const y = 2;');
        });

        it('muestra marcadores + y - en el diff', () => {
            const result = formatDiff('viejo texto aqui', 'nuevo texto aqui');
            const plain = stripAnsi(result);
            expect(plain).toContain('-');
            expect(plain).toContain('+');
        });

        it('sin cambios no produce lineas con + o - al inicio', () => {
            const result = formatDiff('igual', 'igual');
            const plain = stripAnsi(result);
            // Las lineas same no llevan prefijo +/-
            const lines = plain.split('\n').filter(l => l.includes('igual'));
            expect(lines.some(l => /^\s*[+-]/.test(l.trim()))).toBe(false);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. INTERCEPTOR DE SHELL — comandos de lectura → tools internas
// ═══════════════════════════════════════════════════════════════════════════

describe('Interceptor de shell — execute_command redirige lecturas', () => {
    let tmpDir: string;
    let tmpFile: string;
    let confirmationCalled: boolean;

    beforeAll(() => {
        clearRegistry();
        registerBuiltinHandlers({
            projectRoot: os.tmpdir(),
            vaultPath: '',
            instructions: defaultInstructions(),
            askConfirmation: async () => {
                confirmationCalled = true;
                return false; // denegar para detectar si se llamo
            },
            memoryContext: null,
            onMemoryUpdate: null,
            pathAllowlist: new PathAllowlist({
                allowedPaths: [os.tmpdir()],
                allowSubpaths: true,
            }),
        });
    });

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsk-e2e-'));
        tmpFile = path.join(tmpDir, 'test.ts');
        await fs.writeFile(tmpFile, 'const x = 42;\nconst y = "hello";');
        confirmationCalled = false;
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    const baseOpts = {
        config: getDefaultConfig(),
        instructions: defaultInstructions(),
        vaultPath: '',
        askConfirmation: async () => false,
    };

    // -- Comandos interceptados (sin PowerShell, sin confirmacion) -----------

    it('Get-Content <file> → lee el archivo sin confirmar', async () => {
        const result = await executeToolCall(
            makeToolCall('execute_command', { command: `Get-Content "${tmpFile}"` }),
            baseOpts
        );
        expect(confirmationCalled).toBe(false);
        expect(result.success).toBe(true);
        expect((result as any).data).toContain('const x = 42;');
    });

    it('cat <file> → lee el archivo sin confirmar', async () => {
        const result = await executeToolCall(
            makeToolCall('execute_command', { command: `cat "${tmpFile}"` }),
            baseOpts
        );
        expect(confirmationCalled).toBe(false);
        expect(result.success).toBe(true);
        expect((result as any).data).toContain('const x = 42;');
    });

    it('type <file> → lee el archivo sin confirmar', async () => {
        const result = await executeToolCall(
            makeToolCall('execute_command', { command: `type "${tmpFile}"` }),
            baseOpts
        );
        expect(confirmationCalled).toBe(false);
        expect(result.success).toBe(true);
        expect((result as any).data).toContain('const x = 42;');
    });

    it('ls <dir> → lista directorio sin confirmar', async () => {
        await fs.writeFile(path.join(tmpDir, 'archivo.ts'), '');
        const result = await executeToolCall(
            makeToolCall('execute_command', { command: `ls "${tmpDir}"` }),
            baseOpts
        );
        expect(confirmationCalled).toBe(false);
        expect(result.success).toBe(true);
        expect((result as any).data).toContain('archivo.ts');
    });

    it('Get-ChildItem <dir> → lista directorio sin confirmar', async () => {
        await fs.writeFile(path.join(tmpDir, 'modulo.ts'), '');
        const result = await executeToolCall(
            makeToolCall('execute_command', { command: `Get-ChildItem "${tmpDir}"` }),
            baseOpts
        );
        expect(confirmationCalled).toBe(false);
        expect(result.success).toBe(true);
        expect((result as any).data).toContain('modulo.ts');
    });

    // -- Comandos NO interceptados (pasan a PowerShell + confirmacion) -------

    it('ls -Recurse → NO interceptado, pide confirmacion', async () => {
        const result = await executeToolCall(
            makeToolCall('execute_command', { command: `ls -Recurse "${tmpDir}"` }),
            baseOpts
        );
        expect(confirmationCalled).toBe(true);
        // Como confirmationCalled retorna false, el resultado es Cancelado
        expect((result as any).data ?? (result as any).error).toMatch(/[Cc]ancelado/);
    });

    it('npm run build → NO interceptado, pide confirmacion', async () => {
        const result = await executeToolCall(
            makeToolCall('execute_command', { command: 'npm run build' }),
            baseOpts
        );
        expect(confirmationCalled).toBe(true);
    });

    it('script .ps1 → NO interceptado, pide confirmacion', async () => {
        const result = await executeToolCall(
            makeToolCall('execute_command', { command: '.\\scripts\\commit-workflow.ps1' }),
            baseOpts
        );
        expect(confirmationCalled).toBe(true);
    });

    it('Get-Content con archivo inexistente → retorna error sin confirmar', async () => {
        const result = await executeToolCall(
            makeToolCall('execute_command', { command: 'Get-Content "/no/existe.ts"' }),
            baseOpts
        );
        expect(confirmationCalled).toBe(false); // interceptado pero falla la lectura
        // El resultado contiene error (success = true con mensaje de error, o success = false)
        const output = (result as any).data ?? (result as any).error ?? '';
        expect(output).toMatch(/[Ee]rror|Acceso denegado/i);
    });
});
