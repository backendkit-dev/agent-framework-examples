/**
 * @description AuditCiBlocker — Bloqueo de deploys en CI/CD.
 *
 * Verifica si hay hallazgos críticos/altos sin resolver y genera
 * reportes de estado para pipelines de CI/CD.
 *
 * Útil para:
 * - `audit check --block-on-critical` en CI
 * - Generar reportes de estado para GitHub Actions / GitLab CI
 * - Fallar el pipeline si hay issues abiertos
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { GateRecord, AuditFinding, CiReport } from './types';

// ── AuditCiBlocker ───────────────────────────────────────────────────────────

export class AuditCiBlocker {
  private docsDir: string;

  constructor(docsDir: string) {
    this.docsDir = docsDir;
  }

  /**
   * @description Verifica si hay hallazgos críticos/altos sin resolver.
   * Busca tanto en memoria como en disco.
   * Si retorna true, el pipeline CI/CD debe fallar.
   *
   * @param gates - Gates en memoria para verificar
   */
  async hasCriticalOpenFindings(gates: GateRecord[]): Promise<boolean> {
    try {
      const files = await fs.readdir(this.docsDir);

      // Buscar pending issues activos
      if (files.some(f => f.startsWith('pending-issues') && f.endsWith('.md'))) return true;

      // Buscar en informes finales y gates persistidos
      for (const file of files) {
        if (!file.endsWith('.md') || file.startsWith('auto-gates')) continue;
        const content = await fs.readFile(path.join(this.docsDir, file), 'utf-8');
        const criticalMatches = (content.match(/\*\*(Crítica|Alta)\*\*/g) ?? []).length;
        const resolvedMatches = (content.match(/Resuelto en commit/g) ?? []).length;
        if (criticalMatches > resolvedMatches) return true;
      }

      // Buscar en memoria
      if (gates.some(g => g.hallazgos.some(h =>
        (h.severidad === 'critical' || h.severidad === 'high') && !h.resolvedByCommit
      ))) return true;

      return false;
    } catch {
      return false;
    }
  }

  /**
   * @description Genera reporte de estado para CI/CD.
   *
   * @param gates - Gates en memoria para analizar
   */
  async generateCiReport(gates: GateRecord[]): Promise<CiReport> {
    const criticalOpen: AuditFinding[] = [];
    const highOpen: AuditFinding[] = [];

    for (const gate of gates) {
      for (const h of gate.hallazgos) {
        if (!h.resolvedByCommit) {
          if (h.severidad === 'critical') criticalOpen.push(h);
          else if (h.severidad === 'high') highOpen.push(h);
        }
      }
    }

    const ok = criticalOpen.length === 0 && highOpen.length === 0;
    const message = ok
      ? '✅ No hay hallazgos críticos o altos abiertos. Deploy permitido.'
      : `❌ ${criticalOpen.length} crítico(s) y ${highOpen.length} alto(s) sin resolver. Deploy bloqueado.`;

    return {
      ok,
      criticalCount: criticalOpen.length,
      highCount: highOpen.length,
      findings: [...criticalOpen, ...highOpen],
      message,
    };
  }
}
