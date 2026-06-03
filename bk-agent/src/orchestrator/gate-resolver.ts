/**
 * @description GateResolver — Única fuente de verdad para la resolución de gates.
 *
 * Consolida la lógica que estaba dispersa en:
 * - buildPipeline() de orchestrator/index.ts
 * - isCommitAllowed() de orchestrator/index.ts
 * - policy-engine.ts (requiredGates)
 * - risk-scorer.ts (riskLevel → gates)
 *
 * Usar esta función como punto de entrada canónico para determinar:
 * qué agentes se activan en cada fase, y si el commit está permitido.
 */

import { TaskContext } from '../types/task-context';
import { PolicyEngineResult } from './policy-engine';
import { AgentPipelinePhase } from './types';
import { OrchestratorConfig } from './types';

export interface GateResolution {
  /** Pipeline de fases de agentes a ejecutar */
  pipeline: AgentPipelinePhase[];
  /** Si el commit está permitido en el estado actual */
  commitAllowed: boolean;
  /** Reviews obligatorias detectadas (para trazabilidad) */
  requiredReviews: Array<'security' | 'architecture' | 'qa'>;
}

/**
 * @description Determina el pipeline de gates y si el commit está permitido.
 *
 * @param task - Contexto de la tarea orquestada
 * @param policyResult - Resultado del PolicyEngine con gates requeridos
 * @param config - Configuración del orquestador
 * @param selectedAgents - Agentes ya seleccionados por el router
 */
export function resolveGates(
  task: TaskContext,
  policyResult: PolicyEngineResult,
  config: OrchestratorConfig,
  selectedAgents: Array<{ agentId: string; score: number; reason: string }>
): GateResolution {
  const pipeline: AgentPipelinePhase[] = [];
  const requiredReviews: Array<'security' | 'architecture' | 'qa'> = [];

  const isHighRisk = task.riskLevel === 'high' || task.riskLevel === 'critical';
  const hasSecurityDomain = task.domains.includes('security');
  const hasArchitectureDomain =
    task.domains.includes('architecture') || task.domains.includes('resilience');

  // Review de seguridad
  if (task.requiresSecurityReview || (isHighRisk && hasSecurityDomain)) {
    pipeline.push({
      phase: 'review',
      agentId: 'security-agent',
      purpose: 'Review security implications',
      optional: false,
    });
    requiredReviews.push('security');
  }

  // Review de arquitectura
  if (task.requiresArchitectureReview || (isHighRisk && hasArchitectureDomain)) {
    pipeline.push({
      phase: 'review',
      agentId: 'architecture-agent',
      purpose: 'Review architecture for high-risk change',
      optional: false,
    });
    requiredReviews.push('architecture');
  }

  // Fase de implementación: mejor agente seleccionado
  const topAgent = selectedAgents[0];
  if (topAgent && topAgent.agentId !== 'general') {
    pipeline.push({
      phase: 'implement',
      agentId: topAgent.agentId,
      purpose: topAgent.reason,
      optional: false,
    });
  }

  // Fase de verificación QA
  const hasImplementPhase = pipeline.some(p => p.phase === 'implement');
  if (hasImplementPhase && task.requiresQaApproval) {
    pipeline.push({
      phase: 'verify',
      agentId: 'qa-engineer',
      purpose: 'Verify implementation quality and best practices',
      optional: false,
    });
    requiredReviews.push('qa');
  }

  const commitAllowed = resolveCommitAllowed(task, policyResult, config);

  return { pipeline, commitAllowed, requiredReviews };
}

/**
 * @description Determina si el commit está permitido según el estado del task y las políticas.
 */
export function resolveCommitAllowed(
  task: TaskContext,
  policyResult: PolicyEngineResult,
  config: OrchestratorConfig
): boolean {
  if (!config.features.commitGate) return true;
  if (task.status === 'commit_allowed') return true;

  if (task.requiresQaApproval && task.status !== 'approved' && task.status !== 'qa_review') return false;
  if (task.requiresSecurityReview && task.status !== 'approved' && task.status !== 'security_review') return false;
  if (task.requiresArchitectureReview && task.status !== 'approved' && task.status !== 'design_review') return false;

  if (!task.requiresQaApproval && !task.requiresSecurityReview && !task.requiresArchitectureReview) {
    return true;
  }

  return false;
}
