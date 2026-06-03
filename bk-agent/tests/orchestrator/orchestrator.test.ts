/**
 * @description Tests de integración para el Orchestrator completo.
 * Prueba el pipeline completo: Intent → Domain → Risk → Policy.
 */

import { Orchestrator } from '../../src/orchestrator/index';
import { defaultOrchestratorConfig, CapabilityMatrix, PolicyRule } from '../../src/orchestrator/types';

describe('Orchestrator (integración)', () => {
  const capabilityMatrix: CapabilityMatrix = {
    'architecture-agent': {
      owns: ['architecture', 'resilience', 'distributed-systems'],
      skills: ['architecture-review', 'adr-generation'],
      baseWeight: 0.95,
    },
    'security-agent': {
      owns: ['security', 'authentication'],
      skills: ['security-audit', 'threat-modeling'],
      baseWeight: 0.95,
    },
    'backend-agent': {
      owns: ['backend', 'api-design', 'database'],
      skills: ['implementation', 'refactoring'],
      baseWeight: 0.9,
    },
    'qa-engineer': {
      owns: ['testing', 'quality'],
      skills: ['test-generation', 'code-review'],
      baseWeight: 0.9,
    },
    'general': {
      owns: ['general'],
      skills: [],
      baseWeight: 0.5,
    },
  };

  const customRules: PolicyRule[] = [
    {
      if: { actionType: 'design' },
      then: { mustInclude: ['architecture-agent'], requireArchitectureReview: true },
    },
    {
      if: { riskLevel: ['high', 'critical'] },
      then: { mustInclude: ['qa-engineer'], requireQaApproval: true },
    },
    {
      if: { domain: 'security' },
      then: { mustInclude: ['security-agent'], requireSecurityReview: true },
    },
  ];

  function createOrchestrator() {
    return new Orchestrator({
      config: defaultOrchestratorConfig(),
      customRules,
      capabilityMatrix,
    });
  }

  describe('orchestrate', () => {
    it('debe clasificar una tarea de implementación simple', async () => {
      const orchestrator = createOrchestrator();
      const result = await orchestrator.orchestrate('Implementa un endpoint REST para crear usuarios');

      expect(result.task.actionType).toBe('implementation');
      expect(result.task.domains).toContain('backend');
      expect(result.task.riskLevel).toBe('low');
      expect(result.selectedAgents.length).toBeGreaterThan(0);
      expect(result.commitAllowed).toBe(true);
    });

    it('debe clasificar una tarea de diseño con architecture-agent', async () => {
      const orchestrator = createOrchestrator();
      const result = await orchestrator.orchestrate('Diseña la arquitectura para el módulo de pagos');

      expect(result.task.actionType).toBe('design');
      expect(result.task.domains).toContain('architecture');
      expect(result.selectedAgents.some(a => a.agentId === 'architecture-agent')).toBe(true);
      expect(result.requiredGates).toContain('architecture');
    });

    it('debe clasificar una tarea de seguridad con security-agent', async () => {
      const orchestrator = createOrchestrator();
      const result = await orchestrator.orchestrate('Audita la seguridad del módulo JWT');

      expect(result.task.actionType).toBe('security_audit');
      expect(result.task.domains).toContain('security');
      expect(result.selectedAgents.some(a => a.agentId === 'security-agent')).toBe(true);
      expect(result.requiredGates).toContain('security');
    });

    it('debe detectar alto riesgo y requerir QA', async () => {
      const orchestrator = createOrchestrator();
      const result = await orchestrator.orchestrate(
        'Breaking change crítico en producción que afecta autenticación y base de datos'
      );

      expect(result.task.riskLevel).toBe('critical');
      expect(result.selectedAgents.some(a => a.agentId === 'qa-engineer')).toBe(true);
      expect(result.requiredGates).toContain('qa');
    });

    it('debe seleccionar múltiples agentes para tareas complejas', async () => {
      const orchestrator = createOrchestrator();
      const result = await orchestrator.orchestrate(
        'Diseña la arquitectura de autenticación JWT con refresh token en el backend'
      );

      // Debería tener al menos architecture-agent (por diseño) y backend-agent (por dominio)
      const agentIds = result.selectedAgents.map(a => a.agentId);
      expect(agentIds).toContain('architecture-agent');
      expect(agentIds).toContain('backend-agent');
    });

    it('debe ordenar agentes por score descendente', async () => {
      const orchestrator = createOrchestrator();
      const result = await orchestrator.orchestrate('Implementa un endpoint REST');

      for (let i = 1; i < result.selectedAgents.length; i++) {
        expect(result.selectedAgents[i].score).toBeLessThanOrEqual(result.selectedAgents[i - 1].score);
      }
    });

    it('debe retornar appliedPolicies con las reglas activadas', async () => {
      const orchestrator = createOrchestrator();
      const result = await orchestrator.orchestrate('Diseña la arquitectura');

      expect(result.appliedPolicies.length).toBeGreaterThan(0);
    });

    it('debe permitir commit para tareas de bajo riesgo', async () => {
      const orchestrator = createOrchestrator();
      const result = await orchestrator.orchestrate('Agrega un comentario al README');

      expect(result.commitAllowed).toBe(true);
    });

    it('debe usar fallback a agente general si no hay match', async () => {
      const orchestrator = createOrchestrator();
      const result = await orchestrator.orchestrate('Hola, ¿cómo estás?');

      expect(result.selectedAgents.length).toBeGreaterThan(0);
      // Si no hay match de dominio, debe caer en general
      const hasGeneral = result.selectedAgents.some(a => a.agentId === 'general');
      expect(hasGeneral).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('debe permitir actualizar configuración en runtime', async () => {
      const orchestrator = createOrchestrator();
      orchestrator.updateConfig({
        features: { ...defaultOrchestratorConfig().features, intentDetection: false },
      });

      const result = await orchestrator.orchestrate('Implementa algo');
      // Con intentDetection desactivado, actionType queda como 'unknown'
      expect(result.task.actionType).toBe('unknown');
    });
  });

  describe('updateRules', () => {
    it('debe permitir actualizar reglas en runtime', async () => {
      const orchestrator = createOrchestrator();
      const newRules: PolicyRule[] = [
        {
          if: { actionType: 'implementation' },
          then: { mustInclude: ['backend-agent'] },
        },
      ];
      orchestrator.updateRules(newRules);

      const result = await orchestrator.orchestrate('Implementa algo');
      expect(result.selectedAgents.some(a => a.agentId === 'backend-agent')).toBe(true);
    });
  });

  describe('updateCapabilityMatrix', () => {
    it('debe permitir actualizar capability matrix en runtime', async () => {
      const orchestrator = createOrchestrator();
      const newMatrix: CapabilityMatrix = {
        'custom-agent': {
          owns: ['custom-domain'],
          skills: ['custom-skill'],
          baseWeight: 1.0,
        },
      };
      orchestrator.updateCapabilityMatrix(newMatrix);

      // Con matrix vacía, debe caer en fallback general
      const result = await orchestrator.orchestrate('Implementa algo');
      expect(result.selectedAgents.some(a => a.agentId === 'general')).toBe(true);
    });
  });
});
