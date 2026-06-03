/**
 * @description BootstrapHook — Puente entre el proceso de inicialización (bootstrap) y el ReflectionEngine.
 *
 * Captura incidentes durante el arranque del sistema (configuración faltante,
 * manifest corrupto, fallos de carga de memoria) y los reporta al
 * ReflectionEngine para análisis y promoción a políticas.
 *
 * Se integra en bootstrap/index.ts (detector.ts, config-loader.ts, memory-loader.ts).
 *
 * @example
 * ```ts
 * const hook = new BootstrapHook(engine);
 * await hook.reportBootstrapFailure('missing_config_yaml', 'No se encontró config.yaml');
 * ```
 */

import { ReflectionEngine } from '../reflection-engine';
import { FailureRecord, ReflectionDomain, FailureType } from '../types';
import { detectBootstrapFailureType, getBootstrapFailureTypeMeta } from '../domains/bootstrap-domain';

// ── BootstrapHook ────────────────────────────────────────────────────────────

export class BootstrapHook {
  private engine: ReflectionEngine;

  constructor(engine: ReflectionEngine) {
    this.engine = engine;
  }

  /**
   * @description Reporta un incidente de bootstrap al Reflection Engine.
   *
   * @param failureType - Tipo de fallo (opcional, se auto-detecta)
   * @param hallazgo - Descripción del incidente
   * @param archivos - Archivos relacionados
   * @param domain - Dominio del Reflection Engine (default: "bootstrap")
   * @returns El FailureRecord creado y los patrones detectados
   */
  async reportBootstrapFailure(
    hallazgo: string,
    archivos: string[] = [],
    failureType?: FailureType,
    domain: ReflectionDomain = 'bootstrap'
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    const detectedType = failureType ?? detectBootstrapFailureType(hallazgo);
    const meta = getBootstrapFailureTypeMeta(detectedType);

    const record: Omit<FailureRecord, 'id'> = {
      domain,
      failureType: detectedType,
      severity: meta?.severity ?? 'high',
      dimension: meta?.dimension ?? 'configuración',
      gate: 'bootstrap',
      agenteResponsable: 'system',
      hallazgo,
      recomendacion: meta?.genericRecommendation ?? 'Revisar la configuración de bootstrap y corregir el error antes de continuar',
      archivos,
      fecha: new Date().toISOString(),
    };

    const result = await this.engine.reportIncident(record);
    return result;
  }

  /**
   * @description Reporta un manifest.yaml corrupto.
   */
  async reportManifestCorrupt(
    parseError: string,
    manifestPath: string
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    return this.reportBootstrapFailure(
      `manifest_corrupt: Error al parsear ${manifestPath}: ${parseError}`,
      [manifestPath],
      'manifest_corrupt'
    );
  }

  /**
   * @description Reporta un fallo de carga de archivo de configuración.
   */
  async reportMissingConfig(
    configPath: string
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    return this.reportBootstrapFailure(
      `missing_config_yaml: No se encontró ${configPath}`,
      [configPath],
      'missing_config_yaml'
    );
  }

  /**
   * @description Reporta un fallo de carga de archivo de memoria.
   */
  async reportMemoryLoadFailure(
    memoryPath: string,
    errorDetail: string
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    return this.reportBootstrapFailure(
      `memory_load_failure: Error cargando ${memoryPath}: ${errorDetail}`,
      [memoryPath],
      'memory_load_failure'
    );
  }

  /**
   * @description Ejecuta una reflexión completa del dominio bootstrap.
   */
  async reflectBootstrapDomain(): Promise<{
    patterns: import('../types').DetectedPattern[];
    promotedRules: import('../types').ManifestPolicyRule[];
  }> {
    return this.engine.reflect({ domain: 'bootstrap', autoPromote: true });
  }

  /**
   * @description Obtiene estadísticas de incidentes del dominio bootstrap.
   */
  async getBootstrapStats(): Promise<{
    totalIncidents: number;
    unresolvedCount: number;
    patternsByFailureType: Record<string, number>;
  }> {
    const stats = await this.engine.getStats();
    const catalog = this.engine.getCatalog();
    const bootstrapRecords = await catalog.findByDomain('bootstrap');
    const unresolved = await catalog.findUnresolved();

    const patternsByFailureType: Record<string, number> = {};
    for (const record of bootstrapRecords) {
      patternsByFailureType[record.failureType] = (patternsByFailureType[record.failureType] ?? 0) + 1;
    }

    return {
      totalIncidents: stats.totalIncidents,
      unresolvedCount: unresolved.length,
      patternsByFailureType,
    };
  }
}
