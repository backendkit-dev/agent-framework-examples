/**
 * @description DomainRegistry — Registro dinamico de dominios de aprendizaje.
 *
 * Separa definicion (global) de activacion (per-proyecto):
 * - Catalogo global:   ~/.deepseek-code/domains/custom-domains.json
 * - Activacion local:  ~/.deepseek-code/projects/{hash}/domains/active-domains.json
 *
 * Los 5 dominios built-in (audit, test, commit, agent, bootstrap) siempre estan
 * disponibles y no se pueden eliminar, solo desactivar por proyecto.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { atomicWrite } from '../shared/utils/atomic-write';
import { cwdToProjectKey } from '../bootstrap/memory-loader';

// ── Constantes ───────────────────────────────────────────────────────────────

export const BUILTIN_DOMAINS = ['audit', 'test', 'commit', 'agent', 'bootstrap'] as const;
export type BuiltinDomain = typeof BUILTIN_DOMAINS[number];

const CATALOG_FILENAME = 'custom-domains.json';
const ACTIVE_FILENAME  = 'active-domains.json';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface FailureTypeDefinition {
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  dimension: string;
  keywords: string[];
  recommendation: string;
}

export interface CustomDomainDefinition {
  name: string;
  description: string;
  failureTypes: FailureTypeDefinition[];
  createdAt: string;
}

interface DomainCatalog {
  version: string;
  domains: CustomDomainDefinition[];
}

interface ActiveDomainsFile {
  version: string;
  enabled: string[];
  disabled: string[];
}

// ── DomainRegistry ───────────────────────────────────────────────────────────

export class DomainRegistry {
  private globalCatalogPath: string;
  private activeDomainsPath: string;
  private catalog: DomainCatalog = { version: '1.0', domains: [] };
  private activeFile: ActiveDomainsFile = { version: '1.0', enabled: [], disabled: [] };
  private loaded = false;

  constructor(options?: { projectRoot?: string }) {
    const root = options?.projectRoot ?? process.cwd();
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();

    this.globalCatalogPath = path.join(home, '.deepseek-code', 'domains', CATALOG_FILENAME);
    this.activeDomainsPath = path.join(
      home, '.deepseek-code', 'projects', cwdToProjectKey(root), 'domains', ACTIVE_FILENAME
    );
  }

  // ── Carga ─────────────────────────────────────────────────────────────────

  async load(): Promise<void> {
    await Promise.all([this.loadCatalog(), this.loadActive()]);
    this.loaded = true;
  }

  private async loadCatalog(): Promise<void> {
    try {
      const raw = await fs.readFile(this.globalCatalogPath, 'utf-8');
      this.catalog = JSON.parse(raw) as DomainCatalog;
    } catch {
      this.catalog = { version: '1.0', domains: [] };
    }
  }

  private async loadActive(): Promise<void> {
    try {
      const raw = await fs.readFile(this.activeDomainsPath, 'utf-8');
      this.activeFile = JSON.parse(raw) as ActiveDomainsFile;
    } catch {
      this.activeFile = { version: '1.0', enabled: [], disabled: [] };
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('[DomainRegistry] Llamar load() antes de usar el registry.');
    }
  }

  // ── Gestion del catalogo global ───────────────────────────────────────────

  /**
   * Registra un nuevo dominio custom en el catalogo global.
   * No activa el dominio en ningun proyecto.
   */
  async registerDomain(def: Omit<CustomDomainDefinition, 'createdAt'>): Promise<CustomDomainDefinition> {
    this.ensureLoaded();

    if (this.isBuiltin(def.name)) {
      throw new Error(`[DomainRegistry] '${def.name}' es un dominio built-in y no puede redefinirse.`);
    }
    if (this.catalog.domains.some(d => d.name === def.name)) {
      throw new Error(`[DomainRegistry] El dominio '${def.name}' ya existe. Usa updateDomain() para modificarlo.`);
    }

    const full: CustomDomainDefinition = { ...def, createdAt: new Date().toISOString() };
    this.catalog.domains.push(full);
    await this.saveCatalog();
    return full;
  }

  /**
   * Actualiza la definicion de un dominio custom existente.
   */
  async updateDomain(
    name: string,
    patch: Partial<Omit<CustomDomainDefinition, 'name' | 'createdAt'>>
  ): Promise<CustomDomainDefinition> {
    this.ensureLoaded();

    if (this.isBuiltin(name)) {
      throw new Error(`[DomainRegistry] Los dominios built-in no pueden modificarse.`);
    }

    const idx = this.catalog.domains.findIndex(d => d.name === name);
    if (idx === -1) {
      throw new Error(`[DomainRegistry] Dominio '${name}' no encontrado.`);
    }

    this.catalog.domains[idx] = { ...this.catalog.domains[idx], ...patch };
    await this.saveCatalog();
    return this.catalog.domains[idx];
  }

  /**
   * Elimina un dominio custom del catalogo global.
   * Tambien lo desactiva en el proyecto actual.
   */
  async unregisterDomain(name: string): Promise<void> {
    this.ensureLoaded();

    if (this.isBuiltin(name)) {
      throw new Error(`[DomainRegistry] Los dominios built-in no pueden eliminarse.`);
    }

    const before = this.catalog.domains.length;
    this.catalog.domains = this.catalog.domains.filter(d => d.name !== name);
    if (this.catalog.domains.length === before) {
      throw new Error(`[DomainRegistry] Dominio '${name}' no encontrado.`);
    }

    // Limpiar de la activacion local tambien
    this.activeFile.enabled = this.activeFile.enabled.filter(n => n !== name);
    this.activeFile.disabled = this.activeFile.disabled.filter(n => n !== name);

    await Promise.all([this.saveCatalog(), this.saveActive()]);
  }

  /**
   * Devuelve todos los dominios custom definidos globalmente.
   */
  listCustomDomains(): CustomDomainDefinition[] {
    this.ensureLoaded();
    return [...this.catalog.domains];
  }

  /**
   * Busca un dominio custom por nombre.
   */
  getCustomDomain(name: string): CustomDomainDefinition | undefined {
    this.ensureLoaded();
    return this.catalog.domains.find(d => d.name === name);
  }

  // ── Activacion per-proyecto ───────────────────────────────────────────────

  /**
   * Activa un dominio custom en el proyecto actual.
   * El dominio debe estar registrado en el catalogo global.
   */
  async enableDomain(name: string): Promise<void> {
    this.ensureLoaded();

    if (!this.isBuiltin(name) && !this.catalog.domains.some(d => d.name === name)) {
      throw new Error(`[DomainRegistry] Dominio '${name}' no encontrado. Registralo primero con registerDomain().`);
    }

    if (!this.activeFile.enabled.includes(name)) {
      this.activeFile.enabled.push(name);
    }
    this.activeFile.disabled = this.activeFile.disabled.filter(n => n !== name);
    await this.saveActive();
  }

  /**
   * Desactiva un dominio en el proyecto actual (sin eliminarlo del catalogo).
   */
  async disableDomain(name: string): Promise<void> {
    this.ensureLoaded();

    this.activeFile.enabled = this.activeFile.enabled.filter(n => n !== name);
    if (!this.activeFile.disabled.includes(name)) {
      this.activeFile.disabled.push(name);
    }
    await this.saveActive();
  }

  /**
   * Devuelve todos los dominios activos para este proyecto:
   * built-ins (menos los desactivados) + custom habilitados.
   */
  getActiveDomains(): string[] {
    this.ensureLoaded();

    const builtins = BUILTIN_DOMAINS.filter(b => !this.activeFile.disabled.includes(b));
    const custom = this.activeFile.enabled.filter(n => !this.isBuiltin(n));
    return [...builtins, ...custom];
  }

  /**
   * Devuelve todos los dominios disponibles (built-ins + custom registrados).
   */
  getAllDomains(): Array<{ name: string; builtin: boolean; active: boolean; description?: string }> {
    this.ensureLoaded();
    const active = new Set(this.getActiveDomains());

    const builtins = BUILTIN_DOMAINS.map(b => ({
      name: b,
      builtin: true,
      active: active.has(b),
    }));

    const custom = this.catalog.domains.map(d => ({
      name: d.name,
      builtin: false,
      active: active.has(d.name),
      description: d.description,
    }));

    return [...builtins, ...custom];
  }

  // ── Helpers para PolicyPromoter ───────────────────────────────────────────

  /**
   * Devuelve los keywords de un failureType de un dominio custom.
   * Retorna undefined si el dominio es built-in (PolicyPromoter usa su propio KEYWORD_MAP).
   */
  getKeywordsForFailureType(domainName: string, failureType: string): string[] | undefined {
    if (this.isBuiltin(domainName)) return undefined;
    const domain = this.catalog.domains.find(d => d.name === domainName);
    if (!domain) return undefined;
    const ft = domain.failureTypes.find(f => f.name === failureType);
    return ft?.keywords;
  }

  /**
   * Devuelve la definicion de un failureType de un dominio custom.
   */
  getFailureTypeDef(domainName: string, failureType: string): FailureTypeDefinition | undefined {
    if (this.isBuiltin(domainName)) return undefined;
    const domain = this.catalog.domains.find(d => d.name === domainName);
    return domain?.failureTypes.find(f => f.name === failureType);
  }

  /**
   * Detecta automaticamente el failureType de un dominio custom basandose en keywords.
   * Busca coincidencias en el texto del hallazgo.
   */
  detectFailureType(domainName: string, hallazgo: string): string | undefined {
    const domain = this.catalog.domains.find(d => d.name === domainName);
    if (!domain) return undefined;

    const text = hallazgo.toLowerCase();
    for (const ft of domain.failureTypes) {
      if (ft.keywords.some(kw => text.includes(kw.toLowerCase()))) {
        return ft.name;
      }
    }
    return undefined;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  isBuiltin(name: string): name is BuiltinDomain {
    return (BUILTIN_DOMAINS as readonly string[]).includes(name);
  }

  isKnownDomain(name: string): boolean {
    this.ensureLoaded();
    return this.isBuiltin(name) || this.catalog.domains.some(d => d.name === name);
  }

  // ── Persistencia ─────────────────────────────────────────────────────────

  private async saveCatalog(): Promise<void> {
    await fs.mkdir(path.dirname(this.globalCatalogPath), { recursive: true });
    await atomicWrite(this.globalCatalogPath, JSON.stringify(this.catalog, null, 2));
  }

  private async saveActive(): Promise<void> {
    await fs.mkdir(path.dirname(this.activeDomainsPath), { recursive: true });
    await atomicWrite(this.activeDomainsPath, JSON.stringify(this.activeFile, null, 2));
  }
}
