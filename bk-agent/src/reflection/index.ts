/**
 * @description Reflection Engine — Barrel de exportaciones publicas.
 *
 * Pipeline: Feedback -> FailureCatalog -> PatternDetector -> PolicyPromoter -> Prevention
 * 5 dominios built-in: audit, test, commit, agent, bootstrap.
 * Dominios custom: via DomainRegistry + DomainCommands.
 *
 * @example
 * ```ts
 * import { ReflectionEngine, DomainRegistry, DomainCommands, AuditHook } from './reflection';
 * ```
 *
 * @see reflection-engine.ts — Orquestador principal
 * @see domain-registry.ts — Registro dinamico de dominios
 * @see commands/domain-commands.ts — CLI handlers (add/remove/enable/disable/list/show)
 * @see types.ts — Tipos base
 */

// ── Engine principal ─────────────────────────────────────────────────────────

export { ReflectionEngine } from './reflection-engine';
export type { ReflectionStats } from './reflection-engine';

// ── Catalogo de fallos ───────────────────────────────────────────────────────

export { FailureCatalog } from './failure-catalog';

// ── Detector de patrones ─────────────────────────────────────────────────────

export { PatternDetector } from './pattern-detector';

// ── Promotor de politicas ────────────────────────────────────────────────────

export { PolicyPromoter } from './policy-promoter';

// ── Tipos base ───────────────────────────────────────────────────────────────

export {
  FAILURE_TYPES_BY_DOMAIN,
  generateFailureId,
  generatePolicyRuleId,
  defaultReflectionConfig,
} from './types';

export type {
  ReflectionDomain,
  AnyDomain,
  FailureType,
  FailureRecord,
  DetectedPattern,
  ManifestPolicyRule,
  ReflectionConfig,
} from './types';

// ── Domain Registry (dominios dinamicos) ─────────────────────────────────────

export { DomainRegistry, BUILTIN_DOMAINS } from './domain-registry';
export type {
  CustomDomainDefinition,
  FailureTypeDefinition,
  BuiltinDomain,
} from './domain-registry';

// ── Domain Commands (CLI handlers) ───────────────────────────────────────────

export { DomainCommands } from './commands/domain-commands';
export type {
  AddDomainInput,
  DomainListEntry,
  DomainCommandResult,
} from './commands/domain-commands';

// ── Dominios (failureTypes metadata) ─────────────────────────────────────────

export { AUDIT_FAILURE_TYPES, detectAuditFailureType, getAuditFailureTypeMeta } from './domains/audit-domain';
export type { AuditFailureTypeMeta } from './domains/audit-domain';

export { TEST_FAILURE_TYPES, detectTestFailureType, getTestFailureTypeMeta } from './domains/test-domain';
export type { TestFailureTypeMeta } from './domains/test-domain';

export { COMMIT_FAILURE_TYPES, detectCommitFailureType, getCommitFailureTypeMeta } from './domains/commit-domain';
export type { CommitFailureTypeMeta } from './domains/commit-domain';

export { AGENT_FAILURE_TYPES, detectAgentFailureType, getAgentFailureTypeMeta } from './domains/agent-domain';
export type { AgentFailureTypeMeta } from './domains/agent-domain';

export { BOOTSTRAP_FAILURE_TYPES, detectBootstrapFailureType, getBootstrapFailureTypeMeta } from './domains/bootstrap-domain';
export type { BootstrapFailureTypeMeta } from './domains/bootstrap-domain';

// ── Hooks (integracion con dominios) ─────────────────────────────────────────

export { AuditHook } from './hooks/audit-hook';
export { TestHook } from './hooks/test-hook';
export { CommitHook } from './hooks/commit-hook';
export { AgentHook } from './hooks/agent-hook';
export { BootstrapHook } from './hooks/bootstrap-hook';
