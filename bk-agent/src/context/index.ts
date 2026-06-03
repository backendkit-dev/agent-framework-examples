/**
 * @description Modulo de contexto - Context Pipeline determinista.
 * El pipeline orquesta la carga de 5 stages de informacion que se
 * inyectan en el system prompt del agente, garantizando que el LLM
 * tenga el contexto necesario sin tener que decidir voluntariamente
 * leer archivos adicionales.
 *
 * Cada stage tiene:
 * - Fuente determinista (archivo + mtime)
 * - Checksum para cache
 * - Fallo silencioso (stage continua con null)
 *
 * Stages:
 * 1. stage-instructions  -> AGENT.md + USER.md
 * 2. stage-project       -> contexto-proyecto.md
 * 3. stage-session       -> sesion-actual.md
 * 4. stage-manifest      -> manifest.yaml
 * 5. stage-lessons       -> lessons-fingerprints.json + lecciones-aprendidas.md
 */

export {
    runContextPipeline,
    formatPipelineForPrompt,
    StageCache,
} from './pipeline';

export type {
    PipelineResult,
    PipelineConfig,
    PipelineChecksums,
} from './pipeline';

export type { InstructionsResult } from './stages/stage-instructions';
export type { ProjectResult } from './stages/stage-project';
export type { SessionResult } from './stages/stage-session';
export type { ManifestResult } from './stages/stage-manifest';
export type { LessonsResult } from './stages/stage-lessons';
