/**
 * @description Superficie publica del paquete.
 *
 * bk-agent es un CLI: el runtime de agentes (loop, orquestador, motor de
 * reflexion) vive en `@backendkit-labs/agent-core` / `agent-coding`. Aqui se
 * exporta solo lo que este repositorio mantiene y testea: la politica de
 * aprobacion, el saneado de terminal, el encoding/escritura de archivos y los
 * tipos de configuracion.
 *
 * `AgentLoop`/`AgentClient` (implementacion previa al framework) quedaron en
 * `legacy/` y ya no se exportan.
 */
export {
    decideApproval,
    decisionFromUserAnswer,
    requiresAlwaysAsk,
    isMutatingTool,
    MUTATING_TOOLS,
    ALWAYS_ASK_PATTERNS,
} from './agent/approval-policy';
export type { ApprovalDecision, ApprovalPolicyInput } from './agent/approval-policy';

export { stripTerminalEscapes, sanitizeSingleLine } from './shared/utils/sanitize-terminal';

export {
    setupConsoleEncoding,
    sanitizeForConsole,
    sanitizeCodeOutput,
    readFileSafe,
    readFileSafeAsync,
    writeFileSafe,
    writeFileSafeAsync,
} from './shared/utils/encoding';
export { atomicWrite, atomicWriteSync } from './shared/utils/atomic-write';
export { LRUCache } from './shared/utils/lru-cache';

export { HeadlessStreamFilter } from './ui/headless-stream';
export type { HeadlessEmission } from './ui/headless-stream';

/**
 * Endurecimiento de las tools de archivos (contencion canonica de symlinks y
 * aprobacion de rutas sensibles). **No lo aplica el CLI todavia**: requiere que
 * `createCodingEngine` acepte `tools`/`extraTools` en `CodingEngineOptions`
 * (hoy pasa `CODING_TOOLS` fijo y el registro no es accesible). Se exporta para
 * que cualquier consumidor que arme su engine con `createBaseEngine` pueda
 * usarlo ya, y para que el framework lo adopte con sus tests.
 */
export { guardFileTools, checkCanonicalContainment, isInside, FILE_TOOL_ARG } from './security/tool-guards';
export type { ToolRegistryLike, ToolDefinitionLike, ToolGuardsOptions } from './security/tool-guards';
export { isSensitivePath, SENSITIVE_PATH_PATTERNS } from './security/sensitive-paths';
export {
    applyExtraApprovals,
    needsExtraApproval,
    isMcpTool,
    isReadOnlyTool,
    STATE_WRITE_TOOLS,
} from './security/apply-extra-approvals';
export type { EngineWithGate, ExtraApprovalOptions } from './security/apply-extra-approvals';
export { applyToolGuards } from './security/apply-tool-guards';

export {
    parseDesignState,
    readDesignState,
    designStatePath,
    findPhase,
    allPhasesComplete,
    nextPendingPhase,
    phaseIcon,
    renderRoadmapLines,
    parseQaVerdict,
    buildQaRunPrompt,
} from './spec/design-state';
export type { DesignPhase, DesignState, QaVerdict } from './spec/design-state';

export * from './types/config';
