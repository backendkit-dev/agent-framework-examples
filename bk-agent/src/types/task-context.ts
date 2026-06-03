/**
 * @description TaskContext — Esquema formal de tarea para el orquestador.
 * 
 * Transforma texto libre del usuario en una estructura tipada que el sistema
 * puede procesar con políticas, scoring y routing deterministas.
 * 
 * Cada tarea pasa por: Intent Detection → Domain Detection → Risk Scoring
 * → Policy Engine → Agent Routing → FSM.
 * 
 * @see {@link https://agentskills.io/specification} para el estándar de skills
 */

// ── Tipos de acción ──────────────────────────────────────────────────────────

/**
 * Tipos de acción que el sistema puede clasificar.
 * Cada acción define qué tipo de procesamiento se necesita.
 */
export type ActionType =
  | 'design'           // Diseñar arquitectura, planificar
  | 'implementation'   // Implementar código
  | 'review'           // Revisar código existente
  | 'security_audit'   // Auditoría de seguridad
  | 'documentation'    // Escribir documentación
  | 'refactor'         // Refactorizar código
  | 'bugfix'           // Corregir un bug
  | 'test'             // Escribir o ejecutar tests
  | 'research'         // Investigar / analizar
  | 'optimize'         // Optimizar rendimiento
  | 'deploy'           // Desplegar / infraestructura
  | 'unknown';         // No clasificado

// ── Niveles de riesgo ────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ── Estados del FSM ──────────────────────────────────────────────────────────

export type TaskStatus =
  | 'new'
  | 'classified'
  | 'design_review'
  | 'implementation'
  | 'security_review'
  | 'qa_review'
  | 'rework_required'
  | 'approved'
  | 'commit_allowed'
  | 'rejected'
  // Estados del commit workflow (Fase 4 refactor)
  | 'commit_planning'     // Architecture agent: analiza staged y propone plan
  | 'commit_reviewing'    // QA agent: valida plan, revisa calidad
  | 'commit_validated'    // Plan aceptado, listo para ejecutar
  | 'commit_rejected'     // Plan rechazado, vuelve a IDLE
  | 'commit_failed'       // No se pudo generar plan
  | 'commit_skipped';     // No hay cambios staged

// ── Commit Plan ──────────────────────────────────────────────────────────────

export type ConventionalCommitType =
  | 'feat'
  | 'fix'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'chore'
  | 'style'
  | 'perf'
  | 'ci'
  | 'build'
  | 'revert';

export interface CommitPlan {
  /** Tipo de commit convencional */
  type: ConventionalCommitType;
  /** Scope basado en el módulo afectado (ej: 'orchestrator', 'cli', 'fsm') */
  scope: string;
  /** Descripción corta en imperativo (< 72 chars) */
  description: string;
  /** Cuerpo opcional con detalles */
  body?: string;
  /** Si es breaking change */
  breaking: boolean;
}

// ── Factores de riesgo ───────────────────────────────────────────────────────

export interface RiskFactors {
  /** Cambia APIs públicas o contratos existentes */
  breaking_change: boolean;
  /** Afecta autenticación, autorización, datos sensibles */
  security_sensitive: boolean;
  /** Impacta múltiples servicios */
  cross_service_impact: boolean;
  /** Modifica esquemas de base de datos o consultas transaccionales */
  db_transactional: boolean;
  /** Afecta código en producción */
  production_critical: boolean;
  /** Complejidad estimada (1-10) */
  complexity: number;
}

// ── TaskContext ──────────────────────────────────────────────────────────────

/**
 * @description Representación formal de una tarea del usuario.
 * 
 * El orquestador convierte el input del usuario en un TaskContext
 * que luego es procesado por el Policy Engine, Capability Matrix
 * y FSM para determinar qué agentes participan y qué gates aplicar.
 * 
 * @example
 * ```ts
 * const task: TaskContext = {
 *   taskId: 'task_abc123',
 *   rawPrompt: 'Agregar circuit breaker para ServiceNow',
 *   actionType: 'implementation',
 *   domains: ['resilience', 'backend', 'integration'],
 *   riskLevel: 'high',
 *   riskFactors: {
 *     breaking_change: false,
 *     security_sensitive: false,
 *     cross_service_impact: true,
 *     db_transactional: false,
 *     production_critical: true,
 *     complexity: 7,
 *   },
 *   requiresArchitectureReview: true,
 *   requiresSecurityReview: false,
 *   requiresQaApproval: true,
 *   targetServices: ['api-gateway', 'snowq-service'],
 *   relatedPatterns: ['circuit-breaker', 'retry-backoff'],
 *   status: 'new',
 *   assignedAgents: [],
 * };
 * ```
 */
export interface TaskContext {
  /** ID único de la tarea */
  taskId: string;

  /** Prompt original del usuario */
  rawPrompt: string;

  /** Tipo de acción clasificada */
  actionType: ActionType;

  /** Dominios detectados (bounded contexts) */
  domains: string[];

  /** Nivel de riesgo calculado */
  riskLevel: RiskLevel;

  /** Factores de riesgo detallados */
  riskFactors: RiskFactors;

  /** Indica si requiere revisión de arquitectura */
  requiresArchitectureReview: boolean;

  /** Indica si requiere revisión de seguridad */
  requiresSecurityReview: boolean;

  /** Indica si requiere aprobación de QA */
  requiresQaApproval: boolean;

  /** Servicios objetivo (si se detectan) */
  targetServices: string[];

  /** Patrones relacionados del vault */
  relatedPatterns: string[];

  /** Estado actual en la FSM */
  status: TaskStatus;

  /** Agentes asignados a la tarea */
  assignedAgents: string[];

  /** Archivos relevantes detectados para la tarea */
  relevantFiles?: string[];

  /** Plan de commit generado por Architecture agent */
  commitPlan?: CommitPlan;

  /** Timestamp de creación */
  createdAt: Date;

  /** Timestamp de última actualización */
  updatedAt: Date;
}

// ===== Protocolo de Delegación =====

/**
 * @description Solicitud de delegación estructurada entre agentes.
 * Reemplaza el mecanismo plano de ask_agent con un handoff formal
 * que incluye contexto, entregables esperados y timeout.
 */
export interface DelegationRequest {
  /** ID único de la solicitud de delegación */
  requestId: string;
  /** ID del agente que delega (origen) */
  fromAgentId: string;
  /** ID del agente especialista (destino) */
  toAgentId: string;
  /** Contexto compartido con el especialista */
  context: {
    taskId: string;
    question: string;
    relevantFiles: string[];
    previousDelegations?: DelegationResult[];
  };
  /** Momento en que se crea la solicitud */
  timestamp: Date;
  /** Timeout en ms para considerar fallo (default: 30000) */
  timeoutMs: number;
  /** Profundidad de delegación (0 = primera delegación). Máximo permitido: 3 */
  hopCount?: number;
}

/**
 * @description Resultado de una delegación ejecutada por un agente especialista.
 * Incluye el contenido de la respuesta y un sello de completitud
 * que garantiza que el especialista terminó su análisis.
 */
export interface DelegationResult {
  /** Mismo requestId que la solicitud */
  requestId: string;
  /** ID del agente que ejecutó (destino) */
  agentId: string;
  /** Resultado textual del especialista */
  result: string;
  /** Sello de completitud */
  completionStamp: {
    status: 'completed' | 'partial' | 'failed';
    summary: string;
    suggestedFollowUp?: string;
    filesTouched: string[];
  };
  /** Momento en que se completó */
  completedAt: Date;
  /** Si hubo error, descripción */
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @description Detecta el scope del commit a partir de los archivos staged.
 * Analiza las rutas de los archivos y determina el módulo afectado.
 * 
 * @param stagedFiles - Lista de rutas de archivos staged
 * @returns Scope detectado (ej: 'cli', 'orchestrator', 'api', etc.)
 * 
 * @example
 * ```ts
 * detectScopeFromFiles(['bin/cli.ts', 'src/ui/formatters.ts']);
 * // → 'cli'
 * 
 * detectScopeFromFiles(['src/orchestrator/fsm.ts', 'src/types/task-context.ts']);
 * // → 'core'
 * ```
 */
export function detectScopeFromFiles(stagedFiles: string[]): string {
  if (stagedFiles.length === 0) return 'root';

  // Mapa de patrones de directorio a scopes
  const scopePatterns: Array<{ pattern: RegExp; scope: string }> = [
    // CLI & UI
    { pattern: /^bin\//, scope: 'cli' },
    { pattern: /^src\/cli\//, scope: 'cli' },
    { pattern: /^src\/ui\//, scope: 'ui' },
    { pattern: /^src\/terminal\//, scope: 'ui' },

    // API & Client
    { pattern: /^src\/api\//, scope: 'api' },
    { pattern: /^src\/client\//, scope: 'api' },

    // Orchestrator
    { pattern: /^src\/orchestrator\//, scope: 'orchestrator' },

    // Agent
    { pattern: /^src\/agent\//, scope: 'agent' },

    // Tools
    { pattern: /^src\/tools\//, scope: 'tools' },

    // Skills
    { pattern: /^src\/skills\//, scope: 'skills' },

    // Vault
    { pattern: /^src\/vault\//, scope: 'vault' },

    // Research
    { pattern: /^src\/research\//, scope: 'research' },

    // Bootstrap & Config
    { pattern: /^src\/bootstrap\//, scope: 'config' },
    { pattern: /^\.ai-assistant\//, scope: 'config' },
    { pattern: /^\.obsidian-vault\//, scope: 'config' },
    { pattern: /\.(yaml|yml|json|env)$/i, scope: 'config' },

    // Memory
    { pattern: /^src\/memory\//, scope: 'memory' },
    { pattern: /^src\/context\//, scope: 'memory' },

    // Types
    { pattern: /^src\/types\//, scope: 'types' },

    // Test
    { pattern: /(test|spec|e2e)\.(ts|js)$/i, scope: 'test' },
    { pattern: /^__tests__\//, scope: 'test' },
    { pattern: /^tests\//, scope: 'test' },

    // Docs
    { pattern: /\.md$/i, scope: 'docs' },
    { pattern: /^docs\//, scope: 'docs' },

    // Dependencies
    { pattern: /^package\.json$/, scope: 'deps' },
    { pattern: /^package-lock\.json$/, scope: 'deps' },

    // Infra
    { pattern: /^Dockerfile/, scope: 'infra' },
    { pattern: /^\.github\//, scope: 'infra' },
    { pattern: /^scripts\//, scope: 'scripts' },
  ];

  // Puntaje por scope: cuántos archivos coinciden
  const scores = new Map<string, number>();

  for (const file of stagedFiles) {
    for (const { pattern, scope } of scopePatterns) {
      if (pattern.test(file)) {
        scores.set(scope, (scores.get(scope) ?? 0) + 1);
        break; // Un archivo solo cuenta para un scope (el primero que coincide)
      }
    }
  }

  if (scores.size === 0) return 'root';

  // Scope con más archivos coincidentes
  let bestScope = 'root';
  let bestScore = 0;

  for (const [scope, count] of scores) {
    if (count > bestScore) {
      bestScore = count;
      bestScope = scope;
    }
  }

  return bestScope;
}

/**
 * Crea un TaskContext con valores por defecto.
 * Útil para tests y para inicializar desde el detector de intents.
 */
export function createTaskContext(rawPrompt: string): TaskContext {
  return {
    taskId: generateTaskId(),
    rawPrompt,
    actionType: 'unknown',
    domains: [],
    riskLevel: 'low',
    riskFactors: {
      breaking_change: false,
      security_sensitive: false,
      cross_service_impact: false,
      db_transactional: false,
      production_critical: false,
      complexity: 1,
    },
    requiresArchitectureReview: false,
    requiresSecurityReview: false,
    requiresQaApproval: false,
    targetServices: [],
    relatedPatterns: [],
    status: 'new',
    assignedAgents: [],
    commitPlan: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Genera un ID único para la tarea.
 * Formato: task_<timestamp>_<random>
 */
function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `task_${timestamp}_${random}`;
}

/**
 * Actualiza el timestamp de una tarea.
 */
export function touchTask(task: TaskContext): TaskContext {
  return { ...task, updatedAt: new Date() };
}

/**
 * Cambia el estado de una tarea y actualiza timestamp.
 */
export function transitionTask(task: TaskContext, newStatus: TaskStatus): TaskContext {
  return touchTask({ ...task, status: newStatus });
}
