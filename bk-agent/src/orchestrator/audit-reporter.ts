/**
 * @description Audit Reporter — Orquestador de informes Markdown de auditoría multi-gate.
 *
 * **Responsabilidad:** Coordinar las 8 clases helper del subsistema de auditoría
 * para generar informes con versionado semántico, fechas precisas y hash de integridad.
 *
 * **Delegación:**
 * - `AuditReportVersionManager` → versionado semántico
 * - `AuditReportRenderer` → renderizado Markdown + hash SHA-256
 * - `AuditLessonsLearned` → lecciones aprendidas
 * - `AuditSilentGatesBuffer` → batch diario de auto-gates silenciosos
 * - `AuditPendingIssues` → issues pendientes (críticos/altos)
 * - `AuditFindingTracer` → trazabilidad hallazgo → commit
 * - `AuditCiBlocker` → bloqueo de deploys en CI/CD
 * - `AuditReflectionBridge` → puente con Reflection Engine
 *
 * Cada informe se almacena en ~/.deepseek-code/projects/{cwd-hashed}/audits/
 * y se aísla por proyecto usando el mismo esquema que la memoria persistente.
 *
 * @example
 * ```ts
 * const reporter = new AuditReporter({ projectRoot: process.cwd(), useGlobalDir: true });
 * await reporter.recordGate('architecture', 'APPROVED', findings, task);
 * await reporter.generateFinalReport(sprintInfo);
 * ```
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { TaskContext } from '../types/task-context';
import { cwdToProjectKey } from '../bootstrap/memory-loader';
import { sanitizeFilename } from '../shared/utils/string-utils';
import { ReflectionEngine } from '../reflection/reflection-engine';
import {
  AuditReportVersionManager,
  AuditReportRenderer,
  AuditLessonsLearned,
  AuditSilentGatesBuffer,
  AuditPendingIssues,
  AuditFindingTracer,
  AuditCiBlocker,
  AuditReflectionBridge,
} from './audit';
import type {
  AuditFinding,
  GateVeredict,
  GateRecord,
  SprintInfo,
  FinalReport,
  AuditStats,
} from './audit';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFormattedDate(): string {
  return new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z/, ' UTC');
}

// ── AuditReporter ────────────────────────────────────────────────────────────

export class AuditReporter {
  private docsDir: string;
  private gates: GateRecord[] = [];

  // Sub-sistemas delegados
  private versionManager: AuditReportVersionManager;
  private renderer: AuditReportRenderer;
  private lessons: AuditLessonsLearned;
  private silentBuffer: AuditSilentGatesBuffer;
  private pendingIssues: AuditPendingIssues;
  private findingTracer: AuditFindingTracer;
  private ciBlocker: AuditCiBlocker;
  private reflectionBridge: AuditReflectionBridge;

  constructor(options?: { projectRoot?: string; useGlobalDir?: boolean }) {
    const root = options?.projectRoot ?? process.cwd();
    const useGlobal = options?.useGlobalDir ?? true;

    if (useGlobal) {
      const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
      this.docsDir = path.join(home, '.deepseek-code', 'projects', cwdToProjectKey(root), 'audits');
    } else {
      this.docsDir = path.join(root, 'docs', 'auditorias');
    }

    // Inicializar sub-sistemas
    this.versionManager = new AuditReportVersionManager(this.docsDir);
    this.renderer = new AuditReportRenderer();
    this.lessons = new AuditLessonsLearned(this.docsDir);
    this.silentBuffer = new AuditSilentGatesBuffer(this.docsDir);
    this.pendingIssues = new AuditPendingIssues(this.docsDir);
    this.findingTracer = new AuditFindingTracer(this.docsDir);
    this.ciBlocker = new AuditCiBlocker(this.docsDir);
    this.reflectionBridge = new AuditReflectionBridge();
  }

  // ── recordGate ─────────────────────────────────────────────────────────────

  /**
   * @description Registra el resultado de un gate individual.
   * Si skipIfEmpty=true y es auto-GO sin hallazgos, solo acumula en buffer diario
   * sin persistir archivo individual.
   */
  async recordGate(
    gate: string,
    agente: string,
    veredicto: GateVeredict,
    hallazgos: AuditFinding[],
    task?: TaskContext,
    notas?: string,
    skipIfEmpty?: boolean
  ): Promise<string> {
    const isAutoEmpty = skipIfEmpty === true && veredicto === 'GO' && hallazgos.length === 0;
    const fecha = getFormattedDate();

    const record: GateRecord = { gate, agente, veredicto, fecha, hallazgos, notas };
    this.gates.push(record);

    // Auto-GO sin hallazgos → buffer diario, no persiste
    if (isAutoEmpty) {
      this.silentBuffer.add(gate, agente, fecha, veredicto, notas);
      return '';
    }

    // Cargar y versionar: gate individual → patch
    await this.versionManager.load();
    this.versionManager.incrementPatch();

    const version = this.versionManager.getVersionString();
    const content = this.renderer.renderGateReport(record, version, fecha, task);

    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const filename = `gate-${sanitizeFilename(gate)}-${version}-${suffix}.md`;

    await this.ensureDocsDir();
    await this.versionManager.save();
    const filePath = path.join(this.docsDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');

    return filePath;
  }

  // ── generateFinalReport ────────────────────────────────────────────────────

  /**
   * @description Genera el informe final consolidado con todos los gates,
   * veredicto general y plan de remediación. Incrementa minor.
   */
  async generateFinalReport(sprint: SprintInfo): Promise<string> {
    await this.versionManager.load();
    this.versionManager.incrementMinor();

    const fecha = getFormattedDate();
    const version = this.versionManager.getVersionString();
    const veredictoFinal = this.calculateFinalVeredict();
    const riesgos = this.calculateAccumulatedRisks();
    const resumen = this.renderer.buildExecutiveSummary(sprint, veredictoFinal, this.gates);

    const report: FinalReport = { sprint, gates: this.gates, veredictoFinal, resumen, riesgos, fecha };
    const content = this.renderer.renderFinalReport(report, version, fecha);

    const filename = `informe-final-multigate-${sanitizeFilename(sprint.name)}-v${version}.md`;

    await this.ensureDocsDir();
    await this.versionManager.save();
    const filePath = path.join(this.docsDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');

    // Generar memo de lecciones aprendidas
    await this.lessons.generateMemo(this.gates).catch(() => {});

    return filePath;
  }

  // ── Getters básicos ────────────────────────────────────────────────────────

  getGates(): GateRecord[] {
    return this.gates.map(g => ({ ...g, hallazgos: g.hallazgos.map(h => ({ ...h })) }));
  }

  reset(): void {
    this.gates = [];
  }

  getAuditsDir(): string {
    return this.docsDir;
  }

  // ── Lecciones aprendidas ───────────────────────────────────────────────────

  getLessonsLearned(): string[] {
    return this.lessons.analyze(this.gates);
  }

  async generateLessonsMemo(): Promise<string | null> {
    return this.lessons.generateMemo(this.gates);
  }

  // ── Blockers básicos ───────────────────────────────────────────────────────

  hasActiveBlockers(): boolean {
    return this.gates.some(g => g.hallazgos.some(h => h.severidad === 'critical' || h.severidad === 'high'));
  }

  getActiveBlockers(): AuditFinding[] {
    return this.gates.flatMap(g => g.hallazgos.filter(h => h.severidad === 'critical' || h.severidad === 'high'));
  }

  getStats(): AuditStats {
    const total = this.gates.length;
    const withFindings = this.gates.filter(g => g.hallazgos.length > 0).length;
    const goCount = this.gates.filter(g => g.veredicto === 'GO').length;
    return {
      totalGates: total,
      withFindings,
      approvalRate: total > 0 ? Math.round((goCount / total) * 100) : 0,
      lessonsCount: this.getLessonsLearned().length,
    };
  }

  // ── Silent gates (batch diario) ────────────────────────────────────────────

  /**
   * @description Genera un reporte diario con todos los auto-gates silenciosos
   * acumulados. Reduce 130+ archivos individuales a 1 reporte diario consolidado.
   *
   * @see docs/auditorias/mejoras-audit-reporter.md
   */
  async generateDailySilentGatesReport(fecha?: string): Promise<string | null> {
    return this.silentBuffer.generateDailyReport(fecha);
  }

  getSilentGates(): Array<{ gate: string; agente: string; fecha: string; veredicto: GateVeredict }> {
    return this.silentBuffer.getAll();
  }

  clearSilentGates(): void {
    this.silentBuffer.clear();
  }

  // ── Complete Sprint ────────────────────────────────────────────────────────

  /**
   * @description Completa un sprint generando el informe final, reporte diario
   * de auto-gates, y pending issues si el veredicto es NO-GO.
   *
   * @see docs/auditorias/mejoras-audit-reporter.md
   */
  async completeSprint(
    sprint: SprintInfo,
    finalVeredict?: GateVeredict
  ): Promise<{
    reportPath: string;
    pendingIssues: AuditFinding[];
    silentReportPath: string | null;
  }> {
    const silentReportPath = await this.silentBuffer.generateDailyReport();
    const reportPath = await this.generateFinalReport(sprint);
    const veredicto = finalVeredict ?? this.calculateFinalVeredict();

    const issues: AuditFinding[] = [];
    if (veredicto === 'NO-GO' || veredicto === 'NO-GO condicional') {
      for (const gate of this.gates) {
        for (const hallazgo of gate.hallazgos) {
          if (hallazgo.severidad === 'critical' || hallazgo.severidad === 'high') {
            issues.push({ ...hallazgo });
          }
        }
      }
      if (issues.length > 0) {
        await this.pendingIssues.persist(issues, sprint, veredicto);
      }
    }

    // Reportar hallazgos al Reflection Engine (si está conectado)
    await this.reflectionBridge.reportFindings(this.gates).catch((err: any) => {
      console.warn("[AuditReporter] Error en reportToReflectionEngine:", err?.message);
    });

    this.silentBuffer.clear();
    return { reportPath, pendingIssues: issues, silentReportPath };
  }

  // ── Trazabilidad Hallazgo → Commit ─────────────────────────────────────────

  /**
   * @description Marca un hallazgo como resuelto, asociándolo con un commit.
   * Busca en memoria y en disco.
   *
   * @see docs/auditorias/mejoras-audit-reporter.md
   */
  async markFindingResolved(findingId: string, commitHash: string, commitMessage?: string): Promise<boolean> {
    return this.findingTracer.markResolved(this.gates, findingId, commitHash, commitMessage);
  }

  /**
   * @description Marca hallazgos como resueltos buscando por archivos modificados
   * en el commit. Útil para hook post-commit.
   */
  async markFindingsResolvedByFiles(commitHash: string, modifiedFiles: string[]): Promise<number> {
    return this.findingTracer.markResolvedByFiles(this.gates, commitHash, modifiedFiles);
  }

  // ── CLI audit check (bloqueo de deploys) ────────────────────────────────────

  /**
   * @description Verifica si hay hallazgos críticos/altos sin resolver.
   * Útil para CI/CD: si retorna true, el pipeline debe fallar.
   *
   * @see docs/auditorias/mejoras-audit-reporter.md
   */
  async hasCriticalOpenFindings(): Promise<boolean> {
    return this.ciBlocker.hasCriticalOpenFindings(this.gates);
  }

  /**
   * @description Genera reporte de estado para CI/CD.
   */
  async generateCiReport(): Promise<{
    ok: boolean;
    criticalCount: number;
    highCount: number;
    findings: AuditFinding[];
    message: string;
  }> {
    return this.ciBlocker.generateCiReport(this.gates);
  }

  // ── Reflexión ──────────────────────────────────────────────────

  /**
   * @description Conecta el AuditReporter con el Reflection Engine.
   *
   * @see docs/auditorias/mejoras-audit-reporter.md
   */
  connectReflectionEngine(engine: ReflectionEngine): void {
    this.reflectionBridge.connect(engine);
  }

  /**
   * @description Desconecta el Reflection Engine.
   */
  disconnectReflectionEngine(): void {
    this.reflectionBridge.disconnect();
  }

  // ── Privados ───────────────────────────────────────────────────────────────

  private async ensureDocsDir(): Promise<void> {
    await fs.mkdir(this.docsDir, { recursive: true });
  }

  private calculateFinalVeredict(): GateVeredict {
    if (this.gates.length === 0) return 'NO-GO';
    if (this.gates.some(g => g.veredicto === 'NO-GO' && g.hallazgos.some(h => h.severidad === 'critical'))) return 'NO-GO';
    if (this.gates.some(g => g.veredicto === 'NO-GO')) return 'NO-GO condicional';
    if (this.gates.some(g => g.veredicto === 'NO-GO condicional')) return 'NO-GO condicional';
    return 'GO';
  }

  private calculateAccumulatedRisks(): Array<{ riesgo: string; probabilidad: string; impacto: string; mitigacion: string }> {
    const criticalFindings = this.gates.flatMap(g => g.hallazgos.filter(h => h.severidad === 'critical' || h.severidad === 'high'));
    if (criticalFindings.length === 0) return [];
    return criticalFindings.slice(0, 5).map(h => ({
      riesgo: h.hallazgo,
      probabilidad: h.severidad === 'critical' ? '🔴 Alta' : '🟡 Media',
      impacto: h.severidad === 'critical' ? '🔴 Crítico' : '🟡 Alto',
      mitigacion: h.recomendacion,
    }));
  }
}
