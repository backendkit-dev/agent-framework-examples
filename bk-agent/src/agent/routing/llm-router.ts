/**
 * @description Usa el LLM como fallback cuando el text-scorer no puede
 * determinar un ganador claro (margen < 2 puntos). Consulta al modelo
 * para clasificar el input del usuario al agente más apropiado.
 * Es el tercer y último paso del routing (más costoso, solo cuando es necesario).
 */
import { AgentClient } from '../../api/client';
import { AgentProfile } from '../profiles';

/**
 * @description Clasifica el input del usuario usando el LLM para determinar
 * qué agente especialista es más apropiado. Se usa cuando el text-scorer
 * no encuentra un ganador claro (margen insuficiente entre los dos primeros).
 *
 * El LLM recibe la lista de agentes disponibles y debe responder con un JSON
 * indicando el agent_id seleccionado. Usa deepseek-chat con temperatura 0
 * para máxima determinismo.
 *
 * @param client - Cliente de DeepSeek para la consulta LLM
 * @param input - Texto del usuario a clasificar
 * @param agents - Lista completa de perfiles de agente
 * @returns El perfil del agente seleccionado, o null si no se pudo determinar
 */
export async function routeWithLLM(
    client: AgentClient,
    input: string,
    agents: AgentProfile[]
): Promise<AgentProfile | null> {
    const list = agents
        .filter(a => a.id !== 'general')
        .map(a => `- ${a.id}: ${a.description}`)
        .join('\n');

    const prompt = `Eres un router de agentes. Clasifica el input al agente mas apropiado.
Responde UNICAMENTE con JSON: {"agent_id":"<id>"}

Agentes:
${list}
- general: tarea sin dominio especifico

Input: "${input.slice(0, 400)}"`;

    const originalModel = client.getModel();
    if (originalModel !== 'deepseek-chat') client.setModel('deepseek-chat');

    try {
        const response = await client.chat(
            [{ role: 'user', content: prompt }],
            undefined,
            0.0
        );
        const match = (response.content ?? '').match(/"agent_id"\s*:\s*"([\w-]+)"/);
        const agentId = match?.[1];
        if (!agentId || agentId === 'general') return null;
        return agents.find(a => a.id === agentId) ?? null;
    } catch {
        return null;
    } finally {
        if (originalModel !== 'deepseek-chat') client.setModel(originalModel);
    }
}
