/**
 * @description Policy Engine — Motor de reglas para el orquestador.
 * 
 * Evalúa reglas contra un TaskContext y determina:
 * - Qué agentes deben participar obligatoriamente
 * - Qué gates son obligatorios
 * - Qué skills deben ejecutarse
 * 
 * Las reglas se cargan desde ~/.deepseek-code/policy-rules.yaml
 * y se complementan con reglas built-in por defecto.
 */

import { TaskContext, RiskLevel, ActionType } from '../types/task-context';
import { PolicyRule, PolicyCondition, PolicyAction, OrchestrationResult } from './types';

// ── Reglas built-in por defecto ──────────────────────────────────────────────

const DEFAULT_RULES: PolicyRule[] = [
  // Si es diseño → architecture-agent obligatorio
  {
    if: { actionType: 'design' },
    then: {
      mustInclude: ['architecture-agent'],
      requireArchitectureReview: true,
    },
  },

  // Si es security_audit → security-agent obligatorio
  {
    if: { actionType: 'security_audit' },
    then: {
      mustInclude: ['security-agent'],
      requireSecurityReview: true,
    },
  },

  // Si riskLevel es high o critical → QA obligatorio
  {
    if: { riskLevel: ['high', 'critical'] },
    then: {
      mustInclude: ['qa-engineer'],
      requireQaApproval: true,
    },
  },

  // Si riskLevel es critical → architecture review obligatorio
  {
    if: { riskLevel: 'critical' },
    then: {
      mustInclude: ['architecture-agent'],
      requireArchitectureReview: true,
    },
  },

  // Si el dominio es security → security-agent obligatorio
  {
    if: { domain: 'security' },
    then: {
      mustInclude: ['security-agent'],
      requireSecurityReview: true,
    },
  },

  // Si hay breaking change → architecture review obligatorio
  {
    if: { riskFactor: { breaking_change: true } },
    then: {
      mustInclude: ['architecture-agent'],
      requireArchitectureReview: true,
    },
  },

  // Si es security_sensitive → security-agent obligatorio
  {
    if: { riskFactor: { security_sensitive: true } },
    then: {
      mustInclude: ['security-agent'],
      requireSecurityReview: true,
    },
  },

  // Si es cross_service_impact → architecture review
  {
    if: { riskFactor: { cross_service_impact: true } },
    then: {
      mustInclude: ['architecture-agent'],
      requireArchitectureReview: true,
    },
  },

  // Si es db_transactional → QA review
  {
    if: { riskFactor: { db_transactional: true } },
    then: {
      requireQaApproval: true,
    },
  },

  // Si es test → QA como agente principal
  {
    if: { actionType: 'test' },
    then: {
      mustInclude: ['qa-engineer'],
    },
  },

  // Si es refactor → QA review
  {
    if: { actionType: 'refactor' },
    then: {
      requireQaApproval: true,
    },
  },
];

// ── Policy Engine ────────────────────────────────────────────────────────────

export interface PolicyEngineResult {
  /** Agentes que deben incluirse */
  mustInclude: string[];
  /** Gates obligatorios */
  requiredGates: Array<'qa' | 'security' | 'architecture'>;
  /** Skills obligatorios */
  mustExecute: string[];
  /** Reglas que se activaron */
  appliedRules: Array<{ rule: string; reason: string }>;
}

/**
 * @description Evalúa todas las reglas contra un TaskContext.
 * 
 * Las reglas personalizadas (de ~/.deepseek-code/policy-rules.yaml)
 * tienen prioridad sobre las built-in. Si una regla personalizada
 * coincide, se aplica en lugar de la built-in equivalente.
 * 
 * @param task - TaskContext enriquecido con actionType, domains, riskLevel
 * @param customRules - Reglas personalizadas (opcional, desde config)
 * @returns Políticas aplicadas: agentes, gates y skills obligatorios
 */
export function evaluatePolicies(
  task: TaskContext,
  customRules?: PolicyRule[],
  userInput = ''
): PolicyEngineResult {
  const rules = [...DEFAULT_RULES, ...(customRules ?? [])];
  const mustInclude = new Set<string>();
  const requiredGates = new Set<'qa' | 'security' | 'architecture'>();
  const mustExecute = new Set<string>();
  const appliedRules: Array<{ rule: string; reason: string }> = [];

  for (const rule of rules) {
    if (matchesCondition(task, rule.if, userInput)) {
      // Aplicar acción
      if (rule.then.mustInclude) {
        for (const agent of rule.then.mustInclude) {
          mustInclude.add(agent);
        }
      }

      if (rule.then.mustPass) {
        for (const gate of rule.then.mustPass) {
          if (gate === 'qa-agent' || gate === 'qa') requiredGates.add('qa');
          if (gate === 'security-agent' || gate === 'security') requiredGates.add('security');
          if (gate === 'architecture-agent' || gate === 'architecture') requiredGates.add('architecture');
        }
      }

      if (rule.then.mustExecute) {
        for (const skill of rule.then.mustExecute) {
          mustExecute.add(skill);
        }
      }

      if (rule.then.requireArchitectureReview) {
        requiredGates.add('architecture');
      }

      if (rule.then.requireSecurityReview) {
        requiredGates.add('security');
      }

      if (rule.then.requireQaApproval) {
        requiredGates.add('qa');
      }

      // Registrar regla aplicada
      const reason = buildRuleReason(rule.if);
      appliedRules.push({ rule: reason, reason });
    }
  }

  return {
    mustInclude: [...mustInclude],
    requiredGates: [...requiredGates],
    mustExecute: [...mustExecute],
    appliedRules,
  };
}

/**
 * Verifica si un TaskContext cumple con una condición.
 * userInput es el texto original del usuario — necesario para keywords matching.
 */
function matchesCondition(task: TaskContext, condition: PolicyCondition, userInput = ''): boolean {
  // Verificar actionType
  if (condition.actionType) {
    const types = Array.isArray(condition.actionType)
      ? condition.actionType
      : [condition.actionType];
    if (!types.includes(task.actionType)) return false;
  }

  // Verificar riskLevel
  if (condition.riskLevel) {
    const levels = Array.isArray(condition.riskLevel)
      ? condition.riskLevel
      : [condition.riskLevel];
    if (!levels.includes(task.riskLevel)) return false;
  }

  // Verificar domain
  if (condition.domain) {
    const domains = Array.isArray(condition.domain)
      ? condition.domain
      : [condition.domain];
    const hasDomain = domains.some(d => task.domains.includes(d));
    if (!hasDomain) return false;
  }

  // Verificar riskFactor
  if (condition.riskFactor) {
    for (const [factor, value] of Object.entries(condition.riskFactor)) {
      const taskValue = task.riskFactors[factor as keyof typeof task.riskFactors];
      if (taskValue !== value) return false;
    }
  }

  // Verificar keywords en el mensaje original del usuario (OR logic, case-insensitive)
  if (condition.keywords?.length) {
    const msg = userInput.toLowerCase();
    const matches = condition.keywords.some(kw => msg.includes(kw.toLowerCase()));
    if (!matches) return false;
  }

  return true;
}

/**
 * Construye una descripción legible de la regla aplicada.
 */
function buildRuleReason(condition: PolicyCondition): string {
  const parts: string[] = [];
  if (condition.actionType) {
    const types = Array.isArray(condition.actionType)
      ? condition.actionType.join(' | ')
      : condition.actionType;
    parts.push(`actionType=${types}`);
  }
  if (condition.riskLevel) {
    const levels = Array.isArray(condition.riskLevel)
      ? condition.riskLevel.join(' | ')
      : condition.riskLevel;
    parts.push(`riskLevel=${levels}`);
  }
  if (condition.domain) {
    const domains = Array.isArray(condition.domain)
      ? condition.domain.join(' | ')
      : condition.domain;
    parts.push(`domain=${domains}`);
  }
  if (condition.riskFactor) {
    for (const [k, v] of Object.entries(condition.riskFactor)) {
      parts.push(`${k}=${v}`);
    }
  }
  if (condition.keywords?.length) {
    parts.push(`keywords=[${condition.keywords.join(', ')}]`);
  }
  return parts.length > 0 ? parts.join(', ') : 'regla generica';
}

/**
 * @description Aplica políticas a un TaskContext y produce un resultado completo.
 * Es el entry point principal para el orquestador.
 */
export function applyPolicies(
  task: TaskContext,
  customRules?: PolicyRule[],
  userInput = ''
): { task: TaskContext; result: PolicyEngineResult } {
  const result = evaluatePolicies(task, customRules, userInput);

  // Enriquecer task con los resultados
  const enrichedTask: TaskContext = {
    ...task,
    assignedAgents: [...new Set([...task.assignedAgents, ...result.mustInclude])],
    requiresArchitectureReview: task.requiresArchitectureReview || result.requiredGates.includes('architecture'),
    requiresSecurityReview: task.requiresSecurityReview || result.requiredGates.includes('security'),
    requiresQaApproval: task.requiresQaApproval || result.requiredGates.includes('qa'),
    updatedAt: new Date(),
  };

  return { task: enrichedTask, result };
}
