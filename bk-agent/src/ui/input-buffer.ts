/**
 * Cola FIFO no bloqueante para procesar entradas del usuario.
 * El cursor se libera inmediatamente; el procesamiento ocurre en segundo plano.
 */

const BUFFER_MAX = 50;
const QUEUE_TIMEOUT_MS = 5 * 60 * 1000; // timeout para items esperando en cola, no para procesamiento
const MAX_ITEM_SIZE = 100 * 1024; // 100 KB — previene OOM por entradas masivas

export interface InputItem {
    id: string;
    raw: string;
    timestamp: number;
    type: 'typed' | 'paste';
}

export class InputBuffer {
    private queue: InputItem[] = [];
    private processing = false;
    private cancelFlag = false;
    private onProcess: (raw: string) => Promise<void>;
    private onDrained?: () => void;

    constructor(onProcess: (raw: string) => Promise<void>) {
        this.onProcess = onProcess;
    }

    enqueue(raw: string, type: 'typed' | 'paste' = 'typed'): void {
        if (!raw.trim()) return;

        // H1: rechazar entradas excesivamente grandes para evitar OOM
        if (raw.length > MAX_ITEM_SIZE) {
            raw = raw.slice(0, MAX_ITEM_SIZE) + '\n[...truncado — entrada demasiado grande]';
            process.stderr.write(`[InputBuffer] Entrada truncada a ${MAX_ITEM_SIZE / 1024}KB.\n`);
        }

        if (this.queue.length >= BUFFER_MAX) {
            const dropped = this.queue.shift()!;
            process.stderr.write(
                `[InputBuffer] Cola llena (${BUFFER_MAX}), descartando: "${dropped.raw.slice(0, 40)}"\n`
            );
        }

        this.queue.push({
            id: Math.random().toString(36).slice(2),
            raw,
            timestamp: Date.now(),
            type,
        });

        if (!this.processing) {
            this.processing = true;
            // H4: setTimeout(0) en lugar de setImmediate — evita acumulación
            // en microtask queue en ráfagas largas que causarían stack overflow.
            setTimeout(() => this.processNext(), 0);
        }
    }

    cancel(): void {
        this.cancelFlag = true;
        this.queue = [];
        setTimeout(() => { this.cancelFlag = false; }, 0);
    }

    setOnDrained(cb: () => void): void {
        this.onDrained = cb;
    }

    get size(): number {
        return this.queue.length;
    }

    get isProcessing(): boolean {
        return this.processing;
    }

    private async processNext(): Promise<void> {
        while (this.queue.length > 0 && !this.cancelFlag) {
            const item = this.queue.shift()!;

            // Descartar solo si el item esperó demasiado en cola sin ser atendido.
            // El procesamiento activo no tiene timeout — no matar una llamada LLM en vuelo.
            if (Date.now() - item.timestamp > QUEUE_TIMEOUT_MS) {
                process.stderr.write('[InputBuffer] Item descartado: estuvo 5 min en cola sin ser procesado.\n');
                continue;
            }

            try {
                await this.onProcess(item.raw);
            } catch (err) {
                // Continuar con el siguiente item — no propagar el error
            }
        }
        this.processing = false;
        if (this.queue.length === 0) this.onDrained?.();
    }
}
