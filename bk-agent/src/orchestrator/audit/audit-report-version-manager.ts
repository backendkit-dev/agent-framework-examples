/**
 * @description AuditReportVersionManager — Gestiona el versionado semántico
 * de los informes de auditoría.
 *
 * **Esquema de versionado:**
 * - Gate individual → incrementa patch (v1.0.0 → v1.0.1)
 * - Informe final → incrementa minor (v1.0.0 → v1.1.0)
 * - Reset manual → incrementa major (v1.0.0 → v2.0.0)
 *
 * El estado se persiste en un archivo JSON dentro del directorio de auditorías.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { atomicWrite } from '../../shared/utils/atomic-write';

// ── Constantes ───────────────────────────────────────────────────────────────

const VERSION_FILE = '.audit-report-version.json';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface AuditReportVersion {
  major: number;
  minor: number;
  patch: number;
  lastUpdated: string;
  reportCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFormattedDate(): string {
  return new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z/, ' UTC');
}

// ── AuditReportVersionManager ────────────────────────────────────────────────

export class AuditReportVersionManager {
  private docsDir: string;
  private version: AuditReportVersion;

  constructor(docsDir: string) {
    this.docsDir = docsDir;
    this.version = {
      major: 1,
      minor: 0,
      patch: 0,
      lastUpdated: getFormattedDate(),
      reportCount: 0,
    };
  }

  // ── Carga / Persistencia ──────────────────────────────────────────────────

  /**
   * @description Carga la versión desde disco. Si no existe, retorna v1.0.0.
   */
  async load(): Promise<AuditReportVersion> {
    try {
      const versionPath = path.join(this.docsDir, VERSION_FILE);
      const content = await fs.readFile(versionPath, 'utf-8');
      const parsed = JSON.parse(content);
      this.version = {
        major: parsed.major ?? 1,
        minor: parsed.minor ?? 0,
        patch: parsed.patch ?? 0,
        lastUpdated: parsed.lastUpdated ?? getFormattedDate(),
        reportCount: parsed.reportCount ?? 0,
      };
    } catch {
      this.version = { major: 1, minor: 0, patch: 0, lastUpdated: getFormattedDate(), reportCount: 0 };
    }
    return this.version;
  }

  /**
   * @description Persiste la versión actual en disco.
   */
  async save(): Promise<void> {
    const versionPath = path.join(this.docsDir, VERSION_FILE);
    this.version.lastUpdated = getFormattedDate();
    await atomicWrite(versionPath, JSON.stringify(this.version, null, 2));
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  /**
   * @description Retorna la versión como string "v{major}.{minor}.{patch}".
   */
  getVersionString(): string {
    return `v${this.version.major}.${this.version.minor}.${this.version.patch}`;
  }

  /**
   * @description Retorna el objeto de versión actual.
   */
  getVersion(): AuditReportVersion {
    return { ...this.version };
  }

  // ── Incrementos ───────────────────────────────────────────────────────────

  /**
   * @description Incrementa patch (gate individual).
   */
  incrementPatch(): void {
    this.version.patch += 1;
    this.version.reportCount += 1;
  }

  /**
   * @description Incrementa minor y resetea patch (informe final).
   */
  incrementMinor(): void {
    this.version.minor += 1;
    this.version.patch = 0;
    this.version.reportCount += 1;
  }

  /**
   * @description Incrementa major y resetea minor y patch (reset manual).
   */
  incrementMajor(): void {
    this.version.major += 1;
    this.version.minor = 0;
    this.version.patch = 0;
    this.version.reportCount += 1;
  }
}
