/**
 * @description IterationManager — Controlador de iteraciones con modos.
 *
 * Maneja el ciclo de vida de las iteraciones del loop del agente,
 * con 3 modos de operacion:
 *
 * - `interactive`: pregunta al usuario al alcanzar el limite
 * - `auto`: continua automaticamente hasta que el agente complete o falle
 * - `step-by-step`: pregunta despues de cada paso
 *
 * Mejora 2026-05-02:
 * - resetLimit(): resetea contador a 0 sin perder toolCalls/delegations
 * - Modo auto y step-by-step: solo GLOBAL_LIMIT como tope (sin limite base)
 * - 4 opciones en /iteration: interactive, auto, step-by-step, reset-limit
 *
 * @see AgentLoop._processInput() para integracion
 */

export type IterationMode = 'interactive' | 'auto' | 'step-by-step';

export interface IterationStats {
    /** Iteraciones ejecutadas en este ciclo */
    iterations: number;
    /** Limite actual de iteraciones */
    maxIterations: number;
    /** Limite dinamico ajustado por delegaciones */
    dynamicLimit: number;
    /** Tope absoluto de seguridad */
    globalLimit: number;
    /** Veces que se incremento el limite (por confirmacion del usuario) */
    totalIncrements: number;
    /** Llamadas a herramientas realizadas */
    toolCalls: number;
    /** Delegaciones a especialistas realizadas */
    delegations: number;
    /** Milisegundos desde que inicio el manager */
    elapsedMs: number;
}

export interface IterationManagerOptions {
    /** Modo de operacion (default: 'interactive') */
    mode?: IterationMode;

    /** Limite base de iteraciones antes de preguntar (default: 50) */
    maxIterations?: number;

    /** Cuantas iteraciones extra agregar cuando el usuario confirma continuar (default: 25) */
    batchSize?: number;

    /**
     * Callback cuando se alcanza el limite de iteraciones.
     * Solo se invoca en modo 'interactive'.
     *
     * @param stats - Estadisticas actuales de iteracion
     * @returns true para continuar, false para detener
     */
    onLimitReached?: (stats: IterationStats) => Promise<boolean>;

    /**
     * Callback cuando el usuario dice "no" o se detiene la ejecucion.
     * Util para guardar estado, mostrar resumen, etc.
     */
    onStop?: (stats: IterationStats) => Promise<void>;

    /**
     * Callback opcional para modo step-by-step.
     * Se invoca despues de CADA iteracion.
     *
     * @param stats - Estadisticas actuales
     * @returns true para continuar, false para detener
     */
    onStep?: (stats: IterationStats) => Promise<boolean>;

    /**
     * Callback cuando se alcanza el GLOBAL_LIMIT (200) como tope absoluto.
     * Se invoca ANTES de detener la ejecucion, para que el caller pueda
     * guardar contexto, actualizar memoria, etc.
     *
     * @param stats - Estadisticas actuales de iteracion
     */
    onGlobalLimitReached?: (stats: IterationStats) => Promise<void>;
}

export const DEFAULT_MAX_ITERATIONS = 100;
export const DEFAULT_BATCH_SIZE = 25;
export const GLOBAL_LIMIT = 1000;
export const DELEGATION_EXTEND = 25;
export const DELEGATION_GRACE_ITERATIONS = 5;

export class IterationManager {
    private _iterations = 0;
    private _totalIncrements = 0;
    private _toolCalls = 0;
    private _startTime = Date.now();
    private _stopped = false;
    private _mode: IterationMode;
    private _maxIterations: number;
    private readonly _batchSize: number;

    // ── Nuevas propiedades para delegaciones y limite dinamico ──

    /** Tope absoluto: jamas se pasa de aqui */
    private readonly _globalLimit: number;

    /** Limite dinamico que se extiende con delegaciones */
    private _dynamicLimit: number;

    /** Cuantas delegaciones se realizaron en este ciclo */
    private _delegationCount = 0;

    /** En que iteracion se hizo la ultima delegacion */
    private _lastDelegationIteration = 0;

    /** Callback por defecto si no se provee onLimitReached */
    private _onLimitReached: (stats: IterationStats) => Promise<boolean>;

    constructor(private readonly options: IterationManagerOptions = {}) {
        this._mode = options.mode ?? 'interactive';
        this._maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        this._batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
        this._globalLimit = GLOBAL_LIMIT;
        this._dynamicLimit = this._maxIterations;
        this._onLimitReached = options.onLimitReached ?? this._defaultOnLimitReached.bind(this);
    }

    // ── Getters ─────────────────────────────────────────────────────────

    get iterations(): number {
        return this._iterations;
    }

    get maxIterations(): number {
        return this._maxIterations;
    }

    get mode(): IterationMode {
        return this._mode;
    }

    get stopped(): boolean {
        return this._stopped;
    }

    get stats(): IterationStats {
        return {
            iterations: this._iterations,
            maxIterations: this._maxIterations,
            dynamicLimit: this._dynamicLimit,
            globalLimit: this._globalLimit,
            totalIncrements: this._totalIncrements,
            toolCalls: this._toolCalls,
            delegations: this._delegationCount,
            elapsedMs: Date.now() - this._startTime,
        };
    }

    // ── Setters ─────────────────────────────────────────────────────────

    /** Cambia el modo en caliente (util para debugging) */
    setMode(mode: IterationMode): void {
        this._mode = mode;
    }

    /** Cambia el limite maximo en caliente */
    setMaxIterations(max: number): void {
        this._maxIterations = max;
        this._dynamicLimit = Math.max(this._dynamicLimit, max);
    }

    /** Incrementa el limite actual en batchSize */
    private incrementMaxIterations(): void {
        this._maxIterations += this._batchSize;
        this._totalIncrements++;
    }

    // ── Nuevo: registro de delegaciones ─────────────────────────────────

    /**
     * Registra una delegacion a especialista.
     * Extiende el limite dinamico para dar margen al especialista
     * sin que el contador global se agote prematuramente.
     */
    recordDelegation(): void {
        this._delegationCount++;
        this._lastDelegationIteration = this._iterations;
        // Extender limite dinamico: +25 iteraciones por delegacion
        this._dynamicLimit = Math.max(
            this._dynamicLimit,
            this._iterations + DELEGATION_EXTEND
        );
    }

    // ── Ciclo de vida ───────────────────────────────────────────────────

    /**
     * Reinicia el contador de iteraciones y todas las estadisticas.
     * Util para empezar un nuevo ciclo de procesamiento completo.
     */
    reset(): void {
        this._iterations = 0;
        this._totalIncrements = 0;
        this._toolCalls = 0;
        this._delegationCount = 0;
        this._lastDelegationIteration = 0;
        this._dynamicLimit = this._maxIterations;
        this._startTime = Date.now();
        this._stopped = false;
    }

    /**
     * Resetea SOLO el contador de iteraciones a 0, manteniendo
     * las demas estadisticas (toolCalls, delegations, elapsedMs).
     * Util para /iteration reset-limit: permite seguir iterando
     * sin perder el registro de llamadas a herramientas ni delegaciones.
     */
    resetLimit(): void {
        this._iterations = 0;
        this._dynamicLimit = this._maxIterations;
        this._totalIncrements = 0;
    }

    /**
     * Registra una llamada a herramienta.
     * Se llama desde el loop cuando se ejecuta un toolCall.
     */
    recordToolCall(): void {
        this._toolCalls++;
    }

    /**
     * Avanza una iteracion y verifica si se debe continuar.
     *
     * Mejora 2026-05-02:
     * - Modo auto: corre hasta GLOBAL_LIMIT sin limites intermedios
     * - Modo step-by-step: solo GLOBAL_LIMIT como unico techo
     * - Modo interactive: pregunta al llegar a maxIterations, permite extension
     * - Si hay delegaciones activas, extiende sin preguntar
     *
     * @returns true si se debe continuar, false si se debe detener
     */
    async advance(): Promise<boolean> {
        if (this._stopped) return false;

        this._iterations++;

        // ── Tope absoluto de seguridad: NUNCA pasar de GLOBAL_LIMIT ───────
        if (this._iterations >= this._globalLimit) {
            this._stopped = true;
            // Invocar callback especial de global limit primero (para guardar memoria, contexto, etc.)
            if (this.options.onGlobalLimitReached) {
                await this.options.onGlobalLimitReached(this.stats);
            }
            await this.options.onStop?.(this.stats);
            return false;
        }

        // ── Modo step-by-step: pregunta DESPUES de cada paso ────────────────
        //    Sin limite intermedio: solo GLOBAL_LIMIT como techo.
        //    El usuario decide paso a paso si continuar o no.
        if (this._mode === 'step-by-step' && this._iterations > 1) {
            if (this.options.onStep) {
                const cont = await this.options.onStep(this.stats);
                if (!cont) {
                    this._stopped = true;
                    await this.options.onStop?.(this.stats);
                    return false;
                }
            }
            return true;
        }

        // ── Delegaciones activas: extender sin preguntar ──────────────────
        if (this._delegationCount > 0 &&
            this._iterations - this._lastDelegationIteration < DELEGATION_GRACE_ITERATIONS) {
            return true;
        }

        // ── Modo auto: extiende hasta GLOBAL_LIMIT sin preguntar ──────────
        //    Sin limite intermedio: solo GLOBAL_LIMIT como unico techo.
        if (this._mode === 'auto') {
            // En modo auto no hay pregunta, solo se detiene en GLOBAL_LIMIT
            return true;
        }

        // ── Modo interactive: pregunta al alcanzar el limite ────────────────
        if (this._iterations > this._dynamicLimit) {
            const cont = await this._onLimitReached(this.stats);
            if (cont) {
                this._dynamicLimit += this._batchSize;
                this._totalIncrements++;
                return true;
            }
            this._stopped = true;
            await this.options.onStop?.(this.stats);
            return false;
        }

        return true;
    }

    /**
     * Callback por defecto: retorna false para detener la ejecucion.
     *
     * La decision de preguntar al usuario o extender el limite se toma
     * en loop.ts, que tiene acceso a askConfirmation().
     * IterationManager solo reporta el estado; no decide.
     */
    private async _defaultOnLimitReached(stats: IterationStats): Promise<boolean> {
        // Retornar false → advance() retorna false → loop.ts decide que hacer
        return false;
    }

    /**
     * Verifica si se alcanzo el limite de iteraciones (modo interactive).
     * Util para chequeos externos sin avanzar el contador.
     */
    isLimitReached(): boolean {
        return this._mode === 'interactive' && this._iterations > this._dynamicLimit;
    }
}
