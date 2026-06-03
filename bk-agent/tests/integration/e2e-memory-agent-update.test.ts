/**
 * E2E — Flujo completo de actualizacion de memoria por agentes
 *
 * Simula el flujo completo:
 * 1. Un agente especialista responde con marcas [memory:*] en su respuesta
 * 2. AgentLoop (o specialist-executor) detecta las marcas y llama a updateSessionMemory
 * 3. MemoryUpdater parsea y aplica los cambios a sesion-actual.md
 *
 * Este test verifica el pipeline completo sin mockear el filesystem,
 * usando un directorio temporal aislado.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { parseMemoryTags, stripMemoryTags } from '../../src/memory/memory-tag-parser';
import { updateSessionMemory, SessionMemoryUpdate } from '../../src/memory/updater';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-mem-agent-'));
}

/**
 * Crea un archivo sesion-actual.md minimo en el directorio indicado,
 * simulando el estado inicial de una sesion.
 */
function createSessionFile(dir: string, overrides?: {
    feature?: string;
    progress?: string;
    issues?: string[];
    nextSteps?: string[];
    decisions?: string[];
    notes?: string;
}): void {
    const content = [
        '---',
        'tags: [memoria, deepseek-code, sesion-actual]',
        'fecha_actualizacion: 2026-05-10',
        'proyecto: test-project',
        '---',
        '',
        '# Sesion Actual — test-project',
        '',
        '> Estado vivo del proyecto.',
        '',
        '---',
        '',
        '## Feature en Curso',
        `- **Nombre:** ${overrides?.feature ?? '(Por definir)'}`,
        `- **Progreso:** ${overrides?.progress ?? '0%'}`,
        '',
        '---',
        '',
        '## Issues Activos',
        overrides?.issues?.length
            ? overrides.issues.map((s, i) => `${i + 1}. ${s}`).join('\n')
            : '1. (Ninguno)',
        '',
        '---',
        '',
        '## Próximos Pasos',
        overrides?.nextSteps?.length
            ? overrides.nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
            : '1. (Por definir)',
        '',
        '---',
        '',
        ...(overrides?.decisions?.length
            ? ['## Decisiones', ...overrides.decisions.map(d => `- ${d}`), '', '---', '']
            : []),
        ...(overrides?.notes
            ? ['## Notas', overrides.notes, '', '---', '']
            : []),
        '',
        '## Aprendizajes del Engine',
        '*(Sin patrones detectados aun)*',
        '',
        '---',
        '',
        '*Creado por DeepSeek Code el 2026-05-10*',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'sesion-actual.md'), content, 'utf-8');
}

/**
 * Lee el contenido de sesion-actual.md como string.
 */
function readSession(dir: string): string {
    return fs.readFileSync(path.join(dir, 'sesion-actual.md'), 'utf-8');
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests del flujo completo
// ══════════════════════════════════════════════════════════════════════════════

describe('E2E — Flujo completo de actualizacion de memoria por agentes', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        fs.mkdirSync(path.join(tmpDir, 'checkpoints'), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── Escenario 1: Agente actualiza feature y progreso ─────────────────────

    it('Escenario 1: agente actualiza feature y progreso via [memory:*] tags', async () => {
        // Estado inicial
        createSessionFile(tmpDir);

        // Respuesta simulada de un agente especialista con marcas de memoria
        const agentResponse = [
            '[memory:feature] Implementacion de autenticacion OAuth2',
            '[memory:progress] 45%',
            '',
            'He implementado el flujo de autorizacion con Google OAuth2.',
            'El siguiente paso es agregar refresh token.',
        ].join('\n');

        // Paso 1: Parsear las marcas
        const parsed = parseMemoryTags(agentResponse);
        expect(parsed.rawTags).toHaveLength(2);
        expect(parsed.rawTags[0]).toEqual({ field: 'feature', value: 'Implementacion de autenticacion OAuth2' });
        expect(parsed.rawTags[1]).toEqual({ field: 'progress', value: '45%' });

        // Paso 2: Aplicar la actualizacion a sesion-actual.md
        const result = await updateSessionMemory(tmpDir, parsed.update);
        expect(result).toContain('Memoria actualizada');

        // Paso 3: Verificar que sesion-actual.md refleja los cambios
        const sessionContent = readSession(tmpDir);
        expect(sessionContent).toContain('Implementacion de autenticacion OAuth2');
        expect(sessionContent).toContain('45%');
        // El contenido original del agente NO debe estar en sesion-actual.md
        expect(sessionContent).not.toContain('He implementado el flujo');
    });

    // ── Escenario 2: Agente agrega issues y decisiones ───────────────────────

    it('Escenario 2: agente agrega issues y decisiones via [memory:*] tags', async () => {
        createSessionFile(tmpDir, {
            feature: 'Refactor modulo de pagos',
            progress: '30%',
        });

        const agentResponse = [
            'He encontrado algunos problemas durante la refactorizacion.',
            '',
            '[memory:issues] Bug en calculo de impuestos para facturas internacionales; Falta manejo de errores en gateway de pagos',
            '',
            '[memory:decision] Se decidio usar Strategy Pattern para los calculos de impuestos',
            '',
            'El resto del modulo esta funcionando correctamente.',
        ].join('\n');

        // Paso 1: Parsear
        const parsed = parseMemoryTags(agentResponse);
        expect(parsed.rawTags).toHaveLength(2);

        // issues se parsea como array separado por ;
        expect(parsed.update.issues).toBeDefined();
        expect(parsed.update.issues).toHaveLength(2);
        expect(parsed.update.issues![0]).toBe('Bug en calculo de impuestos para facturas internacionales');
        expect(parsed.update.issues![1]).toBe('Falta manejo de errores en gateway de pagos');

        expect(parsed.update.decisiones).toBeDefined();
        expect(parsed.update.decisiones).toHaveLength(1);
        expect(parsed.update.decisiones![0]).toBe('Se decidio usar Strategy Pattern para los calculos de impuestos');

        // Paso 2: Aplicar
        const result = await updateSessionMemory(tmpDir, parsed.update);
        expect(result).toContain('Memoria actualizada');

        // Paso 3: Verificar
        const sessionContent = readSession(tmpDir);
        expect(sessionContent).toContain('Bug en calculo de impuestos');
        expect(sessionContent).toContain('Falta manejo de errores en gateway de pagos');
        expect(sessionContent).toContain('Strategy Pattern');
        // Feature original debe preservarse
        expect(sessionContent).toContain('Refactor modulo de pagos');
    });

    // ── Escenario 3: Agente actualiza proximos pasos y notas ─────────────────

    it('Escenario 3: agente actualiza proximos pasos y notas via [memory:*] tags', async () => {
        createSessionFile(tmpDir, {
            feature: 'Configurar CI/CD',
            progress: '60%',
            nextSteps: ['Configurar GitHub Actions'],
        });

        const agentResponse = [
            '[memory:next-steps] Configurar GitHub Actions; Agregar tests de integracion al pipeline; Configurar deploy automatico a staging',
            '',
            '[memory:notes] Se recomienda usar matrix build para Node 18 y 20',
            '',
            'La configuracion basica de CI esta lista.',
        ].join('\n');

        // Paso 1: Parsear
        const parsed = parseMemoryTags(agentResponse);
        expect(parsed.rawTags).toHaveLength(2);

        expect(parsed.update.proximos_pasos).toBeDefined();
        expect(parsed.update.proximos_pasos).toHaveLength(3);
        expect(parsed.update.proximos_pasos![0]).toBe('Configurar GitHub Actions');
        expect(parsed.update.proximos_pasos![1]).toBe('Agregar tests de integracion al pipeline');
        expect(parsed.update.proximos_pasos![2]).toBe('Configurar deploy automatico a staging');

        expect(parsed.update.notas).toBe('Se recomienda usar matrix build para Node 18 y 20');

        // Paso 2: Aplicar
        const result = await updateSessionMemory(tmpDir, parsed.update);
        expect(result).toContain('Memoria actualizada');

        // Paso 3: Verificar
        const sessionContent = readSession(tmpDir);
        expect(sessionContent).toContain('Agregar tests de integracion al pipeline');
        expect(sessionContent).toContain('Configurar deploy automatico a staging');
        expect(sessionContent).toContain('matrix build para Node 18 y 20');
    });

    // ── Escenario 4: Multiples marcas del mismo tipo (decisiones) ────────────

    it('Escenario 4: multiples marcas [memory:decision] se acumulan', async () => {
        createSessionFile(tmpDir, {
            feature: 'Diseno de arquitectura',
            progress: '20%',
        });

        const agentResponse = [
            'Analizando las opciones de arquitectura:',
            '',
            '[memory:decision] Se adopta arquitectura hexagonal para el modulo de usuarios',
            '[memory:decision] Se usa PostgreSQL como base de datos principal',
            '[memory:decision] Se implementa CQRS para el modulo de reporting',
            '',
            'Estas decisiones fueron consensuadas con el equipo.',
        ].join('\n');

        // Paso 1: Parsear
        const parsed = parseMemoryTags(agentResponse);
        expect(parsed.rawTags).toHaveLength(3);
        expect(parsed.update.decisiones).toBeDefined();
        expect(parsed.update.decisiones).toHaveLength(3);

        // Paso 2: Aplicar
        const result = await updateSessionMemory(tmpDir, parsed.update);
        expect(result).toContain('Memoria actualizada');

        // Paso 3: Verificar que las 3 decisiones estan presentes
        const sessionContent = readSession(tmpDir);
        expect(sessionContent).toContain('arquitectura hexagonal');
        expect(sessionContent).toContain('PostgreSQL');
        expect(sessionContent).toContain('CQRS');
    });

    // ── Escenario 5: stripMemoryTags limpia las marcas del texto visible ─────

    it('Escenario 5: stripMemoryTags remueve las marcas del texto visible al usuario', async () => {
        const agentResponse = [
            '[memory:feature] Implementar modulo de notificaciones',
            '[memory:progress] 10%',
            '',
            'He comenzado la implementacion del modulo de notificaciones.',
            'Use el patron Observer para desacoplar los canales.',
            '',
            '[memory:decision] Se usa patron Observer para notificaciones',
        ].join('\n');

        const cleanText = stripMemoryTags(agentResponse);

        // El texto limpio NO debe contener las marcas [memory:*]
        expect(cleanText).not.toContain('[memory:feature]');
        expect(cleanText).not.toContain('[memory:progress]');
        expect(cleanText).not.toContain('[memory:decision]');

        // Pero debe preservar el contenido del agente
        expect(cleanText).toContain('He comenzado la implementacion');
        expect(cleanText).toContain('patron Observer');
    });

    // ── Escenario 6: Respuesta sin marcas no modifica la memoria ─────────────

    it('Escenario 6: respuesta sin marcas [memory:*] no modifica la memoria', async () => {
        createSessionFile(tmpDir, {
            feature: 'Feature existente',
            progress: '50%',
        });

        const agentResponse = 'Esta es una respuesta normal sin marcas de memoria.';

        // Paso 1: Parsear — no debe encontrar marcas
        const parsed = parseMemoryTags(agentResponse);
        expect(parsed.rawTags).toHaveLength(0);
        expect(Object.keys(parsed.update)).toHaveLength(0);

        // Paso 2: Aplicar update vacio — debe responder "sin cambios necesarios"
        const result = await updateSessionMemory(tmpDir, parsed.update);
        expect(result).toContain('sin cambios necesarios');

        // Paso 3: El contenido del archivo no debe cambiar
        const sessionContent = readSession(tmpDir);
        expect(sessionContent).toContain('Feature existente');
        expect(sessionContent).toContain('50%');
    });

    // ── Escenario 7: Flujo completo simulado (como lo haria AgentLoop) ───────

    it('Escenario 7: flujo completo simulado como lo ejecutaria AgentLoop', async () => {
        // Este test simula exactamente lo que hace AgentLoop._processInput()
        // cuando recibe una respuesta con marcas [memory:*]

        // Estado inicial de la sesion
        createSessionFile(tmpDir, {
            feature: '(Por definir)',
            progress: '0%',
        });

        // Respuesta simulada de un agente especialista (backend-agent)
        const specialistResponse = [
            '[memory:feature] Implementar API REST de usuarios',
            '[memory:progress] 75%',
            '[memory:issues] Falta validacion de email en el DTO de creacion',
            '[memory:decision] Se usa class-validator para validacion de DTOs',
            '[memory:next-steps] Agregar tests de integracion para el CRUD de usuarios; Implementar middleware de autenticacion; Documentar endpoints con Swagger',
            '',
            '[backend-agent]',
            'He implementado el CRUD basico de usuarios con NestJS.',
            'Los endpoints son: GET /users, POST /users, GET /users/:id.',
        ].join('\n');

        // ── Simulacion del pipeline en AgentLoop ──

        // 1. El specialist-executor parsea las marcas
        const parsed = parseMemoryTags(specialistResponse);
        expect(parsed.rawTags.length).toBeGreaterThanOrEqual(5);

        // 2. El specialist-executor limpia las marcas del texto visible
        const cleanContent = stripMemoryTags(specialistResponse);
        expect(cleanContent).not.toContain('[memory:feature]');
        expect(cleanContent).toContain('He implementado el CRUD basico');

        // 3. AgentLoop llama a applyMemoryUpdate() -> updateSessionMemory()
        const result = await updateSessionMemory(tmpDir, parsed.update);
        expect(result).toContain('Memoria actualizada');

        // 4. Verificar que sesion-actual.md refleja todos los cambios
        const sessionContent = readSession(tmpDir);
        expect(sessionContent).toContain('Implementar API REST de usuarios');
        expect(sessionContent).toContain('75%');
        expect(sessionContent).toContain('Falta validacion de email');
        expect(sessionContent).toContain('class-validator');
        expect(sessionContent).toContain('Agregar tests de integracion');
        expect(sessionContent).toContain('Implementar middleware de autenticacion');
        expect(sessionContent).toContain('Documentar endpoints con Swagger');

        // 5. El texto del agente NO debe filtrarse a sesion-actual.md
        expect(sessionContent).not.toContain('He implementado el CRUD basico');
        expect(sessionContent).not.toContain('GET /users');
    });

    // ── Escenario 8: Actualizacion incremental (dos agentes en secuencia) ────

    it('Escenario 8: dos agentes actualizan memoria incrementalmente', async () => {
        createSessionFile(tmpDir);

        // Primer agente: establece feature y progreso
        const agent1Response = [
            '[memory:feature] Refactorizar modulo de autenticacion',
            '[memory:progress] 30%',
            'Estoy revisando el codigo existente.',
        ].join('\n');

        const parsed1 = parseMemoryTags(agent1Response);
        await updateSessionMemory(tmpDir, parsed1.update);

        let sessionContent = readSession(tmpDir);
        expect(sessionContent).toContain('Refactorizar modulo de autenticacion');
        expect(sessionContent).toContain('30%');

        // Segundo agente: actualiza progreso y agrega issues
        const agent2Response = [
            '[memory:progress] 60%',
            '[memory:issues] Dependencia circular entre AuthModule y UserModule',
            'Encontre y resolvi la mayoria de los problemas.',
        ].join('\n');

        const parsed2 = parseMemoryTags(agent2Response);
        await updateSessionMemory(tmpDir, parsed2.update);

        sessionContent = readSession(tmpDir);
        // Feature debe preservarse del primer agente
        expect(sessionContent).toContain('Refactorizar modulo de autenticacion');
        // Progreso debe reflejar el del segundo agente (ultimo valor)
        expect(sessionContent).toContain('60%');
        // Issue del segundo agente debe estar presente
        expect(sessionContent).toContain('Dependencia circular');
        // 30% del primer agente NO debe estar (fue reemplazado)
        expect(sessionContent).not.toContain('**Progreso:** 30%');
    });
});
