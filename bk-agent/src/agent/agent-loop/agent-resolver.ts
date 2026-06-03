/**
 * @description Resuelve que agente debe manejar el input del usuario.
 * En modo General, solo respeta overrides explicitos (@agent-id).
 * En otros modos, permite auto-switch por scoring o LLM.
 */
import { AgentProfile } from '../profiles';
import { AgentRouter, RoutingMethod } from '../routing/index';
import { OrchestrationResult } from '../../orchestrator/index';

export interface AgentResolution {
  cleanInput: string;
  agentId: string;
  temperature: number;
}

/**
 * @description Resuelve que agente debe manejar el input.
 * Si el General esta activo, solo respeta overrides explicitos (@agent-id).
 * El General NUNCA debe ser reemplazado automaticamente por scoring o LLM,
 * porque el prompt DELEGATION_PROMPT le instruye usar ask_agent para delegar.
 */
export async function resolveAgentAndInput(
  input: string,
  effectiveAgentId: string,
  router: AgentRouter,
  allAgents: AgentProfile[] | undefined,
  orchestrationResult: OrchestrationResult | undefined,
  developerProfile: string | null,
  onRouting?: (profile: AgentProfile, method: RoutingMethod) => void,
): Promise<AgentResolution> {
  if (!allAgents?.length) {
    return { cleanInput: input, agentId: effectiveAgentId, temperature: 0.2 };
  }

  const orchestratedAgents = orchestrationResult?.selectedAgents;
  const preferredAgentIds = new Set(orchestratedAgents?.map(a => a.agentId) ?? []);

  // Cuando el agente activo es General, solo respetar overrides explicitos (@agent-id).
  const allowAutoSwitch = effectiveAgentId !== 'general';

  const onRoutingCallback = (profile: AgentProfile, method: RoutingMethod) => {
    if (method === 'override' || allowAutoSwitch) {
      onRouting?.(profile, method);
    }
  };

  const routingContext = developerProfile
    ? { developerProfile }
    : undefined;

  const result = await router.resolve(input, effectiveAgentId, preferredAgentIds, onRoutingCallback, routingContext);

  // En modo General, solo los overrides cambian el agente; el resto lo maneja el General via ask_agent
  if (!allowAutoSwitch && result.method !== 'override') {
    return { cleanInput: input, agentId: effectiveAgentId, temperature: 0.2 };
  }

  if (result.method !== 'none' && result.agentId !== effectiveAgentId) {
    const profile = allAgents.find(a => a.id === result.agentId);
    if (profile) {
      return {
        cleanInput: result.cleanInput || input,
        agentId: profile.id,
        temperature: profile.temperature ?? 0.2,
      };
    }
  }

  return { cleanInput: result.cleanInput || input, agentId: effectiveAgentId, temperature: 0.2 };
}
