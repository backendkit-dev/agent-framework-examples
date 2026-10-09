/**
 * @description Filtro del stream de tokens para el modo headless.
 *
 * El agente cierra sus respuestas con un bloque `<recap>…</recap>` que el
 * frontend quiere renderizar aparte: este filtro separa el texto normal de ese
 * bloque y lo emite como evento `recap`.
 *
 * Detalle importante: el marcador se retiene hasta estar completo. El filtro
 * nunca emite los ultimos `holdback` caracteres, de modo que un `<recap>` partido
 * entre dos chunks (frecuente en streaming) no se filtra al frontend por error.
 *
 * Vive en `src/` (y no embebido en `bin/cli.ts`) para poder testearse: es
 * logica de protocolo y el entrypoint no tenia cobertura.
 */

export type HeadlessEmission =
    | { type: 'token'; content: string }
    | { type: 'recap'; text: string };

const RECAP_OPEN = '<recap>';
const RECAP_CLOSE = '</recap>';

export class HeadlessStreamFilter {
    private tail = '';
    private recapBuffer = '';
    private suppressing = false;
    private readonly holdback: number;

    /**
     * @param holdback Caracteres que se retienen al final del buffer para no
     * emitir un marcador parcial. Con 8 alcanza para `<recap>` (7) y deja margen.
     */
    constructor(holdback = 8) {
        this.holdback = Math.max(RECAP_OPEN.length - 1, holdback);
    }

    /** @description Procesa un chunk de tokens y devuelve lo que debe emitirse. */
    push(content: string): HeadlessEmission[] {
        const out: HeadlessEmission[] = [];

        if (this.suppressing) {
            this.recapBuffer += content;
            this.closeRecapIfComplete(out);
            return out;
        }

        this.tail += content;
        const openIdx = this.tail.indexOf(RECAP_OPEN);
        if (openIdx !== -1) {
            const before = this.tail.slice(0, openIdx);
            if (before) out.push({ type: 'token', content: before });
            this.suppressing = true;
            this.recapBuffer = this.tail.slice(openIdx + RECAP_OPEN.length);
            this.tail = '';
            this.closeRecapIfComplete(out);
            return out;
        }

        const safe = Math.max(0, this.tail.length - this.holdback);
        if (safe > 0) {
            out.push({ type: 'token', content: this.tail.slice(0, safe) });
            this.tail = this.tail.slice(safe);
        }
        return out;
    }

    /**
     * @description Cierra el stream: emite el remanente retenido.
     * Si un `<recap>` quedo abierto sin cerrar, se emite su contenido igual
     * (mejor mostrar el recap incompleto que perderlo).
     */
    flush(): HeadlessEmission[] {
        const out: HeadlessEmission[] = [];
        if (this.suppressing) {
            const text = this.recapBuffer.trim();
            if (text) out.push({ type: 'recap', text });
            this.suppressing = false;
            this.recapBuffer = '';
        }
        if (this.tail) {
            out.push({ type: 'token', content: this.tail });
            this.tail = '';
        }
        return out;
    }

    private closeRecapIfComplete(out: HeadlessEmission[]): void {
        const endIdx = this.recapBuffer.indexOf(RECAP_CLOSE);
        if (endIdx === -1) return;
        const text = this.recapBuffer.slice(0, endIdx).trim();
        // Lo que venga despues de </recap> vuelve al stream como texto normal
        // (antes se descartaba silenciosamente).
        this.tail = this.recapBuffer.slice(endIdx + RECAP_CLOSE.length) + this.tail;
        this.recapBuffer = '';
        this.suppressing = false;
        if (text) out.push({ type: 'recap', text });
    }
}
