/**
 * @description AuditDomain — failureTypes específicos del dominio de auditoría QA.
 *
 * Define los tipos de fallos que el AuditReporter puede capturar y mapear
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
 * const failureType = detectAuditFailureType('QueryRunner sin release en finally block');
 * // → 'connection_leak'
 * ```
 */

import { FailureType } from '../types';

// ── Interfaz de metadata ─────────────────────────────────────────────────────

export interface AuditFailureTypeMeta {
  failureType: FailureType;
  dimension: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detectionPatterns: RegExp[];
  genericRecommendation: string;
}

// ── Catálogo de failureTypes de auditoría ────────────────────────────────────

export const AUDIT_FAILURE_TYPES: AuditFailureTypeMeta[] = [
  {
    failureType: 'connection_leak',
    dimension: 'seguridad',
    severity: 'high',
    detectionPatterns: [
      /QueryRunner/i,
      /connection/i,
      /release/i,
      /pool/i,
      /conexi[oó]n/i,
      /leak/i,
      /sin\s*close/i,
      /sin\s*release/i,
      /sin\s*cerrar/i,
    ],
    genericRecommendation: 'Agregar finally block con release()/close() para liberar la conexión en todos los casos (éxito y error)',
  },
  {
    failureType: 'missing_rollback',
    dimension: 'seguridad',
    severity: 'critical',
    detectionPatterns: [
      /rollback/i,
      /transacci[oó]n/i,
      /transaction/i,
      /sin\s*rollback/i,
      /commit\s*sin\s*rollback/i,
    ],
    genericRecommendation: 'Implementar manejo de rollback explícito en caso de error dentro de la transacción',
  },
  {
    failureType: 'security_vulnerability',
    dimension: 'seguridad',
    severity: 'critical',
    detectionPatterns: [
      /vulnerabilidad/i,
      /vulnerability/i,
      /brecha/i,
      /exploit/i,
      /inyecci[oó]n/i,
      /injection/i,
      /xss/i,
      /csrf/i,
      /sql\s*injection/i,
      /autenticaci[oó]n/i,
      /authentication/i,
      /autorizaci[oó]n/i,
      /authorization/i,
      /privilegios/i,
    ],
    genericRecommendation: 'Realizar revisión de seguridad dedicada y aplicar parches según OWASP Top 10',
  },
  {
    failureType: 'missing_test_coverage',
    dimension: 'calidad',
    severity: 'high',
    detectionPatterns: [
      /test/i,
      /cobertura/i,
      /coverage/i,
      /sin\s*test/i,
      /faltan\s*test/i,
      /testing\s*faltante/i,
      /sin\s*prueba/i,
    ],
    genericRecommendation: 'Agregar tests unitarios y de integración para cubrir el flujo modificado',
  },
  {
    failureType: 'incomplete_error_handling',
    dimension: 'resiliencia',
    severity: 'medium',
    detectionPatterns: [
      /error\s*handling/i,
      /manejo\s*de\s*errores/i,
      /excepci[oó]n/i,
      /exception/i,
      /sin\s*try/i,
      /sin\s*catch/i,
      /edge\s*case/i,
      /caso\s*borde/i,
      /no\s*se\s*maneja/i,
    ],
    genericRecommendation: 'Implementar manejo de errores estructurado con try/catch y respuesta adecuada para cada caso',
  },
  {
    failureType: 'missing_documentation',
    dimension: 'documentación',
    severity: 'low',
    detectionPatterns: [
      /documentaci[oó]n/i,
      /documentation/i,
      /sin\s*doc/i,
      /faltan\s*docs/i,
      /comentario/i,
      /jsdoc/i,
      /readme/i,
    ],
    genericRecommendation: 'Agregar documentación (JSDoc, README, ADR) explicando el propósito y uso del componente',
  },
  {
    failureType: 'architecture_violation',
    dimension: 'arquitectura',
    severity: 'high',
    detectionPatterns: [
      /arquitectura/i,
      /architecture/i,
      /violaci[oó]n/i,
      /violation/i,
      /acoplamiento/i,
      /coupling/i,
      /responsabilidad/i,
      /capa\s*(saltar|bypass)/i,
      /clean\s*arch/i,
      /hexagonal/i,
      /ddd/i,
    ],
    genericRecommendation: 'Revisar la arquitectura del cambio: asegurar que respeta la separación de capas y bounded contexts',
  },
  {
    failureType: 'missing_logging',
    dimension: 'observabilidad',
    severity: 'medium',
    detectionPatterns: [
      /log/i,
      /logging/i,
      /trazabilidad/i,
      /trace/i,
      /debug/i,
      /sin\s*log/i,
      /no\s*registra/i,
    ],
    genericRecommendation: 'Agregar logs estructurados para trazabilidad en los puntos clave del flujo',
  },
  {
    failureType: 'unvalidated_input',
    dimension: 'seguridad',
    severity: 'high',
    detectionPatterns: [
      /input/i,
      /validaci[oó]n/i,
      /validation/i,
      /sanitiz/i,
      /sin\s*validar/i,
      /no\s*se\s*valida/i,
      /entrada\s*(sin|no)/i,
    ],
    genericRecommendation: 'Agregar validación de entrada (tipo, formato, rango) usando DTOs o clases validadoras',
  },
  {
    failureType: 'hardcoded_secret',
    dimension: 'seguridad',
    severity: 'critical',
    detectionPatterns: [
      /hardcode/i,
      /hardcoded/i,
      /secreto/i,
      /secret/i,
      /api\s*key/i,
      /token\s*hard/i,
      /contraseña\s*en\s*código/i,
      /password\s*in\s*code/i,
      /\.env\b/i,
    ],
    genericRecommendation: 'Mover secretos a variables de entorno o gestor de secretos (Vault, AWS Secrets Manager)',
  },
];

// ── Funciones helper ─────────────────────────────────────────────────────────

const NEGATORS = ['no hay', 'sin ', 'no tiene', 'verificar', 'validar', 'evitar'];

/**
 * Verifica si un patron coincide en el texto pero NO esta precedido por un negador.
 * Evita falsos positivos como "verificar que no hay secrets" → hardcoded_secret.
 */
function matchesWithoutNegation(text: string, pattern: RegExp): boolean {
  const result = pattern.exec(text);
  if (!result) return false;
  const prefix = text.slice(Math.max(0, result.index - 25), result.index);
  return !NEGATORS.some(neg => prefix.includes(neg));
}

/**
 * @description Detecta el failureType más probable basado en el contenido del hallazgo.
 * Recorre los patrones de detección en orden y devuelve el primero que coincide.
 * Si no hay coincidencia, devuelve un fallback genérico.
 *
 * @param hallazgo - Texto del hallazgo de auditoría
 * @returns failureType detectado
 */
export function detectAuditFailureType(hallazgo: string): FailureType {
  const lower = hallazgo.toLowerCase();
  let bestType: FailureType = 'incomplete_error_handling' as FailureType;
  let bestScore = 0;

  for (const meta of AUDIT_FAILURE_TYPES) {
    const score = meta.detectionPatterns.filter(p => matchesWithoutNegation(lower, p)).length;
    if (score > bestScore) {
      bestScore = score;
      bestType = meta.failureType;
    }
  }

  return bestType;
}

/**
 * @description Obtiene la metadata completa para un failureType.
 */
export function getAuditFailureTypeMeta(failureType: FailureType): AuditFailureTypeMeta | undefined {
  return AUDIT_FAILURE_TYPES.find(meta => meta.failureType === failureType);
}

/**
 * @description Obtiene la metadata basada en el contenido del hallazgo.
 * Útil cuando se quiere obtener dimensión y severidad sugerida.
 */
export function getAuditFailureTypeMetaFromHallazgo(hallazgo: string): AuditFailureTypeMeta {
  const failureType = detectAuditFailureType(hallazgo);
  return getAuditFailureTypeMeta(failureType) ?? AUDIT_FAILURE_TYPES[4]; // fallback a incomplete_error_handling
}
