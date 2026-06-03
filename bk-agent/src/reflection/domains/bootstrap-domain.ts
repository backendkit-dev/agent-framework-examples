/**
 * @description BootstrapDomain — failureTypes específicos del dominio de bootstrap.
 *
 * Define los tipos de fallos que el proceso de inicialización puede capturar
 * y mapear a FailureRecord para el Reflection Engine.
 *
 * Cada failureType tiene:
 * - Una expresión regular de detección (keywords en el hallazgo)
 * - Una dimensión por defecto
 * - Una severidad sugerida
 * - Una recomendación genérica
 *
 * @example
 * ```ts
 * const failureType = detectBootstrapFailureType('manifest.yaml corrupto');
 * // → 'manifest_corrupt'
 * ```
 */

import { FailureType } from '../types';

// ── Interfaz de metadata ─────────────────────────────────────────────────────

export interface BootstrapFailureTypeMeta {
  failureType: FailureType;
  dimension: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detectionPatterns: RegExp[];
  genericRecommendation: string;
}

// ── Catálogo de failureTypes de bootstrap ────────────────────────────────────

export const BOOTSTRAP_FAILURE_TYPES: BootstrapFailureTypeMeta[] = [
  {
    failureType: 'missing_config_yaml',
    dimension: 'configuración',
    severity: 'high',
    detectionPatterns: [
      /missing\s*config/i,
      /config.*(not\s*found|faltante|no\s*existe)/i,
      /config\.yaml\s*(no|not)/i,
      /(no|not)\s*se\s*(encontr[oó]|encuentra)\s*.*config/i,
      /sin\s*archivo\s*de\s*configuraci[oó]n/i,
      /configuraci[oó]n\s*(no|faltante)/i,
      /yaml\s*no\s*encontrado/i,
    ],
    genericRecommendation: 'Crear el archivo de configuración faltante (.ai-assistant/config.yaml) o ejecutar el seed automático',
  },
  {
    failureType: 'wrong_project_type_detected',
    dimension: 'configuración',
    severity: 'medium',
    detectionPatterns: [
      /wrong\s*project\s*type/i,
      /tipo\s*de\s*proyecto\s*incorrecto/i,
      /no\s*se\s*pudo\s*detectar/i,
      /project\s*type.*(wrong|incorrect)/i,
      /detecci[oó]n\s*(fallida|incorrecta)/i,
      /tipo\s*err[oó]neo/i,
    ],
    genericRecommendation: 'Revisar la configuración del proyecto: verificar archivos de detección (package.json, .csproj, pom.xml, etc.)',
  },
  {
    failureType: 'memory_load_failure',
    dimension: 'persistencia',
    severity: 'critical',
    detectionPatterns: [
      /memory\s*load/i,
      /carga\s*de\s*memoria/i,
      /no\s*se\s*pudo\s*cargar\s*la\s*memoria/i,
      /memory.*fail/i,
      /memoria.*fall[oó]/i,
      /sesió?n.*no\s*cargada/i,
      /contexto.*no\s*cargado/i,
    ],
    genericRecommendation: 'Verificar la integridad de los archivos de memoria (~/.deepseek-code/projects/{hash}/memory/) y regenerar si es necesario',
  },
  {
    failureType: 'manifest_corrupt',
    dimension: 'configuración',
    severity: 'critical',
    detectionPatterns: [
      /manifest.*(corrupt|malformed|inv[aá]lido|broken)/i,
      /yaml.*parse/i,
      /error\s*al\s*parsear/i,
      /manifest\.yaml.*(error|fall[oó])/i,
      /archivo\s*manifest.*inv[aá]lido/i,
      /corrupto/i,
      /estructura.*inv[aá]lida/i,
    ],
    genericRecommendation: 'Ejecutar regenerateConfigFile() para recuperar el manifest.yaml o restaurar desde backup',
  },
  {
    failureType: 'seed_config_failed',
    dimension: 'configuración',
    severity: 'high',
    detectionPatterns: [
      /seed.*(fail|error|fall[oó])/i,
      /configuraci[oó]n\s*inicial\s*fallida/i,
      /no\s*se\s*pudo\s*sembrar/i,
      /seed.*config.*error/i,
      /bootstrap.*(fail|fall[oó])/i,
      /config\s*seed.*fail/i,
    ],
    genericRecommendation: 'Revisar logs de bootstrap y ejecutar seedConfig() manualmente, verificando permisos de escritura',
  },
  {
    failureType: 'agent_profile_load_failed',
    dimension: 'configuración',
    severity: 'high',
    detectionPatterns: [
      /agent\s*profile.*(fail|load|error)/i,
      /perfil\s*de\s*agente.*(fail|error)/i,
      /no\s*se\s*pudo\s*cargar\s*el\s*perfil/i,
      /profile.*load.*fail/i,
      /agente.*no\s*encontrado/i,
      /agente.*carga.*fall[oó]/i,
    ],
    genericRecommendation: 'Verificar que los archivos de perfil de agente existen en agents/*.md y tienen formato YAML válido',
  },
  {
    failureType: 'vault_sync_failed',
    dimension: 'persistencia',
    severity: 'medium',
    detectionPatterns: [
      /vault.*(sync|fail|error)/i,
      /sincronizaci[oó]n.*vault.*fall[oó]/i,
      /no\s*se\s*pudo\s*sincronizar/i,
      /vault.*not\s*found/i,
      /b[oó]veda.*(fail|error)/i,
      /obsidian.*sync.*fail/i,
    ],
    genericRecommendation: 'Verificar que la ruta del vault de Obsidian es correcta y que el directorio existe',
  },
];

// ── Funciones helper ─────────────────────────────────────────────────────────

/**
 * @description Detecta el failureType más probable basado en el contenido del hallazgo.
 */
export function detectBootstrapFailureType(hallazgo: string): FailureType {
  const lower = hallazgo.toLowerCase();

  for (const meta of BOOTSTRAP_FAILURE_TYPES) {
    const matches = meta.detectionPatterns.some(pattern => pattern.test(lower));
    if (matches) {
      return meta.failureType;
    }
  }

  return 'unknown_bootstrap' as FailureType;
}

/**
 * @description Obtiene la metadata completa para un failureType.
 */
export function getBootstrapFailureTypeMeta(failureType: FailureType): BootstrapFailureTypeMeta | undefined {
  return BOOTSTRAP_FAILURE_TYPES.find(meta => meta.failureType === failureType);
}

/**
 * @description Obtiene la metadata basada en el contenido del hallazgo.
 */
export function getBootstrapFailureTypeMetaFromHallazgo(hallazgo: string): BootstrapFailureTypeMeta {
  const failureType = detectBootstrapFailureType(hallazgo);
  return getBootstrapFailureTypeMeta(failureType) ?? BOOTSTRAP_FAILURE_TYPES[4]; // fallback a seed_config_failed
}
