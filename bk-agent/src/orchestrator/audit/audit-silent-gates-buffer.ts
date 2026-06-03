/**
 * @description AuditSilentGatesBuffer — Buffer diario de auto-gates silenciosos.
 *
 * Los auto-gates que son GO sin hallazgos se acumulan en un buffer en memoria
 * en lugar de persistir archivos individuales. Al final del día (o del sprint),
 * se genera un único reporte consolidado.
 *
 * Esto reduce drásticamente el ruido: de 130+ archivos individuales a 1 reporte diario.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { SilentGateRecord, GateVeredict } from './types';

// ── AuditSilentGatesBuffer ───────────────────────────────────────────────────

export class AuditSilentGatesBuffer {
  private docsDir: string;
  private silentGates: SilentGateRecord[] = [];

  constructor(docsDir: string) {
    this.docsDir = docsDir;
  }

  // ── Mutadores ──────────────────────────────────────────────────────────────

  /**
   * @description Agrega un gate silencioso al buffer.
   */
  add(gate: string, agente: string, fecha: string, veredicto: GateVeredict, notas?: string): void {
    this.silentGates.push({ gate, agente, fecha, veredicto, notas });
  }

  /**
   * @description Limpia el buffer de gates silenciosos.
   */
  clear(): void {
    this.silentGates = [];
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  /**
   * @description Retorna una copia de los gates silenciosos acumulados.
   */
  getAll(): SilentGateRecord[] {
    return this.silentGates.map(sg => ({ ...sg }));
  }

  /**
   * @description Retorna la cantidad de gates silenciosos acumulados.
   */
  get count(): number {
    return this.silentGates.length;
  }

  // ── Reporte diario ────────────────────────────────────────────────────────

  /**
   * @description Genera un reporte Markdown consolidado con todos los auto-gates
   * silenciosos acumulados. Retorna la ruta del archivo, o null si no hay gates.
   */
  async generateDailyReport(fecha?: string): Promise<string | null> {
    if (this.silentGates.length === 0) return null;

    const today = fecha ?? new Date().toISOString().split('T')[0];
    const content = [
      '---',
      'tags: [auditoria, auto-gates, silenciosos]',
      `fecha: ${today}`,
      `total_auto_gates: ${this.silentGates.length}`,
      '---',
      '',
      `# 📦 Reporte Diario de Auto-Gates — ${today}`,
      '',
      '> Este reporte agrupa todos los auto-gates aprobados automáticamente sin hallazgos.',
      '',
      '---',
      '',
      '## Resumen',
      '',
      `- **Total de auto-gates hoy:** ${this.silentGates.length}`,
      `- **Último gate:** ${this.silentGates[this.silentGates.length - 1]?.gate ?? 'N/A'}`,
      `- **Rango horario:** ${this.silentGates[0]?.fecha ?? 'N/A'} → ${this.silentGates[this.silentGates.length - 1]?.fecha ?? 'N/A'}`,
      '',
      '---',
      '',
      '## Listado de Auto-Gates',
      '',
      '| # | Gate | Agente | Fecha | Notas |',
      '|---|------|--------|-------|-------|',
      ...this.silentGates.map((sg, i) => `| ${i + 1} | ${sg.gate} | ${sg.agente} | ${sg.fecha} | ${sg.notas ?? '—'} |`),
      '',
      '---',
      '',
      '*Generado automáticamente por DeepSeek Code — Audit Reporter*',
    ].join('\n');

    await fs.mkdir(this.docsDir, { recursive: true });
    const filename = `auto-gates-${today}.md`;
    const filePath = path.join(this.docsDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }
}
