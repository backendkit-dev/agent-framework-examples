/**
 * @description CommitHook — Puente entre el commit-workflow.ps1 y el ReflectionEngine.
 *
 * Captura incidentes durante el proceso de commit (validaciones de formato,
 * typecheck, tests) y los reporta al ReflectionEngine para análisis.
 *
 * Se integra en el Test Validation Gate del commit-workflow.
 *
 * @example
 * ```ts
 * const hook = new CommitHook(engine);
 * await hook.reportCommitFailure('missing_type', 'Mensaje sin tipo Conventional Commits');
 * ```
 */

import { ReflectionEngine } from '../reflection-engine';
import { FailureRecord, ReflectionDomain, FailureType } from '../types';
import { detectCommitFailureType, getCommitFailureTypeMeta } from '../domains/commit-domain';

// ── CommitHook ───────────────────────────────────────────────────────────────

export class CommitHook {
  private engine: ReflectionEngine;

  constructor(engine: ReflectionEngine) {
    this.engine = engine;
  }

  /**
   * @description Reporta un fallo de validación de commit.
   *
   * @param failureType - Tipo de fallo (opcional, se auto-detecta)
   * @param hallazgo - Descripción del fallo
   * @param archivos - Archivos involucrados en el commit
   * @param domain - Dominio del Reflection Engine (default: "commit")
   * @returns El FailureRecord creado y los patrones detectados
   */
  async reportCommitFailure(
    hallazgo: string,
    archivos: string[],
    failureType?: FailureType,
    domain: ReflectionDomain = 'commit'
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    const detectedType = failureType ?? detectCommitFailureType(hallazgo);
    const meta = getCommitFailureTypeMeta(detectedType);

    const record: Omit<FailureRecord, 'id'> = {
      domain,
      failureType: detectedType,
      severity: meta?.severity ?? 'medium',
      dimension: meta?.dimension ?? 'convenciones',
      gate: 'commit-workflow',
      agenteResponsable: 'system',
      hallazgo,
      recomendacion: meta?.genericRecommendation ?? 'Revisar las reglas de validación de commit y corregir',
      archivos,
      fecha: new Date().toISOString(),
    };

    const result = await this.engine.reportIncident(record);
    return result;
  }

  /**
   * @description Reporta un error de typecheck durante el commit.
   */
  async reportTypecheckFailure(
    errorMessage: string,
    archivos: string[]
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    return this.reportCommitFailure(
      `typecheck_failed_before_commit: ${errorMessage}`,
      archivos,
      'typecheck_failed_before_commit'
    );
  }

  /**
   * @description Reporta tests fallidos durante el commit.
   */
  async reportTestFailure(
    errorMessage: string,
    archivos: string[]
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    return this.reportCommitFailure(
      `test_failed_before_commit: ${errorMessage}`,
      archivos,
      'test_failed_before_commit'
    );
  }

  /**
   * @description Ejecuta una reflexión completa del dominio commit.
   */
  async reflectCommitDomain(): Promise<{
    patterns: import('../types').DetectedPattern[];
    promotedRules: import('../types').ManifestPolicyRule[];
  }> {
    return this.engine.reflect({ domain: 'commit', autoPromote: true });
  }

  /**
   * @description Obtiene estadísticas de incidentes del dominio commit.
   */
  async getCommitStats(): Promise<{
    totalIncidents: number;
    unresolvedCount: number;
    patternsByFailureType: Record<string, number>;
  }> {
    const stats = await this.engine.getStats();
    const catalog = this.engine.getCatalog();
    const commitRecords = await catalog.findByDomain('commit');
    const unresolved = await catalog.findUnresolved();

    const patternsByFailureType: Record<string, number> = {};
    for (const record of commitRecords) {
      patternsByFailureType[record.failureType] = (patternsByFailureType[record.failureType] ?? 0) + 1;
    }

    return {
      totalIncidents: stats.totalIncidents,
      unresolvedCount: unresolved.length,
      patternsByFailureType,
    };
  }
}
