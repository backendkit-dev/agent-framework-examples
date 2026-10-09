/**
 * @description Saneado de texto antes de escribirlo a un terminal.
 *
 * El modelo y el contenido del repositorio son entradas NO confiables: una
 * respuesta puede traer OSC 52 (escribe el portapapeles del usuario), CSI
 * (borra pantalla, oculta el cursor) o titulos de ventana. `chalk` NO filtra
 * nada, asi que el saneado tiene que ocurrir antes de pintar.
 *
 * Cubre:
 * - CSI: ESC [ ... letra final
 * - OSC: ESC ] ... BEL | ST (incluye OSC 52 → portapapeles)
 * - Escapes de 2 y 3 bytes (ESC c, ESC ( B, ...)
 * - Controles C0/C1 y DEL, preservando \n y \t
 */

/** Secuencias CSI: ESC [ parametros/intermedios byte final. */
const CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
/** Secuencias OSC: ESC ] ... (BEL o ESC \). */
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** Secuencia OSC truncada al final del buffer (sin terminador todavia). */
const OSC_OPEN_RE = /\x1b\][^\x07\x1b]*$/;
/** DCS/SOS/PM/APC: ESC P|X|^|_ ... ST */
const DCS_RE = /\x1b[PX^_][^\x1b]*(?:\x1b\\|$)/g;
/**
 * Escapes de 2 y 3 bytes: ESC + caracter final (0x40-0x5F) y ESC + intermedio
 * (0x20-0x2F) + final. Incluye ESC c (reset), ESC ( B (charset), ESC = / >.
 */
const SHORT_ESC_RE = /\x1b[ -/]*[0-~]/g;
/** Controles C0/C1 y DEL, preservando \n (0x0A) y \t (0x09). */
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * @description Elimina secuencias de escape y caracteres de control.
 * Preserva saltos de linea y tabulaciones (son parte legitima del formato).
 */
export function stripTerminalEscapes(text: string): string {
    if (!text) return '';
    return text
        .replace(OSC_RE, '')
        .replace(DCS_RE, '')
        .replace(CSI_RE, '')
        // Debe ir ANTES de SHORT_ESC_RE: si no, el escape corto se come el ESC+]
        // de una OSC sin terminador y deja el payload visible.
        .replace(OSC_OPEN_RE, '')
        .replace(SHORT_ESC_RE, '')
        .replace(CONTROL_CHARS_RE, '');
}

/**
 * @description Igual que `stripTerminalEscapes` pero ademas colapsa los saltos
 * de linea, para textos que se pintan en una sola linea (footer, spinner, logs).
 */
export function sanitizeSingleLine(text: string): string {
    return stripTerminalEscapes(text).replace(/[\r\n]+/g, ' ').trim();
}
