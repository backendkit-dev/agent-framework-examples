/**
 * @description Aplica los guards de archivos a las herramientas del framework.
 *
 * Contexto (hallazgo N-8 de la auditoria): `createCodingEngine` pasa
 * `tools: CODING_TOOLS` a `createBaseEngine`, que itera ese **mismo array** al
 * construir su registro interno. No hay API publica para inyectar herramientas
 * (`AgentEngine.tools` figura en los .d.ts pero no existe en runtime).
 *
 * Mientras eso no cambie upstream, este modulo reemplaza **in situ** la entrada
 * de cada herramienta de archivos dentro del array exportado, antes de crear el
 * engine. Es una medida temporal, contenida y verificable:
 *
 *  - `guardFileTools` conserva nombre, descripcion y schema originales, y delega
 *    en la implementacion del framework cuando la llamada es legitima;
 *  - si una herramienta no aparece en el array, se informa en `missing` y el CLI
 *    lo avisa por consola (nunca falla en silencio);
 *  - se retira en cuanto `CodingEngineOptions` acepte `tools`/`extraTools`.
 */

import { FILE_TOOL_ARG, guardFileTools, ToolDefinitionLike, ToolRegistryLike, ToolGuardsOptions } from './tool-guards';

/** Registro sobre un array de definiciones (el array que comparte el framework). */
class ArrayToolRegistry implements ToolRegistryLike {
    /** Indice que ocupaba cada herramienta desregistrada, para devolverla a su sitio. */
    private readonly removedIndex = new Map<string, number>();

    constructor(private readonly tools: ToolDefinitionLike[]) {}

    get(name: string): ToolDefinitionLike | undefined {
        return this.tools.find((t) => t.name === name);
    }

    unregister(name: string): void {
        const index = this.tools.findIndex((t) => t.name === name);
        if (index >= 0) {
            this.removedIndex.set(name, index);
            this.tools.splice(index, 1);
        }
    }

    register(tool: ToolDefinitionLike): void {
        // Se reinserta en la posicion original para no alterar el orden que ve el modelo.
        const previous = this.removedIndex.get(tool.name);
        if (previous !== undefined) {
            this.tools.splice(Math.min(previous, this.tools.length), 0, tool);
            this.removedIndex.delete(tool.name);
            return;
        }
        const existing = this.tools.findIndex((t) => t.name === tool.name);
        if (existing >= 0) this.tools[existing] = tool;
        else this.tools.push(tool);
    }
}

export interface ApplyToolGuardsResult {
    /** Herramientas efectivamente envueltas. */
    applied: string[];
    /** Herramientas esperadas que no estaban en el array (el guard NO esta activo para ellas). */
    missing: string[];
}

/**
 * @description Sustituye las herramientas de archivos del array compartido por
 * versiones con contencion canonica y aprobacion de rutas sensibles.
 * Devuelve que se aplico y que falto, para poder avisar al usuario.
 */
export function applyToolGuards(
    tools: ToolDefinitionLike[],
    options: ToolGuardsOptions,
): ApplyToolGuardsResult {
    if (!Array.isArray(tools)) {
        return { applied: [], missing: Object.keys(FILE_TOOL_ARG) };
    }

    const applied = guardFileTools(new ArrayToolRegistry(tools), options);
    const missing = Object.keys(FILE_TOOL_ARG).filter((name) => !applied.includes(name));
    return { applied, missing };
}
