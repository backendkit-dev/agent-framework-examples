/**
 * @description Tipos base del Reflection Engine universal.
 *
 * Define los contratos para FailureRecord, DetectedPattern y las estructuras
 * que conectan el sistema de feedback con la promocion de politicas deterministas.
 *
 * 5 dominios built-in: audit, test, commit, agent, bootstrap
 * Dominios custom: registrados via DomainRegistry y activados por proyecto.
 * Regla de oro: >=3 ocurrencias del mismo failureType -> promocion a policyRule
 *
 * @see domain-registry.ts para gestion dinamica de dominios
 */

import { PolicyRule } from '../orchestrator/types';

// ── Dominios del Reflection Engine ───────────────────────────────────────────

/**
 * Dominios built-in del Reflection Engine.
 * Para dominios custom registrados via DomainRegistry, usar string directamente.
 */
export type ReflectionDomain = 'audit' | 'test' | 'commit' | 'agent' | 'bootstrap';

/**
 * Cualquier dominio valido: built-in o custom registrado via DomainRegistry.
 * Usar este tipo en interfaces que deben aceptar dominios dinamicos.
 */
export type AnyDomain = ReflectionDomain | (string & {});

/**
 * Todos los failureTypes válidos del sistema, organizados por dominio.
 * Se usa como referencia central para validación y documentación.
 */
export const FAILURE_TYPES_BY_DOMAIN: Record<ReflectionDomain, readonly string[]> = {
  audit: [
    'missing_rollback',
    'connection_leak',
    'security_vulnerability',
    'missing_test_coverage',
    'incomplete_error_handling',
    'missing_documentation',
    'architecture_violation',
    'missing_logging',
    'unvalidated_input',
    'hardcoded_secret',
  ] as const,
  test: [
    'tsc_noEmit_type_error',
    'jest_timeout',
    'coverage_below_threshold',
    'flaky_test',
    'missing_test_for_use_case',
    'test_without_assertion',
    'integration_test_without_container',
    'property_test_missing',
  ] as const,
  commit: [
    'unknown_failure',
    'missing_type',
    'wrong_scope',
    'message_too_long',
    'missing_issue_reference',
    'coverage_not_run',
    'typecheck_failed_before_commit',
    'test_failed_before_commit',
    'branch_naming_invalid',
  ] as const,
  agent: [
    'wrong_agent_selected',
    'agent_timeout',
    'agent_hallucination',
    'missing_agent_for_domain',
    'tool_execution_failed',
    'delegation_failed',
    'response_rejected_by_evaluator',
  ] as const,
  bootstrap: [
    'missing_config_yaml',
    'wrong_project_type_detected',
    'memory_load_failure',
    'manifest_corrupt',
    'seed_config_failed',
    'agent_profile_load_failed',
    'vault_sync_failed',
  ] as const,
};

/**
 * Tipo unión de todos los failureTypes del sistema.
 */
export type FailureType = typeof FAILURE_TYPES_BY_DOMAIN[ReflectionDomain][number];

// ── FailureRecord ────────────────────────────────────────────────────────────

/**
 * @description Registro de un incidente capturado por el sistema.
 * Se persiste en el FailureCatalog (~/.deepseek-code/projects/{hash}/reflection/failures.json)
 * y es la unidad básica de aprendizaje del Reflection Engine.
 */
export interface FailureRecord {
  /** ID unico del incidente (hash: dominio+failureType+timestamp) */
  id: string;
  /** Dominio al que pertenece (built-in o custom) */
  domain: AnyDomain;
  /** Tipo de fallo (pertenece al dominio) */
  failureType: string;
  /** Severidad del incidente */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Dimension de calidad afectada (ej: "seguridad", "infraestructura") */
  dimension: string;
  /** Gate o rutina donde se capturó (ej: "security", "qa-engineer", "vitest") */
  gate: string;
  /** Agente que produjo el hallazgo (o "system" si es automático) */
  agenteResponsable: string;
  /** Descripción del fallo */
  hallazgo: string;
  /** Recomendación para resolverlo */
  recomendacion: string;
  /** Archivos involucrados en el incidente */
  archivos: string[];
  /** Fecha ISO del incidente */
  fecha: string;
  /** SHA del commit que resolvió este incidente (opcional) */
  resolvedByCommit?: string;
  /** Fecha de resolución (ISO) */
  resolvedAt?: string;
  /** Contexto adicional en JSON (ej: mensaje de error, stack trace) */
  contextRaw?: string;
}

// ── DetectedPattern ──────────────────────────────────────────────────────────

/**
 * @description Patrón detectado por el PatternDetector.
 * Representa un conjunto de ≥N ocurrencias del mismo failureType
 * que califica para promoción a policyRule determinista.
 */
export interface DetectedPattern {
  /** failureType que se repite */
  failureType: string;
  /** Dominio al que pertenece (built-in o custom) */
  domain: AnyDomain;
  /** Número de ocurrencias detectadas */
  count: number;
  /** Primera vez que se vio (fecha ISO) */
  firstSeen: string;
  /** Última vez que se vio (fecha ISO) */
  lastSeen: string;
  /** Severidad dominante entre los registros */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** IDs de los FailureRecord que componen este patron */
  recordIds: string[];
  /** Dimensión más frecuente entre los registros */
  dominantDimension: string;
  /** Gate más frecuente */
  dominantGate: string;
  /** Recomendación extraída del último registro */
  recommendedAction: string;
  /** Si ya fue promovido a policyRule */
  promotedToPolicy: boolean;
  /** Cuándo se promovió (fecha ISO) */
  promotedAt?: string;
  /** ID de la policyRule generada (para trazabilidad) */
  policyRuleId?: string;
}

// ── ManifestPolicyRule ───────────────────────────────────────────────────────

/**
 * @description Regla de política que se escribe en manifest.yaml.
 * Extiende PolicyRule con metadatos de auto-generación.
 *
 * Compatible con el PolicyEngine existente (policy-engine.ts)
 * pero añade trazabilidad del Reflection Engine.
 */
export interface ManifestPolicyRule extends PolicyRule {
  /** ID único de la regla (ej: "POL-TEST-001") */
  id: string;
  /** Nombre legible de la regla */
  name: string;
  /** Trigger que activo la creacion automatica */
  trigger: {
    /** Dominio donde se detecto el patron (built-in o custom) */
    domain: AnyDomain;
    /** failureType que disparó la promoción */
    pattern: string;
    /** Número mínimo de ocurrencias configurado */
    minOccurrences: number;
  };
  /** Indica si fue generada automáticamente por el Reflection Engine */
  autoGenerated: boolean;
  /** ADR que documenta esta regla (si se generó uno) */
  sourceADR?: string;
  /** Fecha de creación (ISO) */
  createdAt: string;
  /** Versión del Reflection Engine que la generó */
  engineVersion: string;
  /** Telemetría mínima: cuántas veces la regla ayudó (success) o perjudicó (failure) */
  outcomes?: {
    success: number;
    failure: number;
    lastSeen: string;
  };
}

// ── ReflectionConfig ─────────────────────────────────────────────────────────

/**
 * @description Configuración del Reflection Engine.
 * Se puede definir en orchestrator.yaml o usar defaults.
 */
export interface ReflectionConfig {
  /** Feature flag global */
  enabled: boolean;
  /** Umbral de ocurrencias para promoción (default: 3) */
  promotionThreshold: number;
  /** Promoción automática sin confirmación */
  autoPromote: boolean;
  /** Número máximo de reglas auto-generadas permitidas (default: 20) */
  maxAutoGeneratedRules: number;
  /** Generar ADR automático al promover */
  autoGenerateAdr: boolean;
  /** Dominios activos (built-in o custom). Sobreescrito por DomainRegistry si esta presente. */
  activeDomains: AnyDomain[];
  /** Ruta del manifest.yaml (relativa o absoluta) */
  manifestPath: string;
}

export function defaultReflectionConfig(): ReflectionConfig {
  return {
    enabled: true,
    promotionThreshold: 3,
    autoPromote: true,
    maxAutoGeneratedRules: 20,
    autoGenerateAdr: true,
    activeDomains: ['audit', 'test', 'commit', 'agent', 'bootstrap'] as AnyDomain[],
    manifestPath: 'manifest.yaml',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Genera un ID único para un FailureRecord.
 * Formato: fail_<timestamp_36>_<random_6>
 */
export function generateFailureId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `fail_${timestamp}_${random}`;
}

/**
 * Genera un ID unico para un ManifestPolicyRule.
 * Formato: POL-<DOMINIO>-<NUMERO>
 */
export function generatePolicyRuleId(domain: AnyDomain, number: number): string {
  const prefix = domain.toUpperCase().slice(0, 4);
  return `POL-${prefix}-${String(number).padStart(3, '0')}`;
}
