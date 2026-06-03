/**
 * @description AuditPendingIssues — Persiste issues pendientes (críticos/altos)
 * cuando un sprint finaliza con veredicto NO-GO o NO-GO condicional.
 *
 * Estos issues deben resolverse antes de proceder con el deploy.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { AuditFinding, SprintInfo, GateVeredict } from './types';
import { sanitizeFilename } from '../../shared/utils/string-utils';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFormattedDate(): string {
  return new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z/, ' UTC');
}

// ── AuditPendingIssues ───────────────────────────────────────────────────────

export class AuditPendingIssues {
  private docsDir: string;

  constructor(docsDir: string) {
    this.docsDir = docsDir;
  }

  /**
   * @description Filtra los hallazgos críticos o altos de una lista de gates.
   */
  extractCritical(issues: AuditFinding[]): AuditFinding[] {
    return issues.filter(h => h.severidad === 'critical' || h.severidad === 'high');
  }

  /**
   * @description Persiste un archivo Markdown con los issues pendientes.
   * Retorna la ruta del archivo generado.
   */
  async persist(
    issues: AuditFinding[],
    sprint: SprintInfo,
    veredicto: GateVeredict
  ): Promise<string> {
    const criticalIssues = this.extractCritical(issues);
    const fecha = getFormattedDate();

    const content = [
      '---',
      'tags: [auditoria, pending-issues, bloqueantes]',
      `fecha: ${fecha}`,
      `sprint: ${sprint.name}`,
      `veredicto: ${veredicto}`,
      `total_issues: ${criticalIssues.length}`,
      '---',
      '',
      `# 🚫 Pending Issues — ${sprint.name}`,
      '',
      `> Sprint: ${sprint.name} v${sprint.version}`,
      `> Veredicto: ${veredicto}`,
      `> Fecha: ${fecha}`,
      '',
      '---',
      '',
      '## Issues Pendientes (Críticos/Altos)',
      '',
      '| ID | Dimensión | Hallazgo | Severidad | Agente | Recomendación |',
      '|----|-----------|----------|-----------|--------|---------------|',
      ...criticalIssues.map(h => `| ${h.id} | ${h.dimension} | ${h.hallazgo} | **${h.severidad}** | ${h.agenteResponsable} | ${h.recomendacion} |`),
      '',
      '---',
      '',
      '> Estos issues deben resolverse antes de proceder con el deploy.',
      '> Usa `audit check --block-on-critical` en CI para verificar.',
      '',
      '*Generado automáticamente por DeepSeek Code — Audit Reporter*',
    ].join('\n');

    await fs.mkdir(this.docsDir, { recursive: true });
    const filename = `pending-issues-${sanitizeFilename(sprint.name)}-${fecha.replace(/[:\s]/g, '-')}.md`;
    const filePath = path.join(this.docsDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }
}
