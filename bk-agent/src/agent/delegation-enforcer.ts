/**
 * @description DelegationEnforcer — Sistema de enforcement para la delegacion de agentes.
 *
 * Evita que el agente General codifique en dominios que tienen especialistas.
 * Opera en 3 niveles:
 *
 * 1. INTERCEPCION DE TOOLS: Bloquea edit_file/write_file cuando General intenta
 *    modificar archivos de un dominio con especialista. No bloquea read_file
 *    (analisis), pero forza delegacion si detecta que va a implementar.
 *
 * 2. AUDITORIA POST-RESPUESTA: Escanea la respuesta de General en busca de
 *    codigo implementado en dominios ajenos. Si encuentra violaciones, las
 *    registra para que el loop pueda tomar accion correctiva.
 *
 * 3. FORZADO DE RUTEO: Expone un metodo para que el AgentRouter pueda
 *    determinar si un set de tools + input amerita un override forzado
 *    cuando General esta activo.
 *
 * @see AgentLoop._processInput() para integracion
 * @see AgentRouter.resolve() para forzado de ruteo
 */

import { Tool, ToolCall } from '../api/types';

// -- Mapeo de patrones de ruta -> dominio -> especialista -------------------

export interface DomainMapping {
    pattern: RegExp;
    domain: string;
    agentId: string;
    description: string;
}

const FILE_DOMAIN_MAP: DomainMapping[] = [
    // Backend - logica del nucleo, APIs, servicios
    { pattern: /\/src\/agent\//i, domain: 'backend', agentId: 'backend', description: 'Agentes y logica del loop' },
    { pattern: /\/src\/api\//i, domain: 'backend', agentId: 'backend', description: 'Cliente de API y tipos' },
    { pattern: /\/src\/tools\//i, domain: 'backend', agentId: 'backend', description: 'Definiciones y ejecutores de herramientas' },
    { pattern: /\/src\/config\//i, domain: 'backend', agentId: 'backend', description: 'Carga y seed de configuracion' },
    { pattern: /\/src\/shared\//i, domain: 'backend', agentId: 'backend', description: 'Utilidades compartidas' },
    { pattern: /\/src\/bootstrap\//i, domain: 'backend', agentId: 'backend', description: 'Inicializacion del sistema' },
    { pattern: /\/src\/cli\//i, domain: 'backend', agentId: 'backend', description: 'Interfaz de linea de comandos' },
    { pattern: /\/src\/context\//i, domain: 'backend', agentId: 'backend', description: 'Manejo de contexto' },
    { pattern: /\/src\/skills\//i, domain: 'backend', agentId: 'backend', description: 'Sistema de skills' },
    { pattern: /\/src\/vault\//i, domain: 'backend', agentId: 'backend', description: 'Busqueda en vault' },
    { pattern: /\/src\/types\//i, domain: 'backend', agentId: 'backend', description: 'Tipos compartidos' },
    { pattern: /\/src\/handlers\//i, domain: 'backend', agentId: 'backend', description: 'Manejadores de herramientas' },
    { pattern: /\/bin\//i, domain: 'backend', agentId: 'backend', description: 'Punto de entrada CLI' },
    { pattern: /\/scripts\//i, domain: 'backend', agentId: 'backend', description: 'Scripts de workflow' },
    { pattern: /\/templates\//i, domain: 'backend', agentId: 'backend', description: 'Templates del proyecto' },

    // Arquitectura - diseno de sistemas y orquestacion
    { pattern: /\/src\/orchestrator\//i, domain: 'architecture', agentId: 'architecture', description: 'Orquestador, FSM, pipeline de gates' },
    { pattern: /\/docs\/architecture\//i, domain: 'architecture', agentId: 'architecture', description: 'Documentacion arquitectonica' },
    { pattern: /\/adr\//i, domain: 'architecture', agentId: 'architecture', description: 'Architecture Decision Records' },

    // Frontend - interfaz de usuario
    { pattern: /\/src\/components\//i, domain: 'frontend', agentId: 'frontend', description: 'Componentes de UI' },
    { pattern: /\/src\/pages\//i, domain: 'frontend', agentId: 'frontend', description: 'Paginas/vistas' },
    { pattern: /\/src\/ui\//i, domain: 'frontend', agentId: 'frontend', description: 'Capa de interfaz de usuario' },
    { pattern: /\/src\/styles\//i, domain: 'frontend', agentId: 'frontend', description: 'Estilos CSS/Tailwind' },
    { pattern: /\/views\//i, domain: 'frontend', agentId: 'frontend', description: 'Plantillas de vista' },

    // Seguridad - autenticacion, autorizacion, hardening
    { pattern: /\/src\/auth\//i, domain: 'security', agentId: 'security', description: 'Autenticacion y autorizacion' },
    { pattern: /\/src\/security\//i, domain: 'security', agentId: 'security', description: 'Modulo de seguridad' },
    { pattern: /\/(jwt|oauth|crypto|encrypt)\//i, domain: 'security', agentId: 'security', description: 'Cifrado y tokens' },

    // Base de datos - esquemas, queries, migraciones
    { pattern: /\/src\/database\//i, domain: 'data', agentId: 'data', description: 'Capa de base de datos' },
    { pattern: /\/src\/models\//i, domain: 'data', agentId: 'data', description: 'Modelos de datos' },
    { pattern: /\/migrations\//i, domain: 'data', agentId: 'data', description: 'Migraciones de BD' },
    { pattern: /\/src\/repositories\//i, domain: 'data', agentId: 'data', description: 'Repositorios/DAOs' },

    // Testing - tests y calidad
    { pattern: /\/__tests__\//i, domain: 'testing', agentId: 'qa-engineer', description: 'Tests unitarios' },
    { pattern: /\/tests\//i, domain: 'testing', agentId: 'qa-engineer', description: 'Tests de integracion/e2e' },
    { pattern: /\.spec\.(ts|js|tsx|jsx)$/i, domain: 'testing', agentId: 'qa-engineer', description: 'Archivo de test spec' },
    { pattern: /\.test\.(ts|js|tsx|jsx)$/i, domain: 'testing', agentId: 'qa-engineer', description: 'Archivo de test' },
    { pattern: /\/src\/test\//i, domain: 'testing', agentId: 'qa-engineer', description: 'Utilidades de test' },

    // Codificacion pura - implementacion sin dominio especifico
    { pattern: /\/src\/reflection\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion del sistema de reflexion' },
    { pattern: /\/src\/utils\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de utilidades' },
    { pattern: /\/src\/helpers\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de helpers' },
    { pattern: /\/src\/lib\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de librerias internas' },
    { pattern: /\/src\/adapters\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de adaptadores' },
    { pattern: /\/src\/providers\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de providers' },
    { pattern: /\/src\/interfaces\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de interfaces' },
    { pattern: /\/src\/middleware\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de middleware' },
    { pattern: /\/src\/decorators\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de decoradores' },
    { pattern: /\/src\/filters\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de filtros' },
    { pattern: /\/src\/guards\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de guards' },
    { pattern: /\/src\/interceptors\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de interceptors' },
    { pattern: /\/src\/pipes\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de pipes' },
    { pattern: /\/src\/dto\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de DTOs' },
    { pattern: /\/src\/entities\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de entidades' },
    { pattern: /\/src\/enums\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de enums' },
    { pattern: /\/src\/constants\//i, domain: 'codificacion', agentId: 'coder', description: 'Implementacion de constantes' },

    // Infraestructura - Docker, CI/CD, deploy
    { pattern: /\/docker\//i, domain: 'infrastructure', agentId: 'infrastructure', description: 'Configuracion Docker' },
    { pattern: /\/k8s\//i, domain: 'infrastructure', agentId: 'infrastructure', description: 'Configuracion Kubernetes' },
    { pattern: /\/\.github\//i, domain: 'infrastructure', agentId: 'infrastructure', description: 'Workflows de GitHub' },
    { pattern: /\/ci\//i, domain: 'infrastructure', agentId: 'infrastructure', description: 'Pipeline CI/CD' },
    { pattern: /Dockerfile/i, domain: 'infrastructure', agentId: 'infrastructure', description: 'Dockerfile' },
    { pattern: /docker-compose/i, domain: 'infrastructure', agentId: 'infrastructure', description: 'Docker Compose' },
    { pattern: /\/terraform\//i, domain: 'infrastructure', agentId: 'infrastructure', description: 'Terraform/Infra como codigo' },
];

// -- Tools de escritura (bloqueables) ---------------------------------------

const WRITE_TOOLS = new Set([
    'edit_file', 'write_file', 'multi_edit', 'notebook_edit', 'apply_patch',
]);

// -- Patrones de escritura en execute_command (heuristica) ------------------

const SHELL_WRITE_PATTERNS = [
    />\s*["']?[\w./\\-]+\.(ts|js|tsx|jsx|json|yaml|yml|md|ps1|sh)/i, // redireccion >
    /Set-Content\s/i,
    /Out-File\s/i,
    /tee\s+-a\s/i,
];

// -- Tools de lectura (no bloqueables, pero monitoreables) ------------------

const READ_TOOLS = new Set(['read_file', 'list_directory', 'ripgrep_search']);

// -- Violacion reportable ---------------------------------------------------

export interface DelegationViolation {
    domain: string;
    specialistAgentId: string;
    toolName: string;
    filePath: string;
    description: string;
}

// -- Resultado de intercepcion ----------------------------------------------

export interface InterceptResult {
    blocked: true;
    violation: DelegationViolation;
    specialistName: string;
    message: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DelegationEnforcer
// ═══════════════════════════════════════════════════════════════════════════

export class DelegationEnforcer {
    private violations: DelegationViolation[] = [];

    /**
     * @description Detecta el dominio y especialista para una ruta de archivo.
     * @param filePath - Ruta absoluta o relativa del archivo
     * @returns El mapping de dominio si se encuentra, o null si es dominio general
     */
    detectDomain(filePath: string): DomainMapping | null {
        for (const mapping of FILE_DOMAIN_MAP) {
            if (mapping.pattern.test(filePath)) {
                return mapping;
            }
        }
        return null;
    }

    /**
     * @description Obtiene el nombre legible del especialista para un agentId.
     */
    getSpecialistName(agentId: string): string {
        const names: Record<string, string> = {
            'backend': 'Backend Developer',
            'frontend': 'Frontend Developer',
            'architecture': 'Architecture Expert',
            'security': 'Security Expert',
            'data': 'Data Engineer',
            'qa-engineer': 'QA Engineer',
            'infrastructure': 'Infrastructure Engineer',
            'coder': 'Coder',
        };
        return names[agentId] ?? agentId;
    }

    /**
     * @description Intercepta un tool call si General intenta escribir en un
     * archivo de dominio especializado. Previene fisicamente la operacion y
     * devuelve un mensaje que forza al modelo a usar ask_agent.
     *
     * @param toolCall - La llamada a herramienta que General quiere ejecutar
     * @param effectiveAgentId - ID del agente actualmente activo
     * @returns InterceptResult si se debe bloquear, o null si la operacion es valida
     */
    interceptToolCall(toolCall: ToolCall, effectiveAgentId: string): InterceptResult | null {
        // Solo aplicar a General
        if (effectiveAgentId !== 'general') return null;

        const toolName = toolCall.function.name;

        // Parsear argumentos
        let args: any;
        try {
            args = JSON.parse(toolCall.function.arguments);
        } catch {
            return null; // No interceptar si no se pueden parsear los args
        }

        const rawPath: string | undefined =
            args.file_path ?? args.path ?? args.target ?? args.destination ?? args.filename;

        // Si no hay filePath, no interceptar (excepto execute_command - ver abajo)
        if (!rawPath && toolName !== 'execute_command') return null;

        // Normalizar separadores para que los patrones funcionen en Windows
        const filePath = rawPath ? rawPath.replace(/\\/g, '/') : '';

        // -- execute_command: inspeccionar el comando por redirecciones a archivos --
        if (toolName === 'execute_command') {
            const cmd: string = args.command ?? args.cmd ?? '';
            const hasWritePattern = SHELL_WRITE_PATTERNS.some(p => p.test(cmd));
            if (!hasWritePattern) return null;

            // Extraer todos los paths del comando y retornar la primera violación de dominio
            const cmdPathRegex = /["']?([\w./\\-]+\.(ts|js|tsx|jsx|json|yaml|yml|md|ps1|sh))["']?/gi;
            let cmdPath = '';
            let cmdMapping: ReturnType<typeof this.detectDomain> = null;
            for (const m of cmd.matchAll(cmdPathRegex)) {
                const p = m[1].replace(/\\/g, '/');
                const dm = this.detectDomain(p);
                if (dm) { cmdPath = p; cmdMapping = dm; break; }
            }
            if (!cmdMapping) return null;

            const specialistName = this.getSpecialistName(cmdMapping.agentId);
            const violation: DelegationViolation = {
                domain: cmdMapping.domain,
                specialistAgentId: cmdMapping.agentId,
                toolName,
                filePath: cmdPath,
                description: cmdMapping.description,
            };
            this.violations.push(violation);
            return {
                blocked: true,
                violation,
                specialistName,
                message: [
                    `BLOCKED - Comando bloqueado.`,
                    `El comando parece escribir en "${cmdPath}" (dominio "${cmdMapping.domain}").`,
                    `Usa ask_agent para delegar al especialista ${cmdMapping.agentId}.`,
                ].join('\n'),
            };
        }

        // Detectar dominio por path
        const mapping = this.detectDomain(filePath);
        if (!mapping) return null; // Dominio general, no interceptar

        // -- Tools de escritura: SIEMPRE interceptar -------------------------
        if (WRITE_TOOLS.has(toolName)) {
            const violation: DelegationViolation = {
                domain: mapping.domain,
                specialistAgentId: mapping.agentId,
                toolName,
                filePath,
                description: mapping.description,
            };

            this.violations.push(violation);

            const specialistName = this.getSpecialistName(mapping.agentId);
            const message = [
                `BLOCKED - Operacion bloqueada.`,
                ``,
                `El archivo "${filePath}" pertenece al dominio "${mapping.domain}" `,
                `(${mapping.description}), que tiene un especialista asignado: ${specialistName}.`,
                ``,
                `Como agente General, NO debes modificar archivos de este dominio.`,
                `Debes usar la herramienta ask_agent para delegar al especialista ${mapping.agentId}:`,
                ``,
                `ask_agent(`,
                `  agent_id: "${mapping.agentId}",`,
                `  question: "${this.buildDelegationQuestion(toolName, toolCall.function.arguments)}",`,
                `  context: "Archivo: ${filePath}"`,
                `)`,
                ``,
                `Esta operacion ha sido bloqueada por el DelegationEnforcer.`,
            ].join('\n');

            return {
                blocked: true,
                violation,
                specialistName,
                message,
            };
        }

        // -- Tools de lectura: monitorear pero NO bloquear -------------------
        // (General puede leer archivos para analizar, pero si luego intenta
        //  escribirlos, sera bloqueado en el write)

        return null;
    }

    /**
     * @description Audita la respuesta del agente General para detectar si
     * implemento codigo en dominios que deberian haber sido delegados.
     * Escanea bloques de codigo y paths mencionados.
     *
     * @param response - La respuesta textual del agente General
     * @returns Lista de violaciones detectadas en la respuesta
     */
    auditResponse(response: string): DelegationViolation[] {
        const found: DelegationViolation[] = [];

        // Detectar el anti-patrón: decirle al usuario que consulte/hable con un especialista
        // en lugar de invocar ask_agent directamente.
        // Cubre: "deberías/podrías consultarle a", "sugiero que le preguntes al", "te recomiendo hablarle al"
        const REDIRECT_PATTERN = /(?:deber[ií]as?|podr[ií]as?|ten[eé]s?|hay\s+que|te\s+recomiendo|sugiero)\s+(?:que\s+)?(?:le\s+)?(?:consultar(?:le)?|hablar(?:le)?|pedirle?|contactar(?:le)?|preguntar(?:le)?|consultes?|habl[eé]s?|pidas?|contactes?|preguntes?)\s+(?:al\s+|a\s+el\s+|a\s+)(?:especialista|agente\s+de|qa[\s-]engineer|security|backend|frontend|infrastructure|architecture|coder)/i;
        if (REDIRECT_PATTERN.test(response)) {
            found.push({
                domain: 'orchestration',
                specialistAgentId: 'general',
                toolName: 'response_redirect',
                filePath: '(ninguno)',
                description: 'General le dijo al usuario que consultara a un especialista en lugar de invocar ask_agent',
            });
        }

        // Buscar paths de archivos: absolutos (/src/...) y relativos (src/...)
        const filePathRegex = /(?:^|[\s`('"])(?:\.\/|\.\.\/|(?=[a-zA-Z]\/))?((?:[\w._-]+\/)+[\w._-]+\.(ts|js|tsx|jsx|json|yaml|yml|md|ps1|sh|css|scss|html))\b/gm;
        const matches = response.matchAll(filePathRegex);

        const seen = new Set<string>();

        for (const match of matches) {
            const filePath = match[1];
            if (!filePath) continue;

            // Evitar duplicados
            if (seen.has(filePath)) continue;
            seen.add(filePath);

            // FILE_DOMAIN_MAP patterns expect a leading slash — normalize relative paths
            const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;
            const mapping = this.detectDomain(normalizedPath);
            if (!mapping) continue;

            // Verificar si el bloque de codigo contiene implementacion real
            // (no solo referencias)
            const contextLine = this.extractLineContext(response, match.index!);
            const isImplementation = this.isImplementationContext(contextLine);

            if (isImplementation) {
                found.push({
                    domain: mapping.domain,
                    specialistAgentId: mapping.agentId,
                    toolName: 'response_code',
                    filePath,
                    description: mapping.description,
                });
            }
        }

        return found;
    }

    /**
     * @description Filtra los tools de escritura para agentes que no deben modificar archivos directamente.
     * General actúa como orquestador puro: recibe todos los tools de lectura/análisis pero
     * no los de escritura, forzando al modelo a usar ask_agent en vez de escribir por su cuenta.
     * Coder y todos los especialistas reciben el set completo.
     *
     * @param tools - Lista completa de tools disponibles
     * @param agentId - ID del agente actualmente activo
     * @returns Tools filtrados según el rol del agente
     */
    filterToolsForAgent(tools: Tool[], agentId: string): Tool[] {
        if (agentId !== 'general') return tools;
        return tools.filter(t => !WRITE_TOOLS.has(t.function.name));
    }

    /**
     * @description Limpia el historial de violaciones registradas.
     */
    resetViolations(): void {
        this.violations = [];
    }

    /**
     * @description Retorna las violaciones acumuladas desde el ultimo reset.
     */
    getViolations(): DelegationViolation[] {
        return [...this.violations];
    }

    // -- Privados -----------------------------------------------------------

    /**
     * @description Construye una pregunta de delegacion descriptiva basada
     * en la tool que se intento usar y sus argumentos.
     */
    private buildDelegationQuestion(toolName: string, argsJson: string): string {
        try {
            const args = JSON.parse(argsJson);
            if (toolName === 'edit_file') {
                return `Modificar el archivo "${args.file_path}" reemplazando contenido especifico.`;
            }
            if (toolName === 'write_file') {
                return `Escribir/reescribir el archivo "${args.file_path}".`;
            }
            return `Operacion en archivo "${args.file_path}" usando ${toolName}.`;
        } catch {
            return `Realizar la operacion solicitada en el archivo.`;
        }
    }

    /**
     * @description Extrae la linea de contexto alrededor de un match en el texto.
     */
    private extractLineContext(text: string, index: number): string {
        const start = Math.max(0, index - 100);
        const end = Math.min(text.length, index + 100);
        return text.slice(start, end);
    }

    /**
     * @description Determina si un contexto de linea indica implementacion
     * real (no solo una referencia o mencion).
     */
    private isImplementationContext(context: string): boolean {
        const implementacionIndicators = [
            'implementar', 'implementaci',   // "implementar", "implementación", "implementé"
            'crear archivo', 'nuevo archivo', 'reescribir',
            'voy a escribir', 'aqui esta el codigo', 'aqui está el código',
            'he creado', 'he modificado', 'escribiendo el archivo',
        ];
        const lower = context.toLowerCase();
        return implementacionIndicators.some(ind => lower.includes(ind));
    }
}
