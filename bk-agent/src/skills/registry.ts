import { ToolResult } from '../tools/types';

type Handler = (args: any) => Promise<string>;
const registry = new Map<string, Handler>();
export function registerSkillHandler(name: string, fn: Handler) { registry.set(name, fn); }
export function getSkillHandler(name: string) { return registry.get(name); }

/** Retorna el resultado de un handler como ToolResult. */
export async function executeSkillHandler(name: string, args: any): Promise<ToolResult<string>> {
    const handler = getSkillHandler(name);
    if (!handler) return ToolResult.fail(`Handler no registrado: ${name}`);
    try {
        const data = await handler(args);
        return ToolResult.success(data);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return ToolResult.fail(`Error en handler '${name}': ${msg}`);
    }
}

/**
 * Elimina caracteres inseguros del nombre del handler para prevenir
 * inyeccion por nombre malicioso. Usado en tool-executor antes de buscar handler.
 */
export function sanitizeHandlerName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function clearRegistry(): void {
    registry.clear();
}
