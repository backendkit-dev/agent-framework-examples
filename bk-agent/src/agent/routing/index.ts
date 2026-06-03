/**
 * @description Orquesta el proceso de routing de agentes en tres etapas:
 * 1. Override explícito (@agent-id en el input)
 * 2. Text scoring (rápido, basado en triggers)
 * 3. LLM fallback (más costoso, solo cuando hay empate)
 *
 * Mejoras sobre la versión anterior:
 * - Epsilon-greedy (ε=0.05): 5% de exploración aleatoria para descubrir agentes
 * - tryPreferred ordena candidatos por peso antes de elegir
 * - tryOverride avisa explícitamente cuando el agente no existe
 * - Margen relativo (≥30%) en lugar de umbral absoluto fijo (2 unidades)
 * - Contexto opcional (domain, intent) para pesos contextuales
 */
import { AgentClient } from '../../api/client';
import { AgentProfile } from '../profiles';
import { computeTextScores, applyWeightsToScores, ScoredAgent } from './text-scorer';
import { routeWithLLM } from './llm-router';
import { RoutingWeightsStore, WeightContext } from './weights-store';

export type RoutingMethod = 'override' | 'textual' | 'llm' | 'none';

export interface RoutingResult {
    agentId: string;
    method: RoutingMethod;
    cleanInput: string;
}

/** Tasa de exploración aleatoria (epsilon-greedy). */
const EPSILON = 0.05;

/** Margen relativo mínimo para elegir por text scoring sin ir al LLM. */
const RELATIVE_MARGIN_THRESHOLD = 0.30;

export class AgentRouter {
    private weightsStore: RoutingWeightsStore;

    constructor(
        private client: AgentClient,
        private agents: AgentProfile[],
        weightsStore?: RoutingWeightsStore
    ) {
        this.weightsStore = weightsStore ?? new RoutingWeightsStore();
        this.weightsStore.load();
    }

    /**
     * @description Determina qué agente debe manejar el input del usuario.
     *
     * Flujo: override → exploración ε → preferred → text scoring → LLM fallback
     *
     * @param input - Texto del usuario
     * @param currentAgentId - ID del agente actualmente activo
     * @param preferredAgentIds - IDs de agentes preferidos (del orquestador)
     * @param onRouting - Callback para notificar cambios de agente
     * @param context - Contexto de la tarea (domain, intent) para pesos contextuales
     */
    async resolve(
        input: string,
        currentAgentId: string,
        preferredAgentIds?: Set<string>,
        onRouting?: (profile: AgentProfile, method: RoutingMethod) => void,
        context?: WeightContext
    ): Promise<RoutingResult> {
        // 1. Override explícito (@agent-id)
        const overrideResult = this.tryOverride(input, currentAgentId, onRouting);
        if (overrideResult) return overrideResult;

        // 2. Exploración epsilon-greedy — 5% de probabilidad de explorar
        if (this.shouldExplore()) {
            const exploredResult = this.tryExplore(input, currentAgentId, onRouting);
            if (exploredResult) return exploredResult;
        }

        // 3. Agentes preferidos (del orquestador), ordenados por peso
        const preferredResult = this.tryPreferred(preferredAgentIds, currentAgentId, onRouting, context);
        if (preferredResult) return preferredResult;

        // 4. Text scoring con margen relativo
        const textResult = await this.tryTextScoring(input, currentAgentId, onRouting, context);
        if (textResult) return textResult;

        return { agentId: currentAgentId, method: 'none', cleanInput: input };
    }

    // ── API pública para feedback ──────────────────────────────────────────

    seedFromAgentMd(content: string): void {
        this.weightsStore.seedFromAgentMd(content);
    }

    recordSuccess(agentId: string, context?: WeightContext): void {
        this.weightsStore.recordSuccess(agentId, context);
    }

    recordFailure(agentId: string, context?: WeightContext): void {
        this.weightsStore.recordFailure(agentId, context);
    }

    /** Registra un outcome continuo [0–100] normalizado a [0–1]. */
    recordQaScore(agentId: string, score: number, context?: WeightContext): void {
        this.weightsStore.recordOutcome(agentId, score / 100, context);
    }

    getWeight(agentId: string, context?: WeightContext): number {
        return this.weightsStore.get(agentId, context);
    }

    getAllWeights(): Record<string, number> {
        return this.weightsStore.getAll();
    }

    // ── Estrategias privadas ───────────────────────────────────────────────

    /** Override explícito: @agent-id: input. */
    private tryOverride(
        input: string,
        currentAgentId: string,
        onRouting?: (profile: AgentProfile, method: RoutingMethod) => void
    ): RoutingResult | null {
        const overrideMatch = input.match(/^@([\w-]+)[:\s]+(.+)/s);
        if (!overrideMatch) return null;

        const [, agentId, cleanInput] = overrideMatch;
        const profile = this.agents.find(a => a.id === agentId.toLowerCase());

        if (!profile) {
            // Advertir explícitamente en lugar de silencio
            const available = this.agents.map(a => `@${a.id}`).join(', ');
            console.warn(
                `[Router] Override '@${agentId}' no reconocido. ` +
                `Agentes disponibles: ${available}. Se ignora el override.`
            );
            return null;
        }

        if (profile.id !== currentAgentId) {
            onRouting?.(profile, 'override');
        }
        return { agentId: profile.id, method: 'override', cleanInput: cleanInput.trim() };
    }

    /** Exploración epsilon-greedy: elige un agente aleatorio con probabilidad ε. */
    private tryExplore(
        input: string,
        currentAgentId: string,
        onRouting?: (profile: AgentProfile, method: RoutingMethod) => void
    ): RoutingResult | null {
        const candidates = this.agents.filter(a => a.id !== 'general' && a.id !== currentAgentId && a.triggers?.length);
        if (candidates.length === 0) return null;
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        onRouting?.(chosen, 'textual');
        return { agentId: chosen.id, method: 'textual', cleanInput: input };
    }

    /** Elige el mejor agente preferido según peso histórico. */
    private tryPreferred(
        preferredAgentIds: Set<string> | undefined,
        currentAgentId: string,
        onRouting?: (profile: AgentProfile, method: RoutingMethod) => void,
        context?: WeightContext
    ): RoutingResult | null {
        if (!preferredAgentIds || preferredAgentIds.size === 0) return null;

        // Ordenar candidatos por peso descendente para elegir el más confiable
        const candidates = [...preferredAgentIds]
            .map(id => this.agents.find(a => a.id === id))
            .filter((p): p is AgentProfile => !!p && p.id !== currentAgentId)
            .sort((a, b) => this.weightsStore.get(b.id, context) - this.weightsStore.get(a.id, context));

        if (candidates.length > 0) {
            const best = candidates[0];
            onRouting?.(best, 'textual');
            return { agentId: best.id, method: 'textual', cleanInput: '' };
        }

        // El agente actual ya es el mejor preferido — mantenerlo
        if (preferredAgentIds.has(currentAgentId)) {
            return { agentId: currentAgentId, method: 'none', cleanInput: '' };
        }

        return null;
    }

    /** Text scoring con margen relativo para evitar el umbral absoluto arbitrario. */
    private async tryTextScoring(
        input: string,
        currentAgentId: string,
        onRouting?: (profile: AgentProfile, method: RoutingMethod) => void,
        context?: WeightContext
    ): Promise<RoutingResult | null> {
        const scores = computeTextScores(input, this.agents, currentAgentId);
        if (scores.length === 0) return null;

        const weighted = applyWeightsToScores(scores, (id) => this.weightsStore.get(id, context));
        const best = weighted[0];
        const second = weighted[1];

        if (!best || best.raw < 2) return null;

        // Margen relativo: evita que el umbral absoluto sea inconsistente tras escalar por weights
        const margin = best.raw - (second?.raw ?? 0);
        const relativeMargin = best.raw > 0 ? margin / best.raw : 0;

        if (relativeMargin >= RELATIVE_MARGIN_THRESHOLD) {
            if (best.agent.id !== currentAgentId) {
                onRouting?.(best.agent, 'textual');
            }
            return { agentId: best.agent.id, method: 'textual', cleanInput: input };
        }

        // Empate: usar LLM como fallback
        const chosen = await routeWithLLM(this.client, input, this.agents);
        if (chosen && chosen.id !== currentAgentId) {
            onRouting?.(chosen, 'llm');
            return { agentId: chosen.id, method: 'llm', cleanInput: input };
        }

        return null;
    }

    /** Sortea si se debe explorar en este turno (epsilon-greedy). */
    private shouldExplore(): boolean {
        return Math.random() < EPSILON;
    }
}
