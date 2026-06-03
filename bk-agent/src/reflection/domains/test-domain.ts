/**
 * @description TestDomain — failureTypes específicos del dominio de testing.
 *
 * Define los tipos de fallos que el test runner puede capturar y mapear
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
 * const failureType = detectTestFailureType('type error: Property X does not exist');
 * // → 'tsc_noEmit_type_error'
 * ```
 */

import { FailureType } from '../types';

// ── Interfaz de metadata ─────────────────────────────────────────────────────

export interface TestFailureTypeMeta {
  failureType: FailureType;
  dimension: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detectionPatterns: RegExp[];
  genericRecommendation: string;
}

// ── Catálogo de failureTypes de testing ─────────────────────────────────────

export const TEST_FAILURE_TYPES: TestFailureTypeMeta[] = [
  {
    failureType: 'tsc_noEmit_type_error',
    dimension: 'calidad',
    severity: 'critical',
    detectionPatterns: [
      /tsc/i,
      /type.?error/i,
      /no.?emit/i,
      /typecheck/i,
      /type.?check/i,
      /error\s+TS\d+/i,
      /Property\s+'.*'\s+does\s+not\s+exist/i,
      /Type\s+'.*'\s+is\s+not\s+assignable/i,
      /Cannot\s+find\s+module/i,
    ],
    genericRecommendation: 'Corregir el error de tipado TypeScript (ajustar tipos, interfaces o imports) antes de continuar',
  },
  {
    failureType: 'jest_timeout',
    dimension: 'rendimiento',
    severity: 'high',
    detectionPatterns: [
      /jest/i,
      /timeout/i,
      /test\s*timed?\s*out/i,
      /excedi[oó]\s*el\s*t[ií]empo/i,
      /slow\s*test/i,
      /test\s*too\s*slow/i,
      /asincr[oó]nico\s*sin\s*resolver/i,
    ],
    genericRecommendation: 'Revisar el test timeout (aumentar si es un test de integración lento, optimizar si es unitario)',
  },
  {
    failureType: 'coverage_below_threshold',
    dimension: 'calidad',
    severity: 'high',
    detectionPatterns: [
      /coverage/i,
      /cobertura/i,
      /below\s*threshold/i,
      /por\s*debajo\s*del\s*umbral/i,
      /statements.*\d+%/i,
      /branches.*\d+%/i,
      /lines.*\d+%/i,
      /coverage\s*report/i,
    ],
    genericRecommendation: 'Agregar tests para alcanzar el umbral mínimo de cobertura (statements ≥80%, branches ≥70%)',
  },
  {
    failureType: 'flaky_test',
    dimension: 'confiabilidad',
    severity: 'high',
    detectionPatterns: [
      /flaky/i,
      /intermitente/i,
      /sometimes\s*fails/i,
      /a\s*veces\s*falla/i,
      /inconsistente/i,
      /race\s*condition/i,
      /condici[oó]n\s*de\s*carrera/i,
      /test\s*inestable/i,
    ],
    genericRecommendation: 'Identificar la causa raíz del test intermitente (timing, estado compartido, orden de ejecución) y estabilizarlo',
  },
  {
    failureType: 'missing_test_for_use_case',
    dimension: 'calidad',
    severity: 'high',
    detectionPatterns: [
      /missing\s*test/i,
      /sin\s*test/i,
      /faltan\s*test/i,
      /caso\s*de\s*uso\s*sin\s*test/i,
      /use\s*case\s*without\s*test/i,
      /untested/i,
      /no\s*tested/i,
      /flujo\s*sin\s*prueba/i,
    ],
    genericRecommendation: 'Crear tests unitarios y de integración que cubran el caso de uso completo (happy path + errores)',
  },
  {
    failureType: 'test_without_assertion',
    dimension: 'calidad',
    severity: 'medium',
    detectionPatterns: [
      /without\s*assertion/i,
      /sin\s*assert/i,
      /sin\s*afirmaci[oó]n/i,
      /missing\s*expect/i,
      /test\s*vac[ií]o/i,
      /empty\s*test/i,
      /no\s*expect/i,
      /no\s*assert/i,
    ],
    genericRecommendation: 'Agregar assertions (expect/assert) al test para verificar el comportamiento esperado',
  },
  {
    failureType: 'integration_test_without_container',
    dimension: 'arquitectura',
    severity: 'medium',
    detectionPatterns: [
      /integration\s*test/i,
      /test\s*de\s*integraci[oó]n/i,
      /sin\s*container/i,
      /without\s*container/i,
      /mock.*(?:db|database|bd|redis|kafka)/i,
      /mock.*base\s*de\s*datos/i,
      /testcontainers/i,
    ],
    genericRecommendation: 'Usar Testcontainers para tests de integración que requieren BD/Redis/Kafka reales — nunca mockear el driver',
  },
  {
    failureType: 'property_test_missing',
    dimension: 'calidad',
    severity: 'low',
    detectionPatterns: [
      /property.?test/i,
      /property.?based/i,
      /value\s*object\s*sin\s*property/i,
      /fast.?check/i,
      /generative/i,
      /fuzzing/i,
      /invariante/i,
      /invariant/i,
    ],
    genericRecommendation: 'Agregar property-based testing (fast-check) en value objects e invariantes de negocio con ≥1000 iteraciones',
  },
];

// ── Funciones helper ─────────────────────────────────────────────────────────

const NEGATORS = ['no hay', 'sin ', 'no tiene', 'verificar', 'validar', 'evitar'];

/**
 * Verifica si un patron coincide en el texto pero NO esta precedido por un negador.
 * Evita falsos positivos como "verificar que no hay type errors" → tsc_noEmit_type_error.
 */
function matchesWithoutNegation(text: string, pattern: RegExp): boolean {
  const result = pattern.exec(text);
  if (!result) return false;
  const prefix = text.slice(Math.max(0, result.index - 25), result.index);
  return !NEGATORS.some(neg => prefix.includes(neg));
}

/**
 * @description Detecta el failureType más probable basado en el contenido del hallazgo.
 */
export function detectTestFailureType(hallazgo: string): FailureType {
  const lower = hallazgo.toLowerCase();

  for (const meta of TEST_FAILURE_TYPES) {
    const matches = meta.detectionPatterns.some(pattern => matchesWithoutNegation(lower, pattern));
    if (matches) {
      return meta.failureType;
    }
  }

  return 'unknown_test' as FailureType;
}

/**
 * @description Obtiene la metadata completa para un failureType.
 */
export function getTestFailureTypeMeta(failureType: FailureType): TestFailureTypeMeta | undefined {
  return TEST_FAILURE_TYPES.find(meta => meta.failureType === failureType);
}

/**
 * @description Obtiene la metadata basada en el contenido del hallazgo.
 */
export function getTestFailureTypeMetaFromHallazgo(hallazgo: string): TestFailureTypeMeta {
  const failureType = detectTestFailureType(hallazgo);
  return getTestFailureTypeMeta(failureType) ?? TEST_FAILURE_TYPES[1]; // fallback a jest_timeout
}
