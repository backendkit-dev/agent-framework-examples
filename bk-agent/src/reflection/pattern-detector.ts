/**
 * @description PatternDetector — Busca patrones de fallos repetidos en el FailureCatalog.
 *
 * Aplica la regla de oro: si un mismo failureType aparece ≥N veces (default: 3),
 * se considera un patrón candidato a promoción a policyRule determinista.
 *
 * Opera por dominio o globalmente. Los patrones detectados alimentan al
 * PolicyPromoter para su institucionalización en manifest.yaml.
 *
 * @example
 * ```ts
 * const detector = new PatternDetector(catalog);
 * const patterns = await detector.scan(); // todos los dominios
 * const auditPatterns = await detector.scanByDomain('audit'); // solo audit
 * ```
 */

import { FailureCatalog } from './failure-catalog';
import {
  FailureRecord,
  DetectedPattern,
  FAILURE_TYPES_BY_DOMAIN,
} from './types';

// ── Configuración por defecto ────────────────────────────────────────────────

const DEFAULT_PROMOTION_THRESHOLD = 3;

// ── PatternDetector ──────────────────────────────────────────────────────────

export class PatternDetector {
  private catalog: FailureCatalog;
  private promotionThreshold: number;

  constructor(catalog: FailureCatalog, options?: { promotionThreshold?: number }) {
    this.catalog = catalog;
    this.promotionThreshold = options?.promotionThreshold ?? DEFAULT_PROMOTION_THRESHOLD;
  }

  /**
   * @description Escanea todos los dominios buscando patrones de fallos repetidos.
   * @param threshold - Umbral opcional para sobreescribir el default (≥3)
   * @returns Lista de patrones detectados que superan el umbral
   */
  async scan(threshold?: number): Promise<DetectedPattern[]> {
    const allRecords = await this.catalog.getAllRecords();
    const thresholdValue = threshold ?? this.promotionThreshold;
    return this.detectPatterns(allRecords, thresholdValue);
  }

  /**
   * @description Escanea solo un dominio específico.
   * @param domain - Dominio a escanear
   * @param threshold - Umbral opcional
   */
  async scanByDomain(domain: string, threshold?: number): Promise<DetectedPattern[]> {
    const records = await this.catalog.findByDomain(domain);
    const thresholdValue = threshold ?? this.promotionThreshold;
    return this.detectPatterns(records, thresholdValue);
  }

  /**
   * @description Escanea un failureType específico en un dominio.
   * @param domain - Dominio
   * @param failureType - Tipo de fallo a buscar
   * @param threshold - Umbral opcional
   */
  async scanByFailureType(
    domain: string,
    failureType: string,
    threshold?: number
  ): Promise<DetectedPattern[]> {
    const records = await this.catalog.findByDomainAndType(domain, failureType);
    const thresholdValue = threshold ?? this.promotionThreshold;
    const patterns = this.detectPatterns(records, thresholdValue);
    // Filtrar solo el failureType solicitado
    return patterns.filter(p => p.failureType === failureType);
  }

  /**
   * @description Obtiene los failureType que están cerca del umbral (count ≥ threshold - 1).
   * Útil para reportes de "casi patrón".
   */
  async getNearMissPatterns(threshold?: number): Promise<DetectedPattern[]> {
    const allRecords = await this.catalog.getAllRecords();
    const thresholdValue = threshold ?? this.promotionThreshold;
    const nearThreshold = Math.max(2, thresholdValue - 1);

    // Primero detectar los que pasan el nearThreshold
    const patterns = this.detectPatterns(allRecords, nearThreshold);
    // Luego excluir los que ya superan el umbral completo
    return patterns.filter(p => p.count < thresholdValue);
  }

  // ── Núcleo de detección ────────────────────────────────────────────────────

  /**
   * @description Agrupa registros por (domain, failureType) y genera patrones
   * para aquellos grupos que superan el umbral.
   */
  private detectPatterns(records: FailureRecord[], threshold: number): DetectedPattern[] {
    // Agrupar por clave domain:failureType
    const groups = new Map<string, FailureRecord[]>();

    for (const record of records) {
      const key = `${record.domain}:${record.failureType}`;
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }

    const patterns: DetectedPattern[] = [];

    for (const [, group] of groups) {
      if (group.length < threshold) continue;

      const first = group[0];
      const last = group[group.length - 1];

      // Severidad máxima del grupo (no moda)
      const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];
      const dominantSeverity = group
        .map(r => r.severity)
        .sort((a, b) => SEVERITY_ORDER.indexOf(b) - SEVERITY_ORDER.indexOf(a))[0] ?? 'medium';

      // Calcular dimensión más frecuente
      const dimensionCounts = new Map<string, number>();
      for (const r of group) {
        dimensionCounts.set(r.dimension, (dimensionCounts.get(r.dimension) ?? 0) + 1);
      }
      const dominantDimension = [...dimensionCounts.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'general';

      // Calcular gate más frecuente
      const gateCounts = new Map<string, number>();
      for (const r of group) {
        gateCounts.set(r.gate, (gateCounts.get(r.gate) ?? 0) + 1);
      }
      const dominantGate = [...gateCounts.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

      // Recomendación: tomar la del último registro
      const lastRecomendacion = last.recomendacion;

      const pattern: DetectedPattern = {
        failureType: first.failureType,
        domain: first.domain,
        count: group.length,
        firstSeen: first.fecha,
        lastSeen: last.fecha,
        severity: dominantSeverity as DetectedPattern['severity'],
        recordIds: group.map(r => r.id),
        dominantDimension,
        dominantGate,
        recommendedAction: lastRecomendacion,
        promotedToPolicy: false,
      };

      patterns.push(pattern);
    }

    // Ordenar por count descendente
    return patterns.sort((a, b) => b.count - a.count);
  }
}
