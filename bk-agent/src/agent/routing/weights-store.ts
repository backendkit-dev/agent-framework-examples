/**
 * @description Persiste y gestiona los pesos históricos de routing para cada
 * agente usando EWMA (Exponential Weighted Moving Average).
 *
 * Mejoras sobre la versión anterior:
 * - EWMA en lugar de +0.1/-0.2 fijo: w ← (1-α)*w + α*score  (α=0.1)
 * - Escritura atómica (tmp + renameSync) — crash-safe
 * - Validación del JSON al cargar — no acepta shapes inválidos
 * - Composite keys por (agentId, domain, intent) — aprendizaje contextual
 * - Una advertencia visible en el primer fallo de escritura
 *
 * Pesos se guardan en ~/.deepseek-code/projects/{cwd-hash}/agents-routing-weights.json
 */
import * as fs from 'fs';
import * as path from 'path';

const WEIGHTS_FILENAME = 'agents-routing-weights.json';
const ALPHA = 0.1;   // tasa de aprendizaje EWMA
const W_MIN  = 0.1;
const W_MAX  = 3.0;

export interface WeightContext {
    domain?: string;
    intent?: string;
    developerProfile?: string;
}

export class RoutingWeightsStore {
    private weights: Record<string, number> = {};
    private saveWarnedOnce = false;

    // ── Carga ──────────────────────────────────────────────────────────────

    load(): void {
        try {
            const data = fs.readFileSync(this.filePath(), 'utf-8');
            const parsed = JSON.parse(data);
            this.weights = this.validateShape(parsed);
        } catch {
            this.weights = {};
        }
    }

    // ── Lectura ────────────────────────────────────────────────────────────

    /**
     * Retorna el peso del agente. Si hay contexto, busca primero la clave
     * compuesta y, si no existe, cae al peso global del agente.
     */
    get(agentId: string, context?: WeightContext): number {
        if (context?.domain || context?.intent) {
            const compositeKey = this.makeKey(agentId, context);
            if (compositeKey in this.weights) return this.weights[compositeKey];
        }
        return this.weights[agentId] ?? 1.0;
    }

    getAll(): Record<string, number> {
        return { ...this.weights };
    }

    // ── Escritura ──────────────────────────────────────────────────────────

    /**
     * Registra un outcome continuo [0, 1] para el agente.
     * Actualiza la clave global Y la clave compuesta si se provee contexto.
     */
    recordOutcome(agentId: string, score: number, context?: WeightContext): void {
        const clampedScore = Math.max(0, Math.min(1, score));

        // Actualizar peso global
        this.weights[agentId] = this.ewma(this.weights[agentId] ?? 1.0, clampedScore);

        // Actualizar peso contextual si hay contexto
        if (context?.domain || context?.intent) {
            const key = this.makeKey(agentId, context);
            this.weights[key] = this.ewma(this.weights[key] ?? 1.0, clampedScore);
        }

        this.save();
    }

    /** Éxito binario — wrapper de recordOutcome(1.0) */
    recordSuccess(agentId: string, context?: WeightContext): void {
        this.recordOutcome(agentId, 1.0, context);
    }

    /** Fallo binario — wrapper de recordOutcome(0.0) */
    recordFailure(agentId: string, context?: WeightContext): void {
        this.recordOutcome(agentId, 0.0, context);
    }

    // ── Privados ───────────────────────────────────────────────────────────

    private ewma(current: number, newSample: number): number {
        const updated = (1 - ALPHA) * current + ALPHA * newSample;
        return Math.min(W_MAX, Math.max(W_MIN, updated));
    }

    seedFromAgentMd(content: string): void {
        const lines = content.split('\n');
        for (const line of lines) {
            const match = line.match(/^##?\s+@([\w-]+).*?(?:score[:\s]+)?(\d+(?:\.\d+)?)/i);
            if (!match) continue;
            const [, agentId, rawScore] = match;
            const score = parseFloat(rawScore);
            if (!Number.isFinite(score) || score < W_MIN || score > W_MAX) continue;
            if (this.weights[agentId] !== undefined) continue;
            this.weights[agentId] = score;
        }
        // No llamar save() — la seed es en memoria; se persistirá al primer recordOutcome()
    }

    private makeKey(agentId: string, ctx: WeightContext): string {
        const parts = [agentId, ctx.domain ?? '*', ctx.intent ?? '*'];
        if (ctx.developerProfile) parts.push(ctx.developerProfile);
        return parts.join(':');
    }

    /** Valida que el JSON sea Record<string, number> con valores en rango. */
    private validateShape(raw: unknown): Record<string, number> {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const clean: Record<string, number> = {};
        for (const [k, v] of Object.entries(raw as object)) {
            if (typeof v === 'number' && Number.isFinite(v) && v >= W_MIN && v <= W_MAX) {
                clean[k] = v;
            }
        }
        return clean;
    }

    private filePath(): string {
        const home = process.env.USERPROFILE ?? process.env.HOME ?? require('os').homedir();
        const cwd  = process.cwd();
        const projectKey = cwd
            .replace(/[/\\]$/, '')
            .replace(/:[/\\]/g, '--')
            .replace(/[^a-zA-Z0-9-]/g, '-');
        return path.join(home, '.deepseek-code', 'projects', projectKey, WEIGHTS_FILENAME);
    }

    /** Escritura atómica: escribe a .tmp y renombra — safe ante crashes. */
    private save(): void {
        const fp = this.filePath();
        const tmp = fp + '.tmp';
        try {
            fs.mkdirSync(path.dirname(fp), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify(this.weights, null, 2), 'utf-8');
            try {
                fs.renameSync(tmp, fp);
            } catch (renameErr) {
                // Windows: renameSync falla con EPERM si el destino existe y está bloqueado.
                // Fallback: overwrite directo + cleanup del .tmp.
                if ((renameErr as NodeJS.ErrnoException).code === 'EPERM') {
                    fs.writeFileSync(fp, fs.readFileSync(tmp), 'utf-8');
                    try { fs.unlinkSync(tmp); } catch { /* ignorar */ }
                } else {
                    throw renameErr;
                }
            }
        } catch (e) {
            if (!this.saveWarnedOnce) {
                this.saveWarnedOnce = true;
                console.warn(
                    `[WeightsStore] No se pudieron persistir los pesos de routing: ${(e as Error).message}. ` +
                    `El aprendizaje funcionará en memoria pero no sobrevivirá al reinicio.`
                );
            }
        }
    }
}
