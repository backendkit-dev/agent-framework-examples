/**
 * @description Parsea marcas [memory:*] en respuestas de agentes para
 * actualizar automaticamente la memoria de sesion.
 *
 * Formato esperado:
 *   [memory:feature] Nombre del feature
 *   [memory:progress] 75%
 *   [memory:issues] Issue 1 detectado
 *   [memory:decision] Se decidio X porque Y
 *   [memory:next-steps] Paso 1; Paso 2; Paso 3
 *   [memory:notes] Nota adicional
 *
 * Las marcas pueden aparecer en cualquier parte del texto.
 * Se extraen todas y se devuelven como un SessionMemoryUpdate parcial.
 */
import { SessionMemoryUpdate } from './updater';

const MEMORY_TAG_RE = /\[memory:([a-z_-]+)\]\s*(.+?)(?:\n|$)/gi;

export interface ParsedMemoryTags {
    update: SessionMemoryUpdate;
    rawTags: Array<{ field: string; value: string }>;
}

export function parseMemoryTags(text: string): ParsedMemoryTags {
    const update: SessionMemoryUpdate = {};
    const rawTags: Array<{ field: string; value: string }> = [];

    let match: RegExpExecArray | null;
    while ((match = MEMORY_TAG_RE.exec(text)) !== null) {
        const field = match[1].toLowerCase();
        const value = match[2].trim();
        rawTags.push({ field, value });

        switch (field) {
            case 'feature':
                update.feature = value;
                break;
            case 'progress':
                update.progreso = value;
                break;
            case 'issues':
                update.issues = value
                    .split(';')
                    .map(s => s.trim())
                    .filter(Boolean);
                break;
            case 'decision':
                update.decisiones = [
                    ...(update.decisiones ?? []),
                    value,
                ];
                break;
            case 'next-steps':
                update.proximos_pasos = value
                    .split(';')
                    .map(s => s.trim())
                    .filter(Boolean);
                break;
            case 'notes':
                update.notas = value;
                break;
            default:
                // campos desconocidos se ignoran silenciosamente
                break;
        }
    }

    return { update, rawTags };
}

/**
 * @description Remueve las marcas [memory:*] del texto, dejando solo el
 * contenido limpio. Util para limpiar la respuesta antes de mostrarla al usuario.
 */
export function stripMemoryTags(text: string): string {
    return text.replace(MEMORY_TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}
