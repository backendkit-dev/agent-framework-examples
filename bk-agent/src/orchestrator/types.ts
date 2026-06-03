/**
 * @description Tipos compartidos del módulo de orquestación.
 * Define las interfaces para Capability Matrix, Policy Rules,
 * y la configuración del orquestador que se carga desde ~/.deepseek-code/.
 */

import { ActionType, RiskLevel, RiskFactors, TaskContext } from '../types/task-context';

// ── Capability Matrix ────────────────────────────────────────────────────────

/**
 * @description Define qué dominios y skills posee cada agente.
 * Se carga desde ~/.deepseek-code/capability-matrix.yaml
 * 
 * @example
 * ```yaml
 * architecture-agent:
 *   owns:
 *     - architecture
 *     - resilience
 *     - distributed-systems
 *   skills:
 *     - architecture-review
 *     - adr-generation
 * ```
 */
export interface AgentCapability {
  /** Dominios que este agente domina */
  owns: string[];
  /** Skills que este agente puede ejecutar */
  skills: string[];
  /** Peso base para routing (0.0 - 1.0) */
  baseWeight?: number;
}

export type CapabilityMatrix = Record<string, AgentCapability>;

// ── Policy Rules ─────────────────────────────────────────────────────────────

/**
 * @description Una regla del Policy Engine.
 * Define condiciones y acciones obligatorias.
 * 
 * @example
 * ```yaml
 * - if:
 *     actionType: design
 *   then:
 *     mustInclude:
 *       - architecture-agent
 * ```
 */
export interface PolicyRule {
  /** Condiciones que activan esta regla */
  if: PolicyCondition;
  /** Acciones a ejecutar cuando se cumple la condición */
  then: PolicyAction;
}

export interface PolicyCondition {
  actionType?: ActionType | ActionType[];
  riskLevel?: RiskLevel | RiskLevel[];
  domain?: string | string[];
  riskFactor?: Partial<Record<keyof RiskFactors, boolean>>;
  /** Palabras clave que deben aparecer en el mensaje del usuario (case-insensitive, OR logic) */
  keywords?: string[];
  /** Reservado — no se evalua actualmente */
  customExpression?: string;
}

export interface PolicyAction {
  /** Agentes que deben incluirse obligatoriamente */
  mustInclude?: string[];
  /** Gates que deben pasar obligatoriamente */
  mustPass?: string[];
  /** Skills que deben ejecutarse */
  mustExecute?: string[];
  /** Si se requiere revisión de arquitectura */
  requireArchitectureReview?: boolean;
  /** Si se requiere revisión de seguridad */
  requireSecurityReview?: boolean;
  /** Si se requiere aprobación de QA */
  requireQaApproval?: boolean;
}

// ── Configuración del orquestador ────────────────────────────────────────────

/**
 * @description Configuración completa del orquestador.
 * Se carga desde ~/.deepseek-code/orchestrator.yaml
 */
export interface OrchestratorConfig {
  /** Feature flags para habilitar/deshabilitar componentes */
  features: {
    /** Clasificación formal de intents */
    intentDetection: boolean;
    /** Detección de dominios */
    domainDetection: boolean;
    /** Scoring de riesgo */
    riskScoring: boolean;
    /** Policy engine con reglas */
    policyEngine: boolean;
    /** State machine formal */
    fsm: boolean;
    /** QA gate obligatorio */
    qaGate: boolean;
    /** Commit gate bloqueante */
    commitGate: boolean;
  };

  /** Umbrales de riesgo */
  riskThresholds: {
    /** Puntuación mínima para considerar low risk */
    low: number;
    /** Puntuación máxima para considerar medium risk */
    medium: number;
    /** Puntuación máxima para considerar high risk */
    high: number;
    /** Por encima de este valor es critical */
    critical: number;
  };

  /** Pesos para cada factor de riesgo */
  riskWeights: Record<keyof RiskFactors, number>;
}

// ── Resultado del orquestador ────────────────────────────────────────────────

/**
 * @description Resultado completo del pipeline de orquestación.
 * Incluye el TaskContext enriquecido, los agentes seleccionados,
 * las políticas aplicadas, los gates requeridos y el pipeline secuencial.
 */
export interface OrchestrationResult {
  /** Tarea enriquecida con toda la clasificación */
  task: TaskContext;
  /** Agentes seleccionados (ordenados por prioridad) */
  selectedAgents: Array<{
    agentId: string;
    score: number;
    reason: string;
  }>;
  /** Políticas que se activaron */
  appliedPolicies: Array<{
    rule: string;
    reason: string;
  }>;
  /** Gates que deben pasar */
  requiredGates: Array<'qa' | 'security' | 'architecture'>;
  /** Si el commit está permitido */
  commitAllowed: boolean;
  /** Pipeline secuencial de agentes (fases: review → implement → verify) */
  agentPipeline?: AgentPipelinePhase[];
}

/**
 * @description Fase del pipeline secuencial de agentes.
 * Cada fase representa un paso en el flujo review → implement → verify.
 */
export type AgentPipelinePhaseType = 'review' | 'implement' | 'verify';

export interface AgentPipelinePhase {
  /** Tipo de fase */
  phase: AgentPipelinePhaseType;
  /** ID del agente responsable */
  agentId: string;
  /** Propósito de esta fase */
  purpose: string;
  /** Si es opcional dentro del pipeline */
  optional: boolean;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export function defaultOrchestratorConfig(): OrchestratorConfig {
  return {
    features: {
      intentDetection: true,
      domainDetection: true,
      riskScoring: true,
      policyEngine: true,
      fsm: true,     // Fase 4
      qaGate: true,  // Fase 4
      commitGate: true, // Fase 4
    },
    riskThresholds: {
      low: 10,
      medium: 30,
      high: 60,
      critical: 80,
    },
    riskWeights: {
      breaking_change: 25,
      security_sensitive: 30,
      cross_service_impact: 20,
      db_transactional: 15,
      production_critical: 25,
      complexity: 1, // se multiplica por complexity
    },
  };
}
