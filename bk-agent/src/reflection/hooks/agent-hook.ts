/**
 * @description AgentHook — Puente entre el evaluator de agentes y el ReflectionEngine.
 *
 * Captura incidentes de comportamiento de agentes (selección incorrecta,
 * alucinaciones, timeouts, herramientas fallidas) y los reporta
 * al ReflectionEngine para detección de patrones.
 *
 * Se integra en el ResponseEvaluator (evaluator.ts) y en el Agent Loop (loop.ts).
 *
 * @example
 * ```ts
 * const hook = new AgentHook(engine);
 * await hook.reportAgentFailure('wrong_agent_selected', 'Se seleccionó agente general para tarea de seguridad');
 * ```
 */

import { ReflectionEngine } from '../reflection-engine';
import { FailureRecord, ReflectionDomain, FailureType } from '../types';
import { detectAgentFailureType, getAgentFailureTypeMeta } from '../domains/agent-domain';

// ── AgentHook ────────────────────────────────────────────────────────────────

export class AgentHook {
  private engine: ReflectionEngine;

  constructor(engine: ReflectionEngine) {
    this.engine = engine;
  }

  /**
   * @description Reporta un incidente de comportamiento de agente.
   *
   * @param failureType - Tipo de fallo (opcional, se auto-detecta)
   * @param hallazgo - Descripción del incidente
   * @param agenteResponsable - Nombre del agente involucrado
   * @param archivos - Archivos relacionados
   * @param domain - Dominio del Reflection Engine (default: "agent")
   * @returns El FailureRecord creado y los patrones detectados
   */
  async reportAgentFailure(
    hallazgo: string,
    agenteResponsable: string,
    archivos: string[] = [],
    failureType?: FailureType,
    domain: ReflectionDomain = 'agent'
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    const detectedType = failureType ?? detectAgentFailureType(hallazgo);
    const meta = getAgentFailureTypeMeta(detectedType);

    const record: Omit<FailureRecord, 'id'> = {
      domain,
      failureType: detectedType,
      severity: meta?.severity ?? 'medium',
      dimension: meta?.dimension ?? 'confiabilidad',
      gate: 'agent-loop',
      agenteResponsable,
      hallazgo,
      recomendacion: meta?.genericRecommendation ?? 'Revisar el comportamiento del agente y ajustar el contexto o perfil',
      archivos,
      fecha: new Date().toISOString(),
    };

    const result = await this.engine.reportIncident(record);
    return result;
  }

  /**
   * @description Reporta una alucinación detectada por el evaluator.
   */
  async reportHallucination(
    agente: string,
    respuestaOriginal: string,
    detalle: string
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    return this.reportAgentFailure(
      `agent_hallucination (${agente}): ${detalle} — Respuesta: "${respuestaOriginal.substring(0, 200)}..."`,
      agente,
      [],
      'agent_hallucination'
    );
  }

  /**
   * @description Reporta un timeout de agente.
   */
  async reportTimeout(
    agente: string,
    taskDescription: string
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    return this.reportAgentFailure(
      `agent_timeout: "${agente}" excedió el tiempo límite procesando: "${taskDescription}"`,
      agente,
      [],
      'agent_timeout'
    );
  }

  /**
   * @description Reporta una selección incorrecta de agente.
   */
  async reportWrongAgentSelection(
    agenteSeleccionado: string,
    dominioRequerido: string
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    return this.reportAgentFailure(
      `wrong_agent_selected: Se seleccionó "${agenteSeleccionado}" para dominio "${dominioRequerido}"`,
      agenteSeleccionado,
      [],
      'wrong_agent_selected'
    );
  }

  /**
   * @description Ejecuta una reflexión completa del dominio agent.
   */
  async reflectAgentDomain(): Promise<{
    patterns: import('../types').DetectedPattern[];
    promotedRules: import('../types').ManifestPolicyRule[];
  }> {
    return this.engine.reflect({ domain: 'agent', autoPromote: true });
  }

  /**
   * @description Obtiene estadísticas de incidentes del dominio agent.
   */
  async getAgentStats(): Promise<{
    totalIncidents: number;
    unresolvedCount: number;
    patternsByFailureType: Record<string, number>;
  }> {
    const stats = await this.engine.getStats();
    const catalog = this.engine.getCatalog();
    const agentRecords = await catalog.findByDomain('agent');
    const unresolved = await catalog.findUnresolved();

    const patternsByFailureType: Record<string, number> = {};
    for (const record of agentRecords) {
      patternsByFailureType[record.failureType] = (patternsByFailureType[record.failureType] ?? 0) + 1;
    }

    return {
      totalIncidents: stats.totalIncidents,
      unresolvedCount: unresolved.length,
      patternsByFailureType,
    };
  }
}
