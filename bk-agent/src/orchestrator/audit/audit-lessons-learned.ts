/**
 * @description AuditLessonsLearned — Analiza y genera lecciones aprendidas
 * a partir de los gates de auditoría ejecutados.
 *
 * Responsabilidades:
 * - Detectar patrones de severidad (críticos/altos)
 * - Identificar dimensiones con más hallazgos
 * - Encontrar keywords recurrentes en hallazgos
 * - Calcular tasa de aprobación QA
 * - Generar memo Markdown de lecciones aprendidas
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { GateRecord, AuditFinding } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFormattedDate(): string {
  return new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z/, ' UTC');
}

// ── AuditLessonsLearned ──────────────────────────────────────────────────────

export class AuditLessonsLearned {
  private docsDir: string;

  constructor(docsDir: string) {
    this.docsDir = docsDir;
  }

  /**
   * @description Analiza los gates y extrae lecciones aprendidas.
   * Retorna un array de strings con las lecciones detectadas.
   */
  analyze(gates: GateRecord[]): string[] {
    const lessons: string[] = [];
    const qaGates = gates.filter(g =>
      g.hallazgos.length > 0 && (g.gate === 'qa' || g.gate === 'security' || g.gate === 'architecture')
    );
    if (qaGates.length === 0) return [];

    // Patrones de severidad
    const criticalCount = qaGates.filter(g =>
      g.hallazgos.some(h => h.severidad === 'critical' || h.severidad === 'high')
    ).length;
    if (criticalCount > 0) {
      lessons.push(`⚠️ Se detectaron ${criticalCount} gate(s) con hallazgos críticos/altos. Revisar antes de proceder con nuevos cambios.`);
    }

    // Patrones por dimensión
    const dimensiones = new Map<string, number>();
    for (const gate of qaGates) {
      for (const h of gate.hallazgos) {
        dimensiones.set(h.dimension, (dimensiones.get(h.dimension) || 0) + 1);
      }
    }
    const topDimension = [...dimensiones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topDimension.length > 0) {
      lessons.push(`📊 Dimensiones con más hallazgos: ${topDimension.map(([d, c]) => `${d} (${c})`).join(', ')}`);
    }

    // Keywords recurrentes
    const keywordCount = new Map<string, number>();
    const keywords = ['test', 'error', 'edge case', 'caso borde', 'seguridad', 'security', 'perf',
      'documentación', 'validación', 'validation', 'cobertura', 'coverage', 'tipado'];
    for (const gate of qaGates) {
      for (const h of gate.hallazgos) {
        const lower = `${h.hallazgo} ${h.dimension} ${h.evidencia}`.toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw)) keywordCount.set(kw, (keywordCount.get(kw) || 0) + 1);
        }
      }
    }
    const topKeywords = [...keywordCount.entries()]
      .filter(([_, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topKeywords.length > 0) {
      lessons.push(`🔄 Patrones recurrentes: ${topKeywords.map(([kw, c]) => `"${kw}" (${c})`).join(', ')}`);
    }

    // Tasa de aprobación
    const goCount = qaGates.filter(g => g.veredicto === 'GO').length;
    lessons.push(`📈 Tasa de aprobación QA: ${Math.round((goCount / qaGates.length) * 100)}% (${goCount}/${qaGates.length})`);

    return lessons;
  }

  /**
   * @description Genera un memo Markdown de lecciones aprendidas y lo persiste.
   * Retorna la ruta del archivo, o null si no hay lecciones.
   */
  async generateMemo(gates: GateRecord[]): Promise<string | null> {
    const lessons = this.analyze(gates);
    if (lessons.length === 0) return null;

    const content = [
      '---',
      'tags: [auditoria, lecciones-aprendidas, memoria]',
      `fecha: ${getFormattedDate()}`,
      `total_gates: ${gates.length}`,
      `gates_con_hallazgos: ${gates.filter(g => g.hallazgos.length > 0).length}`,
      '---',
      '',
      `# 🧠 Lecciones Aprendidas — Auditorías`,
      '',
      `> Generado automáticamente por DeepSeek Code — Audit Reporter`,
      `> Fecha: ${getFormattedDate()}`,
      '',
      '---',
      '',
      ...lessons.map(l => `- ${l}`),
      '',
      '---',
      '',
      '## 📋 Detalle de Gates Revisados',
      '',
      '| Gate | Auditor | Veredicto | Hallazgos |',
      '|------|---------|-----------|-----------|',
      ...gates.filter(g => g.hallazgos.length > 0).map(g => `| ${g.gate} | ${g.agente} | ${g.veredicto} | ${g.hallazgos.length} |`),
      '',
      '---',
      '',
      '*Este memo se actualiza cada vez que se genera un informe final.*',
    ].join('\n');

    await fs.mkdir(this.docsDir, { recursive: true });
    const filePath = path.join(this.docsDir, 'lecciones-aprendidas.md');
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }
}
