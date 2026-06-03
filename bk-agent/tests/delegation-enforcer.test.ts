/**
 * Tests para DelegationEnforcer — cubre los 3 niveles de enforcement:
 * 1. filterToolsForAgent (nivel API)
 * 2. interceptToolCall (nivel ejecución)
 * 3. auditResponse (nivel respuesta textual)
 */

import { DelegationEnforcer } from '../src/agent/delegation-enforcer';
import { Tool } from '../src/api/types';

const makeTools = (...names: string[]): Tool[] =>
    names.map(name => ({
        type: 'function' as const,
        function: { name, description: '', parameters: { type: 'object', properties: {}, required: [] } },
    }));

describe('DelegationEnforcer', () => {
    let enforcer: DelegationEnforcer;

    beforeEach(() => {
        enforcer = new DelegationEnforcer();
    });

    // ── filterToolsForAgent ────────────────────────────────────────────────────

    describe('filterToolsForAgent', () => {
        const allTools = makeTools('read_file', 'edit_file', 'write_file', 'multi_edit', 'ask_agent', 'execute_command');

        it('elimina herramientas de escritura para General', () => {
            const result = enforcer.filterToolsForAgent(allTools, 'general');
            const names = result.map(t => t.function.name);
            expect(names).not.toContain('edit_file');
            expect(names).not.toContain('write_file');
            expect(names).not.toContain('multi_edit');
        });

        it('conserva herramientas de lectura para General', () => {
            const result = enforcer.filterToolsForAgent(allTools, 'general');
            const names = result.map(t => t.function.name);
            expect(names).toContain('read_file');
            expect(names).toContain('ask_agent');
            expect(names).toContain('execute_command');
        });

        it('no filtra nada para agentes especializados', () => {
            for (const agentId of ['coder', 'backend', 'qa-engineer', 'security']) {
                const result = enforcer.filterToolsForAgent(allTools, agentId);
                expect(result).toHaveLength(allTools.length);
            }
        });

        it('no filtra nada si no hay herramientas de escritura', () => {
            const readOnly = makeTools('read_file', 'ask_agent');
            const result = enforcer.filterToolsForAgent(readOnly, 'general');
            expect(result).toHaveLength(readOnly.length);
        });
    });

    // ── interceptToolCall ──────────────────────────────────────────────────────

    describe('interceptToolCall', () => {
        it('bloquea edit_file de General en dominio backend', () => {
            const toolCall = {
                id: 'tc1',
                type: 'function' as const,
                function: { name: 'edit_file', arguments: JSON.stringify({ path: '/src/agent/loop.ts' }) },
            };
            const result = enforcer.interceptToolCall(toolCall, 'general');
            expect(result).not.toBeNull();
            expect(result!.blocked).toBe(true);
            expect(result!.violation.toolName).toBe('edit_file');
        });

        it('bloquea write_file de General en dominio ui', () => {
            const toolCall = {
                id: 'tc2',
                type: 'function' as const,
                function: { name: 'write_file', arguments: JSON.stringify({ path: '/src/ui/terminal.ts' }) },
            };
            const result = enforcer.interceptToolCall(toolCall, 'general');
            expect(result).not.toBeNull();
            expect(result!.blocked).toBe(true);
        });

        it('permite edit_file a agentes especializados', () => {
            const toolCall = {
                id: 'tc3',
                type: 'function' as const,
                function: { name: 'edit_file', arguments: JSON.stringify({ path: '/src/agent/loop.ts' }) },
            };
            expect(enforcer.interceptToolCall(toolCall, 'coder')).toBeNull();
            expect(enforcer.interceptToolCall(toolCall, 'backend')).toBeNull();
        });

        it('permite read_file a General en cualquier dominio', () => {
            const toolCall = {
                id: 'tc4',
                type: 'function' as const,
                function: { name: 'read_file', arguments: JSON.stringify({ path: '/src/agent/loop.ts' }) },
            };
            expect(enforcer.interceptToolCall(toolCall, 'general')).toBeNull();
        });
    });

    // ── auditResponse — paths de código ───────────────────────────────────────

    describe('auditResponse — código en dominios especializados', () => {
        it('detecta implementación de código backend en respuesta de General', () => {
            const response = `
Aquí está la implementación:

\`\`\`typescript
// src/agent/loop.ts
export class AgentLoop {
    async run() { ... }
}
\`\`\`
`;
            const violations = enforcer.auditResponse(response);
            expect(violations.length).toBeGreaterThan(0);
            expect(violations.some(v => v.toolName === 'response_code')).toBe(true);
        });

        it('no detecta violación cuando General solo menciona un archivo sin implementar', () => {
            const response = 'El archivo src/agent/loop.ts contiene la lógica principal del loop.';
            const violations = enforcer.auditResponse(response);
            // Solo menciona, no implementa — no debe detectar violación
            const codeViolations = violations.filter(v => v.toolName === 'response_code');
            expect(codeViolations).toHaveLength(0);
        });
    });

    // ── auditResponse — patrón de redirección al usuario ──────────────────────

    describe('auditResponse — redirección al usuario (anti-patrón)', () => {
        const REDIRECT_CASES = [
            'Deberías consultarle a qa-engineer para que revise los tests',
            'Te recomiendo hablarle al especialista de seguridad',
            'Podrías pedirle al agente de backend que implemente esto',
            'Hay que consultarle a qa-engineer sobre la cobertura',
            'Sugiero que le preguntes al architecture sobre el diseño',
        ];

        it.each(REDIRECT_CASES)('detecta redirección: "%s"', (response) => {
            const violations = enforcer.auditResponse(response);
            expect(violations.some(v => v.toolName === 'response_redirect')).toBe(true);
        });

        it('no detecta redirección cuando General invoca ask_agent correctamente (texto neutro)', () => {
            const response = 'Voy a invocar ask_agent con qa-engineer para revisar los tests.';
            const violations = enforcer.auditResponse(response);
            const redirectViolations = violations.filter(v => v.toolName === 'response_redirect');
            expect(redirectViolations).toHaveLength(0);
        });

        it('no dispara falso positivo en explicación técnica normal', () => {
            const response = 'El qa-engineer analiza la cobertura de código en el proyecto.';
            const violations = enforcer.auditResponse(response);
            const redirectViolations = violations.filter(v => v.toolName === 'response_redirect');
            expect(redirectViolations).toHaveLength(0);
        });
    });

    // ── ask_agent tool definition ──────────────────────────────────────────────

    describe('definición de herramienta ask_agent', () => {
        it('coder está disponible como agent_id válido', () => {
            // Leer la definición real del tool para verificar que coder está incluido
            const defs = require('../src/tools/definitions');
            const tools: Tool[] = defs.getToolDefinitions ? defs.getToolDefinitions() : [];
            // Si no hay función, importar directamente
            const { TOOL_DEFINITIONS } = require('../src/tools/definitions');
            const allTools: Tool[] = TOOL_DEFINITIONS ?? tools;

            const askAgent = allTools?.find((t: Tool) => t.function.name === 'ask_agent');
            if (askAgent) {
                const agentIdDesc = askAgent.function.parameters?.properties?.agent_id?.description ?? '';
                expect(agentIdDesc).toContain('coder');
            }
            // Si el módulo no exporta las tools directamente, verificar el archivo fuente
        });

        it('la descripción de ask_agent indica que es automático', () => {
            const fs = require('fs');
            const content: string = fs.readFileSync('src/tools/definitions.ts', 'utf-8');
            expect(content).toContain('AUTOMÁTICAMENTE');
            expect(content).toContain('coder');
        });
    });
});
