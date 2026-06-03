/**
 * @description Risk Scorer — Calcula el nivel de riesgo técnico de una tarea.
 * 
 * Evalúa múltiples factores (breaking change, seguridad, impacto entre
 * servicios, transaccionalidad, criticidad en producción) y produce
 * un score numérico [0-100] que determina el riskLevel.
 * 
 * El score se usa en el Policy Engine para decidir qué gates son
 * obligatorios y qué agentes deben participar.
 */

import { RiskFactors, RiskLevel, TaskContext } from '../types/task-context';
import { OrchestratorConfig, defaultOrchestratorConfig } from './types';

// ── Keywords por factor de riesgo ────────────────────────────────────────────

interface RiskKeyword {
  words: string[];
  /** Factor que incrementa */
  factor: keyof RiskFactors;
  /** Valor a incrementar */
  increment: number;
}

const RISK_KEYWORDS: RiskKeyword[] = [
  // breaking_change
  { words: ['breaking change', 'breaking', 'rompe', 'incompatible'], factor: 'breaking_change', increment: 1 },
  { words: ['migrar', 'migración', 'migracion', 'cambiar api'], factor: 'breaking_change', increment: 1 },
  { words: ['deprecar', 'deprecated', 'obsoleto'], factor: 'breaking_change', increment: 1 },
  { words: ['renombrar', 'rename', 'cambiar nombre'], factor: 'breaking_change', increment: 1 },

  // security_sensitive
  { words: ['token', 'jwt', 'contraseña', 'password', 'secreto'], factor: 'security_sensitive', increment: 1 },
  { words: ['autenticación', 'autenticacion', 'login', 'register'], factor: 'security_sensitive', increment: 1 },
  { words: ['autorización', 'autorizacion', 'permiso', 'rol'], factor: 'security_sensitive', increment: 1 },
  { words: ['datos sensibles', 'pii', 'privacidad', 'gdpr'], factor: 'security_sensitive', increment: 1 },
  { words: ['cifrado', 'encriptar', 'hash', 'bcrypt'], factor: 'security_sensitive', increment: 1 },
  { words: ['api key', 'apikey', 'secret'], factor: 'security_sensitive', increment: 1 },

  // cross_service_impact
  { words: ['microservicio', 'servicio externo', 'otro servicio'], factor: 'cross_service_impact', increment: 1 },
  { words: ['api externa', 'integración', 'integracion', 'tercero'], factor: 'cross_service_impact', increment: 1 },
  { words: ['webhook', 'callback', 'evento', 'event'], factor: 'cross_service_impact', increment: 1 },
  { words: ['saga', 'orquestación', 'coreografía'], factor: 'cross_service_impact', increment: 1 },

  // db_transactional
  { words: ['base de datos', 'bd', 'database', 'db'], factor: 'db_transactional', increment: 1 },
  { words: ['migración', 'migracion', 'schema', 'esquema', 'tabla'], factor: 'db_transactional', increment: 1 },
  { words: ['transacción', 'transaccion', 'transaction', 'rollback'], factor: 'db_transactional', increment: 1 },
  { words: ['consulta', 'query', 'join', 'índice', 'indice'], factor: 'db_transactional', increment: 1 },
  { words: ['modelo de datos', 'entidad', 'entity', 'relación'], factor: 'db_transactional', increment: 1 },

  // production_critical
  { words: ['producción', 'produccion', 'production', 'prod'], factor: 'production_critical', increment: 1 },
  { words: ['deploy', 'despliegue', 'release', 'lanzar'], factor: 'production_critical', increment: 1 },
  { words: ['crítico', 'critico', 'urgente', 'emergencia'], factor: 'production_critical', increment: 1 },
  { words: ['rollback', 'hotfix', 'parche'], factor: 'production_critical', increment: 1 },
];

// ── Complexity keywords ──────────────────────────────────────────────────────

const COMPLEXITY_KEYWORDS: Array<{ words: string[]; level: number }> = [
  { words: ['simple', 'sencillo', 'fácil', 'trivial', 'pequeño'], level: 1 },
  { words: ['medio', 'moderado', 'normal', 'estándar'], level: 4 },
  { words: ['complejo', 'complicado', 'difícil', 'elaborado'], level: 7 },
  { words: ['muy complejo', 'altamente', 'sofisticado', 'crítico'], level: 10 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function matchesKeyword(text: string, keyword: string): boolean {
  if (!keyword.includes(' ')) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(keyword.toLowerCase());
}

// ── Risk Scorer ──────────────────────────────────────────────────────────────

export interface RiskScoreResult {
  riskLevel: RiskLevel;
  riskFactors: RiskFactors;
  totalScore: number;
  breakdown: Array<{ factor: string; score: number; weight: number }>;
}

/**
 * @description Calcula el nivel de riesgo de una tarea basado en el input.
 * 
 * Analiza el texto del usuario para detectar factores de riesgo y
 * calcula un score ponderado usando los pesos de la configuración.
 * 
 * @param input - Texto del usuario
 * @param config - Configuración del orquestador (opcional)
 * @returns RiskScoreResult con nivel, factores y desglose
 */
export function calculateRisk(
  input: string,
  config?: OrchestratorConfig
): RiskScoreResult {
  const cfg = config ?? defaultOrchestratorConfig();
  const lower = input.toLowerCase();

  // 1. Detectar factores de riesgo por keywords
  const factors: RiskFactors = {
    breaking_change: false,
    security_sensitive: false,
    cross_service_impact: false,
    db_transactional: false,
    production_critical: false,
    complexity: 1,
  };

  const usedTerms = new Set<string>();

  for (const rk of RISK_KEYWORDS) {
    for (const word of rk.words) {
      if (!usedTerms.has(word) && matchesKeyword(lower, word)) {
        usedTerms.add(word);
        if (rk.factor === 'complexity') {
          factors.complexity = Math.min(10, factors.complexity + rk.increment);
        } else {
          (factors as any)[rk.factor] = true;
        }
        break;
      }
    }
  }

  // 2. Detectar nivel de complejidad
  for (const ck of COMPLEXITY_KEYWORDS) {
    for (const word of ck.words) {
      if (matchesKeyword(lower, word)) {
        factors.complexity = Math.max(factors.complexity, ck.level);
        break;
      }
    }
  }

  // 3. Calcular score ponderado
  const breakdown: Array<{ factor: string; score: number; weight: number }> = [];
  let totalScore = 0;

  for (const [factor, value] of Object.entries(factors)) {
    const weight = cfg.riskWeights[factor as keyof RiskFactors] ?? 0;
    const score = typeof value === 'boolean' ? (value ? weight : 0) : value * (cfg.riskWeights.complexity ?? 1);
    totalScore += score;
    breakdown.push({ factor, score, weight });
  }

  // 4. Determinar nivel de riesgo
  const riskLevel = getRiskLevel(totalScore, cfg);

  return {
    riskLevel,
    riskFactors: factors,
    totalScore,
    breakdown,
  };
}

/**
 * Determina el nivel de riesgo basado en el score total.
 */
function getRiskLevel(score: number, config: OrchestratorConfig): RiskLevel {
  if (score >= config.riskThresholds.critical) return 'critical';
  if (score >= config.riskThresholds.high) return 'high';
  if (score >= config.riskThresholds.medium) return 'medium';
  return 'low';
}

/**
 * @description Enriquce un TaskContext con el riesgo calculado.
 */
export function enrichTaskWithRisk(
  task: TaskContext,
  config?: OrchestratorConfig
): TaskContext {
  const result = calculateRisk(task.rawPrompt, config);
  return {
    ...task,
    riskLevel: result.riskLevel,
    riskFactors: result.riskFactors,
    requiresArchitectureReview: result.riskLevel === 'critical' || result.riskLevel === 'high',
    requiresSecurityReview: result.riskFactors.security_sensitive,
    requiresQaApproval: result.riskLevel === 'high' || result.riskLevel === 'critical',
    updatedAt: new Date(),
  };
}
