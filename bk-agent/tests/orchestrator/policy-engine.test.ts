/**
 * @description Tests para Policy Engine — motor de reglas.
 */

import { evaluatePolicies, applyPolicies } from '../../src/orchestrator/policy-engine';
import { createTaskContext, TaskContext } from '../../src/types/task-context';
import { PolicyRule } from '../../src/orchestrator/types';

describe('PolicyEngine', () => {
  describe('evaluatePolicies', () => {
    it('debe incluir architecture-agent para actionType=design', () => {
      const task = createTaskContext('Diseña la arquitectura');
      task.actionType = 'design';
      task.riskLevel = 'low';

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('architecture-agent');
      expect(result.requiredGates).toContain('architecture');
    });

    it('debe incluir security-agent para actionType=security_audit', () => {
      const task = createTaskContext('Audita seguridad');
      task.actionType = 'security_audit';

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('security-agent');
      expect(result.requiredGates).toContain('security');
    });

    it('debe incluir qa-engineer para riskLevel=high', () => {
      const task = createTaskContext('Tarea de alto riesgo');
      task.riskLevel = 'high';

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('qa-engineer');
      expect(result.requiredGates).toContain('qa');
    });

    it('debe incluir qa-engineer para riskLevel=critical', () => {
      const task = createTaskContext('Tarea crítica');
      task.riskLevel = 'critical';

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('qa-engineer');
      expect(result.requiredGates).toContain('qa');
    });

    it('debe incluir architecture-agent para riskLevel=critical', () => {
      const task = createTaskContext('Tarea crítica');
      task.riskLevel = 'critical';

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('architecture-agent');
      expect(result.requiredGates).toContain('architecture');
    });

    it('debe incluir security-agent para dominio security', () => {
      const task = createTaskContext('Tarea de seguridad');
      task.domains = ['security'];

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('security-agent');
      expect(result.requiredGates).toContain('security');
    });

    it('debe incluir architecture-agent para breaking_change', () => {
      const task = createTaskContext('Breaking change');
      task.riskFactors.breaking_change = true;

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('architecture-agent');
      expect(result.requiredGates).toContain('architecture');
    });

    it('debe incluir security-agent para security_sensitive', () => {
      const task = createTaskContext('Seguridad');
      task.riskFactors.security_sensitive = true;

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('security-agent');
      expect(result.requiredGates).toContain('security');
    });

    it('debe incluir architecture-agent para cross_service_impact', () => {
      const task = createTaskContext('Impacto entre servicios');
      task.riskFactors.cross_service_impact = true;

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('architecture-agent');
      expect(result.requiredGates).toContain('architecture');
    });

    it('debe requerir QA para db_transactional', () => {
      const task = createTaskContext('Cambio en BD');
      task.riskFactors.db_transactional = true;

      const result = evaluatePolicies(task);

      expect(result.requiredGates).toContain('qa');
    });

    it('debe incluir qa-engineer para actionType=test', () => {
      const task = createTaskContext('Escribe tests');
      task.actionType = 'test';

      const result = evaluatePolicies(task);

      expect(result.mustInclude).toContain('qa-engineer');
    });

    it('debe requerir QA para actionType=refactor', () => {
      const task = createTaskContext('Refactoriza');
      task.actionType = 'refactor';

      const result = evaluatePolicies(task);

      expect(result.requiredGates).toContain('qa');
    });

    it('debe aplicar reglas personalizadas si se proveen', () => {
      const task = createTaskContext('Tarea personalizada');
      task.actionType = 'implementation';

      const customRules: PolicyRule[] = [
        {
          if: { actionType: 'implementation' },
          then: {
            mustInclude: ['backend-agent'],
            requireQaApproval: true,
          },
        },
      ];

      const result = evaluatePolicies(task, customRules);

      expect(result.mustInclude).toContain('backend-agent');
      expect(result.requiredGates).toContain('qa');
    });

    it('debe registrar las reglas que se activaron', () => {
      const task = createTaskContext('Diseño');
      task.actionType = 'design';

      const result = evaluatePolicies(task);

      expect(result.appliedRules.length).toBeGreaterThan(0);
      expect(result.appliedRules[0].rule).toBeDefined();
      expect(result.appliedRules[0].reason).toBeDefined();
    });

    it('debe retornar mustInclude sin duplicados', () => {
      const task = createTaskContext('Diseño crítico');
      task.actionType = 'design';
      task.riskLevel = 'critical';

      const result = evaluatePolicies(task);

      // architecture-agent aparece por design y por critical, pero debe ser único
      const architectureCount = result.mustInclude.filter(a => a === 'architecture-agent').length;
      expect(architectureCount).toBe(1);
    });
  });

  describe('applyPolicies', () => {
    it('debe enriquecer el TaskContext con assignedAgents', () => {
      const task = createTaskContext('Diseño');
      task.actionType = 'design';

      const { task: enriched } = applyPolicies(task);

      expect(enriched.assignedAgents).toContain('architecture-agent');
    });

    it('debe combinar assignedAgents sin duplicados', () => {
      const task = createTaskContext('Diseño crítico');
      task.actionType = 'design';
      task.riskLevel = 'critical';
      task.assignedAgents = ['architecture-agent']; // ya asignado

      const { task: enriched } = applyPolicies(task);

      const count = enriched.assignedAgents.filter(a => a === 'architecture-agent').length;
      expect(count).toBe(1);
    });

    it('debe activar gates según políticas', () => {
      const task = createTaskContext('Diseño crítico');
      task.actionType = 'design';
      task.riskLevel = 'critical';

      const { result } = applyPolicies(task);

      expect(result.requiredGates).toContain('architecture');
      expect(result.requiredGates).toContain('qa');
    });
  });
});
