import chalk from 'chalk';
import { theme } from './theme';
import { FuturistaAnimation, WavesAnimation, PulseAnimation, AnimationType, AnimationConfig } from '@backendkit-labs/console-animations';

const FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

function makeAnim<T extends { start(): void; nextFrame(t: number): { content: string } }>(ctor: new (c: AnimationConfig) => T, type: AnimationType): T {
    const a = new ctor({ type, speed: 0 });
    a.start();
    return a;
}

export interface SpinnerMetrics {
    /** Input tokens acumulados en la sesi\u00F3n */
    inputTokens: number;
    /** Output tokens acumulados en la sesi\u00F3n */
    outputTokens: number;
    /** Tiempo total acumulado en ms */
    elapsedMs: number;
    /** Costo estimado en USD (por mill\u00F3n de tokens) */
    estimatedCostUsd?: number;
    /** Nombre del modelo activo (para c\u00E1lculo de precio) */
    modelName?: string;
}

/**
 * @description Indicador visual de progreso asíncrono con métricas en vivo.
 * Muestra animación, tiempo transcurrido, tokens consumidos y costo estimado
 * mientras el agente procesa. El desarrollador recibe feedback inmediato
 * sobre el estado y costo de la operación sin saturar la terminal.
 */
export class Spinner {
    private timer: NodeJS.Timeout | null = null;
    private frameIdx = 0;
    private text = '';
    private startTime = 0;
    private paused = false;
    private metrics: SpinnerMetrics | null = null;
    private showMetrics = false;
    private currentInputTokens = 0;
    private currentOutputTokens = 0;
    private statusCallback?: (text: string) => void;

    /** Cuando se provee, el spinner actualiza el footer del Terminal en lugar
     * de escribir directamente a stdout. Llamar después de crear el Terminal. */
    setStatusCallback(fn: (text: string) => void): void {
        this.statusCallback = fn;
    }

    private renderLine(content: string): void {
        if (this.statusCallback) {
            this.statusCallback(content);
        } else {
            process.stdout.write('\r' + content);
        }
    }

    /**
     * @description Inicia la animación del spinner con un texto descriptivo.
     * Muestra una animación braille mientras el agente procesa, indicando
     * que hay actividad sin ocupar líneas adicionales en la terminal.
     */
    start(text: string): void {
        this.text = text;
        this.frameIdx = 0;
        this.startTime = Date.now();
        this.showMetrics = false;
        if (this.timer) this.stop(false);
        const anim = makeAnim(PulseAnimation, AnimationType.PULSE);
        this.timer = setInterval(() => {
            if (this.paused) return;
            const f = anim.nextFrame(performance.now());
            const frameChar = f.content || FRAMES[this.frameIdx % FRAMES.length];
            const frame = this.statusCallback ? '' : chalk.hex(theme.colors.info)(frameChar) + ' ';
            this.renderLine(frame + chalk.hex(theme.colors.textDim)(this.text));
            this.frameIdx++;
        }, 80);
    }

    /**
     * @description Inicia el spinner con un contador de tiempo en vivo.
     * Muestra los segundos transcurridos junto a la animación, útil para
     * operaciones donde el tiempo es relevante (ej: compilación, despliegue).
     */
    startWithTimer(text: string): void {
        const startMs = Date.now();
        this.text = text;
        this.frameIdx = 0;
        this.startTime = startMs;
        this.showMetrics = false;
        if (this.timer) this.stop(false);
        const anim = makeAnim(FuturistaAnimation, AnimationType.FUTURISTA);
        this.timer = setInterval(() => {
            if (this.paused) return;
            const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
            const f = anim.nextFrame(performance.now());
            const frameChar = f.content || FRAMES[this.frameIdx % FRAMES.length];
            if (this.statusCallback) {
                this.renderLine(frameChar + '  ' + chalk.hex(theme.colors.textDim)(this.text + '  ' + elapsed + 's'));
            } else {
                this.renderLine(chalk.hex(theme.colors.info)(frameChar) + ' ' + chalk.hex(theme.colors.textDim)(this.text + '  ' + elapsed + 's'));
            }
            this.frameIdx++;
        }, 100);
    }

    /**
     * @description Inicia el spinner con métricas en vivo: tokens, tiempo y costo.
     * Las métricas se actualizan automáticamente desde el objeto referenciado,
     * permitiendo al desarrollador monitorear el consumo de la API en tiempo real
     * sin necesidad de consultar logs externos.
     * @param text Texto descriptivo de la operación en curso
     * @param metrics Objeto de métricas que se actualiza externamente
     */
    startWithMetrics(text: string, metrics: SpinnerMetrics): void {
        this.text = text;
        this.frameIdx = 0;
        this.startTime = Date.now();
        this.showMetrics = true;
        this.metrics = metrics;
        if (this.timer) this.stop(false);
        const anim = makeAnim(WavesAnimation, AnimationType.WAVES);
        this.timer = setInterval(() => {
            if (this.paused) return;
            this.updateFromMetrics(metrics);
            const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
            const costStr = metrics.estimatedCostUsd !== undefined
                ? ' \u00b7 $' + metrics.estimatedCostUsd.toFixed(4)
                : '';
            const up = metrics.inputTokens > 0 ? ' \u00b7 \u2191 ' + (metrics.inputTokens / 1000).toFixed(1) + 'k tk' : '';
            const down = metrics.outputTokens > 0 ? ' \u2193 ' + (metrics.outputTokens / 1000).toFixed(1) + 'k tk' : '';
            const statusContent = this.text + ' (' + elapsed + 's' + up + down + costStr + ')';
            const f = anim.nextFrame(performance.now());
            const frameChar = f.content || FRAMES[this.frameIdx % FRAMES.length];
            if (this.statusCallback) {
                this.renderLine(frameChar + '  ' + chalk.hex(theme.colors.textDim)(statusContent));
            } else {
                this.renderLine(chalk.hex(theme.colors.info)(frameChar) + ' ' + chalk.hex(theme.colors.textDim)(statusContent));
            }
            metrics.elapsedMs = Date.now() - this.startTime;
            this.frameIdx++;
        }, 200);
    }

    /** Actualiza los contadores internos desde las m\u00E9tricas */
    private updateFromMetrics(metrics: SpinnerMetrics): void {
        if (metrics.inputTokens > this.currentInputTokens) {
            this.currentInputTokens = metrics.inputTokens;
        }
        if (metrics.outputTokens > this.currentOutputTokens) {
            this.currentOutputTokens = metrics.outputTokens;
        }
    }

    /**
     * @description Actualiza el texto del spinner en caliente.
     * Permite cambiar el mensaje sin reiniciar la animación, ideal para
     * mostrar el progreso de una operación multi-paso.
     */
    update(text: string): void {
        this.text = text;
    }

    /**
     * @description Pausa la animación del spinner sin detenerlo.
     * Útil cuando se necesita escribir a la terminal temporalmente
     * (ej: mostrar un mensaje de error) y luego reanudar el spinner.
     */
    pause(): void {
        this.paused = true;
    }

    /**
     * @description Reanuda la animación del spinner después de una pausa.
     * Continúa desde el mismo frame donde se detuvo, manteniendo la
     * experiencia visual consistente.
     */
    resume(): void {
        this.paused = false;
    }

    /**
     * @description Detiene el spinner y opcionalmente limpia la línea.
     * Si clearLine es true, borra la línea actual para dejar la terminal
     * limpia. Si es false, deja el último frame visible (útil para
     * transiciones suaves a mensajes de éxito/error).
     */
    stop(clearLine = true): void {
        this.showMetrics = false;
        this.metrics = null;
        const wasRunning = this.timer !== null;
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (clearLine && wasRunning) {
            if (this.statusCallback) {
                this.statusCallback(''); // limpiar footer del terminal
            } else {
                process.stdout.write('\r\x1b[2K');
            }
        }
    }

    /**
     * @description Detiene el spinner y muestra un mensaje de éxito (✓).
     * Reemplaza la animación por una marca verde, dando feedback visual
     * positivo al desarrollador sobre la operación completada.
     */
    succeed(text: string): void {
        this.showMetrics = false;
        this.metrics = null;
        this.stop();
        console.log(chalk.hex(theme.colors.success)('\u2713 ') + text);
    }

    /**
     * @description Detiene el spinner y muestra un mensaje de error (✗).
     * Reemplaza la animación por una marca roja, alertando al desarrollador
     * que la operación falló sin necesidad de revisar logs.
     */
    fail(text: string): void {
        this.showMetrics = false;
        this.metrics = null;
        this.stop();
        console.log(chalk.hex(theme.colors.error)('\u2717 ') + text);
    }

    /**
     * @description Indica si el spinner está actualmente en ejecución.
     * Útil para que otros componentes sepan si deben evitar escribir
     * sobre la línea del spinner.
     */
    isRunning(): boolean {
        return this.timer !== null;
    }
}
