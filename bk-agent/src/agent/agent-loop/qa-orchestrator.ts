/**
 * @description Orquesta las transiciones de QA review dentro del AgentLoop.
 * Maneja: auto-activacion de qa-engineer, registro de gates en AuditReporter,
 * transiciones de estado (qa_review -> approved -> commit), y reseteo al General.
 */
import { Message } from '../../api/types';
import { Orchestrator, OrchestrationResult } from '../../orchestrator/index';
import type { AuditFinding } from '../../orchestrator/audit';
import { TaskStatus } from '../../types/task-context';
import { AgentProfile } from '../profiles';
import { AgentRouter } from '../routing/index';
import { AgentHook } from '../../reflection/hooks/agent-hook';
import { QAService } from '../qa/index';

export interface QaTransitionContext {
  clean: string;
  orchestrationResult: OrchestrationResult;
  orchestrator: Orchestrator;
  qaService: QAService;
  router: AgentRouter;
  agentHook: AgentHook;
  allAgents?: AgentProfile[];
  noQA?: boolean;
  onQAReview?: (review: string) => void;
  onAgentRouting?: (profile: AgentProfile, method: 'override' | 'textual' | 'llm') => void;
  onAgentAutoSwitch?: (profile: AgentProfile) => void;
  messages: Message[];
  effectiveAgentId: string;
  setAgentProfile: (addition: string, resetHistory?: boolean) => void;
  setEffectiveAgent: (agentId: string, temperature: number, profileAddition: string) => void;
  autoCommitAfterQaApproval: () => Promise<void>;
}

/**
 * @description Intenta avanzar por gates requeridos (design_review, security_review, qa_review)
 * cuando el orquestador esta presente y la respuesta tiene codigo sustancial.
 */
export async function advanceRequiredGates(
  ctx: QaTransitionContext,
): Promise<void> {
  const { orchestrationResult, orchestrator, qaService, clean } = ctx;

  const hasSubstantialCode = qaService.countCodeLines(clean) >= 8;
  if (!hasSubstantialCode) return;

  const gates: Array<{ status: TaskStatus; gateName: string; agentId: string }> = [
    { status: 'design_review', gateName: 'architecture', agentId: 'architecture-agent' },
    { status: 'security_review', gateName: 'security', agentId: 'security-agent' },
    { status: 'qa_review', gateName: 'qa', agentId: 'qa-engineer' },
  ];

  for (const gate of gates) {
    const transition = orchestrator.transitionTask(
      orchestrationResult.task,
      gate.status,
    );
    if (transition.allowed && transition.task) {
      orchestrationResult.task = transition.task;

      // Registrar gate en AuditReporter
      const reporter = orchestrator.getAuditReporter();
      if (reporter) {
        reporter.recordGate(
          gate.gateName,
          gate.agentId,
          'GO',
          [],
          orchestrationResult.task,
          `Gate automatico: ${gate.gateName} (ruta sin revisiones pendientes)`,
          true,
        ).catch((err: any) => console.warn(`[AuditReporter] Error registrando gate ${gate.gateName}:`, err?.message));
      }
    }
  }
}

/**
 * @description Activa el agente qa-engineer cuando el estado es qa_review
 * y el agente actual no es qa-engineer.
 */
export function activateQaEngineerIfNeeded(
  ctx: QaTransitionContext,
): boolean {
  const { orchestrationResult, allAgents, noQA, clean, qaService, messages } = ctx;

  const currentStatus = orchestrationResult?.task.status;
  if (
    currentStatus !== 'qa_review' ||
    ctx.effectiveAgentId === 'qa-engineer' ||
    noQA
  ) {
    return false;
  }

  const hasSubstantialCode = qaService.countCodeLines(clean) >= 8;
  if (!hasSubstantialCode) return false;

  const qaAgent = allAgents?.find(a => a.id === 'qa-engineer');
  if (!qaAgent) return false;

  ctx.setEffectiveAgent('qa-engineer', qaAgent.temperature ?? 0.2, qaAgent.systemPromptAddition);
  ctx.onAgentRouting?.(qaAgent, 'textual');
  ctx.onAgentAutoSwitch?.(qaAgent);

  const qaReviewMessage = `Revisa el siguiente codigo generado y determina si es apto para commit. Tu revision es la ultima palabra y sera visible para el usuario.\n\n${clean}`;
  messages.push({ role: 'user', content: qaReviewMessage });

  return true;
}

/**
 * @description Procesa la respuesta del qa-engineer: registra el gate,
 * evalua si aprueba, transiciona a approved o rework_required,
 * y dispara auto-commit si corresponde.
 */
export async function processQaEngineerResponse(
  ctx: QaTransitionContext,
): Promise<void> {
  const { orchestrationResult, orchestrator, qaService, router, agentHook, clean, messages } = ctx;

  const qaReview = clean;
  if (ctx.onQAReview) {
    ctx.onQAReview(qaReview);
  }

  // Registrar gate de QA en AuditReporter
  const qaReporter = orchestrator.getAuditReporter();
  if (qaReporter) {
    const gateHallazgos: AuditFinding[] = qaService.extractFindings(qaReview);
    qaReporter.recordGate(
      'qa',
      'qa-engineer',
      qaService.evaluateReview(qaReview) ? 'GO' : 'NO-GO condicional',
      gateHallazgos,
      orchestrationResult.task,
      'QA review del agente qa-engineer (auto-activado)',
      true,
    ).catch((err: any) => console.warn('[AuditReporter] Error registrando gate QA:', err?.message));
  }

  const qaApproved = qaService.evaluateReview(qaReview);

  if (qaApproved) {
    router.recordSuccess('qa-engineer');
    const toApproved = orchestrator.transitionTask(
      orchestrationResult.task,
      'approved',
    );
    if (toApproved.allowed && toApproved.task) {
      orchestrationResult.task = toApproved.task;

      // TASK-10: completeSprint() reporta hallazgos al Reflection Engine ademas del informe final
      const finalReporter = orchestrator.getAuditReporter();
      if (finalReporter) {
        const sprintInfo = {
          name: orchestrationResult.task.rawPrompt?.slice(0, 48) ?? 'sprint',
          version: '1.0.0',
          purpose: orchestrationResult.task.rawPrompt ?? 'Implementacion automatica',
          newFiles: [] as string[],
          modifiedFiles: [] as string[],
          testCount: 0,
          testTime: '0s',
        };
        finalReporter.completeSprint(sprintInfo).catch((err: any) =>
          console.warn('[AuditReporter] Error completando sprint:', err?.message),
        );
      }

    }
  } else {
    router.recordFailure('qa-engineer');
    agentHook.reportAgentFailure(
      `QA auto-review rechazo la respuesta del agente "${ctx.effectiveAgentId}"`,
      ctx.effectiveAgentId,
      [],
      'response_rejected_by_evaluator',
    ).catch(() => {});

    const rework = orchestrator.transitionTask(
      orchestrationResult.task,
      'rework_required',
    );
    if (rework.allowed && rework.task) {
      orchestrationResult.task = rework.task;
    }
  }

  // Resetear al General despues de que el QA engineer complete su review
  ctx.setEffectiveAgent('general', 0.2, '');
}

/**
 * @description Procesa QA review inline (cuando no hay qa-engineer dedicado).
 * Evalua la respuesta, registra el gate y transiciona estados.
 */
export async function processInlineQaReview(
  ctx: QaTransitionContext,
): Promise<void> {
  const { orchestrationResult, orchestrator, qaService, router, agentHook, clean } = ctx;

  const review = await qaService.reviewResponse(clean);
  if (!review) return;

  if (ctx.onQAReview) {
    ctx.onQAReview(review);
  }

  // Registrar gate de QA inline en AuditReporter
  const qaReporter = orchestrator.getAuditReporter();
  if (qaReporter) {
    const gateHallazgos: AuditFinding[] = qaService.extractFindings(review);
    qaReporter.recordGate(
      'qa',
      'qa-engineer',
      qaService.evaluateReview(review) ? 'GO' : 'NO-GO condicional',
      gateHallazgos,
      orchestrationResult.task,
      'QA review inline post-respuesta',
      true,
    ).catch((err: any) => console.warn('[AuditReporter] Error registrando gate QA inline:', err?.message));
  }

  const qaApproved = qaService.evaluateReview(review);

  if (qaApproved) {
    router.recordSuccess(ctx.effectiveAgentId);
    const currentTask = orchestrationResult.task;
    if (currentTask.status !== 'qa_review' && currentTask.status !== 'approved') {
      const toQa = orchestrator.transitionTask(currentTask, 'qa_review');
      if (toQa.allowed && toQa.task) {
        orchestrationResult.task = toQa.task;
      }
    }
    const toApproved = orchestrator.transitionTask(
      orchestrationResult.task,
      'approved',
    );
    if (toApproved.allowed && toApproved.task) {
      orchestrationResult.task = toApproved.task;
      // TASK-10: completeSprint() reporta hallazgos al Reflection Engine
      const inlineReporter = orchestrator.getAuditReporter();
      if (inlineReporter) {
        const sprintInfo = {
          name: orchestrationResult.task.rawPrompt?.slice(0, 48) ?? 'sprint',
          version: '1.0.0',
          purpose: orchestrationResult.task.rawPrompt ?? 'Implementacion automatica',
          newFiles: [] as string[],
          modifiedFiles: [] as string[],
          testCount: 0,
          testTime: '0s',
        };
        inlineReporter.completeSprint(sprintInfo).catch((err: any) =>
          console.warn('[AuditReporter] Error completando sprint inline:', err?.message),
        );
      }
    }
  } else {
    router.recordFailure(ctx.effectiveAgentId);
    agentHook.reportAgentFailure(
      `QA inline rechazo la respuesta del agente "${ctx.effectiveAgentId}"`,
      ctx.effectiveAgentId,
      [],
      'response_rejected_by_evaluator',
    ).catch(() => {});

    const rework = orchestrator.transitionTask(
      orchestrationResult.task,
      'rework_required',
    );
    if (rework.allowed && rework.task) {
      orchestrationResult.task = rework.task;
    }
  }
}
