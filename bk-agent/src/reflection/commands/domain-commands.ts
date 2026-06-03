/**
 * @description Handlers de comandos para gestion de dominios de aprendizaje.
 *
 * Implementa las operaciones: add, remove, enable, disable, list, show.
 * Usable desde la CLI (bk domain <cmd>) o desde el agente como skill.
 *
 * @example
 * ```ts
 * const cmds = new DomainCommands({ projectRoot: process.cwd() });
 * await cmds.add({ name: 'database', description: '...', failureTypes: [...] });
 * await cmds.enable('database');
 * console.log(await cmds.list());
 * ```
 */

import { DomainRegistry, CustomDomainDefinition, FailureTypeDefinition } from '../domain-registry';

// ── Tipos de entrada/salida ───────────────────────────────────────────────────

export interface AddDomainInput {
  name: string;
  description: string;
  failureTypes: FailureTypeDefinition[];
}

export interface DomainListEntry {
  name: string;
  builtin: boolean;
  active: boolean;
  description?: string;
  failureTypeCount?: number;
}

export interface DomainCommandResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

// ── DomainCommands ────────────────────────────────────────────────────────────

export class DomainCommands {
  private registry: DomainRegistry;
  private initialized = false;

  constructor(options?: { projectRoot?: string; registry?: DomainRegistry }) {
    this.registry = options?.registry ?? new DomainRegistry({ projectRoot: options?.projectRoot });
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.registry.load();
      this.initialized = true;
    }
  }

  /**
   * Registra un nuevo dominio custom en el catalogo global.
   */
  async add(input: AddDomainInput): Promise<DomainCommandResult> {
    await this.ensureInit();
    try {
      const def = await this.registry.registerDomain(input);
      return {
        ok: true,
        message: `Dominio '${def.name}' registrado con ${def.failureTypes.length} tipo(s) de fallo.`,
        data: def,
      };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Elimina un dominio custom del catalogo global.
   */
  async remove(name: string): Promise<DomainCommandResult> {
    await this.ensureInit();
    try {
      await this.registry.unregisterDomain(name);
      return { ok: true, message: `Dominio '${name}' eliminado del catalogo global.` };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Activa un dominio en el proyecto actual.
   */
  async enable(name: string): Promise<DomainCommandResult> {
    await this.ensureInit();
    try {
      await this.registry.enableDomain(name);
      return { ok: true, message: `Dominio '${name}' activado en este proyecto.` };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Desactiva un dominio en el proyecto actual.
   */
  async disable(name: string): Promise<DomainCommandResult> {
    await this.ensureInit();
    try {
      await this.registry.disableDomain(name);
      return { ok: true, message: `Dominio '${name}' desactivado en este proyecto.` };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Lista todos los dominios (built-in + custom), con estado de activacion.
   */
  async list(): Promise<DomainCommandResult> {
    await this.ensureInit();
    const all = this.registry.getAllDomains();

    const entries: DomainListEntry[] = all.map(d => {
      const custom = this.registry.getCustomDomain(d.name);
      return {
        name: d.name,
        builtin: d.builtin,
        active: d.active,
        description: d.description,
        failureTypeCount: custom?.failureTypes.length,
      };
    });

    const lines: string[] = [
      `Dominios disponibles (${entries.length} total):`,
      '',
    ];

    for (const e of entries) {
      const status = e.active ? '[activo]' : '[inactivo]';
      const kind   = e.builtin ? 'built-in' : 'custom';
      const desc   = e.description ? ` — ${e.description}` : '';
      const fts    = e.failureTypeCount !== undefined ? ` (${e.failureTypeCount} failure types)` : '';
      lines.push(`  ${status} ${e.name}  (${kind})${fts}${desc}`);
    }

    return { ok: true, message: lines.join('\n'), data: entries };
  }

  /**
   * Muestra el detalle completo de un dominio custom.
   */
  async show(name: string): Promise<DomainCommandResult> {
    await this.ensureInit();

    if (this.registry.isBuiltin(name)) {
      return {
        ok: true,
        message: `'${name}' es un dominio built-in. Su definicion esta en src/reflection/domains/${name}-domain.ts`,
      };
    }

    const def = this.registry.getCustomDomain(name);
    if (!def) {
      return { ok: false, message: `Dominio '${name}' no encontrado.` };
    }

    const active = this.registry.getActiveDomains().includes(name);
    const lines: string[] = [
      `Dominio: ${def.name}  [${active ? 'activo' : 'inactivo'}]`,
      `Descripcion: ${def.description}`,
      `Creado: ${def.createdAt}`,
      `Failure types (${def.failureTypes.length}):`,
    ];

    for (const ft of def.failureTypes) {
      lines.push(`  - ${ft.name}  [${ft.severity}] (${ft.dimension})`);
      lines.push(`    Keywords: ${ft.keywords.join(', ')}`);
      lines.push(`    Recomendacion: ${ft.recommendation}`);
    }

    return { ok: true, message: lines.join('\n'), data: def };
  }

  /**
   * Agrega un nuevo failureType a un dominio custom existente.
   */
  async addFailureType(domainName: string, ft: FailureTypeDefinition): Promise<DomainCommandResult> {
    await this.ensureInit();

    if (this.registry.isBuiltin(domainName)) {
      return { ok: false, message: `Los dominios built-in no pueden modificarse.` };
    }

    const def = this.registry.getCustomDomain(domainName);
    if (!def) {
      return { ok: false, message: `Dominio '${domainName}' no encontrado.` };
    }
    if (def.failureTypes.some(f => f.name === ft.name)) {
      return { ok: false, message: `El failure type '${ft.name}' ya existe en '${domainName}'.` };
    }

    try {
      await this.registry.updateDomain(domainName, {
        failureTypes: [...def.failureTypes, ft],
      });
      return { ok: true, message: `Failure type '${ft.name}' agregado a '${domainName}'.` };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Elimina un failureType de un dominio custom.
   */
  async removeFailureType(domainName: string, failureTypeName: string): Promise<DomainCommandResult> {
    await this.ensureInit();

    if (this.registry.isBuiltin(domainName)) {
      return { ok: false, message: `Los dominios built-in no pueden modificarse.` };
    }

    const def = this.registry.getCustomDomain(domainName);
    if (!def) {
      return { ok: false, message: `Dominio '${domainName}' no encontrado.` };
    }

    const filtered = def.failureTypes.filter(f => f.name !== failureTypeName);
    if (filtered.length === def.failureTypes.length) {
      return { ok: false, message: `Failure type '${failureTypeName}' no encontrado en '${domainName}'.` };
    }

    try {
      await this.registry.updateDomain(domainName, { failureTypes: filtered });
      return { ok: true, message: `Failure type '${failureTypeName}' eliminado de '${domainName}'.` };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  /**
   * Devuelve el registry subyacente para uso directo.
   */
  getRegistry(): DomainRegistry {
    return this.registry;
  }
}
