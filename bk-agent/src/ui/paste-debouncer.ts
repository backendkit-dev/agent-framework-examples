/**
 * Agrupa líneas que llegan rápidamente (pegado desde portapapeles) en un único
 * bloque de texto, evitando N peticiones por N líneas pegadas.
 *
 * Umbral de detección: si dos líneas consecutivas llegan en < 40ms se consideran
 * parte del mismo pegado. Tras 100ms de inactividad se hace flush del bloque.
 * Para líneas tipadas manualmente (>40ms entre ellas), el flush es inmediato.
 */

const PASTE_INTERVAL_MS = 40;   // gap entre líneas que indica paste
const FLUSH_DELAY_MS    = 100;  // inactividad antes de emitir el bloque
const MAX_TEXT_CHARS    = 60_000;

export interface PasteFlushEvent {
    text: string;
    type: 'typed' | 'paste';
}

export interface PasteDebouncerOptions {
    onFlush: (event: PasteFlushEvent) => void;
}

export class PasteDebouncer {
    private lines: string[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private lastLineAt = 0;
    private detectedPaste = false;
    private isProcessing = false; // H5: previene flush durante operación en curso
    private readonly isTTY: boolean;  // H2: degradación en no-TTY
    private onFlush: (event: PasteFlushEvent) => void;

    constructor(opts: PasteDebouncerOptions) {
        this.onFlush = opts.onFlush;
        // H2: en entornos no-TTY (CI, pipe) no tiene sentido detectar paste —
        // las líneas llegan tan rápido como el pipe puede enviarlas, no por
        // velocidad de escritura humana. Se desactiva el debounce.
        this.isTTY = process.stdin.isTTY === true;
    }

    receiveLine(line: string): void {
        // H2: fallback no-TTY — pasar directamente sin debounce ni detección
        if (!this.isTTY) {
            this.onFlush({ text: line, type: 'typed' });
            return;
        }

        const now = Date.now();
        const gap = now - this.lastLineAt;
        this.lastLineAt = now;

        if (this.lines.length > 0 && gap < PASTE_INTERVAL_MS) {
            this.detectedPaste = true;
        }

        this.lines.push(line);
        this.scheduleFlush();
    }

    /** H5: señala que hay una operación en curso para posponer el flush. */
    setProcessing(active: boolean): void {
        this.isProcessing = active;
        // Si terminó la operación y hay líneas acumuladas, procesarlas ahora
        if (!active && this.lines.length > 0 && !this.timer) {
            this.scheduleFlush();
        }
    }

    cancel(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.lines = [];
        this.detectedPaste = false;
    }

    private scheduleFlush(): void {
        if (this.timer) clearTimeout(this.timer);

        if (!this.detectedPaste && this.lines.length === 1) {
            // Usar PASTE_INTERVAL_MS en lugar de 0 para dar tiempo a que lleguen
            // líneas siguientes del mismo paste antes de hacer flush prematuro.
            this.timer = setTimeout(() => this.flush(), PASTE_INTERVAL_MS);
        } else {
            this.timer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
        }
    }

    private flush(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.lines.length === 0) return;

        // H5: si hay una operación en curso, posponer el flush 50ms
        if (this.isProcessing) {
            this.timer = setTimeout(() => this.flush(), 50);
            return;
        }

        let text = this.lines.join('\n');
        const type: 'typed' | 'paste' = this.detectedPaste ? 'paste' : 'typed';

        this.lines = [];
        this.detectedPaste = false;

        if (text.includes('\0')) {
            process.stdout.write('\n  [Contenido binario ignorado]\n');
            return;
        }

        if (text.length > MAX_TEXT_CHARS) {
            text = text.slice(0, MAX_TEXT_CHARS) + '\n[...truncado]';
        }

        this.onFlush({ text, type });
    }
}
