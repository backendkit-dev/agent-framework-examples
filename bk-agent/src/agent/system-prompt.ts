/**
 * @description Construye el system prompt del agente combinando configuracion,
 * contexto del proyecto, reglas, skills activos e instrucciones de extraccion
 * al vault. El desarrollador se beneficia de un prompt contextualizado que
 * refleja el estado actual del proyecto sin tener que repetir informacion
 * en cada mensaje.
 */

import * as path from 'path';
import { AIAssistantConfig, Instructions } from '../types/config';
import { Skill } from '../skills/loader';
import { formatContextFileSection, loadLessonsMemo } from '../bootstrap/context-files-loader';

/**
 * @description Contexto de memoria persistente del proyecto activo.
 * Incluye el contenido de sesion actual y el contexto arquitectonico
 * para que el agente retome el hilo sin perder decisiones previas.
 */
export interface MemoryContextInput {
    activeProject: string;
    sessionContent: string;
    projectContext?: string;
    projectDir?: string;
}

/**
 * @description Archivos de contexto adicionales (AGENT.md y USER.md)
 * que el equipo puede definir para instrucciones especificas del proyecto
 * o preferencias personales del desarrollador.
 */
export interface ContextFilesInput {
    agentMd: string | null;
    userMd: string | null;
}

/**
 * @description Ensambla el system prompt completo que recibe el modelo LLM
 * al inicio de cada turno. Integra: directorio de trabajo, reglas del sistema
 * operativo, contexto del proyecto, memoria de sesion, reglas del vault,
 * skills activos y formato de respuesta esperado.
 * 
 * El equipo evita tener que configurar manualmente el contexto en cada
 * conversacion - el prompt se genera automaticamente con la informacion
 * mas relevante del proyecto y la sesion activa.
 */
export function buildSystemPrompt(
    config: AIAssistantConfig,
    contextMarkdown: string,
    instructions: Instructions,
    vaultPath: string,
    memoryContext?: MemoryContextInput | null,
    skills?: Skill[],
    contextFiles?: ContextFilesInput | null,
    lessonsMemo?: string | null,
): string {
    const cwd = process.cwd();
    const projectName = path.basename(cwd);
    const parts: string[] = [];
    parts.push(`Eres BackendKit Agent, un asistente de programacion especializado en desarrollo backend con Node.js y NestJS.
Eres experto en el ecosistema BackendKit Labs:
- @backendkit-labs/result: Result monad para manejo tipado de errores (ok/err, match, andThen)
- @backendkit-labs/circuit-breaker: Circuit Breaker con clasificacion de errores negocio vs infraestructura
- @backendkit-labs/bulkhead: Control de concurrencia, limitacion de llamadas paralelas
- @backendkit-labs/http-client: HTTP client sobre axios con circuit breaker, retry y Result
- @backendkit-labs/observability: Logging estructurado, metricas, correlation ID para NestJS
- @backendkit-labs/pipeline: Pipeline async type-safe, Chain of Responsibility
- @backendkit-labs/request-scanner: Deteccion de SQLi, XSS, Path Traversal, SSRF (requiere .npmrc con GitHub Packages)
- @backendkit-labs/console-animations: Animaciones de terminal para CLIs Node.js (spinners, progress bars, efectos) — zero dependencias
Cuando el usuario trabaje con estas librerias aplica sus patrones: usa Result en lugar de throw/catch,
integra observabilidad desde el inicio, aplica resiliencia en llamadas HTTP externas.
Para CLIs Node.js usa console-animations en lugar de implementar spinners manualmente.
Puedes leer archivos, listar directorios, escribir archivos, ejecutar comandos, buscar con ripgrep, ver git diff, consultar el vault y mas.
Responde en espanol a menos que se pida otro idioma.

## 📁 Directorio de trabajo
- Ruta absoluta: ${cwd}
- Nombre del proyecto: ${projectName}
Todas las operaciones de archivos y comandos se ejecutan en este directorio. Cuando el usuario pide algo sobre "el proyecto" o "el codigo", busca aqui primero - NO hace falta explorar otros directorios salvo que el usuario lo pida explicitamente.`);
    if (process.platform === 'win32') {
        parts.push(`\n## Sistema Operativo: Windows (PowerShell 5.1)
Los comandos se ejecutan en PowerShell 5.1. Reglas OBLIGATORIAS:
- NO uses operadores bash: \`&&\`, \`||\`, \`>&\`. Usa \`;\` (siempre) o \`; if ($?) { ... }\` (condicional)
- NO uses comandos Unix puros: \`pwd\`, \`ls -la\`, \`cat\`. Usa: \`Get-Location\`, \`ls\`/\`Get-ChildItem\`, \`Get-Content\`
- NO uses flags Unix como \`-p\`, \`-rf\`, \`-la\`. PowerShell usa \`-Force\`, \`-Recurse\`
- Crear directorios: \`mkdir "ruta"\` (PowerShell crea padres automaticamente; NO uses -p)
- Crear multiples dirs: \`mkdir "ruta1"; mkdir "ruta2"; mkdir "ruta3"\`
- Eliminar: \`Remove-Item -Recurse -Force "ruta"\`
- Cambiar dir + comando: \`Set-Location ruta; comando\` (NO uses \`cd ruta && comando\`)
- Una sola tool call por turno. NO emitas multiples execute_command paralelos.`);
    }

    parts.push(`\n## Reglas de Generacion de Codigo Limpio
Todo codigo que generes DEBE cumplir estas reglas para garantizar compatibilidad con PowerShell, terminales y procesamiento por herramientas:

### Caracteres y encoding
- Usa SOLO caracteres ASCII imprimibles (rango 32-126) mas tabulacion y salto de linea
- PROHIBIDO en codigo, comentarios y strings: caracteres con tildes o especiales del espanol
  - Correcto (ASCII puro): "accion", "opcion", "parametro", "funcion", "configuracion", "gestion"
- PROHIBIDO usar comillas tipograficas: usa " y ' en lugar de "" ''
- PROHIBIDO usar guiones largos: usa - en lugar de - (em dash) o - (en dash)
- PROHIBIDO usar elipsis tipografica: usa ... en lugar de ...
- PROHIBIDO incluir BOM o bytes nulos (\\0)
- Los bloques de codigo siempre con etiqueta de lenguaje: \`\`\`typescript, \`\`\`powershell, etc.

### Escapado para PowerShell
- En strings PowerShell: usa backtick (\`) para escapar $ cuando es literal
- Para rutas con espacios: usa comillas dobles "C:\\\\ruta con espacios"
- Para strings que NO deben expandir variables: usa comillas simples 'valor literal'
- Caracteres especiales en strings PS: \`, $, ", # necesitan escape con backtick dentro de comillas dobles

### Formato de salida
- Fin de linea: LF (\\n), NO CRLF
- Indentacion: espacios o tabs consistentes (no mezclar)
- Sin trailing whitespace innecesario

### Code language
- ALL code identifiers (variables, functions, classes, types, constants, parameters) and code comments MUST be in English
- Exception: string literals displayed to end users may be in the project's language

### File operations (CRITICAL)
- NEVER use execute_command or PowerShell to create or modify files (no >, Set-Content, Out-File, tee)
- ALWAYS use edit_file, multi_edit or write_file for any file modification — no exceptions
- If edit_file fails, fix the old_string match; do NOT fall back to a shell script

### Special characters in responses
- NEVER use special unicode symbols in responses or code: no box-drawing (┄ ─ ═ ║), no bullets (● ◆ ▸), no arrows (→ ←), no special markers (※ ✓ ✗)
- Use plain ASCII alternatives: -, =, *, >, x, OK`);

    if (memoryContext?.projectContext) {
        parts.push(
            `\n## 📋 Contexto del Proyecto: ${memoryContext.activeProject}\n` +
            `> Arquitectura, stack y relaciones permanentes del proyecto.\n\n` +
            memoryContext.projectContext
        );
    }
    if (memoryContext?.sessionContent) {
        parts.push(
            `\n## 🧠 Sesion Activa: ${memoryContext.activeProject}\n` +
            `> Estado actual de la sesion. Se actualiza con update_session_memory.\n\n` +
            formatSessionContext(memoryContext.sessionContent)
        );
    }
    if (memoryContext?.projectDir) {
        parts.push(
            `\n## 📝 Herramientas de Memoria\n` +
            `- \`update_session_memory\` - actualiza feature en curso, progreso, proximos pasos, issues\n` +
            `- \`update_project_context\` - actualiza stack, arquitectura, convenciones, proyectos relacionados\n` +
            `Usa update_project_context cuando el usuario informe cambios de stack, arquitectura o relaciones entre proyectos.`
        );
    }
    if (contextMarkdown) parts.push(`\n## Contexto del Proyecto\n${contextMarkdown}`);
    if (instructions?.rules?.length) parts.push(`\n## Reglas\n${instructions.rules.map(r => `- ${r}`).join('\n')}`);
    if (config.usage?.enabled && config.usage.priority === 'vault_first') {
        parts.push(`\n## Prioridad de Vault\nBusca patrones en el vault antes de generar codigo nuevo.`);
    }

    // -- Instruccion de busqueda en vault via @obsidian -------------------------
    if (vaultPath) {
        parts.push(`\n## 🔍 Busqueda en Vault
Para buscar patrones en el vault de Obsidian, incluye @obsidian en tu mensaje.
Sin @obsidian no se realiza ninguna busqueda en el vault, ahorrando tokens y tiempo.
Ejemplo: "@obsidian patron repository en TypeScript"`);
    }

    if (config.notification?.enabled) {
        parts.push(`\n## Formato\n${instructions.format.vaultCode} Codigo del vault | ${instructions.format.newExtract} Nuevo para extraer | ${instructions.format.businessSpecific} Especifico del negocio`);
    }

    // -- Instruccion de extraccion al vault (Fase 4.2) -------------------------
    if (config.extraction?.enabled && vaultPath) {
        parts.push(`\n## 📤 Extraccion de Patrones al Vault
Cuando implementes codigo que sea un patron reutilizable (value objects, aggregate roots, domain errors, configuraciones genericas, clientes HTTP, etc.):
1. Usa \`extract_to_vault\` para guardarlo en el vault.
2. La ruta debe ser dentro de \`04-Recursos/\` (ej: \`04-Recursos/Backend/Patrones/mi-patron.md\`).
3. Incluye tags relevantes (stack, tipo de patron).
4. NO extraer codigo especifico del negocio - solo lo generico y reutilizable.
5. Marca la respuesta con ${instructions.format.newExtract} cuando hayas extraido algo nuevo.`);
    }

    // -- Secciones de AGENT.md y USER.md (Fase 3.1) ---------------------------
    if (contextFiles?.agentMd) {
        parts.push(formatContextFileSection('Instrucciones del Proyecto (AGENT.md)', contextFiles.agentMd));
    }
    if (contextFiles?.userMd) {
        parts.push(formatContextFileSection('Preferencias del Desarrollador (USER.md)', contextFiles.userMd));
    }

    // -- Lecciones aprendidas de auditorias -----------------------------------
    if (lessonsMemo) {
        // Sanitizar para evitar prompt injection desde texto generado por LLM
        const sanitizedMemo = lessonsMemo
            .replace(/<\/?[a-zA-Z][^>]*>/g, '')        // strip XML/HTML tags
            .replace(/\[INST\]|\[\/INST\]/g, '')        // strip Llama tokens
            .replace(/<<SYS>>|<\/SYS>/g, '')            // strip Llama sys tokens
            .replace(/^(SYSTEM:|ASSISTANT:|USER:)\s*/gim, '') // strip role prefixes
            .slice(0, 3000);                             // truncar a 3000 chars
        parts.push(`\n## 🧠 Lecciones Aprendidas (de auditorias previas)
> Patrones de fallo y calidad detectados automaticamente en gates anteriores.
> Usalos para evitar errores ya cometidos.

${sanitizedMemo}`);
    }

    parts.push(`\n## ※ Recap al finalizar
Cuando completes trabajo concreto (codigo escrito, archivos modificados, analisis tecnico, decisiones de arquitectura), anadi al final de tu respuesta este bloque exacto:

<recap>1-2 oraciones: que hiciste y cual es el siguiente paso sugerido</recap>

El sistema extrae y formatea el recap automaticamente. No lo agregues en respuestas conversacionales, al presentar opciones o al pedir confirmacion.`);

    // Skills ya se cargan como herramientas y se inyectan contextualmente
    // cuando los triggers coinciden - no es necesario listarlos en el prompt.
    return parts.join('\n');
}

// ── Truncado inteligente de sesion-actual.md ──────────────────────────────────

const MAX_SESSION_CHARS = 3000;

/**
 * @description Si sessionContent supera MAX_SESSION_CHARS, extrae solo las
 * secciones de alta prioridad para no saturar el system prompt con historial
 * completo. Preserva siempre: Feature en Curso, Issues Activos, Proximos Pasos
 * y Aprendizajes del Engine.
 */
export function formatSessionContext(sessionContent: string): string {
    if (sessionContent.length <= MAX_SESSION_CHARS) return sessionContent;

    const critical = extractSections(sessionContent, [
        'Feature en Curso',
        'Issues Activos',
        'Próximos Pasos',
        'Aprendizajes del Engine',
    ]);

    return critical
        ? `${critical}\n\n*(sesion-actual.md truncada — usa /memory para ver completa)*`
        : sessionContent.slice(0, MAX_SESSION_CHARS) + '\n\n*(truncado)*';
}

/**
 * @description Extrae los bloques `## Titulo` indicados del contenido markdown,
 * en el orden dado. Devuelve string vacio si ninguno se encuentra.
 */
function extractSections(content: string, titles: string[]): string {
    const parts: string[] = [];
    for (const title of titles) {
        const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(## ${escaped}\\n[\\s\\S]*?)(?=\\n---\\s*\\n|\\n## |$)`);
        const match = re.exec(content);
        if (match) parts.push(match[1].trim());
    }
    return parts.join('\n\n---\n\n');
}
