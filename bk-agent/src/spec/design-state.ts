/**
 * @description Estado del flujo spec-driven (`/spec.*`).
 *
 * El plugin MCP `design` mantiene `design.json` dentro del directorio de proyecto
 * del framework. Estas funciones lo leen, lo **validan** y derivan lo que los
 * comandos necesitan (fase actual, siguiente fase pendiente, render del roadmap,
 * veredicto de QA).
 *
 * Vive en `src/` y no embebido en `bin/cli.ts` por dos motivos:
 *   1. es lógica pura y el entrypoint no tenía cobertura;
 *   2. antes se hacía `JSON.parse` sin validar y luego `state.phases.find(...)`, así
 *      que un `design.json` vacío o corrupto rompía el comando con un TypeError.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProjectDir } from '@backendkit-labs/agent-core';

export interface DesignPhase {
    number: number;
    name: string;
    status?: string;
    stage?: string;
    description?: string;
    criteria?: string[];
    log?: string[];
}

export interface DesignState {
    project?: string;
    currentPhase?: number;
    phases: DesignPhase[];
}

export type QaVerdict = 'GO' | 'NO-GO' | 'unknown';

/** Nombre del archivo de estado que escribe el plugin design. */
export const DESIGN_FILE = 'design.json';

/**
 * @description Valida y normaliza el contenido de `design.json`.
 * Devuelve `null` si no tiene la forma esperada (en lugar de romper más adelante).
 */
export function parseDesignState(raw: unknown): DesignState | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;
    if (!Array.isArray(candidate.phases)) return null;

    const phases: DesignPhase[] = [];
    for (const item of candidate.phases) {
        if (!item || typeof item !== 'object') return null;
        const phase = item as Record<string, unknown>;
        if (typeof phase.number !== 'number' || Number.isNaN(phase.number)) return null;
        phases.push({
            number: phase.number,
            name: typeof phase.name === 'string' ? phase.name : `Fase ${phase.number}`,
            ...(typeof phase.status === 'string' ? { status: phase.status } : {}),
            ...(typeof phase.stage === 'string' ? { stage: phase.stage } : {}),
            ...(typeof phase.description === 'string' ? { description: phase.description } : {}),
            ...(Array.isArray(phase.criteria)
                ? { criteria: phase.criteria.filter((c): c is string => typeof c === 'string') }
                : {}),
            ...(Array.isArray(phase.log)
                ? { log: phase.log.filter((l): l is string => typeof l === 'string') }
                : {}),
        });
    }

    return {
        ...(typeof candidate.project === 'string' ? { project: candidate.project } : {}),
        ...(typeof candidate.currentPhase === 'number' ? { currentPhase: candidate.currentPhase } : {}),
        phases,
    };
}

/** Ruta del `design.json` del proyecto indicado. */
export function designStatePath(projectDir: string): string {
    return path.join(getProjectDir('bk-agent', projectDir), DESIGN_FILE);
}

/**
 * @description Lee el estado del proyecto. `null` si no existe, no es JSON válido
 * o no tiene la forma esperada.
 */
export function readDesignState(projectDir: string): DesignState | null {
    const file = designStatePath(projectDir);
    if (!fs.existsSync(file)) return null;
    try {
        return parseDesignState(JSON.parse(fs.readFileSync(file, 'utf-8')));
    } catch {
        return null;
    }
}

/** @description Fase con ese numero, o la fase actual del estado. */
export function findPhase(state: DesignState, phaseNumber?: number): DesignPhase | undefined {
    const target = phaseNumber ?? state.currentPhase;
    if (typeof target !== 'number') return undefined;
    return state.phases.find((p) => p.number === target);
}

/** @description true si todas las fases estan completas. */
export function allPhasesComplete(state: DesignState): boolean {
    return state.phases.length > 0 && state.phases.every((p) => p.status === 'complete');
}

/** @description Primera fase que no esta completa, en orden de numero. */
export function nextPendingPhase(state: DesignState): DesignPhase | undefined {
    return [...state.phases].sort((a, b) => a.number - b.number).find((p) => p.status !== 'complete');
}

export function phaseIcon(status?: string): string {
    if (status === 'complete') return '✓';
    if (status === 'in_progress') return '◉';
    if (status === 'blocked') return '✗';
    return '○';
}

/** @description Lineas de resumen del roadmap (una por fase) para la terminal. */
export function renderRoadmapLines(state: DesignState): string[] {
    const done = state.phases.filter((p) => p.status === 'complete').length;
    const lines = [`Roadmap: ${state.project ?? '(sin nombre)'}  [${done}/${state.phases.length} fases]`, ''];
    for (const phase of [...state.phases].sort((a, b) => a.number - b.number)) {
        lines.push(`  ${phaseIcon(phase.status)}  ${phase.number}. ${phase.name}`);
    }
    return lines;
}

/**
 * @description Interpreta el veredicto de un reporte de QA.
 * Se comprueba `NO-GO` **antes** que `GO` porque "NO-GO" contiene "GO".
 */
export function parseQaVerdict(content: string | null | undefined): QaVerdict {
    if (!content) return 'unknown';
    if (/VEREDICTO:\s*NO-GO/i.test(content)) return 'NO-GO';
    if (/VEREDICTO:\s*GO/i.test(content)) return 'GO';
    return 'unknown';
}

/**
 * @description Prompt de evaluacion de una fase (lo consume el agente de QA).
 * Se conserva literal para no cambiar el comportamiento del flujo.
 */
export function buildQaRunPrompt(dir: string, phase: DesignPhase): string {
    const criteria = phase.criteria?.length ? phase.criteria : ['ver specification.md'];
    return `Evalúa la Fase ${phase.number} "${phase.name}" del proyecto en "${dir}".` +
        `\nEtapa actual: ${phase.stage}.` +
        `\n` +
        `\n## Paso 1 — Criterios funcionales` +
        `\nVerifica cada criterio con evidencia concreta (lee los archivos, ejecuta comandos):` +
        `\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}` +
        `\n` +
        `\n## Paso 2 — Cumplimiento de decisiones de diseño (ADRs)` +
        `\nLee "${dir}/design.md". Identifica todas las decisiones técnicas: librerías a usar, patrones arquitectónicos, restricciones.` +
        `\nPara cada decisión que especifique una librería o módulo:` +
        `\n- Busca con grep/search si esa librería aparece en imports dentro de src/ (no solo en package.json).` +
        `\n- Si design.md dice "usar X" pero X no aparece en ningún import de src/, eso es una violación grave — VEREDICTO: NO-GO.` +
        `\n- Muestra evidencia: qué archivos la importan, o confirma que no hay ninguno.` +
        `\n` +
        `\n## Reporte final` +
        `\nGuarda el reporte completo en "${dir}/qa-phase${phase.number}.md" con:` +
        `\n- Resultado de cada criterio (✅/❌ + evidencia)` +
        `\n- Resultado de cada ADR verificado (✅/❌ + archivos que lo cumplen o no)` +
        `\n- Plan de remediación si hay violaciones` +
        `\n- Última línea: "VEREDICTO: GO" o "VEREDICTO: NO-GO — [razón principal]"` +
        `\nIMPORTANTE: Solo evalúa — NO llames design_advance, design_next ni design_init.`;
}
