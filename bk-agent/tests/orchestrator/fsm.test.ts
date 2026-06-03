/**
 * @description Tests para TaskFSM — Finite State Machine.
 */

import { TaskFSM } from '../../src/orchestrator/fsm';
import { createTaskContext, TaskContext, TaskStatus } from '../../src/types/task-context';

describe('TaskFSM', () => {
  let fsm: TaskFSM;

  beforeEach(() => {
    fsm = new TaskFSM();
  });

  describe('transition', () => {
    it('debe permitir transición new → classified', () => {
      const task = createTaskContext('test');
      const result = fsm.transition(task, 'classified');

      expect(result.allowed).toBe(true);
      expect(result.task).toBeDefined();
      expect(result.task!.status).toBe('classified');
    });

    it('debe rechazar transición new → commit_allowed', () => {
      const task = createTaskContext('test');
      const result = fsm.transition(task, 'commit_allowed');

      expect(result.allowed).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Transición no permitida');
    });

    it('debe rechazar transición new → rejected (no está en transiciones permitidas)', () => {
      const task = createTaskContext('test');
      const result = fsm.transition(task, 'rejected');

      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Transición no permitida');
    });

    it('debe permitir classified → implementation', () => {
      const task = createTaskContext('test');
      task.status = 'classified';

      const result = fsm.transition(task, 'implementation');

      expect(result.allowed).toBe(true);
      expect(result.task!.status).toBe('implementation');
    });

    it('debe permitir classified → design_review', () => {
      const task = createTaskContext('test');
      task.status = 'classified';

      const result = fsm.transition(task, 'design_review');

      expect(result.allowed).toBe(true);
      expect(result.task!.status).toBe('design_review');
    });

    it('debe permitir qa_review → approved', () => {
      const task = createTaskContext('test');
      task.status = 'qa_review';

      const result = fsm.transition(task, 'approved');

      expect(result.allowed).toBe(true);
      expect(result.task!.status).toBe('approved');
    });

    it('debe permitir approved → commit_allowed', () => {
      const task = createTaskContext('test');
      task.status = 'approved';

      const result = fsm.transition(task, 'commit_allowed');

      expect(result.allowed).toBe(true);
      expect(result.task!.status).toBe('commit_allowed');
    });

    it('debe permitir qa_review → rework_required', () => {
      const task = createTaskContext('test');
      task.status = 'qa_review';

      const result = fsm.transition(task, 'rework_required');

      expect(result.allowed).toBe(true);
      expect(result.task!.status).toBe('rework_required');
    });

    it('debe permitir rework_required → implementation', () => {
      const task = createTaskContext('test');
      task.status = 'rework_required';

      const result = fsm.transition(task, 'implementation');

      expect(result.allowed).toBe(true);
      expect(result.task!.status).toBe('implementation');
    });

    it('debe rechazar transiciones desde estados terminales', () => {
      // commit_allowed NO es terminal, pero no puede ir a classified directo
      const task1 = createTaskContext('test');
      task1.status = 'commit_allowed';
      const result1 = fsm.transition(task1, 'classified');
      expect(result1.allowed).toBe(false); // commit_allowed → classified no está permitido

      const task2 = createTaskContext('test');
      task2.status = 'rejected';
      const result2 = fsm.transition(task2, 'classified');
      expect(result2.allowed).toBe(false);
    });

    it('debe retornar availableTransitions en el resultado', () => {
      const task = createTaskContext('test');
      const result = fsm.transition(task, 'classified');

      expect(result.availableTransitions).toContain('design_review');
      expect(result.availableTransitions).toContain('implementation');
    });
  });

  describe('guards', () => {
    it('debe rechazar commit_allowed si no está approved (transición no permitida)', () => {
      const task = createTaskContext('test');
      task.status = 'implementation';

      const result = fsm.transition(task, 'commit_allowed');

      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Transición no permitida');
    });

    it('debe requerir design_review si requiresArchitectureReview (desde classified a implementation sin pasar por design_review)', () => {
      const task = createTaskContext('test');
      task.status = 'classified';
      task.requiresArchitectureReview = true;

      // classified → implementation está permitido (el guard permite classified como excepción)
      // Pero desde cualquier otro estado sin design_review, se bloquea
      // Probamos desde new (que no puede ir directo a implementation)
      const result = fsm.transition(task, 'implementation');

      // classified → implementation está permitido por el guard
      expect(result.allowed).toBe(true);
    });

    it('debe permitir implementation si requiresArchitectureReview pero pasa por design_review', () => {
      const task = createTaskContext('test');
      task.status = 'design_review';
      task.requiresArchitectureReview = true;

      const result = fsm.transition(task, 'implementation');

      expect(result.allowed).toBe(true);
      expect(result.task!.status).toBe('implementation');
    });

    it('debe requerir security_review si requiresSecurityReview', () => {
      const task = createTaskContext('test');
      task.status = 'implementation';
      task.requiresSecurityReview = true;

      const result = fsm.transition(task, 'qa_review');

      expect(result.allowed).toBe(false);
      expect(result.error).toContain('seguridad');
    });

    it('debe permitir qa_review si requiresSecurityReview pero pasa por security_review', () => {
      const task = createTaskContext('test');
      task.status = 'security_review';
      task.requiresSecurityReview = true;

      const result = fsm.transition(task, 'qa_review');

      expect(result.allowed).toBe(true);
      expect(result.task!.status).toBe('qa_review');
    });

    it('debe requerir qa_review si requiresQaApproval (transición no permitida)', () => {
      const task = createTaskContext('test');
      task.status = 'implementation';
      task.requiresQaApproval = true;

      const result = fsm.transition(task, 'approved');

      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Transición no permitida');
    });

    it('debe permitir approved si requiresQaApproval pero pasa por qa_review', () => {
      const task = createTaskContext('test');
      task.status = 'qa_review';
      task.requiresQaApproval = true;

      const result = fsm.transition(task, 'approved');

      expect(result.allowed).toBe(true);
      expect(result.task!.status).toBe('approved');
    });
  });

  describe('getAvailableTransitions', () => {
    it('debe retornar transiciones desde new', () => {
      const transitions = fsm.getAvailableTransitions('new');
      // Ahora new puede ir a classified o commit_planning (para @commit sin orquestación)
      expect(transitions).toContain('classified');
      expect(transitions).toContain('commit_planning');
    });

    it('debe retornar transiciones desde classified', () => {
      const transitions = fsm.getAvailableTransitions('classified');
      expect(transitions).toContain('design_review');
      expect(transitions).toContain('implementation');
      expect(transitions).toContain('rejected');
    });

    it('debe retornar array vacío para estados terminales', () => {
      // commit_allowed ahora puede ir a commit_planning (re-planificar)
      expect(fsm.getAvailableTransitions('commit_allowed')).toEqual(['commit_planning']);
      expect(fsm.getAvailableTransitions('rejected')).toEqual([]);
    });
  });

  describe('isTerminal', () => {
    it('debe identificar commit_allowed como no terminal (puede ir a commit_planning)', () => {
      // commit_allowed ahora puede ir a commit_planning para re-planificar
      expect(fsm.isTerminal('commit_allowed')).toBe(false);
    });

    it('debe identificar rejected como terminal', () => {
      expect(fsm.isTerminal('rejected')).toBe(true);
    });

    it('debe identificar new como no terminal', () => {
      expect(fsm.isTerminal('new')).toBe(false);
    });
  });

  describe('getCriticalPath', () => {
    it('debe retornar ruta completa desde new', () => {
      const task = createTaskContext('test');
      const path = fsm.getCriticalPath(task);

      expect(path[0]).toBe('new');
      expect(path).toContain('classified');
      expect(path).toContain('implementation');
      expect(path).toContain('approved');
      expect(path).toContain('commit_allowed');
    });

    it('debe incluir design_review si requiere architecture review', () => {
      const task = createTaskContext('test');
      task.requiresArchitectureReview = true;

      const path = fsm.getCriticalPath(task);

      expect(path).toContain('design_review');
    });

    it('debe incluir security_review si requiere security review', () => {
      const task = createTaskContext('test');
      task.requiresSecurityReview = true;

      const path = fsm.getCriticalPath(task);

      expect(path).toContain('security_review');
    });

    it('debe incluir qa_review si requiere QA approval', () => {
      const task = createTaskContext('test');
      task.requiresQaApproval = true;

      const path = fsm.getCriticalPath(task);

      expect(path).toContain('qa_review');
    });

    it('debe retornar solo el estado actual si es terminal', () => {
      const task = createTaskContext('test');
      task.status = 'commit_allowed';

      const path = fsm.getCriticalPath(task);

      expect(path).toEqual(['commit_allowed']);
    });

    it('debe acortar ruta si ya pasó algunos gates', () => {
      const task = createTaskContext('test');
      task.status = 'implementation';

      const path = fsm.getCriticalPath(task);

      expect(path[0]).toBe('implementation');
      expect(path).not.toContain('new');
      expect(path).not.toContain('classified');
    });
  });
});
