/**
 * @description FSM — Finite State Machine para el ciclo de vida de tareas.
 * 
 * Define los estados válidos y las transiciones permitidas para un TaskContext.
 * Cada tarea comienza en 'new' y progresa a través de gates (architecture,
 * security, QA) hasta llegar a 'commit_allowed' o 'rejected'.
 * 
 * El FSM se integra con el Orchestrator para validar que las transiciones
 * sean legales según las políticas aplicadas.
 * 
 * @example
 * ```ts
 * const fsm = new TaskFSM();
 * const task = createTaskContext('Implementar auth');
 * 
 * // Transición válida
 * const result = fsm.transition(task, 'classified');
 * // result.allowed === true
 * // result.task.status === 'classified'
 * 
 * // Transición inválida
 * const result2 = fsm.transition(task, 'commit_allowed');
 * // result.allowed === false
 * // result.error === 'Transición no permitida: new → commit_allowed'
 * ```
 */

import { TaskContext, TaskStatus, transitionTask } from '../types/task-context';

// ── Definición de transiciones ───────────────────────────────────────────────

/**
 * Mapa de transiciones permitidas.
 * Cada estado tiene un conjunto de estados destino válidos.
 */
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  'new': ['classified', 'commit_planning'], // ← commit_planning para @commit sin orquestación
  'classified': ['design_review', 'implementation', 'security_review', 'qa_review', 'rejected'],
  'design_review': ['implementation', 'security_review', 'qa_review', 'rework_required', 'rejected'],
  'implementation': ['security_review', 'qa_review', 'design_review', 'rework_required', 'rejected'],
  'security_review': ['qa_review', 'design_review', 'implementation', 'rework_required', 'rejected'],
  'qa_review': ['approved', 'rework_required', 'rejected'],
  'rework_required': ['design_review', 'implementation', 'security_review', 'qa_review', 'rejected'],
  'approved': ['commit_allowed', 'commit_planning', 'implementation', 'rejected'],
  'commit_allowed': ['commit_planning'], // Puede re-planificar desde commit_allowed
  'rejected': [],       // Estado terminal
  // Nuevos estados del commit workflow
  'commit_planning': ['commit_reviewing', 'commit_failed', 'commit_skipped'],
  'commit_reviewing': ['commit_validated', 'commit_rejected', 'commit_failed'],
  'commit_validated': ['commit_allowed'], // Plan validado, listo para ejecutar commit
  'commit_rejected': ['commit_planning', 'rejected'], // Rechazado, puede replanificar
  'commit_failed': ['commit_planning', 'rejected'], // Falló, puede reintentar
  'commit_skipped': ['commit_allowed'], // Saltado, vuelve a commit_allowed
};

// ── Guards ───────────────────────────────────────────────────────────────────

/**
 * Condiciones adicionales que deben cumplirse para ciertas transiciones.
 * Cada guard recibe el TaskContext actual y el estado destino, y retorna
 * un error si la transición no está permitida, o null si es válida.
 */
type TransitionGuard = (task: TaskContext, to: TaskStatus) => string | null;

const GUARDS: TransitionGuard[] = [
  // No se puede saltar a commit_allowed sin pasar por approved o commit_validated
  (task, to) => {
    if (to === 'commit_allowed' && task.status !== 'approved' && task.status !== 'commit_validated') {
      return 'Debe estar en estado "approved" o "commit_validated" antes de permitir commit';
    }
    return null;
  },

  // Si requiere architecture review, debe pasar por design_review
  (task, to) => {
    if (task.requiresArchitectureReview && to === 'implementation' && task.status !== 'design_review' && task.status !== 'classified') {
      return 'Requiere revisión de arquitectura (design_review) antes de implementar';
    }
    return null;
  },

  // Si requiere security review, debe pasar por security_review
  (task, to) => {
    if (task.requiresSecurityReview && to === 'qa_review' && task.status !== 'security_review') {
      return 'Requiere revisión de seguridad (security_review) antes de QA';
    }
    return null;
  },

  // Si requiere QA approval, debe pasar por qa_review
  (task, to) => {
    if (task.requiresQaApproval && to === 'approved' && task.status !== 'qa_review') {
      return 'Requiere aprobación de QA (qa_review) antes de approved';
    }
    return null;
  },
];

// ── Resultado de transición ──────────────────────────────────────────────────

export interface FSMTransitionResult {
  /** Si la transición fue permitida */
  allowed: boolean;
  /** TaskContext actualizado (solo si allowed === true) */
  task?: TaskContext;
  /** Mensaje de error si no fue permitida */
  error?: string;
  /** Próximos estados válidos desde el estado actual */
  availableTransitions: TaskStatus[];
}

// ── TaskFSM ──────────────────────────────────────────────────────────────────

export class TaskFSM {
  /**
   * @description Intenta transicionar una tarea a un nuevo estado.
   * Valida que la transición esté en el mapa de transiciones permitidas
   * y que pase todos los guards.
   * 
   * @param task - Tarea actual
   * @param to - Estado destino
   * @returns Resultado con la tarea actualizada o error
   */
  transition(task: TaskContext, to: TaskStatus): FSMTransitionResult {
    const available = this.getAvailableTransitions(task.status);

    // Verificar que la transición esté permitida
    if (!available.includes(to)) {
      return {
        allowed: false,
        error: `Transición no permitida: ${task.status} → ${to}. Estados válidos: ${available.join(', ')}`,
        availableTransitions: available,
      };
    }

    // Ejecutar guards
    for (const guard of GUARDS) {
      const error = guard(task, to);
      if (error) {
        return {
          allowed: false,
          error,
          availableTransitions: available,
        };
      }
    }

    // Transición válida
    return {
      allowed: true,
      task: transitionTask(task, to),
      availableTransitions: this.getAvailableTransitions(to),
    };
  }

  /**
   * @description Obtiene los estados destino válidos desde un estado dado.
   */
  getAvailableTransitions(from: TaskStatus): TaskStatus[] {
    return TRANSITIONS[from] ?? [];
  }

  /**
   * @description Determina si un estado es terminal (no tiene salidas).
   */
  isTerminal(status: TaskStatus): boolean {
    return TRANSITIONS[status]?.length === 0;
  }

  /**
   * @description Calcula la ruta crítica desde el estado actual hasta commit_allowed.
   * Útil para mostrar al usuario qué gates faltan.
   */
  getCriticalPath(task: TaskContext): TaskStatus[] {
    const path: TaskStatus[] = [task.status];
    const current = task.status;

    if (current === 'commit_allowed' || current === 'rejected') return path;

    // Si está en new, debe clasificarse
    if (current === 'new') {
      path.push('classified');
    }

    // Si requiere architecture review y no ha pasado
    if (task.requiresArchitectureReview && !this.hasPassedGate(task, 'design_review')) {
      if (!path.includes('design_review')) path.push('design_review');
    }

    // Si no ha llegado a implementation
    if (current !== 'implementation' && current !== 'design_review') {
      if (!path.includes('implementation')) path.push('implementation');
    }

    // Si requiere security review
    if (task.requiresSecurityReview && !this.hasPassedGate(task, 'security_review')) {
      if (!path.includes('security_review')) path.push('security_review');
    }

    // Si requiere QA approval
    if (task.requiresQaApproval && !this.hasPassedGate(task, 'qa_review')) {
      if (!path.includes('qa_review')) path.push('qa_review');
    }

    // Approved → commit_allowed
    if (!path.includes('approved')) path.push('approved');
    if (!path.includes('commit_allowed')) path.push('commit_allowed');

    return path;
  }

  /**
   * Verifica si la tarea ha pasado por un gate específico.
   */
  private hasPassedGate(task: TaskContext, gate: TaskStatus): boolean {
    const order: TaskStatus[] = [
      'new', 'classified', 'design_review', 'implementation',
      'security_review', 'qa_review', 'approved', 'commit_allowed',
      'commit_planning', 'commit_reviewing', 'commit_validated',
      'commit_rejected', 'commit_failed', 'commit_skipped',
    ];
    const currentIdx = order.indexOf(task.status);
    const gateIdx = order.indexOf(gate);
    return currentIdx >= gateIdx;
  }
}
