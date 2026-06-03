/**
 * @description Orquestador principal — Pipeline completo de clasificación.
 * 
 * Integra: Intent Detection → Domain Detection → Risk Scoring → Policy Engine
 * 
 * Cada etapa enriquece el TaskContext progresivamente.
 * El resultado final contiene los agentes seleccionados, políticas aplicadas
 * y gates requeridos para proceder.
 * 
 * @example
 * ```ts
 * const orchestrator = new Orchestrator(client, config);
 * const result = await orchestrator.orchestrate('Agregar circuit breaker para ServiceNow');
 * // result.task.actionType === 'implementation'
 * // result.task.domains === ['resilience', 'backend']
 * // result.task.riskLevel === 'high'
 * // result.selectedAgents === ['architecture-agent', 'backend-agent', 'qa-engineer']
 * ```
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as yaml from 'yaml';
import { AgentClient } from '../api/client';
import { createTaskContext, TaskContext, TaskStatus } from '../types/task-context';
import { enrichTaskWithIntent } from './intent-detector';
import { enrichTaskWithDomains } from './domain-detector';
import { enrichTaskWithRisk } from './risk-scorer';
import { applyPolicies, PolicyEngineResult } from './policy-engine';
import { TaskFSM, FSMTransitionResult } from './fsm';
import {
  OrchestratorConfig,
  OrchestrationResult,
  PolicyRule,
  CapabilityMatrix,
  AgentPipelinePhase,
  AgentPipelinePhaseType,
  defaultOrchestratorConfig,
} from './types';
import { AuditReporter } from './audit-reporter';
import type { GateVeredict, AuditFinding } from './audit';

export type { OrchestratorConfig, OrchestrationResult, PolicyRule, CapabilityMatrix };
export { defaultOrchestratorConfig } from './types';
export { detectIntent, enrichTaskWithIntent } from './intent-detector';
export { detectDomains, enrichTaskWithDomains } from './domain-detector';
export { calculateRisk, enrichTaskWithRisk } from './risk-scorer';
export { evaluatePolicies, applyPolicies } from './policy-engine';
export { TaskFSM } from './fsm';
export type { FSMTransitionResult } from './fsm';
export { createTaskContext } from '../types/task-context';
export type { TaskContext } from '../types/task-context';
export { AuditReporter } from './audit-reporter';
export type { AuditFinding, GateVeredict } from './audit';

/**
 * @description Orquestador central del sistema multi-agente.
 * 
 * Procesa el input del usuario a través de un pipeline de 4 etapas:
 * 1. Intent Detection — clasifica la acción (design, implement, etc.)
 * 2. Domain Detection — identifica bounded contexts
 * 3. Risk Scoring — calcula nivel de riesgo técnico
 * 4. Policy Engine — aplica reglas y determina agentes/gates
 * 
 * El resultado es un OrchestrationResult que el AgentLoop puede usar
 * para seleccionar agentes, aplicar gates y controlar el flujo.
 * 
 * **Auditoría integrada:**
 * Cada vez que `orchestrate()` se ejecuta, el AuditReporter registra
 * automáticamente un gate de orquestación con los hallazgos detectados.
 * 
 * Los gates de QA, security y architecture se registran desde el AgentLoop
 * usando `getAuditReporter()`.
 */
export class Orchestrator {
  private client?: AgentClient;
  private config: OrchestratorConfig;
  private customRules?: PolicyRule[];
  private capabilityMatrix?: CapabilityMatrix;
  private fsm: TaskFSM;
  private auditReporter: AuditReporter;

  constructor(options?: {
    client?: AgentClient;
    config?: OrchestratorConfig;
    customRules?: PolicyRule[];
    capabilityMatrix?: CapabilityMatrix;
    /** Ruta raíz del proyecto para los informes de auditoría (default: process.cwd()) */
    projectRoot?: string;
  }) {
    this.client = options?.client;
    this.config = options?.config ?? defaultOrchestratorConfig();
    this.customRules = options?.customRules;
    this.capabilityMatrix = options?.capabilityMatrix;
    this.fsm = new TaskFSM();
    this.auditReporter = new AuditReporter({
      projectRoot: options?.projectRoot ?? process.cwd(),
      useGlobalDir: true,
    });
  }

  /**
   * @description Procesa el input del usuario a través del pipeline completo.
   * 
   * @param input - Texto del usuario
   * @returns Resultado completo de la orquestación
   */
  async orchestrate(input: string): Promise<OrchestrationResult> {
    // Etapa 1: Crear TaskContext
    let task = createTaskContext(input);

    // Etapa 2: Intent Detection
    if (this.config.features.intentDetection) {
      task = await enrichTaskWithIntent(task, this.client);
    }

    // Etapa 3: Domain Detection
    if (this.config.features.domainDetection) {
      task = enrichTaskWithDomains(task);
    }

    // Etapa 4: Risk Scoring
    if (this.config.features.riskScoring) {
      task = enrichTaskWithRisk(task, this.config);
    }

    // Etapa 5: Policy Engine
    let policyResult: PolicyEngineResult = {
      mustInclude: [],
      requiredGates: [],
      mustExecute: [],
      appliedRules: [],
    };

    if (this.config.features.policyEngine) {
      const manifestRules = await this.loadManifestPolicyRules();
      const mergedRules = [...(this.customRules ?? []), ...manifestRules];
      const result = applyPolicies(task, mergedRules.length > 0 ? mergedRules : undefined, input);
      task = result.task;
      policyResult = result.result;
    }

    // Etapa 6: Seleccionar agentes basados en capability matrix
    const selectedAgents = this.selectAgents(task, policyResult);

    // Etapa 7: Construir pipeline secuencial de agentes
    const agentPipeline = this.buildPipeline(selectedAgents, task);

    // Etapa 8: Determinar si commit está permitido
    const commitAllowed = this.isCommitAllowed(task, policyResult);

    // ── Etapa 9: Auditar orquestación ─────────────────────────────────
    await this.recordOrchestrationGate(task, selectedAgents, policyResult);

    return {
      task,
      selectedAgents,
      agentPipeline, // ← pipeline secuencial
      appliedPolicies: policyResult.appliedRules.map(r => ({
        rule: r.rule,
        reason: r.reason,
      })),
      requiredGates: policyResult.requiredGates,
      commitAllowed,
    };
  }

  // ── Auditoría ──────────────────────────────────────────────────────────

  /**
   * @description Obtiene la instancia del AuditReporter para registrar gates
   * desde el AgentLoop u otros componentes.
   */
  getAuditReporter(): AuditReporter {
    return this.auditReporter;
  }

  /**
   * @description Registra automáticamente un gate de orquestación después
   * de ejecutar el pipeline completo.
   */
  private async recordOrchestrationGate(
    task: TaskContext,
    selectedAgents: Array<{ agentId: string; score: number; reason: string }>,
    policyResult: PolicyEngineResult
  ): Promise<void> {
    const hallazgos: AuditFinding[] = [];

    // Hallazgo de riesgos
    if (task.riskLevel === 'high' || task.riskLevel === 'critical') {
      hallazgos.push({
        id: `ORQ-${randomUUID().slice(0, 8)}`,
        dimension: 'Riesgo',
        hallazgo: `Tarea con nivel de riesgo ${task.riskLevel}`,
        severidad: task.riskLevel === 'critical' ? 'critical' : 'high',
        evidencia: `RiskLevel: ${task.riskLevel}, Factores: ${JSON.stringify(task.riskFactors)}`,
        recomendacion: 'Asegurar que todos los gates requeridos se ejecuten antes del commit',
        agenteResponsable: 'orchestrator',
      });
    }

    // Hallazgo de gates requeridos
    if (policyResult.requiredGates.length > 0) {
      hallazgos.push({
        id: `GATES-${randomUUID().slice(0, 8)}`,
        dimension: 'Políticas',
        hallazgo: `Gates requeridos: ${policyResult.requiredGates.join(', ')}`,
        severidad: 'medium',
        evidencia: `Reglas aplicadas: ${policyResult.appliedRules.map(r => r.rule).join(', ')}`,
        recomendacion: `Ejecutar gates: ${policyResult.requiredGates.join(', ')} antes del commit`,
        agenteResponsable: 'orchestrator',
      });
    }

    // Hallazgo de agentes seleccionados
    if (selectedAgents.length > 0) {
      hallazgos.push({
        id: `AGENTS-${randomUUID().slice(0, 8)}`,
        dimension: 'Selección de Agentes',
        hallazgo: `Agentes seleccionados: ${selectedAgents.map(a => a.agentId).join(', ')}`,
        severidad: 'low',
        evidencia: `Top: ${selectedAgents[0]?.agentId} (score: ${selectedAgents[0]?.score})`,
        recomendacion: selectedAgents.length === 1 && selectedAgents[0]?.agentId === 'general'
          ? 'Considerar configurar capability matrix para mejor selección'
          : 'Selección automática correcta',
        agenteResponsable: 'orchestrator',
      });
    }

    const veredicto: GateVeredict =
      task.riskLevel === 'critical' ? 'NO-GO condicional' :
      task.riskLevel === 'high' ? 'NO-GO condicional' :
      'GO';

    await this.auditReporter.recordGate(
      'orquestación',
      'orchestrator',
      veredicto,
      hallazgos,
      task,
      `Pipeline ejecutado: intent → domains → risk → policies → agents → gates`,
      true // skipIfEmpty: No persistir auto-gates sin hallazgos (reduce ruido)
    );
  }

  // ── Selección de Agentes ────────────────────────────────────────────────

  /**
   * Selecciona agentes combinando:
   * - Políticas obligatorias (mustInclude)
   * - Capability matrix (dominios)
   * - Pesos dinámicos
   */
  private selectAgents(
    task: TaskContext,
    policyResult: PolicyEngineResult
  ): Array<{ agentId: string; score: number; reason: string }> {
    const selected: Array<{ agentId: string; score: number; reason: string }> = [];
    const seen = new Set<string>();

    // Fuente única de verdad: task.assignedAgents (ya rellenado por applyPolicies)
    // más cualquier mustInclude adicional que la política reportó
    const mandatoryIds = new Set([
      ...task.assignedAgents,
      ...policyResult.mustInclude,
    ]);

    for (const agentId of mandatoryIds) {
      if (!seen.has(agentId)) {
        seen.add(agentId);
        selected.push({ agentId, score: 100, reason: 'Politica obligatoria' });
      }
    }

    // Agentes por capability matrix (dominios detectados)
    if (this.capabilityMatrix) {
      for (const domain of task.domains) {
        for (const [agentId, capability] of Object.entries(this.capabilityMatrix)) {
          if (seen.has(agentId)) continue;
          if (capability.owns.includes(domain)) {
            seen.add(agentId);
            const baseWeight = capability.baseWeight ?? 0.8;
            selected.push({
              agentId,
              score: Math.round(baseWeight * 100),
              reason: `Domina el dominio: ${domain}`,
            });
          }
        }
      }
    }

    // Agente general como fallback
    if (selected.length === 0) {
      selected.push({ agentId: 'general', score: 50, reason: 'Fallback: agente general' });
    }

    return selected.sort((a, b) => b.score - a.score);
  }

  /**
   * Construye el pipeline secuencial de agentes en fases:
   * review → implement → verify.
   * 
   * - review: architecture-agent o security-agent si hay dominios de alto riesgo
   * - implement: el agente con mayor score en selectedAgents
   * - verify: qa-engineer siempre al final si hay implementación
   */
  private buildPipeline(
    selectedAgents: Array<{ agentId: string; score: number; reason: string }>,
    task: TaskContext
  ): AgentPipelinePhase[] | undefined {
    if (selectedAgents.length === 0) return undefined;

    const pipeline: AgentPipelinePhase[] = [];

    // Fase review: architecture o security según riesgo
    const isHighRisk = task.riskLevel === 'high' || task.riskLevel === 'critical';
    const hasSecurityDomain = task.domains.includes('security');
    const hasArchitectureDomain = task.domains.includes('architecture') || task.domains.includes('resilience');

    if (task.requiresSecurityReview || (isHighRisk && hasSecurityDomain)) {
      pipeline.push({
        phase: 'review',
        agentId: 'security-agent',
        purpose: 'Review security implications',
        optional: false,
      });
    }
    if (task.requiresArchitectureReview || (isHighRisk && hasArchitectureDomain)) {
      pipeline.push({
        phase: 'review',
        agentId: 'architecture-agent',
        purpose: 'Review architecture for high-risk change',
        optional: false,
      });
    }

    // Fase implement: el mejor agente seleccionado
    const topAgent = selectedAgents[0];
    if (topAgent && topAgent.agentId !== 'general') {
      pipeline.push({
        phase: 'implement',
        agentId: topAgent.agentId,
        purpose: topAgent.reason,
        optional: false,
      });
    }

    // Fase verify: QA siempre al final si hay implementación
    const hasImplementPhase = pipeline.some(p => p.phase === 'implement');
    if (hasImplementPhase && task.requiresQaApproval) {
      pipeline.push({
        phase: 'verify',
        agentId: 'qa-engineer',
        purpose: 'Verify implementation quality and best practices',
        optional: false,
      });
    }

    return pipeline.length > 0 ? pipeline : undefined;
  }

  /**
   * Determina si el commit está permitido según políticas y gates.
   * 
   * Reglas:
   * - Si commitGate está desactivado → siempre permitido
   * - Si ya está en commit_allowed → permitido
   * - Si requiere gates (QA, security, architecture) y no están resueltos → bloqueado
   * - Si no requiere gates → permitido (se puede commitear directamente)
   */
  private isCommitAllowed(
    task: TaskContext,
    policyResult: PolicyEngineResult
  ): boolean {
    if (!this.config.features.commitGate) return true;

    // Si ya está en commit_allowed → permitido
    if (task.status === 'commit_allowed') return true;

    // Si requiere gates específicos y no están resueltos → bloqueado
    if (task.requiresQaApproval && task.status !== 'approved' && task.status !== 'qa_review') return false;
    if (task.requiresSecurityReview && task.status !== 'approved' && task.status !== 'security_review') return false;
    if (task.requiresArchitectureReview && task.status !== 'approved' && task.status !== 'design_review') return false;

    // Si no requiere gates → permitido (tarea simple)
    if (!task.requiresQaApproval && !task.requiresSecurityReview && !task.requiresArchitectureReview) {
      return true;
    }

    return false;
  }

  /**
   * @description Transiciona una tarea a un nuevo estado usando el FSM.
   * Valida que la transición sea legal según las reglas del FSM.
   * 
   * @param task - Tarea a transicionar
   * @param to - Estado destino
   * @returns Resultado de la transición
   */
  transitionTask(task: TaskContext, to: TaskStatus): FSMTransitionResult {
    return this.fsm.transition(task, to);
  }

  /**
   * @description Obtiene los estados destino válidos desde el estado actual.
   */
  getAvailableTransitions(status: TaskStatus): TaskStatus[] {
    return this.fsm.getAvailableTransitions(status);
  }

  /**
   * @description Calcula la ruta crítica desde el estado actual hasta commit_allowed.
   */
  getCriticalPath(task: TaskContext): TaskStatus[] {
    return this.fsm.getCriticalPath(task);
  }

  /**
   * @description Obtiene la instancia del FSM.
   */
  getFSM(): TaskFSM {
    return this.fsm;
  }

  /**
   * @description Actualiza la configuración en runtime.
   */
  updateConfig(config: Partial<OrchestratorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * @description Actualiza las reglas personalizadas en runtime.
   */
  updateRules(rules: PolicyRule[]): void {
    this.customRules = rules;
  }

  /**
   * @description Actualiza la capability matrix en runtime.
   */
  updateCapabilityMatrix(matrix: CapabilityMatrix): void {
    this.capabilityMatrix = matrix;
  }

  /**
   * @description Carga las policyRules auto-promovidas desde manifest.yaml.
   * Estas son generadas por el PolicyPromoter del Reflection Engine y se
   * fusionan con las customRules en cada orchestrate().
   */
  private async loadManifestPolicyRules(): Promise<PolicyRule[]> {
    try {
      const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
      const manifestPath = path.join(home, '.deepseek-code', 'manifest.yaml');
      const content = await fs.promises.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      const rules: Array<{ if?: unknown; then?: unknown }> = manifest?.policyRules ?? [];
      return rules
        .filter(r => r.if && r.then)
        .map(r => ({ if: r.if, then: r.then })) as PolicyRule[];
    } catch {
      return [];
    }
  }
}
