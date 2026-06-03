/**
 * @description AgentDomain — failureTypes específicos del dominio de agentes.
 *
 * Define los tipos de fallos que el evaluator (y otros sistemas) pueden capturar
 * sobre el comportamiento de los agentes del sistema multi-agente.
 *
 * Cada failureType tiene:
 * - Una expresión regular de detección (keywords en el hallazgo)
 * - Una dimensión por defecto
 * - Una severidad sugerida
 * - Una recomendación genérica
 *
 * @example
 * ```ts
 * const failureType = detectAgentFailureType('agente incorrecto seleccionado para dominio seguridad');
 * // → 'wrong_agent_selected'
 * ```
 */

import { FailureType } from '../types';

// ── Interfaz de metadata ─────────────────────────────────────────────────────

export interface AgentFailureTypeMeta {
  failureType: FailureType;
  dimension: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detectionPatterns: RegExp[];
  genericRecommendation: string;
}

// ── Catálogo de failureTypes de agentes ─────────────────────────────────────

export const AGENT_FAILURE_TYPES: AgentFailureTypeMeta[] = [
  {
    failureType: 'wrong_agent_selected',
    dimension: 'arquitectura',
    severity: 'medium',
    detectionPatterns: [
      /wrong\s*agent/i,
      /agente\s*incorrecto/i,
      /agente\s*equivocado/i,
      /no\s*era\s*el\s*agente\s*adecuado/i,
      /wrong\s*profile/i,
      /perfil\s*incorrecto/i,
      /selecci[oó]n\s*incorrecta/i,
      /deber[ií]a\s*haber\s*ido\s*(a|con)/i,
    ],
    genericRecommendation: 'Revisar la lógica de selección de agente: verificar capability matrix y triggers de perfil',
  },
  {
    failureType: 'agent_timeout',
    dimension: 'rendimiento',
    severity: 'medium',
    detectionPatterns: [
      /agent\s*timeout/i,
      /agente\s*timeout/i,
      /agente\s*(sin|no)\s*responde/i,
      /agente\s*demor[oó]\s*(mucho|demasiado)/i,
      /timeout.*agente/i,
      /agente\s*no\s*contest[oó]/i,
    ],
    genericRecommendation: 'Aumentar el timeout del agente o dividir la tarea en subtareas más pequeñas',
  },
  {
    failureType: 'agent_hallucination',
    dimension: 'confiabilidad',
    severity: 'critical',
    detectionPatterns: [
      /alucinaci[oó]n/i,
      /hallucination/i,
      /informaci[oó]n\s*(incorrecta|falsa|inventada)/i,
      /fabric[oó]\s*(datos|informaci[oó]n)/i,
      /invent[oó]\s*(una|un)/i,
      /respuesta\s*no\s*basada/i,
      /no\s*existe\s*en\s*el\s*c[oód]igo/i,
      /funci[oó]n\s*inexistente/i,
    ],
    genericRecommendation: 'Revisar el contexto del agente (system prompt, herramientas disponibles) y reducir el espacio de búsqueda',
  },
  {
    failureType: 'missing_agent_for_domain',
    dimension: 'arquitectura',
    severity: 'high',
    detectionPatterns: [
      /missing\s*agent/i,
      /agente\s*faltante/i,
      /no\s*hay\s*agente\s*para/i,
      /sin\s*agente\s*especializado/i,
      /dominio\s*sin\s*agente/i,
      /domain\s*without\s*agent/i,
      /no\s*existe\s*agente\s*para/i,
    ],
    genericRecommendation: 'Crear un perfil de agente para el dominio faltante o mapear a un agente general con instrucciones adicionales',
  },
  {
    failureType: 'tool_execution_failed',
    dimension: 'confiabilidad',
    severity: 'high',
    detectionPatterns: [
      /tool\s*execution/i,
      /ejecuci[oó]n\s*de\s*herramienta/i,
      /tool.*fail/i,
      /herramienta.*fall[oó]/i,
      /tool.*error/i,
      /no\s*pudo\s*ejecutar/i,
      /fall[oó]\s*al\s*ejecutar/i,
      /comando\s*fallido/i,
    ],
    genericRecommendation: 'Revisar los parámetros de la herramienta y el entorno: permisos, rutas, dependencias',
  },
  {
    failureType: 'delegation_failed',
    dimension: 'arquitectura',
    severity: 'high',
    detectionPatterns: [
      /delegaci[oó]n.*fall/i,
      /delegation.*fail/i,
      /no\s*pudo\s*delegar/i,
      /agente\s*(hijo|subordinado).*fall[oó]/i,
      /sub.?agente.*error/i,
      /fall[oó]\s*la\s*delegaci[oó]n/i,
    ],
    genericRecommendation: 'Verificar que el agente destino existe y está disponible; implementar fallback al agente general',
  },
  {
    failureType: 'response_rejected_by_evaluator',
    dimension: 'confiabilidad',
    severity: 'medium',
    detectionPatterns: [
      /rechazad[oa]\s*por\s*evaluador/i,
      /rejected\s*by\s*evaluator/i,
      /respuesta\s*rechazada/i,
      /evaluator.*reject/i,
      /evaluador.*rechaz/i,
      /response.*not\s*approved/i,
      /calidad\s*insuficiente/i,
    ],
    genericRecommendation: 'Revisar la respuesta del agente: verificar que cumple con los criterios de calidad y no contiene alucinaciones',
  },
];

// ── Funciones helper ─────────────────────────────────────────────────────────

/**
 * @description Detecta el failureType más probable basado en el contenido del hallazgo.
 */
export function detectAgentFailureType(hallazgo: string): FailureType {
  const lower = hallazgo.toLowerCase();

  for (const meta of AGENT_FAILURE_TYPES) {
    const matches = meta.detectionPatterns.some(pattern => pattern.test(lower));
    if (matches) {
      return meta.failureType;
    }
  }

  return 'unknown_agent' as FailureType;
}

/**
 * @description Obtiene la metadata completa para un failureType.
 */
export function getAgentFailureTypeMeta(failureType: FailureType): AgentFailureTypeMeta | undefined {
  return AGENT_FAILURE_TYPES.find(meta => meta.failureType === failureType);
}

/**
 * @description Obtiene la metadata basada en el contenido del hallazgo.
 */
export function getAgentFailureTypeMetaFromHallazgo(hallazgo: string): AgentFailureTypeMeta {
  const failureType = detectAgentFailureType(hallazgo);
  return getAgentFailureTypeMeta(failureType) ?? AGENT_FAILURE_TYPES[1]; // fallback a agent_timeout
}
