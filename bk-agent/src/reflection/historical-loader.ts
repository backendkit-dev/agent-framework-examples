/**
 * @description HistoricalLoader — Carga archivos historicos de auditoria (NO-GO)
 * y los convierte en FailureRecord para alimentar el Reflection Engine.
 *
 * Escanea ~/.deepseek-code/projects/{hash}/audits/ en busca de archivos .md
 * con veredicto NO-GO o NO-GO condicional, extrae los hallazgos de la tabla
 * Markdown y los persiste en failures.json, luego dispara reflect() para
 * que PatternDetector detecte patrones y PolicyPromoter genere policyRules.
 *
 * @example
 * ```ts
 * const loader = new HistoricalLoader({ engine });
 * const result = await loader.loadAll();
 * console.log(`Cargados ${result.loaded} registros, ${result.patterns} patrones detectados`);
 * ```
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { ReflectionEngine } from './reflection-engine';
import { FailureRecord, ReflectionDomain, generateFailureId } from './types';

type Severity = 'critical' | 'high' | 'medium' | 'low';
import { cwdToProjectKey } from '../bootstrap/memory-loader';

// ── Constantes ───────────────────────────────────────────────────────────────

const TABLE_ROW_PATTERN = /^\|\s*([\w-]+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/;

const SEVERITY_MAP: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  'critical': 'critical', 'critica': 'critical', 'Critica': 'critical', 'Crítica': 'critical',
  'high': 'high',         'alta': 'high',         'Alta': 'high',
  'medium': 'medium',     'media': 'medium',       'Media': 'medium',
  'low': 'low',           'baja': 'low',           'Baja': 'low',
};

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface HistoricalLoadResult {
  /** Total de archivos escaneados */
  scannedFiles: number;
  /** Archivos con veredicto NO-GO/NO-GO condicional */
  noGoFiles: number;
  /** Registros de fallo cargados al catalogo */
  loaded: number;
  /** Registros omitidos por duplicado */
  skipped: number;
  /** Patrones detectados tras la carga */
  patterns: number;
  /** Reglas promovidas tras la carga */
  promotedRules: number;
  /** Errores encontrados durante el proceso */
  errors: string[];
  /** Proyectos donde se encontro y proceso */
  projectsProcessed: string[];
}

interface ParsedFinding {
  id: string;
  dimension: string;
  hallazgo: string;
  severidad: 'critical' | 'high' | 'medium' | 'low';
  evidencia: string;
  recomendacion: string;
  agenteResponsable: string;
}

const SEVERITY_TO_RECORD = SEVERITY_MAP;

interface ParsedGateFile {
  gate: string;
  agente: string;
  veredicto: string;
  fecha: string;
  hallazgos: ParsedFinding[];
  dominio: string;
}

// ── HistoricalLoader ─────────────────────────────────────────────────────────

export class HistoricalLoader {
  private engine: ReflectionEngine;
  private projectRoot: string;

  constructor(options: { engine: ReflectionEngine; projectRoot?: string }) {
    this.engine = options.engine;
    this.projectRoot = options.projectRoot ?? process.cwd();
  }

  /**
   * @description Escanea y carga todos los proyectos con directorios audits/.
   * Si no se especifica projectRoot, escanea todos los proyectos en
   * ~/.deepseek-code/projects/.
   */
  async loadAll(options?: {
    /** Escanear solo el proyecto actual (default: true) */
    onlyCurrentProject?: boolean;
    /** Forzar recarga aunque los registros ya existan */
    force?: boolean;
  }): Promise<HistoricalLoadResult> {
    const result: HistoricalLoadResult = {
      scannedFiles: 0,
      noGoFiles: 0,
      loaded: 0,
      skipped: 0,
      patterns: 0,
      promotedRules: 0,
      errors: [],
      projectsProcessed: [],
    };

    const projects = options?.onlyCurrentProject !== false
      ? [this.resolveProjectAuditsDir(this.projectRoot)]
      : await this.findAllProjectAuditsDirs();

    for (const auditsDir of projects) {
      if (!auditsDir) continue;
      const projectKey = path.basename(path.dirname(auditsDir));
      result.projectsProcessed.push(projectKey);

      try {
        const projectResult = await this.loadProject(auditsDir, options?.force);
        result.scannedFiles += projectResult.scannedFiles;
        result.noGoFiles += projectResult.noGoFiles;
        result.loaded += projectResult.loaded;
        result.skipped += projectResult.skipped;
        result.patterns += projectResult.patterns;
        result.promotedRules += projectResult.promotedRules;
        result.errors.push(...projectResult.errors);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`[${projectKey}] Error: ${msg}`);
      }
    }

    return result;
  }

  /**
   * @description Carga un proyecto especifico por su directorio de auditorias.
   */
  async loadProject(auditsDir: string, force?: boolean): Promise<HistoricalLoadResult> {
    const result: HistoricalLoadResult = {
      scannedFiles: 0,
      noGoFiles: 0,
      loaded: 0,
      skipped: 0,
      patterns: 0,
      promotedRules: 0,
      errors: [],
      projectsProcessed: [],
    };

    // Verificar que el directorio existe
    try {
      await fs.access(auditsDir);
    } catch {
      result.errors.push(`Directorio no encontrado: ${auditsDir}`);
      return result;
    }

    // Listar archivos .md (excluir auto-gates, pending-issues, lecciones)
    const files = await fs.readdir(auditsDir);
    const mdFiles = files.filter(f =>
      f.endsWith('.md') &&
      !f.startsWith('auto-gates') &&
      !f.startsWith('pending-issues') &&
      f !== 'lecciones-aprendidas.md'
    );

    result.scannedFiles = mdFiles.length;

    // Cargar registros existentes para evitar duplicados
    const catalog = this.engine.getCatalog();
    await catalog.ensureLoaded();
    const existingRecords = await catalog.getAllRecords();
    const existingFingerprints = new Set(
      existingRecords.map(r => `${r.domain}:${r.failureType}:${r.hallazgo.slice(0, 80)}`)
    );

    // Procesar cada archivo
    const newRecords: FailureRecord[] = [];

    for (const file of mdFiles) {
      const filePath = path.join(auditsDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');

        // Saltar archivos GO sin hallazgos
        if (this.isGoWithoutFindings(content)) continue;

        result.noGoFiles++;

        const parsed = this.parseGateFile(content, file);
        if (!parsed) continue;

        // Extraer dominio del contexto de la tarea o del gate
        const domain = this.inferDomain(parsed);

        for (const finding of parsed.hallazgos) {
          // Inferir failureType del hallazgo
          const failureType = this.inferFailureType(finding, domain);

          // Crear fingerprint para evitar duplicados
          const fingerprint = `${domain}:${failureType}:${finding.hallazgo.slice(0, 80)}`;

          if (!force && existingFingerprints.has(fingerprint)) {
            result.skipped++;
            continue;
          }

          const record: FailureRecord = {
            id: generateFailureId(),
            domain,
            failureType,
            severity: (SEVERITY_TO_RECORD[finding.severidad] ?? 'medium') as Severity,
            dimension: finding.dimension,
            gate: parsed.gate,
            agenteResponsable: finding.agenteResponsable,
            hallazgo: finding.hallazgo,
            recomendacion: finding.recomendacion,
            archivos: [],
            fecha: parsed.fecha,
          };

          newRecords.push(record);
          existingFingerprints.add(fingerprint);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Error procesando ${file}: ${msg}`);
      }
    }

    // Persistir registros nuevos
    if (newRecords.length > 0) {
      await catalog.addRecords(newRecords);
      result.loaded = newRecords.length;
    }

    // Disparar reflexion para detectar patrones y promover reglas
    if (newRecords.length > 0) {
      try {
        const reflectResult = await this.engine.reflect({ autoPromote: true });
        result.patterns = reflectResult.patterns.length;
        result.promotedRules = reflectResult.promotedRules.length;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Error en reflexion: ${msg}`);
      }
    }

    return result;
  }

  // ── Parseo de archivos ─────────────────────────────────────────────────────

  /**
   * @description Parsea un archivo de gate Markdown y extrae metadatos + hallazgos.
   */
  private parseGateFile(content: string, filename: string): ParsedGateFile | null {
    // Extraer veredicto del frontmatter YAML
    const veredictoMatch = content.match(/veredicto:\s*"(.+?)"/);
    const veredicto = veredictoMatch?.[1] ?? '';

    // Solo procesar NO-GO y NO-GO condicional
    if (veredicto !== 'NO-GO' && veredicto !== 'NO-GO condicional') return null;

    // Extraer gate del frontmatter
    const gateMatch = content.match(/title:\s*"Informe de Gate:\s*(.+?)"/);
    const gate = gateMatch?.[1]?.toLowerCase() ?? 'unknown';

    // Extraer agente del frontmatter
    const agenteMatch = content.match(/auditor:\s*"(.+?)"/);
    const agente = agenteMatch?.[1] ?? 'unknown';

    // Extraer fecha del frontmatter
    const fechaMatch = content.match(/fecha:\s*"(.+?)"/);
    const fecha = fechaMatch?.[1] ?? new Date().toISOString();

    // Extraer dominio del contexto de la tarea
    const dominioMatch = content.match(/Domino\(s\):\s*(.+?)(?:\n|$)/);
    const dominio = dominioMatch?.[1]?.trim() ?? '';

    // Extraer hallazgos de la tabla Markdown
    const hallazgos = this.parseFindingsTable(content);

    return { gate, agente, veredicto, fecha, hallazgos, dominio };
  }

  /**
   * @description Parsea la tabla de hallazgos en formato Markdown.
   * Formato esperado:
   * | ID | Dimension | Hallazgo | Severidad | Evidencia | Recomendacion | Agente responsable |
   */
  private parseFindingsTable(content: string): ParsedFinding[] {
    const findings: ParsedFinding[] = [];
    const lines = content.split('\n');
    let inTable = false;
    let headerPassed = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Detectar inicio de tabla
      if (trimmed.startsWith('| ID |')) {
        inTable = true;
        continue;
      }

      // Saltar separador |---|----|
      if (inTable && trimmed.startsWith('|---')) {
        headerPassed = true;
        continue;
      }

      // Salir de la tabla al encontrar linea no-tabla
      if (inTable && headerPassed && (!trimmed.startsWith('|') || trimmed.startsWith('| ---'))) {
        break;
      }

      if (inTable && headerPassed && trimmed.startsWith('|')) {
        const finding = this.parseTableRow(trimmed);
        if (finding) {
          findings.push(finding);
        }
      }
    }

    return findings;
  }

  /**
   * @description Parsea una fila de la tabla Markdown.
   * Maneja el encoding corrupto (caracteres corruptos) limpiando el texto.
   */
  private parseTableRow(row: string): ParsedFinding | null {
    // Dividir por | respetando pipes escapados
    const parts = row.split('|').map(p => p.trim()).filter(p => p.length > 0);

    if (parts.length < 7) return null;

    const id = this.cleanText(parts[0]);
    const dimension = this.cleanText(parts[1]);
    const hallazgo = this.cleanText(parts[2]);
    const severidadRaw = this.cleanText(parts[3]).replace(/\*\*/g, '');
    const evidencia = this.cleanText(parts[4]);
    const recomendacion = this.cleanText(parts[5]);
    const agenteResponsable = this.cleanText(parts[6]);

    // Mapear severidad
    const severidad = this.mapSeverity(severidadRaw);

    return {
      id,
      dimension,
      hallazgo,
      severidad,
      evidencia,
      recomendacion,
      agenteResponsable,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * @description Limpia caracteres corruptos del encoding.
   */
  private cleanText(text: string): string {
    return text
      .replace(/\uFFFD/g, '')     // Quitar caracter de reemplazo Unicode
      .replace(/[^\x20-\x7E\s]/g, '') // Quitar no-ASCII imprimible
      .replace(/\s+/g, ' ')       // Normalizar espacios
      .trim();
  }

  /**
   * @description Mapea texto de severidad a enum.
   */
  private mapSeverity(raw: string): 'critical' | 'high' | 'medium' | 'low' {
    return SEVERITY_MAP[raw] ?? SEVERITY_MAP[raw.toLowerCase()] ?? 'medium';
  }

  /**
   * @description Determina si un archivo es GO sin hallazgos (para saltarlo).
   */
  private isGoWithoutFindings(content: string): boolean {
    const hasNoGo = content.includes('NO-GO');
    const hasFindings = content.includes('| ID |');
    return !hasNoGo && !hasFindings;
  }

  /**
   * @description Infiere el dominio Reflection a partir del gate y contexto.
   */
  private inferDomain(parsed: ParsedGateFile): ReflectionDomain {
    const gate = parsed.gate.toLowerCase();
    const dominio = parsed.dominio.toLowerCase();

    if (gate.includes('qa') || gate.includes('test')) return 'test';
    if (gate.includes('security')) return 'audit';
    if (gate.includes('architecture')) return 'audit';
    if (gate.includes('orquest')) return 'agent';
    if (dominio.includes('bootstrap') || dominio.includes('config')) return 'bootstrap';
    if (dominio.includes('commit')) return 'commit';

    return 'audit';
  }

  /**
   * @description Infiere el failureType a partir del hallazgo y dominio.
   * Usa palabras clave en el texto del hallazgo.
   */
  private inferFailureType(finding: ParsedFinding, domain: ReflectionDomain): string {
    const text = `${finding.hallazgo} ${finding.dimension} ${finding.evidencia}`.toLowerCase();

    // Patrones por dominio
    if (domain === 'audit') {
      if (text.includes('security') || text.includes('vulnerabilidad') || text.includes('owasp')) return 'security_vulnerability';
      if (text.includes('test') || text.includes('cobertura') || text.includes('coverage')) return 'missing_test_coverage';
      if (text.includes('error') || text.includes('exception') || text.includes('catch')) return 'incomplete_error_handling';
      if (text.includes('documentacion') || text.includes('documentation') || text.includes('doc')) return 'missing_documentation';
      if (text.includes('arquitectura') || text.includes('architecture') || text.includes('diseno')) return 'architecture_violation';
      if (text.includes('log') || text.includes('logging')) return 'missing_logging';
      if (text.includes('validacion') || text.includes('validation') || text.includes('input')) return 'unvalidated_input';
      if (text.includes('secret') || text.includes('password') || text.includes('api_key')) return 'hardcoded_secret';
      if (text.includes('rollback') || text.includes('migracion')) return 'missing_rollback';
      if (text.includes('conexion') || text.includes('connection') || text.includes('pool')) return 'connection_leak';
    }

    if (domain === 'test') {
      if (text.includes('timeout') || text.includes('tiempo')) return 'jest_timeout';
      if (text.includes('cobertura') || text.includes('coverage') || text.includes('threshold')) return 'coverage_below_threshold';
      if (text.includes('flaky') || text.includes('intermitente')) return 'flaky_test';
      if (text.includes('assert') || text.includes('assertion')) return 'test_without_assertion';
      if (text.includes('integration') || text.includes('integracion')) return 'integration_test_without_container';
      if (text.includes('type') || text.includes('tsc') || text.includes('tipado')) return 'tsc_noEmit_type_error';
    }

    if (domain === 'agent') {
      if (text.includes('seleccion') || text.includes('wrong') || text.includes('incorrecto')) return 'wrong_agent_selected';
      if (text.includes('timeout') || text.includes('tiempo')) return 'agent_timeout';
      if (text.includes('alucinacion') || text.includes('hallucination')) return 'agent_hallucination';
      if (text.includes('delegacion') || text.includes('delegation')) return 'delegation_failed';
      if (text.includes('rechaz') || text.includes('rejected') || text.includes('evaluator')) return 'response_rejected_by_evaluator';
    }

    if (domain === 'bootstrap') {
      if (text.includes('config') || text.includes('yaml') || text.includes('manifest')) return 'manifest_corrupt';
      if (text.includes('memoria') || text.includes('memory') || text.includes('load')) return 'memory_load_failure';
      if (text.includes('seed') || text.includes('configuracion')) return 'seed_config_failed';
    }

    if (domain === 'commit') {
      if (text.includes('type') || text.includes('tipo')) return 'missing_type';
      if (text.includes('scope') || text.includes('ambito')) return 'wrong_scope';
      if (text.includes('branch') || text.includes('rama')) return 'branch_naming_invalid';
    }

    return 'unknown_failure';
  }

  /**
   * @description Resuelve el directorio de auditorias para un proyecto.
   */
  private resolveProjectAuditsDir(projectRoot: string): string | null {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    const projectKey = cwdToProjectKey(projectRoot);
    return path.join(home, '.deepseek-code', 'projects', projectKey, 'audits');
  }

  /**
   * @description Encuentra todos los directorios audits/ en projects/.
   */
  private async findAllProjectAuditsDirs(): Promise<(string | null)[]> {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    const projectsDir = path.join(home, '.deepseek-code', 'projects');

    try {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });
      const dirs: (string | null)[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const auditsDir = path.join(projectsDir, entry.name, 'audits');
          try {
            await fs.access(auditsDir);
            dirs.push(auditsDir);
          } catch {
            // No tiene audits/
          }
        }
      }

      return dirs;
    } catch {
      return [];
    }
  }
}
