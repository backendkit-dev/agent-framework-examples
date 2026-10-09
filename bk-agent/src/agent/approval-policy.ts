/**
 * @description Politica de aprobacion de herramientas del CLI.
 *
 * Vive en `src/` (y no embebida en `bin/cli.ts`) para poder testearse: el
 * entrypoint no tiene cobertura y estas decisiones son de seguridad.
 *
 * Reglas:
 * - Las herramientas que mutan el sistema (escritura/ejecucion) requieren
 *   aprobacion explicita. En `--headless` se DENIEGAN salvo `autoApprove`.
 * - Las operaciones irreversibles (instalar/quitar paquetes) se preguntan
 *   SIEMPRE, aunque el usuario haya elegido "aprobar todo".
 * - Las herramientas de solo lectura se ejecutan sin preguntar.
 */

/** Herramientas que pueden modificar el sistema y por eso se confirman. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
    'write_file',
    'edit_file',
    'run_command',
]);

/**
 * Espejo de `ApprovalGate.ALWAYS_ASK_PATTERNS` del framework: operaciones de
 * alto impacto que se confirman siempre, incluso con `allowAll` activo.
 */
export const ALWAYS_ASK_PATTERNS: readonly RegExp[] = [
    /^\s*npm\s+(install|i|add)\s+[^-]/i,
    /^\s*npm\s+uninstall\b/i,
    /^\s*yarn\s+add\s+[^-]/i,
    /^\s*pnpm\s+add\s+[^-]/i,
    /^\s*pip\s+install\b/i,
    /^\s*pip3\s+install\b/i,
];

export type ApprovalDecision = 'approve' | 'approve_all' | 'reject' | 'ask';

export interface ApprovalPolicyInput {
    /** true cuando el CLI corre en modo headless (JSON-Lines por stdin). */
    headless: boolean;
    /** true solo si el usuario paso --auto-approve explicitamente. */
    autoApprove: boolean;
    toolName: string;
    /** Preview de argumentos que entrega el gate del framework. */
    argsPreview: string;
    /** true si el usuario ya eligio "aprobar todo" en esta sesion. */
    allowAll: boolean;
}

/**
 * @description Decide la aprobacion sin intervencion del usuario.
 * Devuelve 'ask' cuando hace falta preguntarle (modo interactivo).
 */
export function decideApproval(input: ApprovalPolicyInput): ApprovalDecision {
    const { headless, autoApprove, toolName, argsPreview, allowAll } = input;
    const mutating = isMutatingTool(toolName);
    const alwaysAsk = requiresAlwaysAsk(toolName, argsPreview);

    if (headless) {
        // Fail-closed: sin --auto-approve, headless no muta nada.
        if (autoApprove || !mutating) return 'approve';
        return 'reject';
    }

    // Las herramientas de solo lectura nunca interrumpen al usuario, incluso si
    // el gate las consulta (hoy solo consulta las que mutan).
    if (!mutating) return 'approve';

    // El permiso global no cubre las operaciones irreversibles.
    if (allowAll && !alwaysAsk) return 'approve_all';
    return 'ask';
}

export interface UserAnswerResult {
    decision: 'approve' | 'approve_all' | 'reject';
    /** Nuevo valor de `allowAll`: solo se activa si la respuesta lo habilita. */
    allowAll: boolean;
}

/**
 * @description Traduce la respuesta del usuario a una decision.
 * "all" no activa el permiso global si la operacion es de las que preguntan siempre.
 */
export function decisionFromUserAnswer(answer: 'yes' | 'no' | 'all', alwaysAsk: boolean): UserAnswerResult {
    if (answer === 'no') return { decision: 'reject', allowAll: false };
    if (answer === 'all' && !alwaysAsk) return { decision: 'approve_all', allowAll: true };
    return { decision: 'approve', allowAll: false };
}

export function isMutatingTool(toolName: string): boolean {
    return MUTATING_TOOLS.has(toolName);
}

/**
 * @description true si el comando es una operacion irreversible que debe
 * confirmarse siempre (instalacion/desinstalacion de paquetes).
 */
export function requiresAlwaysAsk(toolName: string, argsPreview: string): boolean {
    if (toolName !== 'run_command') return false;
    let command = argsPreview;
    // El gate entrega el JSON de argumentos; si se puede parsear, usamos `command`.
    try {
        const parsed = JSON.parse(argsPreview) as { command?: unknown };
        if (typeof parsed?.command === 'string') command = parsed.command;
    } catch {
        /* preview truncado o no-JSON: se evalua el texto crudo */
    }
    return ALWAYS_ASK_PATTERNS.some((re) => re.test(command));
}
