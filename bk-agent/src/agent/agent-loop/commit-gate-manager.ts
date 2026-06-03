/**
 * @description Gestiona el gate de commit y la ejecucion de commits.
 * Verifica que los gates requeridos esten aprobados antes de permitir el commit,
 * y ejecuta el workflow de commit con validaciones (tests, QA review).
 */
import { Orchestrator, OrchestrationResult } from '../../orchestrator/index';
import { TaskStatus } from '../../types/task-context';
import {
  runCommitWorkflow,
  runPreCommitTests,
  detectCommitWorkflow,
  getStagedFiles,
  checkGitConfig,
  CommitWorkflowOptions,
  CommitWorkflowResult,
} from '../commit/index';
import { AgentRouter } from '../routing/index';
import { TestHook } from '../../reflection/hooks/test-hook';
import { CommitHook } from '../../reflection/hooks/commit-hook';
import { QAService } from '../qa/index';

export interface CommitGateResult {
  allowed: boolean;
  criticalPath: string[];
  error?: string;
}

/**
 * @description Verifica si el commit esta permitido segun el estado de la tarea.
 * Si hay gates pendientes (QA, security, architecture), bloquea el commit.
 * Si es posible, avanza automaticamente por la ruta critica hasta commit_allowed.
 */
export async function checkCommitGate(
  orchestrationResult: OrchestrationResult | undefined,
  orchestrator: Orchestrator | undefined,
): Promise<CommitGateResult> {
  if (!orchestrationResult) {
    const fsm = orchestrator?.getFSM();
    if (fsm) {
      const available = fsm.getAvailableTransitions('new');
      if (available.includes('commit_planning')) {
        return { allowed: true, criticalPath: ['new', 'commit_planning'] };
      }
    }
    return { allowed: true, criticalPath: [] };
  }

  const fsm = orchestrator?.getFSM();
  if (!fsm) {
    return { allowed: true, criticalPath: [] };
  }

  const criticalPath = fsm.getCriticalPath(orchestrationResult.task);
  const currentStatus = orchestrationResult.task.status;

  if (currentStatus === 'commit_allowed') {
    return { allowed: true, criticalPath };
  }

  if (currentStatus === 'rejected') {
    return {
      allowed: false,
      criticalPath,
      error: 'La tarea fue rechazada. No se puede hacer commit.',
    };
  }

  const pendingGates: string[] = [];
  if (orchestrationResult.task.requiresQaApproval && currentStatus !== 'approved' && currentStatus !== 'qa_review') {
    pendingGates.push('QA review (qa_review -> approved)');
  }
  if (orchestrationResult.task.requiresSecurityReview && currentStatus !== 'security_review') {
    pendingGates.push('Security review (security_review)');
  }
  if (orchestrationResult.task.requiresArchitectureReview && currentStatus !== 'design_review') {
    pendingGates.push('Architecture review (design_review)');
  }

  if (pendingGates.length > 0) {
    return {
      allowed: false,
      criticalPath,
      error: `Commit bloqueado. Gates pendientes:\n${pendingGates.map(g => `  - ${g}`).join('\n')}\n\nRuta critica: ${criticalPath.join(' -> ')}`,
    };
  }

  if ((currentStatus as TaskStatus) !== 'commit_allowed') {
    let currentTask = { ...orchestrationResult.task };
    const maxSteps = 10;
    let steps = 0;

    while (currentTask.status !== 'commit_allowed' && steps < maxSteps) {
      steps++;
      const available = fsm.getAvailableTransitions(currentTask.status);

      const priority: TaskStatus[] = [
        'commit_allowed', 'approved', 'qa_review', 'implementation',
        'security_review', 'design_review', 'classified',
      ];

      let nextStatus: TaskStatus | null = null;
      for (const p of priority) {
        if (available.includes(p)) {
          nextStatus = p;
          break;
        }
      }

      if (!nextStatus) break;

      const transitionResult = orchestrator!.transitionTask(currentTask, nextStatus);
      if (transitionResult.allowed && transitionResult.task) {
        currentTask = transitionResult.task;
      } else {
        break;
      }
    }

    orchestrationResult.task.status = currentTask.status;
  }

  return { allowed: true, criticalPath };
}

/**
 * @description Obtiene la ruta critica desde el estado actual hasta commit_allowed.
 */
export function getCriticalPath(
  orchestrationResult: OrchestrationResult | undefined,
  orchestrator: Orchestrator | undefined,
): TaskStatus[] {
  if (!orchestrationResult) return [];
  const fsm = orchestrator?.getFSM();
  if (!fsm) return [];
  return fsm.getCriticalPath(orchestrationResult.task);
}

/**
 * @description Mapea un actionType a un tipo de commit convencional.
 */
export function mapActionTypeToCommitType(actionType?: string): CommitWorkflowOptions['type'] {
  const map: Record<string, CommitWorkflowOptions['type']> = {
    design: 'docs',
    implementation: 'feat',
    review: 'refactor',
    security_audit: 'fix',
    documentation: 'docs',
    refactor: 'refactor',
    bugfix: 'fix',
    test: 'test',
    research: 'docs',
    optimize: 'perf',
    deploy: 'ci',
  };
  return map[actionType ?? ''] ?? 'chore';
}

/**
 * @description Detecta el scope del commit basado en los dominios de la tarea.
 */
export function detectScope(domains?: string[]): string {
  if (!domains || domains.length === 0) return 'root';
  const domain = domains[0].toLowerCase();
  const scopeMap: Record<string, string> = {
    architecture: 'arch',
    backend: 'api',
    frontend: 'ui',
    security: 'auth',
    database: 'db',
    testing: 'test',
    documentation: 'docs',
    devops: 'ci',
    infrastructure: 'infra',
    cli: 'cli',
    config: 'config',
    dependencies: 'deps',
  };
  return scopeMap[domain] ?? domain;
}

/**
 * @description Ejecuta el commit con todas las validaciones:
 * gate check, staged files, git config, tests, QA review.
 */
export async function executeCommit(
  options: {
    orchestrationResult?: OrchestrationResult;
    orchestrator?: Orchestrator;
    router: AgentRouter;
    testHook: TestHook;
    commitHook?: CommitHook;
    qaService: QAService;
    effectiveAgentId: string;
    onQAReview?: (review: string) => void;
    onAutoCommitStatus?: (status: string, message: string) => void;
  },
  commitOptions?: Partial<CommitWorkflowOptions>,
  skipGateCheck = false,
): Promise<CommitWorkflowResult> {
  if (!skipGateCheck) {
    const gateResult = await checkCommitGate(options.orchestrationResult, options.orchestrator);
    if (!gateResult.allowed) {
      return {
        success: false,
        output: '',
        error: gateResult.error ?? 'Commit bloqueado por el gate',
      };
    }
  }

  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    return {
      success: false,
      output: '',
      error: [
        'No hay archivos staged para commitear.',
        '',
        'deepseek-code ya no hace stage automatico. Vos decidis que incluir.',
        'Usa git add para stagear los archivos que quieras commitear.',
        'Luego ejecuta @commit de nuevo.',
      ].join('\n'),
    };
  }

  const gitConfigStatus = checkGitConfig();
  if (!gitConfigStatus.ok) {
    return {
      success: false,
      output: '',
      error: [
        'Git no tiene configurada la identidad del usuario.',
        'Configuralo con:',
        '  git config --global user.name "Tu Nombre"',
        '  git config --global user.email "tu@email.com"',
        '',
        'Faltan: ' + gitConfigStatus.missing.join(', '),
      ].join('\n'),
    };
  }

  const { installed } = detectCommitWorkflow();
  if (!installed) {
    return {
      success: false,
      output: '',
      error: [
        'commit-workflow.ps1 no esta instalado en este proyecto.',
        '',
        'Para instalarlo, ejecuta:',
        '  pwsh -File ~/.deepseek-code/scripts/install-workflow.ps1',
        '',
        'O manualmente:',
        '  mkdir scripts',
        '  copy ~/.deepseek-code/templates/commit-workflow.ps1 scripts/',
      ].join('\n'),
    };
  }

  const testResult = await runPreCommitTests();
  if (!testResult.success) {
    options.testHook.reportTestFailure(testResult.output, stagedFiles).catch((err) => {
      console.warn('[Hook] report failure:', err);
    });
    options.commitHook?.reportCommitFailure(testResult.output, stagedFiles).catch((err) => {
      console.warn('[Hook] commit failure report:', err);
    });
    const qaDiagnosis = await options.qaService.diagnoseTestFailure(testResult.output);
    return {
      success: false,
      output: testResult.output,
      error: [
        'Tests fallaron. QA Engineer fue consultado para diagnosticar los problemas.',
        '',
        qaDiagnosis,
      ].join('\n'),
    };
  }

  const qaReviewResult = await options.qaService.reviewPreCommit(stagedFiles);
  if (!qaReviewResult.approved) {
    return {
      success: false,
      output: qaReviewResult.review,
      error: [
        'QA review rechazo el cambio. Revisa los problemas senalados antes de commitear.',
        '',
        qaReviewResult.review,
      ].join('\n'),
    };
  }
  if (qaReviewResult.review && options.onQAReview) {
    options.onQAReview(qaReviewResult.review);
  }

  const task = options.orchestrationResult?.task;

  const finalCommitOptions: CommitWorkflowOptions = {
    type: commitOptions?.type ?? mapActionTypeToCommitType(task?.actionType),
    scope: commitOptions?.scope ?? detectScope(task?.domains),
    message: commitOptions?.message ?? task?.rawPrompt?.slice(0, 72) ?? 'update',
    body: commitOptions?.body,
    breakingChange: commitOptions?.breakingChange ?? (task?.riskLevel === 'critical'),
    developerInitials: commitOptions?.developerInitials,
    branchType: commitOptions?.branchType,
    finishFeature: commitOptions?.finishFeature,
    finishRelease: commitOptions?.finishRelease,
    version: commitOptions?.version,
    noVerify: commitOptions?.noVerify,
  };

  const workflowResult = await runCommitWorkflow(finalCommitOptions);

  if (workflowResult.success) {
    options.router.recordSuccess(options.effectiveAgentId);
  }

  return workflowResult;
}

/**
 * @description Ejecuta auto-commit cuando QA aprueba el cambio.
 * Solo si el commit workflow esta instalado y hay archivos staged.
 */
export async function autoCommitAfterQaApproval(
  context: {
    orchestrationResult?: OrchestrationResult;
    router: AgentRouter;
    testHook: TestHook;
    qaService: QAService;
    effectiveAgentId: string;
    onAutoCommitStatus?: (status: string, message: string) => void;
  },
  lockRef: { locked: boolean },
): Promise<void> {
  if (lockRef.locked) return;
  lockRef.locked = true;

  try {
    const { installed } = detectCommitWorkflow();
    if (!installed) {
      context.onAutoCommitStatus?.('workflow_not_installed', 'Workflow de commit no instalado');
      return;
    }

    const stagedFiles = getStagedFiles();
    if (stagedFiles.length === 0) {
      context.onAutoCommitStatus?.('no_staged_files', 'No hay archivos staged');
      return;
    }

    const testResult = await runPreCommitTests();
    if (!testResult.success) {
      context.onAutoCommitStatus?.('tests_failed', testResult.output);
      return;
    }

    const task = context.orchestrationResult?.task;
    const commitOptions: CommitWorkflowOptions = {
      type: mapActionTypeToCommitType(task?.actionType),
      scope: detectScope(task?.domains),
      message: task?.rawPrompt?.slice(0, 72) ?? 'auto-commit',
      body: undefined,
      breakingChange: task?.riskLevel === 'critical',
    };

    context.onAutoCommitStatus?.('commit_started', 'Iniciando auto-commit...');
    const result = await runCommitWorkflow(commitOptions);

    if (result.success) {
      context.onAutoCommitStatus?.('commit_success', result.output);
    } else {
      context.onAutoCommitStatus?.('commit_failed', result.error ?? 'Error desconocido');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error en auto-commit';
    context.onAutoCommitStatus?.('error', message);
  } finally {
    lockRef.locked = false;
  }
}
