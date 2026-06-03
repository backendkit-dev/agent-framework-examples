export { detectDirectionChange, detectUserCorrection } from './direction-detector';
export type { DirectionChange } from './direction-detector';

export { runOrchestrator, buildOrchestrationContextBlock } from './orchestration-bridge';

export { resolveAgentAndInput } from './agent-resolver';
export type { AgentResolution } from './agent-resolver';

export { evaluateResponse, extractRecap, buildCorrectiveContext } from './response-evaluator';
export type { EvaluationResult } from './response-evaluator';

export {
  advanceRequiredGates,
  activateQaEngineerIfNeeded,
  processQaEngineerResponse,
  processInlineQaReview,
} from './qa-orchestrator';
export type { QaTransitionContext } from './qa-orchestrator';

export { executeAskAgent, buildRecentContext } from './specialist-executor';
export type { AskAgentArgs, SpecialistResult } from './specialist-executor';

export {
  checkCommitGate,
  getCriticalPath,
  mapActionTypeToCommitType,
  detectScope,
  executeCommit,
  autoCommitAfterQaApproval,
} from './commit-gate-manager';
export type { CommitGateResult } from './commit-gate-manager';

export { validateMessages, compactIfNeeded, forceCompact, CONTEXT_THRESHOLD_TOKENS } from './context-manager';
