/**
 * @description AuditFindingTracer — Trazabilidad hallazgo → commit.
 *
 * Permite marcar hallazgos de auditoría como resueltos, asociándolos
 * con un commit SHA específico. Busca tanto en memoria como en disco
 * para actualizar los registros persistidos.
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

// ── AuditFindingTracer ───────────────────────────────────────────────────────

export class AuditFindingTracer {
  private docsDir: string;

  constructor(docsDir: string) {
    this.docsDir = docsDir;
  }

  /**
   * @description Marca un hallazgo como resuelto en memoria y en disco.
   *
   * @param gates - Lista de gates en memoria donde buscar
   * @param findingId - ID del hallazgo a marcar
   * @param commitHash - SHA del commit que lo resuelve
   * @param commitMessage - Mensaje del commit (opcional)
   * @returns true si se encontró y marcó el hallazgo
   */
  async markResolved(
    gates: GateRecord[],
    findingId: string,
    commitHash: string,
    commitMessage?: string
  ): Promise<boolean> {
    let found = false;
    const resolvedAt = getFormattedDate();

    // En memoria
    for (const gate of gates) {
      for (const hallazgo of gate.hallazgos) {
        if (hallazgo.id === findingId) {
          hallazgo.resolvedByCommit = commitHash;
          hallazgo.resolvedAt = resolvedAt;
          found = true;
        }
      }
    }

    // En disco
    try {
      const files = await fs.readdir(this.docsDir);
      for (const file of files) {
        if (!file.endsWith('.md') || file.startsWith('auto-gates') || file.startsWith('pending-issues')) continue;
        const filePath = path.join(this.docsDir, file);
        let content = await fs.readFile(filePath, 'utf-8');
        const pattern = new RegExp(`\\|\\s*${findingId}\\s*\\|`);
        if (pattern.test(content)) {
          const marker = `*(Resuelto en commit \`${commitHash}\`${commitMessage ? `: ${commitMessage}` : ''} — ${resolvedAt})*`;
          content = content.replace(pattern, `$& ${marker}`);
          await fs.writeFile(filePath, content, 'utf-8');
          found = true;
        }
      }
    } catch {
      // Si no existe directorio, no hay archivos que actualizar
    }

    return found;
  }

  /**
   * @description Marca hallazgos como resueltos buscando por archivos modificados
   * en el commit. Útil para hook post-commit.
   *
   * @param gates - Lista de gates en memoria
   * @param commitHash - SHA del commit
   * @param modifiedFiles - Archivos modificados en el commit
   * @returns Cantidad de hallazgos resueltos
   */
  async markResolvedByFiles(
    gates: GateRecord[],
    commitHash: string,
    modifiedFiles: string[]
  ): Promise<number> {
    let resolved = 0;
    for (const gate of gates) {
      for (const hallazgo of gate.hallazgos) {
        if (!hallazgo.resolvedByCommit && modifiedFiles.some(f =>
          hallazgo.evidencia.includes(f) || hallazgo.hallazgo.includes(f)
        )) {
          if (await this.markResolved(gates, hallazgo.id, commitHash)) resolved++;
        }
      }
    }
    return resolved;
  }
}
