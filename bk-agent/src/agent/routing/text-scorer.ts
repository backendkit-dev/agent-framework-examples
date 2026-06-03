/**
 * @description Evalúa el texto del usuario contra los triggers de cada agente
 * para determinar qué especialista es más relevante. Usa matching de palabras
 * completas y pesos históricos para priorizar agentes con buen desempeño previo.
 * Es el primer paso del routing (rápido, sin LLM).
 */
import { AgentProfile } from '../profiles';

export interface ScoredAgent {
    agent: AgentProfile;
    raw: number;
}

/**
 * @description Calcula un puntaje numérico para cada agente basado en cuántos
 * triggers coinciden con el input del usuario. Los agentes con más coincidencias
 * obtienen mayor puntaje. El agente actual tiene una bonificación de +2 para
 * favorecer continuidad sobre cambios innecesarios.
 *
 * @param input - Texto del usuario a evaluar
 * @param agents - Lista de perfiles de agente disponibles
 * @param currentAgentId - ID del agente actualmente activo
 * @returns Array de agentes con puntaje, ordenados por relevancia descendente
 */
export function computeTextScores(
    input: string,
    agents: AgentProfile[],
    currentAgentId: string
): ScoredAgent[] {
    const inputWords = new Set(
        input.toLowerCase()
            .split(/[\s,;:.!?()\[\]{}"'\/\\+*=<>@#&|~`]+/)
            .filter(w => w.length >= 2)
    );

    const results: ScoredAgent[] = [];

    for (const agent of agents) {
        if (!agent.triggers?.length || agent.id === 'general') continue;

        let raw = 0;
        for (const trigger of agent.triggers) {
            const trigWords = trigger.toLowerCase().split(/[\s\-_]+/).filter(Boolean);
            const allMatch = trigWords.every(tw => inputWords.has(tw));
            if (allMatch) {
                raw += trigWords.length;
            }
        }

        if (raw === 0) continue;

        // Bonificación por continuidad: +2 si es el agente actual
        const adjusted = raw + (agent.id === currentAgentId ? 2 : 0);
        results.push({ agent, raw: adjusted });
    }

    return results.sort((a, b) => b.raw - a.raw);
}

/**
 * @description Aplica los pesos históricos de routing a los puntajes calculados.
 * Los agentes con buen historial de éxito ven sus puntajes aumentados, mientras
 * que los que han fallado reciben un descuento. Esto permite que el sistema
 * aprenda qué especialistas son más confiables para ciertos tipos de consultas.
 *
 * @param scores - Array de agentes con puntaje base
 * @param getWeight - Función que retorna el peso actual de un agente
 * @returns Array con puntajes ajustados por peso, ordenados por relevancia
 */
export function applyWeightsToScores(
    scores: ScoredAgent[],
    getWeight: (agentId: string) => number
): ScoredAgent[] {
    return scores
        .map(({ agent, raw }) => ({
            agent,
            raw: raw * getWeight(agent.id),
        }))
        .sort((a, b) => b.raw - a.raw);
}
