/**
 * @description FailureCatalog — Repositorio persistente de incidentes del Reflection Engine.
 *
 * Almacena FailureRecord en un archivo JSON en ~/.deepseek-code/projects/{hash}/reflection/
 * y provee operaciones CRUD básicas más consultas por dominio, failureType y rango de fechas.
 *
 * @example
 * ```ts
 * const catalog = new FailureCatalog({ projectRoot: process.cwd(), useGlobalDir: true });
 * await catalog.addRecord(record);
 * const results = await catalog.findByDomainAndType('audit', 'connection_leak');
 * ```
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { FailureRecord, ReflectionDomain, DetectedPattern } from './types';
import { cwdToProjectKey } from '../bootstrap/memory-loader';
import { atomicWrite } from '../shared/utils/atomic-write';

// ── Constantes ───────────────────────────────────────────────────────────────

const CATALOG_FILENAME = 'failures.json';
const MAX_RECORDS = 10_000;

// ── FailureCatalog ───────────────────────────────────────────────────────────

export class FailureCatalog {
  private catalogDir: string;
  private records: FailureRecord[] = [];
  private catalogPath: string;
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options?: { projectRoot?: string; useGlobalDir?: boolean }) {
    const root = options?.projectRoot ?? process.cwd();
    const useGlobal = options?.useGlobalDir ?? true;

    if (useGlobal) {
      const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
      this.catalogDir = path.join(home, '.deepseek-code', 'projects', cwdToProjectKey(root), 'reflection');
    } else {
      this.catalogDir = path.join(root, '.reflection');
    }

    this.catalogPath = path.join(this.catalogDir, CATALOG_FILENAME);
  }

  // ── Persistencia ───────────────────────────────────────────────────────────

  /**
   * @description Carga los registros desde el archivo JSON.
   * Se llama automáticamente en el constructor si ya existe.
   */
  async load(): Promise<FailureRecord[]> {
    try {
      const content = await fs.readFile(this.catalogPath, 'utf-8');
      const parsed = JSON.parse(content) as FailureRecord[];
      this.records = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.records = [];
    }
    this.loaded = true;
    return this.records;
  }

  async save(): Promise<void> {
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    await fs.mkdir(this.catalogDir, { recursive: true });
    await atomicWrite(this.catalogPath, JSON.stringify(this.records, null, 2));
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * @description Agrega un nuevo FailureRecord al catálogo y persiste.
   * @returns El registro agregado (con ID generado si no tenía)
   */
  async addRecord(record: FailureRecord): Promise<FailureRecord> {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureLoaded();
      this.records.push(record);
      await this.save();
    });
    await this.writeQueue;
    return record;
  }

  async addRecords(records: FailureRecord[]): Promise<FailureRecord[]> {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureLoaded();
      this.records.push(...records);
      await this.save();
    });
    await this.writeQueue;
    return records;
  }

  /**
   * @description Obtiene un registro por su ID.
   */
  async getRecordById(id: string): Promise<FailureRecord | undefined> {
    await this.ensureLoaded();
    return this.records.find(r => r.id === id);
  }

  /**
   * @description Actualiza un registro existente por su ID.
   * @returns true si se actualizó, false si no se encontró
   */
  async updateRecord(id: string, updates: Partial<FailureRecord>): Promise<boolean> {
    await this.ensureLoaded();
    const index = this.records.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.records[index] = { ...this.records[index], ...updates };
    await this.save();
    return true;
  }

  /**
   * @description Marca un registro como resuelto.
   * @param commitHash - SHA del commit que lo resolvió
   */
  async markResolved(id: string, commitHash: string, promoter?: import('./policy-promoter').PolicyPromoter): Promise<boolean> {
    const updated = await this.updateRecord(id, {
      resolvedByCommit: commitHash,
      resolvedAt: new Date().toISOString(),
    });
    if (updated && promoter) {
      const record = await this.getRecordById(id);
      if (record) {
        const domainRecords = await this.findByDomain(record.domain);
        const stillUnresolved = domainRecords.filter(
          r => !r.resolvedByCommit && r.failureType === record.failureType
        );
        if (stillUnresolved.length === 0) {
          const existing = await promoter.findRule(record.domain, record.failureType);
          if (existing) await promoter.removeRule(existing.id);
        }
      }
    }
    return updated;
  }

  /**
   * @description Elimina un registro por su ID.
   */
  async deleteRecord(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const index = this.records.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.records.splice(index, 1);
    await this.save();
    return true;
  }

  // ── Consultas ──────────────────────────────────────────────────────────────

  /**
   * @description Busca registros por dominio y failureType.
   */
  async findByDomainAndType(domain: string, failureType: string): Promise<FailureRecord[]> {
    await this.ensureLoaded();
    return this.records.filter(r => r.domain === domain && r.failureType === failureType);
  }

  /**
   * @description Busca registros por dominio (built-in o custom).
   */
  async findByDomain(domain: string): Promise<FailureRecord[]> {
    await this.ensureLoaded();
    return this.records.filter(r => r.domain === domain);
  }

  /**
   * @description Busca registros de un failureType específico (sin filtrar por dominio).
   */
  async findByFailureType(failureType: string): Promise<FailureRecord[]> {
    await this.ensureLoaded();
    return this.records.filter(r => r.failureType === failureType);
  }

  /**
   * @description Busca registros dentro de un rango de fechas.
   * @param start - Fecha ISO inicio
   * @param end - Fecha ISO fin (inclusive)
   */
  async findByDateRange(start: string, end: string): Promise<FailureRecord[]> {
    await this.ensureLoaded();
    return this.records.filter(r => r.fecha >= start && r.fecha <= end);
  }

  /**
   * @description Busca registros no resueltos.
   */
  async findUnresolved(): Promise<FailureRecord[]> {
    await this.ensureLoaded();
    return this.records.filter(r => !r.resolvedByCommit);
  }

  /**
   * @description Obtiene todos los failureType únicos (y su conteo) en el catálogo.
   */
  async getFailureTypeCounts(): Promise<Map<string, number>> {
    await this.ensureLoaded();
    const counts = new Map<string, number>();
    for (const record of this.records) {
      const key = `${record.domain}:${record.failureType}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * @description Cuenta registros por dominio.
   */
  async getDomainCounts(): Promise<Record<string, number>> {
    await this.ensureLoaded();
    const counts: Record<string, number> = { audit: 0, test: 0, commit: 0, agent: 0, bootstrap: 0 };
    for (const record of this.records) {
      counts[record.domain] = (counts[record.domain] ?? 0) + 1;
    }
    return counts;
  }

  // ── Métrica total ──────────────────────────────────────────────────────────

  /**
   * @description Número total de registros en el catálogo.
   */
  async totalRecords(): Promise<number> {
    await this.ensureLoaded();
    return this.records.length;
  }

  /**
   * @description Obtiene la ruta del archivo de catálogo.
   */
  getCatalogPath(): string {
    return this.catalogPath;
  }

  /**
   * @description Obtiene todos los registros (para debug/reporting).
   */
  async getAllRecords(): Promise<FailureRecord[]> {
    await this.ensureLoaded();
    return [...this.records];
  }
}
