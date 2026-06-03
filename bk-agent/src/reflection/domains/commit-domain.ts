/**
 * @description CommitDomain — failureTypes específicos del dominio de commits.
 *
 * Define los tipos de fallos que el commit-workflow puede capturar y mapear
 * a FailureRecord para el Reflection Engine.
 *
 * Cada failureType tiene:
 * - Una expresión regular de detección (keywords en el hallazgo)
 * - Una dimensión por defecto
 * - Una severidad sugerida
 * - Una recomendación genérica
 *
 * @example
 * ```ts
 * const failureType = detectCommitFailureType('mensaje sin tipo: "arreglos varios"');
 * // → 'missing_type'
 * ```
 */

import { FailureType } from '../types';

// ── Interfaz de metadata ─────────────────────────────────────────────────────

export interface CommitFailureTypeMeta {
  failureType: FailureType;
  dimension: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detectionPatterns: RegExp[];
  genericRecommendation: string;
}

// ── Catálogo de failureTypes de commits ──────────────────────────────────────

export const COMMIT_FAILURE_TYPES: CommitFailureTypeMeta[] = [
  {
    failureType: 'missing_type',
    dimension: 'convenciones',
    severity: 'medium',
    detectionPatterns: [
      /sin\s*tipo/i,
      /missing\s*type/i,
      /no\s*sigue\s*conventional\s*commits/i,
      /formato\s*inv[aá]lido/i,
      /no\s*empieza\s*con/i,
      /mensaje\s*sin\s*tipo/i,
      /commit\s*sin\s*tipo/i,
      /missing\s*conventional\s*commit/i,
    ],
    genericRecommendation: 'Usar formato Conventional Commits: <tipo>(<ámbito>): <descripción imperativa>',
  },
  {
    failureType: 'wrong_scope',
    dimension: 'convenciones',
    severity: 'low',
    detectionPatterns: [
      /wrong\s*scope/i,
      /scop.*\s*incorrecto/i,
      /[aà]mbito.*\s*incorrecto/i,
      /scop.*\s*inv[aá]lido/i,
      /no\s*coincide\s*con\s*el\s*dominio/i,
      /scop.*\s*no\s*v[aá]lido/i,
    ],
    genericRecommendation: 'Corregir el scope del commit para que coincida con el módulo afectado (cli, core, api, config, etc.)',
  },
  {
    failureType: 'message_too_long',
    dimension: 'convenciones',
    severity: 'low',
    detectionPatterns: [
      /mensaje\s*(demasiado|muy)\s*largo/i,
      /message\s*too\s*long/i,
      /excede\s*los\s*(72|50)\s*caracteres/i,
      /exceeds\s*(72|50)\s*characters/i,
      /long\s*subject/i,
      /asunto\s*muy\s*largo/i,
    ],
    genericRecommendation: 'Acortar el asunto del commit a ≤50 caracteres (o ≤72 si es el cuerpo)',
  },
  {
    failureType: 'missing_issue_reference',
    dimension: 'trazabilidad',
    severity: 'medium',
    detectionPatterns: [
      /missing\s*issue/i,
      /sin\s*referencia/i,
      /sin\s*issue/i,
      /no\s*menciona\s*ticket/i,
      /falta\s*\#\d+/i,
      /missing\s*ticket/i,
      /sin\s*enlace/i,
      /sin\s*tarea/i,
    ],
    genericRecommendation: 'Agregar referencia al issue/ticket en el footer del commit (ej: "Closes #42")',
  },
  {
    failureType: 'coverage_not_run',
    dimension: 'calidad',
    severity: 'high',
    detectionPatterns: [
      /coverage\s*not\s*run/i,
      /tests\s*no\s*ejecutados/i,
      /sin\s*correr\s*test/i,
      /no\s*se\s*ejecutaron\s*los\s*test/i,
      /tests\s*skipped/i,
      /omitir\s*test/i,
      /saltar\s*test/i,
    ],
    genericRecommendation: 'Ejecutar tests (coverage) antes del commit: make test o jest --coverage',
  },
  {
    failureType: 'typecheck_failed_before_commit',
    dimension: 'calidad',
    severity: 'critical',
    detectionPatterns: [
      /typecheck\s*failed/i,
      /type.?check.*fall[oó]/i,
      /tsc.*error/i,
      /fall[oó]\s*type.?check/i,
      /error\s*de\s*tipado/i,
      /compilaci[oó]n\s*fallida/i,
    ],
    genericRecommendation: 'Corregir errores de tipo TypeScript y ejecutar make typecheck antes de reintentar el commit',
  },
  {
    failureType: 'test_failed_before_commit',
    dimension: 'calidad',
    severity: 'critical',
    detectionPatterns: [
      /test\s*failed/i,
      /test.*fall[oói]/i,
      /pruebas?\s*fallidas/i,
      /tests\s*rojos/i,
      /red\s*tests/i,
      /fall[oó]\s*el\s*test/i,
      /tests\s*not\s*passing/i,
    ],
    genericRecommendation: 'Corregir los tests fallidos antes de reintentar el commit (make test)',
  },
  {
    failureType: 'branch_naming_invalid',
    dimension: 'convenciones',
    severity: 'medium',
    detectionPatterns: [
      /branch\s*naming/i,
      /nombre\s*de\s*rama/i,
      /branch\s*name.*invalid/i,
      /rama\s*inv[aá]lida/i,
      /no\s*sigue\s*git\s*flow/i,
      /formato\s*de\s*rama/i,
      /branch.*pattern/i,
    ],
    genericRecommendation: 'Usar Git Flow: feature/<siglas>_<descripcion>_<YYYYMMDD> o fix/<siglas>_<descripcion>_<YYYYMMDD>',
  },
];

// ── Funciones helper ─────────────────────────────────────────────────────────

/**
 * @description Detecta el failureType más probable basado en el contenido del hallazgo.
 */
export function detectCommitFailureType(hallazgo: string): FailureType {
  const lower = hallazgo.toLowerCase();

  for (const meta of COMMIT_FAILURE_TYPES) {
    const matches = meta.detectionPatterns.some(pattern => pattern.test(lower));
    if (matches) {
      return meta.failureType;
    }
  }

  return 'unknown_failure';
}

/**
 * @description Obtiene la metadata completa para un failureType.
 */
export function getCommitFailureTypeMeta(failureType: FailureType): CommitFailureTypeMeta | undefined {
  return COMMIT_FAILURE_TYPES.find(meta => meta.failureType === failureType);
}

/**
 * @description Obtiene la metadata basada en el contenido del hallazgo.
 */
export function getCommitFailureTypeMetaFromHallazgo(hallazgo: string): CommitFailureTypeMeta {
  const failureType = detectCommitFailureType(hallazgo);
  return getCommitFailureTypeMeta(failureType) ?? COMMIT_FAILURE_TYPES[0]; // fallback a unknown_failure (primer elemento del array)
}
