/**
 * @description Context Pipeline - Orquestador principal de carga de contexto.
 * Determina que informacion se inyecta en el system prompt del agente,
 * en que orden y con que cache, sin depender de que el LLM decida
 * voluntariamente leer archivos adicionales.
 *
 * Cada stage:
 * 1. Tiene una fuente determinista (archivo + mtime)
 * 2. Retorna datos estructurados con un checksum
 * 3. Se salta si el checksum no cambio desde la ultima ejecucion
 * 4. Puede fallar silenciosamente (stage continua con null)
 */

import { runStageInstructions, InstructionsResult } from './stages/stage-instructions';
import { runStageProject, ProjectResult } from './stages/stage-project';
import { runStageSession, SessionResult } from './stages/stage-session';
import { runStageManifest, ManifestResult } from './stages/stage-manifest';
import { runStageLessons, LessonsResult } from './stages/stage-lessons';

// ── Tipos publicos ────────────────────────────────────────────────────────────

export interface PipelineResult {
    /** Contexto de instrucciones (AGENT.md + USER.md) */
    instructions: InstructionsResult;
    /** Contexto del proyecto (stack, arquitectura, convenciones) */
    project: ProjectResult;
    /** Estado de sesion actual (feature en curso, progreso) */
    session: SessionResult;
    /** Configuracion global manifest.yaml */
    manifest: ManifestResult;
    /** Lecciones aprendidas del sistema */
    lessons: LessonsResult;
    /** Metadatos del pipeline */
    meta: {
        /** Timestamp de ejecucion */
        executedAt: string;
        /** Stages que cambiaron desde la ultima ejecucion */
        changedStages: string[];
        /** Tiempo total de ejecucion en ms */
        elapsedMs: number;
    };
}

/** Checksums de cada stage para detectar cambios */
export interface PipelineChecksums {
    instructions: string;
    project: string;
    session: string;
    manifest: string;
    lessons: string;
}

// ── Cache de stage individual ─────────────────────────────────────────────────

interface StageCacheEntry<T> {
    checksum: string;
    data: T;
}

export class StageCache {
    private store = new Map<string, StageCacheEntry<unknown>>();

    get<T>(key: string): StageCacheEntry<T> | null {
        const entry = this.store.get(key);
        return entry ? (entry as StageCacheEntry<T>) : null;
    }

    set<T>(key: string, checksum: string, data: T): void {
        this.store.set(key, { checksum, data });
    }

    getChecksums(): PipelineChecksums {
        return {
            instructions: (this.store.get('instructions')?.checksum as string) ?? '',
            project: (this.store.get('project')?.checksum as string) ?? '',
            session: (this.store.get('session')?.checksum as string) ?? '',
            manifest: (this.store.get('manifest')?.checksum as string) ?? '',
            lessons: (this.store.get('lessons')?.checksum as string) ?? '',
        };
    }
}

// ── Configuracion del pipeline ────────────────────────────────────────────────

export interface PipelineConfig {
    /** Directorio del proyecto (default: process.cwd()) */
    cwd?: string;
    /** Cache opcional para reutilizar entre ejecuciones */
    cache?: StageCache;
    /** Si true, fuerza recarga de todos los stages ignorando cache */
    forceRefresh?: boolean;
}

// ── Pipeline principal ────────────────────────────────────────────────────────

/**
 * @description Ejecuta el pipeline completo de carga de contexto.
 * Cada stage se ejecuta secuencialmente y retorna sus datos estructurados.
 * Si hay cache y el checksum no cambio, se salta el stage.
 *
 * @returns PipelineResult con todos los contextos cargados y metadatos
 */
export async function runContextPipeline(config?: PipelineConfig): Promise<PipelineResult> {
    const start = Date.now();
    const cache = config?.cache ?? new StageCache();
    const cwd = config?.cwd ?? process.cwd();
    const forceRefresh = config?.forceRefresh ?? false;

    const changedStages: string[] = [];

    // Stage 1: Instrucciones (AGENT.md + USER.md)
    const instructionsResult = await runStageWithCache(
        'instructions',
        cache,
        forceRefresh,
        () => runStageInstructions(cwd),
        (checksum) => changedStages.push('instructions')
    );

    // Stage 2: Proyecto (contexto-proyecto.md)
    const projectResult = await runStageWithCache(
        'project',
        cache,
        forceRefresh,
        () => runStageProject(cwd),
        (checksum) => changedStages.push('project')
    );

    // Stage 3: Sesion (sesion-actual.md)
    const sessionResult = await runStageWithCache(
        'session',
        cache,
        forceRefresh,
        () => runStageSession(cwd),
        (checksum) => changedStages.push('session')
    );

    // Stage 4: Manifest (manifest.yaml)
    const manifestResult = await runStageWithCache(
        'manifest',
        cache,
        forceRefresh,
        () => runStageManifest(),
        (checksum) => changedStages.push('manifest')
    );

    // Stage 5: Lecciones (lessons-fingerprints.json + lecciones-aprendidas.md)
    const lessonsResult = await runStageWithCache(
        'lessons',
        cache,
        forceRefresh,
        () => runStageLessons(cwd),
        (checksum) => changedStages.push('lessons')
    );

    const elapsedMs = Date.now() - start;

    return {
        instructions: instructionsResult,
        project: projectResult,
        session: sessionResult,
        manifest: manifestResult,
        lessons: lessonsResult,
        meta: {
            executedAt: new Date().toISOString(),
            changedStages,
            elapsedMs,
        },
    };
}

/**
 * @description Ejecuta un stage con soporte de cache.
 * Si el checksum no cambio y no se forceRefresh, retorna datos cacheados.
 */
async function runStageWithCache<T>(
    key: string,
    cache: StageCache,
    forceRefresh: boolean,
    runner: () => Promise<{ checksum: string; data: T }>,
    onChanged: (checksum: string) => void
): Promise<T> {
    if (!forceRefresh) {
        const cached = cache.get<T>(key);
        if (cached) {
            // Ejecutar rapido solo para obtener checksum sin IO pesado
            const fresh = await runner();
            if (fresh.checksum === cached.checksum) {
                return cached.data;
            }
            // Checksum diferente: actualizar cache
            cache.set(key, fresh.checksum, fresh.data);
            onChanged(fresh.checksum);
            return fresh.data;
        }
    }

    // Sin cache: ejecutar normal
    const fresh = await runner();
    cache.set(key, fresh.checksum, fresh.data);
    onChanged(fresh.checksum);
    return fresh.data;
}

/**
 * @description Convierte el resultado del pipeline en secciones formateadas
 * para inyectar en el system prompt.
 * Cada seccion se incluye solo si tiene contenido relevante.
 */
export function formatPipelineForPrompt(result: PipelineResult): string[] {
    const sections: string[] = [];

    // Instrucciones del proyecto (AGENT.md)
    if (result.instructions.agentMd) {
        sections.push(formatSection('Instrucciones del Proyecto (AGENT.md)', result.instructions.agentMd));
    }

    // Preferencias del desarrollador (USER.md)
    if (result.instructions.userMd) {
        sections.push(formatSection('Preferencias del Desarrollador (USER.md)', result.instructions.userMd));
    }

    // Contexto del proyecto
    if (result.project.content) {
        sections.push(formatSection('Contexto del Proyecto', result.project.content));
    }

    // Sesion activa
    if (result.session.content) {
        sections.push(formatSection('Sesion Activa', result.session.content));
    }

    // Lecciones aprendidas (solo las relevantes)
    if (result.lessons.memo) {
        const sanitized = result.lessons.memo
            .replace(/<\/?[a-zA-Z][^>]*>/g, '')
            .replace(/\[INST\]|\[\/INST\]/g, '')
            .replace(/<<SYS>>|<\/SYS>/g, '')
            .replace(/^(SYSTEM:|ASSISTANT:|USER:)\s*/gim, '')
            .slice(0, 3000);
        sections.push(formatSection('Lecciones Aprendidas (de auditorias previas)', sanitized));
    }

    return sections;
}

function formatSection(title: string, content: string): string {
    return [
        '',
        `## ${title}`,
        '> Cargado por el Context Pipeline',
        '',
        content.trim(),
        '',
    ].join('\n');
}
