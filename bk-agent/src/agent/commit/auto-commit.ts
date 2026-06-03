/**
 * @description AutoCommit — Ejecuta commits automaticos cuando QA aprueba.
 * Verifica gates, ejecuta tests, y corre el workflow de commit.
 * Previene ejecucion concurrente via lock.
 */

import { OrchestrationResult } from '../../orchestrator/index';
import { CommitGate } from './commit-gate';
import {
    runCommitWorkflow,
    runPreCommitTests,
    detectCommitWorkflow,
    getStagedFiles,
    CommitWorkflowOptions,
    CommitWorkflowResult,
} from './index';
import { QAService } from '../qa/index';
import { CommitHook } from '../../reflection/hooks/commit-hook';
import { TestHook } from '../../reflection/hooks/test-hook';

export type AutoCommitStatus =
    | 'gate_blocked'
    | 'workflow_not_installed'
    | 'no_staged_files'
    | 'tests_failed'
    | 'commit_started'
    | 'commit_success'
    | 'commit_failed'
    | 'error';

export interface AutoCommitOptions {
    gate: CommitGate;
    qaService: QAService;
    commitHook: CommitHook;
    testHook: TestHook;
    onStatus?: (status: AutoCommitStatus, message: string) => void;
    mapActionTypeToCommitType?: (actionType?: string) => CommitWorkflowOptions['type'];
    detectScope?: (domains?: string[]) => string;
}

export class AutoCommit {
    private lock = false;
    private promise: Promise<void> | null = null;
    private options: AutoCommitOptions;

    constructor(options: AutoCommitOptions) {
        this.options = options;
    }

    /**
     * @description Ejecuta commit automatico si QA aprobo.
     * Usa lock para prevenir ejecucion concurrente.
     */
    async executeAfterQaApproval(orchestrationResult?: OrchestrationResult): Promise<void> {
        if (this.lock) return;

        this.lock = true;
        this.promise = this.run(orchestrationResult);

        try {
            await this.promise;
        } finally {
            this.lock = false;
            this.promise = null;
        }
    }

    isRunning(): boolean {
        return this.lock;
    }

    private async run(orchestrationResult?: OrchestrationResult): Promise<void> {
        try {
            const gateResult = await this.options.gate.check(orchestrationResult);
            if (!gateResult.allowed) {
                this.options.onStatus?.('gate_blocked', 'Auto-commit: gate bloqueado');
                return;
            }

            const { installed } = detectCommitWorkflow();
            if (!installed) {
                this.options.onStatus?.('workflow_not_installed', 'Auto-commit: commit-workflow.ps1 no instalado');
                return;
            }

            const stagedFiles = getStagedFiles();
            if (stagedFiles.length === 0) {
                this.options.onStatus?.('no_staged_files', 'Auto-commit: No hay archivos staged. Usa git add primero.');
                return;
            }

            const testResult = await runPreCommitTests();
            if (!testResult.success) {
                this.options.testHook.reportTestFailure(testResult.output, stagedFiles).catch((err) => { console.warn('[TestHook] reportTestFailure failed:', err); });
                const qaDiagnosis = await this.options.qaService.diagnoseTestFailure(testResult.output);
                this.options.onStatus?.('tests_failed', [
                    'Auto-commit: Tests fallaron. QA Engineer fue consultado.',
                    '',
                    qaDiagnosis,
                ].join('\n'));
                return;
            }

            const autoQaResult = await this.options.qaService.reviewPreCommit(stagedFiles);
            if (!autoQaResult.approved) {
                this.options.onStatus?.('tests_failed', [
                    'Auto-commit: QA review rechazo el cambio.',
                    '',
                    autoQaResult.review,
                ].join('\n'));
                return;
            }

            const task = orchestrationResult?.task;

            const commitOptions: CommitWorkflowOptions = {
                type: this.options.mapActionTypeToCommitType?.(task?.actionType),
                scope: this.options.detectScope?.(task?.domains),
                message: task?.rawPrompt?.slice(0, 72) ?? 'update',
                breakingChange: task?.riskLevel === 'critical',
                autoStage: false,
            };

            this.options.onStatus?.('commit_started', 'Auto-commit: QA aprobo, ejecutando commit...');
            const workflowResult = await runCommitWorkflow(commitOptions);

            if (workflowResult.success) {
                this.options.onStatus?.('commit_success', `Auto-commit exitoso: ${commitOptions.type}(${commitOptions.scope}): ${commitOptions.message}`);
            } else {
                this.options.onStatus?.('commit_failed', `Auto-commit fallo: ${workflowResult.error?.slice(0, 200)}. Ejecuta @commit manualmente.`);
                this.options.commitHook.reportCommitFailure(workflowResult.error ?? 'Auto-commit failed', stagedFiles).catch((err) => { console.warn('[CommitHook] reportCommitFailure failed:', err); });
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.options.onStatus?.('error', `Error en auto-commit: ${msg}`);
        }
    }
}
