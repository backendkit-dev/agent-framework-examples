/**
 * @description Aprobaciones que el framework no cubre por si mismo.
 *
 * Hallazgo M-7 de la auditoria: `ApprovalGate` solo pide confirmacion para tres
 * nombres fijos (`write_file`, `edit_file`, `run_command`). Quedaban fuera:
 *
 *  1. **Tools de servidores MCP** (`docker`, `design`, `curator…`): pueden publicar
 *     en Slack, escribir en una base de datos o tocar un cluster, y se ejecutaban
 *     sin preguntar incluso en modo interactivo.
 *  2. **Tools de estado del framework** (`save_context`, `save_learning`,
 *     `save_audit`, `save_user_preference`, `update_session`): escriben en la
 *     memoria/auditoria del proyecto, que se reinyecta en prompts posteriores
 *     (vector de persistencia de contenido no confiable).
 *
 * `AgentEngine.approvalGate` es accesible en runtime y su `check()` es el paso
 * obligado de toda tool call, asi que este modulo envuelve ese metodo para:
 *
 *  - pedir aprobacion en los dos casos anteriores;
 *  - **no** preguntar si la tool MCP declara `annotations.readOnlyHint === true`
 *    (leer no es un efecto lateral) ni si el usuario ya eligio el modo `auto`
 *    (el framework deja el gate `disabled`);
 *  - delegar en la implementacion original en cualquier otro caso.
 */

export type GateDecision = 'run' | 'rejected';

export interface ToolCallLike {
    name: string;
    args: string;
}

export interface ApprovalGateLike {
    check(call: ToolCallLike, agentId: string): Promise<GateDecision>;
    disabled?: boolean;
}

export interface McpToolLike {
    name: string;
    annotations?: { readOnlyHint?: boolean } | null;
}

export interface McpManagerLike {
    getTools(): McpToolLike[];
}

export interface EngineWithGate {
    approvalGate?: ApprovalGateLike;
    getMCPManager?: () => McpManagerLike | undefined;
}

export interface ExtraApprovalOptions {
    /** Decide si se permite ejecutar la tool. `argsPreview` es el JSON de argumentos (truncado). */
    onApproval: (toolName: string, argsPreview: string) => Promise<boolean>;
    log?: (message: string) => void;
}

export interface ApplyExtraApprovalsResult {
    applied: boolean;
    /** Motivo por el que no se pudo aplicar (el guard NO esta activo). */
    reason?: string;
}

/**
 * Tools del framework que escriben estado persistente del proyecto y que su
 * `ApprovalGate` no cubre. `update_session` y `save_context` son las que
 * reinyectan contenido en prompts posteriores.
 */
export const STATE_WRITE_TOOLS: ReadonlySet<string> = new Set([
    'save_context',
    'save_learning',
    'save_audit',
    'save_user_preference',
    'update_session',
]);

/** true si la tool viene de un servidor MCP conectado. */
export function isMcpTool(manager: McpManagerLike | undefined, toolName: string): boolean {
    const tools = manager?.getTools?.() ?? [];
    return tools.some((t) => t.name === toolName);
}

/** true si la tool declara explicitamente que solo lee. */
export function isReadOnlyTool(manager: McpManagerLike | undefined, toolName: string): boolean {
    const tools = manager?.getTools?.() ?? [];
    const tool = tools.find((t) => t.name === toolName);
    return tool?.annotations?.readOnlyHint === true;
}

/**
 * @description Decide si una tool call necesita aprobacion extra.
 * `reason` es informativo (se muestra en el prompt).
 */
export function needsExtraApproval(
    manager: McpManagerLike | undefined,
    toolName: string,
): { needed: boolean; reason?: 'mcp' | 'state-write' } {
    if (STATE_WRITE_TOOLS.has(toolName)) return { needed: true, reason: 'state-write' };
    if (isMcpTool(manager, toolName) && !isReadOnlyTool(manager, toolName)) return { needed: true, reason: 'mcp' };
    return { needed: false };
}

/**
 * @description Envuelve `engine.approvalGate.check` para cubrir las tools MCP y
 * las de estado del framework. Devuelve si se pudo aplicar; nunca falla en
 * silencio (el caller avisa al usuario).
 */
export function applyExtraApprovals(
    engine: EngineWithGate,
    options: ExtraApprovalOptions,
): ApplyExtraApprovalsResult {
    const gate = engine?.approvalGate;
    if (!gate || typeof gate.check !== 'function') {
        return { applied: false, reason: 'el engine no expone approvalGate.check' };
    }
    if (typeof engine.getMCPManager !== 'function') {
        return { applied: false, reason: 'el engine no expone getMCPManager (no se pueden identificar las tools MCP)' };
    }

    const originalCheck = gate.check.bind(gate);

    gate.check = async (call: ToolCallLike, agentId: string): Promise<GateDecision> => {
        try {
            // Modo auto: el framework desactivo el gate; se respeta la eleccion.
            if (gate.disabled) return originalCheck(call, agentId);

            const manager = engine.getMCPManager?.();
            const { needed } = needsExtraApproval(manager, call?.name);
            if (needed) {
                const approved = await options.onApproval(call.name, String(call.args ?? '').slice(0, 200));
                return approved ? 'run' : 'rejected';
            }
        } catch (error) {
            // Ante un fallo del guard, no se bloquea el trabajo del usuario: se
            // delega en el gate original (que ya cubre las mutaciones conocidas).
            options.log?.(`[extra-approvals] no se pudo evaluar ${call?.name}: ${(error as Error)?.message}`);
        }
        return originalCheck(call, agentId);
    };

    options.log?.('[extra-approvals] approvalGate.check envuelto: tools MCP y de estado piden aprobacion');
    return { applied: true };
}
