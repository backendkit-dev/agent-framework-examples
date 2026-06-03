/**
 * TASK-07 — Truncado inteligente de sesion-actual.md en system prompt
 * Verifica que formatSessionContext extrae solo secciones criticas
 * cuando sessionContent supera 3000 chars.
 */

import { formatSessionContext } from '../src/agent/system-prompt';

const MAX_SESSION_CHARS = 3000;

function buildSession(extras: string = ''): string {
    return [
        '---',
        'tags: [memoria, sesion-actual]',
        'fecha_actualizacion: 2026-05-10',
        'proyecto: mi-proyecto',
        '---',
        '',
        '# Sesion Actual — mi-proyecto',
        '',
        '## Feature en Curso',
        '- **Nombre:** feature-critica',
        '- **Progreso:** 75%',
        '',
        '---',
        '',
        '## Issues Activos',
        '1. Conexion huerfana en EventBus',
        '2. Memory leak en worker pool',
        '',
        '---',
        '',
        '## Próximos Pasos',
        '1. Revisar conexiones del EventBus',
        '2. Profilear el worker pool',
        '',
        '---',
        '',
        '## Decisiones',
        '- Usar CQRS para separar reads/writes',
        '- Preferir Kafka sobre RabbitMQ por throughput',
        '',
        '---',
        '',
        '## Aprendizajes del Engine',
        '- **connection_leak** (audit, Alta, x3) — revisar cierre de conexiones',
        '',
        '---',
        '',
        extras,
        '',
        '*Creado por DeepSeek Code el 2026-05-10*',
    ].join('\n');
}

describe('formatSessionContext', () => {
    describe('contenido bajo el limite (<=3000 chars)', () => {
        it('devuelve el contenido sin cambios', () => {
            const short = 'contenido corto';
            expect(formatSessionContext(short)).toBe(short);
        });

        it('devuelve la sesion completa cuando esta justo en el limite', () => {
            const atLimit = 'x'.repeat(MAX_SESSION_CHARS);
            expect(formatSessionContext(atLimit)).toBe(atLimit);
        });
    });

    describe('contenido sobre el limite (>3000 chars)', () => {
        let largeSession: string;

        beforeEach(() => {
            // Notas largas para superar 3000 chars
            const padding = '- nota historica: ' + 'y'.repeat(80) + '\n';
            const bigNotes = Array(40).fill(padding).join('');
            largeSession = buildSession(`## Notas\n${bigNotes}`);
            expect(largeSession.length).toBeGreaterThan(MAX_SESSION_CHARS);
        });

        it('incluye la seccion Feature en Curso', () => {
            const result = formatSessionContext(largeSession);
            expect(result).toContain('## Feature en Curso');
            expect(result).toContain('feature-critica');
            expect(result).toContain('75%');
        });

        it('incluye Issues Activos', () => {
            const result = formatSessionContext(largeSession);
            expect(result).toContain('## Issues Activos');
            expect(result).toContain('Conexion huerfana en EventBus');
            expect(result).toContain('Memory leak en worker pool');
        });

        it('incluye Proximos Pasos', () => {
            const result = formatSessionContext(largeSession);
            expect(result).toContain('## Próximos Pasos');
            expect(result).toContain('Revisar conexiones del EventBus');
        });

        it('incluye Aprendizajes del Engine', () => {
            const result = formatSessionContext(largeSession);
            expect(result).toContain('## Aprendizajes del Engine');
            expect(result).toContain('connection_leak');
        });

        it('NO incluye la seccion Decisiones (baja prioridad)', () => {
            const result = formatSessionContext(largeSession);
            expect(result).not.toContain('Usar CQRS para separar reads/writes');
        });

        it('NO incluye las Notas largas que causaron el overflow', () => {
            const result = formatSessionContext(largeSession);
            expect(result).not.toContain('nota historica');
        });

        it('incluye el aviso de truncado', () => {
            const result = formatSessionContext(largeSession);
            expect(result).toContain('sesion-actual.md truncada');
            expect(result).toContain('/memory');
        });

        it('el resultado es mas corto que el original', () => {
            const result = formatSessionContext(largeSession);
            expect(result.length).toBeLessThan(largeSession.length);
        });
    });

    describe('fallback cuando no hay secciones criticas reconocibles', () => {
        it('usa slice(MAX_SESSION_CHARS) si no encuentra ninguna seccion conocida', () => {
            const content = 'x'.repeat(MAX_SESSION_CHARS + 500);
            const result = formatSessionContext(content);
            expect(result).toContain('*(truncado)*');
            expect(result.length).toBeLessThanOrEqual(MAX_SESSION_CHARS + 20);
        });
    });
});
