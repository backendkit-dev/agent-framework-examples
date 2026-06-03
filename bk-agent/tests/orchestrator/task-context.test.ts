/**
 * @description Tests para TaskContext — esquema formal de tarea.
 */

import { createTaskContext, transitionTask, touchTask, TaskContext } from '../../src/types/task-context';

describe('TaskContext', () => {
  describe('createTaskContext', () => {
    it('debe crear un TaskContext con valores por defecto', () => {
      const task = createTaskContext('Agregar circuit breaker');

      expect(task.taskId).toBeDefined();
      expect(task.taskId).toMatch(/^task_/);
      expect(task.rawPrompt).toBe('Agregar circuit breaker');
      expect(task.actionType).toBe('unknown');
      expect(task.domains).toEqual([]);
      expect(task.riskLevel).toBe('low');
      expect(task.riskFactors).toEqual({
        breaking_change: false,
        security_sensitive: false,
        cross_service_impact: false,
        db_transactional: false,
        production_critical: false,
        complexity: 1,
      });
      expect(task.requiresArchitectureReview).toBe(false);
      expect(task.requiresSecurityReview).toBe(false);
      expect(task.requiresQaApproval).toBe(false);
      expect(task.targetServices).toEqual([]);
      expect(task.relatedPatterns).toEqual([]);
      expect(task.status).toBe('new');
      expect(task.assignedAgents).toEqual([]);
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.updatedAt).toBeInstanceOf(Date);
    });

    it('debe generar taskId único cada vez', () => {
      const task1 = createTaskContext('test');
      const task2 = createTaskContext('test');
      expect(task1.taskId).not.toBe(task2.taskId);
    });
  });

  describe('transitionTask', () => {
    it('debe cambiar el estado y actualizar timestamp', () => {
      const task = createTaskContext('test');
      const before = task.updatedAt.getTime();

      // Pequeña pausa para asegurar diferencia de timestamp
      const updated = transitionTask(task, 'classified');

      expect(updated.status).toBe('classified');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
      // No debe mutar el original
      expect(task.status).toBe('new');
    });

    it('debe preservar el resto de propiedades', () => {
      const task = createTaskContext('Implementar auth');
      const updated = transitionTask(task, 'approved');

      expect(updated.rawPrompt).toBe('Implementar auth');
      expect(updated.taskId).toBe(task.taskId);
      expect(updated.createdAt).toEqual(task.createdAt);
    });
  });

  describe('touchTask', () => {
    it('debe actualizar el timestamp sin cambiar estado', () => {
      const task = createTaskContext('test');
      const before = task.updatedAt.getTime();

      const updated = touchTask(task);

      expect(updated.status).toBe('new');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});
