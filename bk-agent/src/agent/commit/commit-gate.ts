/**
 * @description CommitGate — Sistema de gates para controlar si un commit
 * puede proceder. Verifica que todas las revisiones requeridas (QA, security,
 * architecture) esten completas antes de permitir el commit.
 *
 * Integra con Orchestrator FSM para determinar el estado actual de la tarea
 * y los gates pendientes.
 */

import { Orchestrator, OrchestrationResult } from '../../orchestrator/index';
import { TaskStatus } from '../../types/task-context';

export interface GateResult {
    allowed: boolean;
    criticalPath: string[];
    error?: string;
}

export class CommitGate {
    constructor(private orchestrator?: Orchestrator) {}

    /**
     * @description Verifica si el commit esta permitido segun el estado
     * actual de la orquestacion. Si no hay orquestador, permite el commit.
     * Si hay gates pendientes, los resuelve automaticamente si es posible.
     */
    async check(result: OrchestrationResult | undefined): Promise<GateResult> {
        if (!result) {
            const fsm = this.orchestrator?.getFSM();
            if (fsm) {
                const available = fsm.getAvailableTransitions('new');
                if (available.includes('commit_planning')) {
                    return { allowed: true, criticalPath: ['new', 'commit_planning'] };
                }
            }
            return { allowed: true, criticalPath: [] };
        }

        const fsm = this.orchestrator?.getFSM();
        if (!fsm) {
            return { allowed: true, criticalPath: [] };
        }

        const criticalPath = fsm.getCriticalPath(result.task);
        const currentStatus = result.task.status;

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
        if (result.task.requiresQaApproval && currentStatus !== 'approved' && currentStatus !== 'qa_review') {
            pendingGates.push('QA review (qa_review -> approved)');
        }
        if (result.task.requiresSecurityReview && currentStatus !== 'security_review') {
            pendingGates.push('Security review (security_review)');
        }
        if (result.task.requiresArchitectureReview && currentStatus !== 'design_review') {
            pendingGates.push('Architecture review (design_review)');
        }

        if (pendingGates.length > 0) {
            return {
                allowed: false,
                criticalPath,
                error: `Commit bloqueado. Gates pendientes:\n${pendingGates.map(g => `  - ${g}`).join('\n')}\n\nRuta critica: ${criticalPath.join(' -> ')}`,
            };
        }

        // Intentar avanzar automaticamente hacia commit_allowed
        if ((currentStatus as TaskStatus) !== 'commit_allowed') {
            let currentTask = { ...result.task };
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

                const transitionResult = this.orchestrator!.transitionTask(currentTask, nextStatus);
                if (transitionResult.allowed && transitionResult.task) {
                    currentTask = transitionResult.task;
                } else {
                    break;
                }
            }

            result.task.status = currentTask.status;
        }

        return { allowed: true, criticalPath };
    }
}
