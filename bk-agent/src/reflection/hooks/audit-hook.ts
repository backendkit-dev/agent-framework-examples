/**
 * @description AuditHook — Puente entre AuditReporter y ReflectionEngine.
 *
 * Este hook se encarga de transformar los hallazgos de auditoría (AuditFinding)
 * en FailureRecord y reportarlos al ReflectionEngine para su análisis.
 *
 * Se integra en el método completeSprint() del AuditReporter, donde se
 * dispara la reflexión automática al finalizar cada sprint de auditoría.
 *
 * @example
 * ```ts
 * const hook = new AuditHook(engine);
 * await hook.reportFinding(finding, gateName, agente);
 * ```
 */

import { ReflectionEngine } from '../reflection-engine';
import type { AuditFinding } from '../../orchestrator/audit';
import { FailureRecord, ReflectionDomain } from '../types';
import { detectAuditFailureType, getAuditFailureTypeMeta } from '../domains/audit-domain';
import { updateSessionMemory } from '../../memory/updater';


// ── AuditHook ────────────────────────────────────────────────────────────────

export class AuditHook {
  private engine: ReflectionEngine;

  constructor(engine: ReflectionEngine) {
    this.engine = engine;
  }

  /**
   * @description Reporta un hallazgo de auditoría al Reflection Engine.
   * Convierte un AuditFinding en FailureRecord, detecta el failureType
   * automáticamente según el contenido del hallazgo, y lo registra
   * en el catálogo de fallos. Si se detecta un patrón (≥3 ocurrencias),
   * se promueve automáticamente a policyRule.
   *
   * @param finding - Hallazgo de auditoría (AuditFinding)
   * @param gateName - Nombre del gate que generó el hallazgo (ej: "security", "qa")
   * @param domain - Dominio del Reflection Engine (default: "audit")
   * @returns El FailureRecord creado y los patrones detectados
   */
  async reportFinding(
    finding: AuditFinding,
    gateName: string,
    domain: ReflectionDomain = 'audit'
  ): Promise<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }> {
    // Detectar failureType automáticamente desde el texto del hallazgo
    const failureType = detectAuditFailureType(finding.hallazgo);
    const meta = getAuditFailureTypeMeta(failureType);

    // Construir el FailureRecord a partir del AuditFinding
    const record: Omit<FailureRecord, 'id'> = {
      domain,
      failureType,
      severity: finding.severidad,
      dimension: finding.dimension,
      gate: gateName,
      agenteResponsable: finding.agenteResponsable,
      hallazgo: finding.hallazgo,
      recomendacion: finding.recomendacion ?? meta?.genericRecommendation ?? '',
      archivos: finding.evidencia ? [finding.evidencia] : [],
      fecha: finding.resolvedAt ?? new Date().toISOString(),
    };

    // Reportar al Reflection Engine (esto detecta patrones automáticamente)
    const result = await this.engine.reportIncident(record);

    // TASK-01: propagar hallazgos Alta/Critica a sesion-actual.md
    const projectDir = this.engine.getProjectDir();
    if (projectDir && (finding.severidad === 'high' || finding.severidad === 'critical')) {
      await updateSessionMemory(projectDir, {
        issues: [`[${finding.severidad}] ${finding.hallazgo} (gate: ${gateName})`],
      }).catch(() => { /* fallo silencioso — memoria no critica */ });
    }

    return result;
  }

  /**
   * @description Reporta múltiples hallazgos de auditoría en lote.
   * Útil cuando un gate produce varios hallazgos en una misma ejecución.
   *
   * @param findings - Lista de hallazgos de auditoría
   * @param gateName - Nombre del gate que generó los hallazgos
   * @param domain - Dominio del Reflection Engine (default: "audit")
   * @returns Lista de resultados (FailureRecord + patrones detectados)
   */
  async reportFindings(
    findings: AuditFinding[],
    gateName: string,
    domain: ReflectionDomain = 'audit'
  ): Promise<Array<{
    record: FailureRecord;
    patterns: import('../types').DetectedPattern[];
  }>> {
    const results: Array<{
      record: FailureRecord;
      patterns: import('../types').DetectedPattern[];
    }> = [];

    for (const finding of findings) {
      const result = await this.reportFinding(finding, gateName, domain);
      results.push(result);
    }

    return results;
  }

  /**
   * @description Ejecuta una reflexión completa del dominio audit.
   * Escanea todos los hallazgos registrados y promueve patrones.
   * Útil para llamar al finalizar un ciclo de auditoría.
   */
  async reflectAuditDomain(): Promise<{
    patterns: import('../types').DetectedPattern[];
    promotedRules: import('../types').ManifestPolicyRule[];
  }> {
    return this.engine.reflect({ domain: 'audit', autoPromote: true });
  }

  /**
   * @description Obtiene estadísticas de incidentes del dominio audit.
   */
  async getAuditStats(): Promise<{
    totalIncidents: number;
    unresolvedCount: number;
    patternsByFailureType: Record<string, number>;
  }> {
    const stats = await this.engine.getStats();
    const catalog = this.engine.getCatalog();
    const unresolved = await catalog.findUnresolved();

    // Contar por failureType
    const auditRecords = await catalog.findByDomain('audit');
    const patternsByFailureType: Record<string, number> = {};
    for (const record of auditRecords) {
      patternsByFailureType[record.failureType] = (patternsByFailureType[record.failureType] ?? 0) + 1;
    }

    return {
      totalIncidents: stats.totalIncidents,
      unresolvedCount: unresolved.length,
      patternsByFailureType,
    };
  }
}
