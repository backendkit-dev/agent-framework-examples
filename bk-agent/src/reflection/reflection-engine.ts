/**
 * @description ReflectionEngine — Orquestador universal del sistema de auto-mejora.
 *
 * Pipeline: Feedback → Catalog → Pattern Detection → Policy Promotion → Prevention
 *
 * Opera sobre 5 dominios: audit, test, commit, agent, bootstrap.
 * Cada dominio tiene sus propios failureTypes y hooks de captura,
 * pero comparten el mismo pipeline de deteccion y promocion.
 *
 * @example
 * ```ts
 * const engine = new ReflectionEngine({ projectRoot: process.cwd() });
 * await engine.initialize();
 * await engine.reflect(); // escanea todos los dominios
 * console.log(engine.getStats());
 * ```
 */

import * as path from 'path';
import { join } from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { atomicWrite } from '../shared/utils/atomic-write';
import { FailureCatalog } from './failure-catalog';
import { PatternDetector } from './pattern-detector';
import { PolicyPromoter } from './policy-promoter';
import {
  FailureRecord,
  DetectedPattern,
  AnyDomain,
  ReflectionConfig,
  ManifestPolicyRule,
  defaultReflectionConfig,
  generateFailureId,
  FAILURE_TYPES_BY_DOMAIN,
} from './types';
import { DomainRegistry } from './domain-registry';
import { updateProjectContext, updateEngineInsights } from '../memory/updater';

// ── ReflectionEngine ─────────────────────────────────────────────────────────

export class ReflectionEngine {
  private catalog: FailureCatalog;
  private detector: PatternDetector;
  private promoter: PolicyPromoter;
  private config: ReflectionConfig;
  private registry?: DomainRegistry;

  private lastPatterns: DetectedPattern[] = [];
  private lastPromotedRules: ManifestPolicyRule[] = [];
  private pendingReflections = new Set<string>();
  private projectDir?: string;

  constructor(options?: {
    projectRoot?: string;
    useGlobalDir?: boolean;
    config?: Partial<ReflectionConfig>;
    registry?: DomainRegistry;
  }) {
    const projectRoot = options?.projectRoot ?? process.cwd();
    const useGlobal = options?.useGlobalDir ?? true;

    this.catalog = new FailureCatalog({ projectRoot, useGlobalDir: useGlobal });
    this.detector = new PatternDetector(this.catalog);
    this.promoter = useGlobal
      ? new PolicyPromoter()
      : new PolicyPromoter({ manifestPath: path.join(projectRoot, '.deepseek-code', 'manifest.yaml') });

    this.config = {
      ...defaultReflectionConfig(),
      ...options?.config,
    };

    if (options?.registry) {
      this.registry = options.registry;
      this.promoter.setRegistry(options.registry);
    }
  }

  // ── Inicializacion ─────────────────────────────────────────────────────────

  /**
   * @description Inicializa el engine: carga el catalogo de fallos y el registry desde disco.
   * Siempre llamar antes de usar el engine.
   */
  async initialize(): Promise<void> {
    await this.catalog.load();
    if (this.registry) {
      await this.registry.load();
    }
  }

  /**
   * @description Conecta un DomainRegistry al engine despues de la construccion.
   * El registry se cargara en el siguiente llamado a initialize() o inmediatamente si
   * el engine ya esta inicializado.
   */
  async connectRegistry(registry: DomainRegistry): Promise<void> {
    this.registry = registry;
    this.promoter.setRegistry(registry);
    await registry.load();
  }

  /**
   * @description Devuelve el DomainRegistry conectado, si existe.
   */
  getRegistry(): DomainRegistry | undefined {
    return this.registry;
  }

  /**
   * @description Conecta el engine con el directorio de memoria del proyecto.
   * Una vez conectado, reflect() y AuditHook actualizaran los archivos de memoria.
   */
  connectMemory(projectDir: string): void {
    this.projectDir = projectDir;
  }

  /**
   * @description Devuelve el directorio de memoria conectado, si existe.
   */
  getProjectDir(): string | undefined {
    return this.projectDir;
  }

  // ── Pipeline de reflexion ──────────────────────────────────────────────────

  /**
   * @description Ejecuta el pipeline completo de reflexion para todos los dominios
   * (o solo los activos segun config):
   * 1. Escanea el catalogo buscando patrones >= promotionThreshold
   * 2. Promueve los patrones no promovidos aun a policyRules
   * 3. Devuelve los patrones detectados y las reglas promovidas
   */
  async reflect(options?: {
    domain?: AnyDomain;
    threshold?: number;
    autoPromote?: boolean;
  }): Promise<{
    patterns: DetectedPattern[];
    promotedRules: ManifestPolicyRule[];
    stats: ReflectionStats;
  }> {
    const threshold = options?.threshold ?? this.config.promotionThreshold;
    const autoPromote = options?.autoPromote ?? this.config.autoPromote;

    // Registry tiene prioridad: usa sus dominios activos (built-ins + custom habilitados)
    const activeDomains: AnyDomain[] = options?.domain
      ? [options.domain]
      : (this.registry?.getActiveDomains() ?? this.config.activeDomains);

    // 1. Escanear dominios activos
    const allPatterns: DetectedPattern[] = [];
    for (const domain of activeDomains) {
      const patterns = await this.detector.scanByDomain(domain, threshold);
      allPatterns.push(...patterns);
    }

    this.lastPatterns = allPatterns;

    // 2. Promover patrones no promovidos aun
    const promotedRules: ManifestPolicyRule[] = [];
    if (autoPromote && this.config.enabled) {
      // H-05: Contar reglas auto-generadas existentes para verificar limite maximo
      const existingRules = await this.promoter.getExistingRules();
      let autoGeneratedCount = existingRules.filter(r => r.autoGenerated === true).length;
      const maxRules = this.config.maxAutoGeneratedRules;

      for (const pattern of allPatterns) {
        if (pattern.failureType.startsWith('unknown_')) continue;
        // H-05: Solo auto-promover patrones de severidad high o critical
        if (pattern.severity !== 'high' && pattern.severity !== 'critical') continue;
        // H-05: Verificar umbral minimo explicito
        if (pattern.count < this.config.promotionThreshold) continue;
        const existing = await this.promoter.findRule(pattern.domain, pattern.failureType);
        if (existing) {
          pattern.promotedToPolicy = true;
          pattern.policyRuleId = existing.id;
          continue;
        }
        // H-05: No promover si se alcanzo el limite maximo de reglas auto-generadas
        if (autoGeneratedCount >= maxRules) {
          console.warn(
            `[ReflectionEngine] Limite de reglas auto-generadas alcanzado (${autoGeneratedCount}/${maxRules}). ` +
            `No se promueve '${pattern.failureType}' (${pattern.domain}).`
          );
          continue;
        }
        const rule = await this.promoter.promote(pattern);
        promotedRules.push(rule);
        pattern.promotedToPolicy = true;
        pattern.promotedAt = new Date().toISOString();
        pattern.policyRuleId = rule.id;
        autoGeneratedCount++; // incrementar contador local para este batch
      }
    }

    this.lastPromotedRules = promotedRules;

    // TASK-02: registrar patrones promovidos en contexto-proyecto.md
    if (this.projectDir && promotedRules.length > 0) {
      const policyLines = promotedRules.map(r => `- [${r.id}] ${r.name}`).join('\n');
      await updateProjectContext(this.projectDir, { notas: `Patrones auto-promovidos:\n${policyLines}` })
        .catch(() => { /* fallo silencioso */ });
    }

    // TASK-03: registrar patrones detectados como insights en sesion-actual.md
    if (this.projectDir && allPatterns.length > 0) {
      const insights = allPatterns.map(p => ({
        failureType: p.failureType,
        domain: p.domain,
        severity: p.severity,
        count: p.count,
        recommendedAction: p.recommendedAction,
      }));
      await updateEngineInsights(this.projectDir, insights)
        .catch(() => { /* fallo silencioso */ });
    }

    // 3. Calcular estadisticas
    const stats = await this.calculateStats(activeDomains);

    return { patterns: allPatterns, promotedRules, stats };
  }

  /**
   * @description Ejecuta reflexion solo para un dominio especifico.
   * Util cuando un hook reporta un incidente y se quiere analizar inmediatamente.
   */
  async reflectByDomain(domain: AnyDomain): Promise<{
    patterns: DetectedPattern[];
    promotedRules: ManifestPolicyRule[];
  }> {
    return this.reflect({ domain });
  }

  // ── Registro de incidentes (desde hooks) ───────────────────────────────────

  /**
   * @description Registra un incidente en el catalogo y ejecuta reflexion
   * inmediata para el dominio al que pertenece.
   *
   * Este es el metodo principal que los hooks deben llamar.
   *
   * @param record - Datos del incidente (sin ID, se genera automaticamente)
   * @returns El FailureRecord completo y los patrones detectados
   */
  async reportIncident(record: Omit<FailureRecord, 'id'>): Promise<{
    record: FailureRecord;
    patterns: DetectedPattern[];
  }> {
    const fullRecord: FailureRecord = { ...record, id: generateFailureId() };
    await this.catalog.addRecord(fullRecord);
    this.pendingReflections.add(record.domain);
    return { record: fullRecord, patterns: [] };
  }

  /**
   * @description Ejecuta la reflexion acumulada de todos los dominios con incidentes pendientes.
   * Llamar al cerrar un sprint o al final de una sesion.
   */
  async flushReflections(): Promise<{
    patterns: DetectedPattern[];
    promotedRules: ManifestPolicyRule[];
  }> {
    const allPatterns: DetectedPattern[] = [];
    const allRules: ManifestPolicyRule[] = [];
    for (const domain of this.pendingReflections) {
      const { patterns, promotedRules } = await this.reflectByDomain(domain);
      allPatterns.push(...patterns);
      allRules.push(...promotedRules);
    }
    this.pendingReflections.clear();
    await this.maybeUpdateAgentMd(allPatterns);
    return { patterns: allPatterns, promotedRules: allRules };
  }

  private async maybeUpdateAgentMd(patterns: DetectedPattern[]): Promise<void> {
    const promoted = patterns.filter(p =>
      (p.severity === 'high' || p.severity === 'critical') && !p.promotedToPolicy
    );
    if (promoted.length === 0) return;

    const agentMdPath = join(process.cwd(), 'AGENT.md');
    const lesson = this.formatLessonsBlock(promoted);

    // Leer, verificar duplicados y escribir en una sola operacion atomica
    // para evitar race conditions entre readFile y atomicWrite
    const current = await fs.readFile(agentMdPath, 'utf-8').catch(() => '');
    if (promoted.every(p => current.includes(p.failureType))) return;
    await atomicWrite(agentMdPath, current + '\n\n' + lesson);
  }

  private formatLessonsBlock(patterns: DetectedPattern[]): string {
    const date = new Date().toISOString().slice(0, 10);
    const lines = patterns.map(p =>
      `- **${p.failureType}** (${p.domain}, ${p.severity}): ${p.recommendedAction}`
    );
    return `## Lessons Learned — ${date}\n\n${lines.join('\n')}\n`;
  }

  // ── Consultas ──────────────────────────────────────────────────────────────

  /**
   * @description Obtiene los patrones detectados en la ultima reflexion.
   */
  getLastPatterns(): DetectedPattern[] {
    return [...this.lastPatterns];
  }

  /**
   * @description Obtiene las reglas promovidas en la ultima reflexion.
   */
  getLastPromotedRules(): ManifestPolicyRule[] {
    return [...this.lastPromotedRules];
  }

  /**
   * @description Obtiene el catalogo de fallos para operaciones directas.
   */
  getCatalog(): FailureCatalog {
    return this.catalog;
  }

  /**
   * @description Obtiene el detector de patrones.
   */
  getDetector(): PatternDetector {
    return this.detector;
  }

  /**
   * @description Obtiene el promoter de politicas.
   */
  getPromoter(): PolicyPromoter {
    return this.promoter;
  }

  /**
   * @description Obtiene la ruta del archivo de lecciones aprendidas.
   * Util para que el AgentLoop pueda cargar el memo e inyectarlo en los agentes.
   */
  getLessonsMemoPath(): string {
    const cwd = process.cwd();
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    const projectKey = cwd
      .replace(/[/\\]$/, '')
      .replace(/:[/\\]/g, '--')
      .replace(/[^a-zA-Z0-9-]/g, '-');
    return path.join(home, '.deepseek-code', 'projects', projectKey, 'audits', 'lecciones-aprendidas.md');
  }

  // ── Estadisticas ───────────────────────────────────────────────────────────

  /**
   * @description Calcula estadisticas del Reflection Engine.
   */
  async getStats(): Promise<ReflectionStats> {
    const activeDomains = this.config.activeDomains;
    return this.calculateStats(activeDomains);
  }

  private async calculateStats(domains: AnyDomain[]): Promise<ReflectionStats> {
    const domainCounts = await this.catalog.getDomainCounts();
    const totalIncidents = await this.catalog.totalRecords();
    const unresolved = await this.catalog.findUnresolved();

    const countsByDomain: Record<string, number> = {};
    for (const domain of domains) {
      countsByDomain[domain] = domainCounts[domain] ?? 0;
    }

    const patternsByDomain: Record<string, number> = {};
    for (const domain of domains) {
      const patterns = await this.detector.scanByDomain(domain);
      patternsByDomain[domain] = patterns.length;
    }

    return {
      enabled: this.config.enabled,
      promotionThreshold: this.config.promotionThreshold,
      activeDomains: [...domains],
      totalIncidents,
      unresolvedCount: unresolved.length,
      countsByDomain,
      patternsByDomain,
      lastReflectionAt: new Date().toISOString(),
    };
  }
}

// ── Tipos de estadisticas ────────────────────────────────────────────────────

export interface ReflectionStats {
  enabled: boolean;
  promotionThreshold: number;
  activeDomains: AnyDomain[];
  totalIncidents: number;
  unresolvedCount: number;
  countsByDomain: Record<string, number>;
  patternsByDomain: Record<string, number>;
  lastReflectionAt: string;
}
