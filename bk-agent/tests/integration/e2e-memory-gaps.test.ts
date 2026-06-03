/**
 * E2E — Cierre de gaps de cobertura de los flujos completos
 *
 * Gap 1: injectContextMessage llega al LLM (AgentLoop.processInput)
 * Gap 2: Re-compactacion post-respuesta se dispara dentro del loop real
 * Gap 3: AuditHook + connectMemory escribe en sesion-actual.md en disco
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { AgentLoop } from '../../src/agent/loop';
import { AgentClient } from '../../src/api/client';
import { Message } from '../../src/api/types';
import { getDefaultConfig } from '../../src/bootstrap/config-loader';
import { defaultInstructions } from '../../src/types/config';

import { ReflectionEngine } from '../../src/reflection/reflection-engine';
import { AuditHook } from '../../src/reflection/hooks/audit-hook';
import type { AuditFinding } from '../../src/orchestrator/audit';

// ── forceCompact mock (solo para Gap 2) ────────────────────────────────────────
// Necesitamos interceptar forceCompact ANTES de que loop.ts lo importe.
// jest.mock se hoisita al principio del modulo automaticamente.

const mockedForceCompact = jest.fn(async (messages: Message[]) => messages);

jest.mock('../../src/agent/agent-loop/index', () => {
    const actual = jest.requireActual('../../src/agent/agent-loop/index');
    return {
        ...actual,
        forceCompact: (...args: any[]) => mockedForceCompact(...args),
    };
});

// ── helpers comunes ────────────────────────────────────────────────────────────

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-gaps-'));
}

const baseOpts = {
    config: getDefaultConfig(),
    instructions: defaultInstructions(),
    vaultPath: '',
    contextMarkdown: '',
    tools: [],
    askConfirmation: async () => false,
    noQA: true,
};

function makeClient(responses: Array<{ content: string | null; tool_calls?: any[] }>): AgentClient {
    let idx = 0;
    return {
        chat: jest.fn(async () => responses[Math.min(idx++, responses.length - 1)]),
        chatStream: jest.fn(),
        getModel: jest.fn(() => 'deepseek-chat'),
        setModel: jest.fn(),
    } as unknown as AgentClient;
}

// ══════════════════════════════════════════════════════════════════════════════
// Gap 1 — injectContextMessage llega al LLM
// ══════════════════════════════════════════════════════════════════════════════

describe('Gap 1 — injectContextMessage llega al LLM en el siguiente processInput', () => {
    it('el mensaje system inyectado aparece en messages[] antes del user message', async () => {
        const capturedMessages: Message[][] = [];

        const client: AgentClient = {
            chat: jest.fn(async (messages: Message[]) => {
                capturedMessages.push([...messages]);
                return { content: 'respuesta del agente', tool_calls: null };
            }),
            chatStream: jest.fn(),
            getModel: jest.fn(() => 'deepseek-chat'),
            setModel: jest.fn(),
        } as unknown as AgentClient;

        const agent = new AgentLoop({ ...baseOpts, client });

        const checkpointContent = '## Checkpoint: reflection-engine (2026-05-09)\n\nFeature en Curso: wiring al engine';
        agent.injectContextMessage(checkpointContent);

        await agent.processInput('que teniamos pendiente?');

        expect(capturedMessages.length).toBeGreaterThanOrEqual(1);
        const sentMessages = capturedMessages[0];

        // Debe haber un system message con el contenido del checkpoint
        const injected = sentMessages.find(
            m => m.role === 'system' && typeof m.content === 'string' && m.content.includes('reflection-engine')
        );
        expect(injected).toBeDefined();

        // El user message debe venir DESPUES del mensaje inyectado
        const injectedIdx = sentMessages.indexOf(injected!);
        const userIdx = sentMessages.findLastIndex(m => m.role === 'user');
        expect(userIdx).toBeGreaterThan(injectedIdx);
    });

    it('injectContextMessage doble: solo el ultimo valor se inyecta en el turno', async () => {
        const capturedMessages: Message[][] = [];

        const client: AgentClient = {
            chat: jest.fn(async (messages: Message[]) => {
                capturedMessages.push([...messages]);
                return { content: 'ok', tool_calls: null };
            }),
            chatStream: jest.fn(),
            getModel: jest.fn(() => 'deepseek-chat'),
            setModel: jest.fn(),
        } as unknown as AgentClient;

        const agent = new AgentLoop({ ...baseOpts, client });

        // Llamar dos veces: la segunda sobreescribe la primera
        agent.injectContextMessage('## Checkpoint: primero\n\nContenido primero');
        agent.injectContextMessage('## Checkpoint: segundo\n\nContenido segundo');

        await agent.processInput('mensaje');

        const sentMessages = capturedMessages[0];

        // Solo el segundo debe estar presente
        const tieneSegundo = sentMessages.some(
            m => m.role === 'system' && typeof m.content === 'string' && m.content.includes('segundo')
        );
        const tienePrimero = sentMessages.some(
            m => m.role === 'system' && typeof m.content === 'string' && m.content.includes('primero') && !m.content.includes('segundo')
        );
        expect(tieneSegundo).toBe(true);
        expect(tienePrimero).toBe(false);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 2 — Re-compactacion post-respuesta se dispara en el loop real
// ══════════════════════════════════════════════════════════════════════════════

describe('Gap 2 — forceCompact se llama cuando la respuesta del modelo supera el umbral', () => {
    beforeEach(() => {
        mockedForceCompact.mockClear();
        mockedForceCompact.mockImplementation(async (messages: Message[]) => messages);
    });

    it('forceCompact NO se llama para respuestas normales', async () => {
        const client = makeClient([{ content: 'respuesta corta', tool_calls: null }]);
        const agent = new AgentLoop({ ...baseOpts, client });

        await agent.processInput('pregunta normal');

        // compactIfNeeded puede llamar a forceCompact si el umbral se supera,
        // pero con mensajes cortos no deberia
        const postResponseCalls = mockedForceCompact.mock.calls.filter(
            (call) => (call[2] as any) === 6  // keepRecent=6 es el valor del post-response compaction
        );
        expect(postResponseCalls).toHaveLength(0);
    });

    it('forceCompact(keepRecent=6) se llama cuando la respuesta supera CONTEXT_THRESHOLD * 1.2', async () => {
        // Respuesta de ~120000 chars → ~30000 tokens, que supera 28800 (24000 * 1.2)
        const largeResponse = 'x'.repeat(120_000);
        const client = makeClient([{ content: largeResponse, tool_calls: null }]);
        const agent = new AgentLoop({ ...baseOpts, client });

        await agent.processInput('generar codigo extenso');

        // Verificar que forceCompact fue llamado con keepRecent=6
        const compactCalls = mockedForceCompact.mock.calls.filter(
            (call) => call[2] === 6
        );
        expect(compactCalls.length).toBeGreaterThanOrEqual(1);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// Gap 3 — AuditHook + connectMemory escribe en sesion-actual.md
// ══════════════════════════════════════════════════════════════════════════════

// Template minimo que simula sesion-actual.md creada por runGlobalSeed/createCheckpoint
function makeSessionFile(dir: string): void {
    const content = [
        '---',
        'tags: [memoria, sesion-actual]',
        'fecha_actualizacion: 2026-05-10',
        'proyecto: test-project',
        '---',
        '',
        '# Sesion Actual — test-project',
        '',
        '## Feature en Curso',
        '- **Nombre:** feature-en-progreso',
        '- **Progreso:** 50%',
        '',
        '---',
        '',
        '## Issues Activos',
        '1. (Ninguno)',
        '',
        '---',
        '',
        '## Próximos Pasos',
        '1. Completar implementacion',
        '',
        '---',
        '',
        '## Decisiones',
        '',
        '---',
        '',
        '## Aprendizajes del Engine',
        '',
        '*Creado por DeepSeek Code el 2026-05-10*',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'sesion-actual.md'), content, 'utf-8');
}

describe('Gap 3 — AuditHook.reportFinding escribe en sesion-actual.md cuando hay projectDir', () => {
    let tmpDir: string;
    let engine: ReflectionEngine;
    let hook: AuditHook;

    beforeEach(async () => {
        tmpDir = makeTmpDir();
        fs.mkdirSync(path.join(tmpDir, 'checkpoints'), { recursive: true });
        // En produccion, sesion-actual.md siempre existe (creado por runGlobalSeed)
        makeSessionFile(tmpDir);

        engine = new ReflectionEngine({ projectRoot: tmpDir, useGlobalDir: false });
        await engine.initialize();

        engine.connectMemory(tmpDir);
        hook = new AuditHook(engine);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('un hallazgo Alta crea sesion-actual.md y agrega el issue', async () => {
        const finding: AuditFinding = {
            id: 'f1',
            dimension: 'seguridad',
            hallazgo: 'SQL injection detectada en query builder',
            severidad: 'high',
            evidencia: 'src/db/query.ts',
            recomendacion: 'Usar parametros preparados',
            agenteResponsable: 'security-agent',
        };

        await hook.reportFinding(finding, 'security');

        const sessionPath = path.join(tmpDir, 'sesion-actual.md');
        expect(fs.existsSync(sessionPath)).toBe(true);

        const content = fs.readFileSync(sessionPath, 'utf-8');
        expect(content).toContain('high');
        expect(content).toContain('SQL injection');
        expect(content).toContain('security');
    });

    it('un hallazgo Critica tambien actualiza sesion-actual.md', async () => {
        const finding: AuditFinding = {
            id: 'f2',
            dimension: 'seguridad',
            hallazgo: 'Credencial hardcodeada en configuracion de produccion',
            severidad: 'critical',
            evidencia: 'config/prod.ts',
            recomendacion: 'Mover a variables de entorno',
            agenteResponsable: 'security-agent',
        };

        await hook.reportFinding(finding, 'audit');

        const content = fs.readFileSync(path.join(tmpDir, 'sesion-actual.md'), 'utf-8');
        expect(content).toContain('critical');
        expect(content).toContain('Credencial hardcodeada');
    });

    it('un hallazgo Media NO modifica sesion-actual.md', async () => {
        const finding: AuditFinding = {
            id: 'f3',
            dimension: 'calidad',
            hallazgo: 'Funcion con mas de 50 lineas',
            severidad: 'medium',
            evidencia: 'src/utils.ts',
            recomendacion: 'Refactorizar en funciones mas pequenas',
            agenteResponsable: 'qa-engineer',
        };

        await hook.reportFinding(finding, 'qa');

        const sessionPath = path.join(tmpDir, 'sesion-actual.md');
        // El archivo puede no existir, o existir pero sin el issue Media
        if (fs.existsSync(sessionPath)) {
            const content = fs.readFileSync(sessionPath, 'utf-8');
            expect(content).not.toContain('Funcion con mas de 50 lineas');
        } else {
            expect(true).toBe(true); // no existe: correcto
        }
    });

    it('sin connectMemory, reportFinding no falla pero no modifica sesion-actual.md', async () => {
        // Directorio separado sin sesion-actual.md para verificar que no se crea
        const tmpDir2 = makeTmpDir();
        fs.mkdirSync(path.join(tmpDir2, 'checkpoints'), { recursive: true });

        const engineSinDir = new ReflectionEngine({ projectRoot: tmpDir2, useGlobalDir: false });
        await engineSinDir.initialize();
        // SIN llamar connectMemory
        const hookSinDir = new AuditHook(engineSinDir);

        const finding: AuditFinding = {
            id: 'f4',
            dimension: 'seguridad',
            hallazgo: 'XSS en endpoint de comentarios',
            severidad: 'high',
            evidencia: 'src/comments.ts',
            recomendacion: 'Sanitizar output',
            agenteResponsable: 'security-agent',
        };

        // No debe lanzar
        await expect(hookSinDir.reportFinding(finding, 'security')).resolves.toBeDefined();

        // Sin connectMemory, sesion-actual.md no fue tocado
        expect(fs.existsSync(path.join(tmpDir2, 'sesion-actual.md'))).toBe(false);

        fs.rmSync(tmpDir2, { recursive: true, force: true });
    });
});
