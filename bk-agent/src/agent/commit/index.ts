/**
 * @description Modulo Commit Workflow
 *
 * Punto de entrada unico para toda la funcionalidad relacionada con commits.
 * Re-exporta tipos, utilidades git y ejecucion del workflow.
 *
 * @example
 * ```ts
 * import { runCommitWorkflow, getStagedFiles, CommitWorkflowOptions } from './commit';
 * ```
 */

export type {
  CommitWorkflowOptions,
  CommitWorkflowResult,
} from './types';

export {
  stageAllChanges,
  getStagedFiles,
  getAllChangedFiles,
  getGitDiff,
  checkGitConfig,
  validateStagedFilesMatchScope,
} from './git-utils';

export {
  detectCommitWorkflow,
  detectMakefile,
  runCommitWorkflow,
  runPreCommitTests,
} from './workflow';

export { CommitGate } from './commit-gate';
export type { GateResult } from './commit-gate';

export { AutoCommit } from './auto-commit';
export type { AutoCommitStatus, AutoCommitOptions } from './auto-commit';
