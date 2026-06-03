/**
 * @description Puente entre AgentLoop y el Orchestrator.
 * Ejecuta el pipeline de orquestacion e inyecta el contexto resultante
 * en los mensajes del sistema para que los especialistas lo vean.
 */
import { Message } from '../../api/types';
import { Orchestrator, OrchestrationResult } from '../../orchestrator/index';
import { ReflectionEngine } from '../../reflection/reflection-engine';

/**
 * @description Ejecuta el orquestador con el input del usuario y actualiza
 * los mensajes del sistema con el contexto de orquestacion.
 * Ademas conecta el audit reporter con el reflection engine si no lo esta.
 */
export async function runOrchestrator(
  input: string,
  orchestrator: Orchestrator | undefined,
  reflectionEngine: ReflectionEngine,
  messages: Message[],
  onOrchestration?: (result: OrchestrationResult) => void,
): Promise<OrchestrationResult | undefined> {
  if (!orchestrator) return undefined;

  try {
    const result = await orchestrator.orchestrate(input);

    // Conectar audit reporter con reflection engine (si no lo esta ya)
    const auditReporter = orchestrator.getAuditReporter();
    if (auditReporter && !('_reflectionConnected' in auditReporter)) {
      auditReporter.connectReflectionEngine(reflectionEngine);
      (auditReporter as any)._reflectionConnected = true;
    }

    onOrchestration?.(result);

    const ctxStr = buildOrchestrationContextBlock(result);

    const existingIdx = messages.findIndex(
      m => m.role === 'system' && typeof m.content === 'string' && m.content.includes('## Contexto de Orquestacion'),
    );

    const orchestratorMsg: Message = {
      role: 'system',
      content: ctxStr,
    };

    if (existingIdx >= 0) {
      messages[existingIdx] = orchestratorMsg;
    } else {
      messages.splice(1, 0, orchestratorMsg);
    }

    return result;
  } catch (err) {
    console.warn(`[orchestrator] Error en pipeline: ${err}`);
    return undefined;
  }
}

/**
 * @description Construye un bloque de contexto de orquestacion estructurado
 * para inyectar en el system prompt del especialista.
 * Incluye: ActionType, dominios, riskLevel, agentes seleccionados,
 * pipeline, politicas aplicadas, rawPrompt del usuario y archivos relevantes.
 */
export function buildOrchestrationContextBlock(result: OrchestrationResult): string {
  const task = result.task;
  const lines: string[] = [
    '## Contexto de Orquestacion',
    '',
    `- ActionType: ${task.actionType}`,
    `- Dominios: ${task.domains.join(', ') || 'ninguno'}`,
    `- RiskLevel: ${task.riskLevel}`,
    `- Agentes seleccionados: ${result.selectedAgents.map(a => a.agentId).join(', ')}`,
    `- Gates requeridos: ${result.requiredGates.join(', ') || 'ninguno'}`,
    `- Commit permitido: ${result.commitAllowed}`,
  ];

  if (task.rawPrompt) {
    lines.push(`- Requerimiento original: ${task.rawPrompt.slice(0, 500)}`);
  }

  if (task.relevantFiles && task.relevantFiles.length > 0) {
    lines.push('- Archivos relevantes:');
    for (const f of task.relevantFiles) {
      lines.push(`  * ${f}`);
    }
  }

  if (result.agentPipeline && result.agentPipeline.length > 0) {
    lines.push('- Pipeline secuencial:');
    for (const phase of result.agentPipeline) {
      lines.push(`  * [${phase.phase}] ${phase.agentId}: ${phase.purpose}${phase.optional ? ' (opcional)' : ''}`);
    }
  }

  if (result.appliedPolicies.length > 0) {
    lines.push('- Politicas aplicadas:');
    for (const p of result.appliedPolicies) {
      lines.push(`  * ${p.rule}: ${p.reason}`);
    }
  }

  return lines.join('\n');
}
