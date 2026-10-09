/**
 * @description Endurecimiento local de las tools de archivos del framework.
 *
 * El motor trae sus propias tools (`read_file`, `write_file`, `edit_file`,
 * `list_directory`) y su sandbox de rutas, pero ese sandbox es **lexico**
 * (`path.resolve` + comparacion de prefijos): un symlink o un junction dentro
 * del directorio de trabajo permite leer y escribir fuera de el. Ademas
 * `read_file` no distingue archivos con credenciales.
 *
 * Como `AgentEngine.tools` es un registro publico, el CLI puede envolver esas
 * tools sin duplicar su logica: se conserva la implementacion original y solo se
 * agrega un pre-chequeo de contencion canonica y, en lectura, la aprobacion para
 * rutas sensibles.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isSensitivePath } from './sensitive-paths';

/** Argumento que contiene la ruta en cada tool envuelta. */
export const FILE_TOOL_ARG: Record<string, string> = {
    read_file: 'file_path',
    write_file: 'file_path',
    edit_file: 'file_path',
    list_directory: 'path',
};

export interface ToolDefinitionLike {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(args: unknown, ctx: ToolContextLike): Promise<string>;
}

export interface ToolContextLike {
    workingDir?: string;
    additionalRoots?: string[];
}

export interface ToolRegistryLike {
    get(name: string): ToolDefinitionLike | undefined;
    unregister(name: string): void;
    register(tool: ToolDefinitionLike): unknown;
}

export interface ToolGuardsOptions {
    /**
     * Decide si se permite leer un archivo marcado como sensible.
     * En modo interactivo pregunta al usuario; en headless deniega salvo
     * `--auto-approve` (lo decide el caller).
     */
    onSensitiveRead: (filePath: string) => Promise<boolean>;
    /** Log de diagnóstico (una linea por tool envuelta). */
    log?: (message: string) => void;
}

/**
 * @description Comprueba que `target` (resuelto dentro de alguna de las raices)
 * siga estando dentro de ellas **tras canonicalizar** symlinks y junctions.
 * Devuelve `ok: false` cuando la ruta escapa o cuando no se puede canonicalizar.
 */
export function checkCanonicalContainment(
    roots: readonly string[],
    target: string,
): { ok: boolean; resolved: string } {
    const usableRoots = roots.filter((r): r is string => typeof r === 'string' && r.length > 0);
    if (usableRoots.length === 0) return { ok: true, resolved: target }; // sin raices: no opinamos

    const base = usableRoots[0];
    const absolute = path.resolve(base, target);

    for (const root of usableRoots) {
        const realRoot = canonicalize(root);
        const realTarget = canonicalizeMissing(absolute);
        if (isInside(realRoot, realTarget)) return { ok: true, resolved: realTarget };
    }
    return { ok: false, resolved: canonicalizeMissing(absolute) };
}

/** `realpath` tolerante: si falla, devuelve la ruta resuelta sin canonicalizar. */
function canonicalize(p: string): string {
    try {
        return fs.realpathSync.native(p);
    } catch {
        return path.resolve(p);
    }
}

/**
 * Canonicaliza la parte existente mas profunda y le vuelve a pegar el resto.
 * Permite validar rutas de archivos que todavia no existen (write_file).
 */
export function canonicalizeMissing(absolute: string): string {
    let existing = absolute;
    let rest = '';
    // Sube hasta encontrar un ancestro existente.
    for (;;) {
        if (fs.existsSync(existing)) break;
        const parent = path.dirname(existing);
        if (parent === existing) break;
        rest = rest ? path.join(path.basename(existing), rest) : path.basename(existing);
        existing = parent;
    }
    const realExisting = canonicalize(existing);
    return rest ? path.join(realExisting, rest) : realExisting;
}

/** Comparacion case-insensitive en Windows, por segmentos (no por prefijo de string). */
export function isInside(root: string, candidate: string): boolean {
    const norm = (p: string) => {
        const abs = path.resolve(p);
        return process.platform === 'win32' ? abs.toLowerCase() : abs;
    };
    const r = norm(root);
    const c = norm(candidate);
    if (r === c) return true;
    const rel = path.relative(r, c);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * @description Envuelve las tools de archivos registradas en el engine.
 * Devuelve los nombres efectivamente envueltos.
 */
export function guardFileTools(registry: ToolRegistryLike, options: ToolGuardsOptions): string[] {
    const wrapped: string[] = [];

    for (const [name, argKey] of Object.entries(FILE_TOOL_ARG)) {
        const original = registry.get(name);
        if (!original) continue;

        registry.unregister(name);
        registry.register({
            ...original,
            execute: async (args: unknown, ctx: ToolContextLike): Promise<string> => {
                const raw = (args as Record<string, unknown> | null)?.[argKey];
                if (typeof raw === 'string' && raw.length > 0) {
                    const roots = [ctx?.workingDir, ...(ctx?.additionalRoots ?? [])].filter(
                        (r): r is string => typeof r === 'string' && r.length > 0,
                    );
                    const containment = checkCanonicalContainment(roots, raw);
                    if (!containment.ok) {
                        return `Acceso denegado: "${raw}" resuelve fuera del directorio de trabajo (symlink/junction).`;
                    }
                    if (name === 'read_file' && isSensitivePath(raw)) {
                        const allowed = await options.onSensitiveRead(raw);
                        if (!allowed) {
                            return `Acceso denegado: "${raw}" parece contener credenciales; la lectura requiere aprobacion explicita.`;
                        }
                    }
                }
                return original.execute(args, ctx);
            },
        });
        wrapped.push(name);
        options.log?.(`[tool-guards] ${name} envuelta (contencion canonica${name === 'read_file' ? ' + rutas sensibles' : ''})`);
    }

    return wrapped;
}
