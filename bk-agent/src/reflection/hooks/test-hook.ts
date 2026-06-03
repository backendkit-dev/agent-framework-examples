/**
 * @description TestHook — Puente entre el test runner (jest) y el ReflectionEngine.
 *
 * Transforma resultados de testing (fallos de typecheck, timeouts, cobertura baja)
 * en FailureRecord y los reporta al ReflectionEngine.
 *
 * Se integra en el pipeline de test validation gate.
 *
 * @example
 * ```ts
 * const hook = new TestHook(engine);
 * await hook.reportTestFailure('tsc_noEmit_type_error', 'Error TS2345', files);
 * ```
 */

import { ReflectionEngine } from '../reflection-engine';
import { FailureRecord, ReflectionDomain, FailureType } from '../types';
import { detectTestFailureType, getTestFailureTypeMeta } from '../domains/test-domain';

// ── TestHook ─────────────────────────────────────────────────────────────────

export class TestHook {
  private engine: ReflectionEngine;

  constructor(engine: ReflectionEngine) {
    this.engine = engine;
  }

  /**
   * @description Reporta un fallo de test al Reflection Engine.
   * Convierte los datos en FailureRecord, detecta el failureType
   * automáticamente según el mensaje de error.
   *
   * @param failureType - Tipo de fallo detectado (opcional, se auto-detecta si no se provee)
   * @param errorMessage - Mensaje de error del test/typecheck
   * @param archivos - Archivos involucrados en el fallo
   * @param domain - Dominio del Reflection Engine (default: "test")
   * @returns El FailureRecord creado y los patrones detectados
   */
  async reportTestFailure(
    errorMessage: string,
    archivos: string[],
    failureType?: FailureType,
    domain: ReflectionDomain = 'test'
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    // Detectar failureType si no se provee
    const detectedType = failureType ?? detectTestFailureType(errorMessage);
    const meta = getTestFailureTypeMeta(detectedType);

    // Determinar severidad según el tipo
    const severity = meta?.severity ?? 'high';

    // Construir el FailureRecord
    const record: Omit<FailureRecord, 'id'> = {
      domain,
      failureType: detectedType,
      severity,
      dimension: meta?.dimension ?? 'calidad',
      gate: 'jest',
      agenteResponsable: 'system',
      hallazgo: errorMessage,
      recomendacion: meta?.genericRecommendation ?? 'Revisar el error del test y corregirlo antes de continuar',
      archivos,
      fecha: new Date().toISOString(),
    };

    // Reportar al Reflection Engine
    const result = await this.engine.reportIncident(record);
    return result;
  }

  /**
   * @description Reporta un fallo de cobertura por debajo del umbral.
   */
  async reportCoverageFailure(
    threshold: string,
    actual: string,
    archivos: string[]
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    const message = `Cobertura por debajo del umbral: esperado ${threshold}, obtenido ${actual}`;
    return this.reportTestFailure(message, archivos, 'coverage_below_threshold');
  }

  /**
   * @description Reporta un test como flaky (intermitente).
   */
  async reportFlakyTest(
    testName: string,
    failureRate: string,
    archivos: string[]
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    const message = `Test flaky detectado: "${testName}" (falla ${failureRate} de las veces)`;
    return this.reportTestFailure(message, archivos, 'flaky_test');
  }

  /**
   * @description Ejecuta una reflexión completa del dominio test.
   */
  async reflectTestDomain(): Promise<{
    patterns: import('../types').DetectedPattern[];
    promotedRules: import('../types').ManifestPolicyRule[];
  }> {
    return this.engine.reflect({ domain: 'test', autoPromote: true });
  }

  /**
   * @description Obtiene estadísticas de incidentes del dominio test.
   */
  async getTestStats(): Promise<{
    totalIncidents: number;
    unresolvedCount: number;
    patternsByFailureType: Record<string, number>;
  }> {
    const stats = await this.engine.getStats();
    const catalog = this.engine.getCatalog();
    const testRecords = await catalog.findByDomain('test');
    const unresolved = await catalog.findUnresolved();

    const patternsByFailureType: Record<string, number> = {};
    for (const record of testRecords) {
      patternsByFailureType[record.failureType] = (patternsByFailureType[record.failureType] ?? 0) + 1;
    }

    return {
      totalIncidents: stats.totalIncidents,
      unresolvedCount: unresolved.length,
      patternsByFailureType,
    };
  }
}
