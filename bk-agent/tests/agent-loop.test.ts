/**
 * @description Tests para AgentLoop — commit gate, executeCommit, orchestration
 *
 * Verifica:
 * - checkCommitGate() con/sin orquestación
 * - checkCommitGate() con gates pendientes
 * - checkCommitGate() con transición automática a commit_allowed
 * - executeCommit() pipeline completo
 * - executeCommit() con workflow no instalado
 * - executeCommit() con tests fallando
 * - getCriticalPath() desde FSM
 * - getOrchestrationResult()
 */

import { AgentLoop } from '../src/agent/loop';
import { AgentClient } from '../src/api/client';
import { getDefaultConfig } from '../src/bootstrap/config-loader';
import { defaultInstructions } from '../src/types/config';
import { Orchestrator, OrchestrationResult } from '../src/orchestrator/index';
import { createTaskContext, TaskContext, TaskStatus } from '../src/types/task-context';
import * as commitWorkflow from '../src/agent/commit/index';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/agent/commit/index');

const mockCommitWorkflow = commitWorkflow as jest.Mocked<typeof commitWorkflow>;

function makeMockClient(responses: any[]): AgentClient {
  let call = 0;
  return {
    chat: jest.fn(async () => responses[Math.min(call++, responses.length - 1)]),
    chatStream: jest.fn(),
    getModel: jest.fn(() => 'deepseek-chat'),
    setModel: jest.fn(),
  } as unknown as AgentClient;
}

function makeMockOrchestrator(result?: Partial<OrchestrationResult>): Orchestrator {
  const task = createTaskContext('Implementar auth JWT');
  const defaultResult: OrchestrationResult = {
    task: {
      ...task,
      actionType: 'implementation',
      domains: ['backend', 'security'],
      riskLevel: 'medium',
      status: 'new' as TaskStatus,
      requiresQaApproval: false,
      requiresSecurityReview: false,
      requiresArchitectureReview: false,
    },
    selectedAgents: [{ agentId: 'backend-agent', score: 80, reason: 'Dominio backend' }],
    appliedPolicies: [],
    requiredGates: [],
    commitAllowed: true,
  };

  const merged = {
    ...defaultResult,
    ...result,
    task: { ...defaultResult.task, ...result?.task },
  };

  return {
    orchestrate: jest.fn().mockResolvedValue(merged),
    getAuditReporter: jest.fn().mockReturnValue({
      recordGate: jest.fn().mockResolvedValue(undefined),
      generateFinalReport: jest.fn().mockResolvedValue(undefined),
      completeSprint: jest.fn().mockResolvedValue({ reportPath: '', pendingIssues: [], silentReportPath: null }),
      connectReflectionEngine: jest.fn(),
    }),
    getFSM: jest.fn().mockReturnValue({
      transition: jest.fn((task: TaskContext, to: TaskStatus) => ({
        allowed: true,
        task: { ...task, status: to },
      })),
      getAvailableTransitions: jest.fn((status: TaskStatus) => {
        const transitions: Record<string, TaskStatus[]> = {
          new: ['classified'],
          classified: ['implementation', 'design_review', 'security_review'],
          implementation: ['qa_review'],
          qa_review: ['approved'],
          design_review: ['approved'],
          security_review: ['approved'],
          approved: ['commit_allowed'],
          commit_allowed: [],
          rejected: [],
        };
        return transitions[status] ?? [];
      }),
      getCriticalPath: jest.fn((task: TaskContext) => {
        const path: TaskStatus[] = ['new', 'classified', 'implementation', 'qa_review', 'approved', 'commit_allowed'];
        const startIdx = path.indexOf(task.status);
        return startIdx >= 0 ? path.slice(startIdx) : path;
      }),
    }),
    transitionTask: jest.fn((task: TaskContext, to: TaskStatus) => ({
      allowed: true,
      task: { ...task, status: to },
    })),
    getAvailableTransitions: jest.fn(),
    getCriticalPath: jest.fn(),
    updateConfig: jest.fn(),
    updateRules: jest.fn(),
    updateCapabilityMatrix: jest.fn(),
  } as unknown as Orchestrator;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AgentLoop — Commit Gate', () => {
  const baseOpts = {
    config: getDefaultConfig(),
    instructions: defaultInstructions(),
    vaultPath: '',
    contextMarkdown: '',
    tools: [],
    askConfirmation: async () => false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── checkCommitGate ───────────────────────────────────────────────────────

  describe('checkCommitGate', () => {
    it('retorna allowed=true si no hay orquestación (modo legacy)', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const agent = new AgentLoop({ ...baseOpts, client });

      const result = await agent.checkCommitGate();

      expect(result.allowed).toBe(true);
      expect(result.criticalPath).toEqual([]);
    });

    it('retorna allowed=true si la tarea ya está en commit_allowed', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'commit_allowed' as TaskStatus,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      // Forzar orquestación
      await agent.processInput('test');
      const result = await agent.checkCommitGate();

      expect(result.allowed).toBe(true);
    });

    it('bloquea commit si requiere QA approval y no está resuelto', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'implementation' as TaskStatus,
          requiresQaApproval: true,
          requiresSecurityReview: false,
          requiresArchitectureReview: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.checkCommitGate();

      expect(result.allowed).toBe(false);
      expect(result.error).toContain('QA review');
    });

    it('bloquea commit si requiere security review y no está resuelto', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'implementation' as TaskStatus,
          requiresQaApproval: false,
          requiresSecurityReview: true,
          requiresArchitectureReview: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.checkCommitGate();

      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Security review');
    });

    it('bloquea commit si requiere architecture review y no está resuelto', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'classified' as TaskStatus,
          requiresQaApproval: false,
          requiresSecurityReview: false,
          requiresArchitectureReview: true,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.checkCommitGate();

      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Architecture review');
    });

    it('bloquea commit si la tarea está rechazada', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'rejected' as TaskStatus,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.checkCommitGate();

      expect(result.allowed).toBe(false);
      expect(result.error).toContain('rechazada');
    });

    it('transiciona automáticamente a commit_allowed si no hay gates pendientes', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          requiresQaApproval: false,
          requiresSecurityReview: false,
          requiresArchitectureReview: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.checkCommitGate();

      expect(result.allowed).toBe(true);
    });

    it('retorna ruta crítica en el resultado', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'implementation' as TaskStatus,
          requiresQaApproval: true,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.checkCommitGate();

      expect(result.criticalPath.length).toBeGreaterThan(0);
      expect(result.criticalPath).toContain('commit_allowed');
    });
  });

  // ── getCriticalPath ───────────────────────────────────────────────────────

  describe('getCriticalPath', () => {
    it('retorna array vacío si no hay orquestación', () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const agent = new AgentLoop({ ...baseOpts, client });

      expect(agent.getCriticalPath()).toEqual([]);
    });

    it('retorna ruta crítica desde el FSM', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator();
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const path = agent.getCriticalPath();

      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toBe('commit_allowed');
    });
  });

  // ── getOrchestrationResult ────────────────────────────────────────────────

  describe('getOrchestrationResult', () => {
    it('retorna undefined si no hay orquestación', () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const agent = new AgentLoop({ ...baseOpts, client });

      expect(agent.getOrchestrationResult()).toBeUndefined();
    });

    it('retorna el resultado de la última orquestación', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator();
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = agent.getOrchestrationResult();

      expect(result).toBeDefined();
      expect(result!.task.actionType).toBe('implementation');
      expect(result!.selectedAgents.length).toBeGreaterThan(0);
    });
  });

  // ── executeCommit ─────────────────────────────────────────────────────────

  describe('executeCommit', () => {
    beforeEach(() => {
      mockCommitWorkflow.detectCommitWorkflow.mockReturnValue({
        installed: true,
        path: '/test/project/scripts/commit-workflow.ps1',
      });
      mockCommitWorkflow.runPreCommitTests.mockResolvedValue({
        success: true,
        output: '✓ Tests passed',
      });
      mockCommitWorkflow.runCommitWorkflow.mockResolvedValue({
        success: true,
        output: 'Commit completado\nBranch: feature/test',
        branchName: 'feature/test',
      });
      // Las nuevas funciones del pipeline deben devolver valores truthy
      mockCommitWorkflow.stageAllChanges.mockReturnValue(true);
      mockCommitWorkflow.getStagedFiles.mockReturnValue(['src/test.ts']);
      mockCommitWorkflow.checkGitConfig.mockReturnValue({ ok: true, missing: [] });
      // Mock getGitDiff para que QA review pueda obtener el diff
      mockCommitWorkflow.getGitDiff.mockReturnValue('diff --git a/src/test.ts b/src/test.ts\nindex abc..def 100644\n--- a/src/test.ts\n+++ b/src/test.ts\n@@ -1,3 +1,5 @@\n+const x = 1;\n+console.log(x);\n');
    });

    it('ejecuta pipeline completo exitosamente', async () => {
      const client = makeMockClient([
        { content: 'ok', tool_calls: null },
        // Respuesta para QA review (runPreCommitQaReview llama al cliente)
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
      ]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('Implementar auth JWT'),
          status: 'new' as TaskStatus,
          actionType: 'implementation',
          domains: ['backend'],
          riskLevel: 'low',
          requiresQaApproval: false,
          requiresSecurityReview: false,
          requiresArchitectureReview: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('Implementar auth JWT');
      const result = await agent.executeCommit();

      expect(result.success).toBe(true);
      expect(result.branchName).toBe('feature/test');
      expect(mockCommitWorkflow.runPreCommitTests).toHaveBeenCalled();
      expect(mockCommitWorkflow.runCommitWorkflow).toHaveBeenCalled();
    });

    it('falla si el commit gate bloquea', async () => {
      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'implementation' as TaskStatus,
          requiresQaApproval: true,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.executeCommit();

      expect(result.success).toBe(false);
      expect(result.error).toContain('bloqueado');
      expect(mockCommitWorkflow.runPreCommitTests).not.toHaveBeenCalled();
    });

    it('falla si el workflow no está instalado', async () => {
      mockCommitWorkflow.detectCommitWorkflow.mockReturnValue({
        installed: false,
        path: null,
      });

      const client = makeMockClient([{ content: 'ok', tool_calls: null }]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          requiresQaApproval: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.executeCommit();

      expect(result.success).toBe(false);
      expect(result.error).toContain('no esta instalado');
    });

    it('falla si los tests previos no pasan', async () => {
      // Mock de runQADiagnosisOnTestFailure para silenciarlo en el test
      // (internamente llama a getGitDiff y al cliente chat)
      mockCommitWorkflow.getGitDiff.mockReturnValue('');
      mockCommitWorkflow.runPreCommitTests.mockResolvedValue({
        success: false,
        output: '❌ TypeScript check falló',
      });

      const client = makeMockClient([
        { content: 'ok', tool_calls: null },
        // runQADiagnosisOnTestFailure llama al cliente para QA
        { content: 'QA diagnosis result', tool_calls: null },
      ]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          requiresQaApproval: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.executeCommit();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tests fallaron');
    });

    it('mapea actionType a commit type correctamente', async () => {
      const client = makeMockClient([
        { content: 'ok', tool_calls: null },
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
      ]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          actionType: 'bugfix',
          domains: ['security'],
          riskLevel: 'high',
          requiresQaApproval: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      await agent.executeCommit();

      // Verificar que se llamó con type='fix' (bugfix → fix)
      expect(mockCommitWorkflow.runCommitWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'fix' })
      );
    });

    it('detecta scope desde los dominios', async () => {
      const client = makeMockClient([
        { content: 'ok', tool_calls: null },
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
      ]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          actionType: 'implementation',
          domains: ['security'],
          riskLevel: 'low',
          requiresQaApproval: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      await agent.executeCommit();

      // security → auth
      expect(mockCommitWorkflow.runCommitWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'auth' })
      );
    });

    it('registra éxito en routing cuando el commit es exitoso', async () => {
      const client = makeMockClient([
        { content: 'ok', tool_calls: null },
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
      ]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          requiresQaApproval: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
      });

      await agent.processInput('test');
      const result = await agent.executeCommit();

      expect(result.success).toBe(true);
    });
  });

  // ── autoCommitAfterQaApproval ─────────────────────────────────────────────
  // Auto-commit fue removido del flujo QA para evitar que execSync bloqueara
  // el event loop (tests + commit pueden tardar hasta 3 min en ejecucion sincrona).
  // El commit ahora solo se dispara via @commit explicito del usuario.

  describe('autoCommitAfterQaApproval — NO se dispara desde flujo QA', () => {
    beforeEach(() => {
      mockCommitWorkflow.detectCommitWorkflow.mockReturnValue({
        installed: true,
        path: '/test/project/scripts/commit-workflow.ps1',
      });
      mockCommitWorkflow.runPreCommitTests.mockResolvedValue({
        success: true,
        output: '✓ Tests passed',
      });
      mockCommitWorkflow.runCommitWorkflow.mockResolvedValue({
        success: true,
        output: 'Commit completado\nBranch: feature/test',
        branchName: 'feature/test',
      });
      mockCommitWorkflow.stageAllChanges.mockReturnValue(true);
      mockCommitWorkflow.getStagedFiles.mockReturnValue(['src/test.ts']);
      mockCommitWorkflow.checkGitConfig.mockReturnValue({ ok: true, missing: [] });
    });

    function makeCodeBlock(lines: number): string {
      const codeLines = [];
      for (let i = 0; i < lines; i++) {
        codeLines.push(`  const x${i} = ${i};`);
      }
      return '```ts\n' + codeLines.join('\n') + '\n```';
    }

    it('QA aprueba con staged files: NO dispara auto-commit (solo via @commit)', async () => {
      const onAutoCommitStatus = jest.fn();
      const client = makeMockClient([
        { content: makeCodeBlock(10), tool_calls: null },
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
      ]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('Implementar auth JWT'),
          status: 'new' as TaskStatus,
          actionType: 'implementation',
          domains: ['backend'],
          riskLevel: 'low',
          requiresQaApproval: false,
          requiresSecurityReview: false,
          requiresArchitectureReview: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
        onAutoCommitStatus,
        onQAReview: jest.fn(),
        allAgents: [{
          id: 'qa-engineer',
          name: 'QA Engineer',
          icon: '🔍',
          description: 'QA reviewer',
          systemPromptAddition: '',
          triggers: [],
        }],
      });

      await agent.processInput('Implementar auth JWT');

      // Auto-commit removido del flujo QA: onAutoCommitStatus no debe ser llamado
      expect(onAutoCommitStatus).not.toHaveBeenCalled();
    });

    it('QA aprueba sin staged files: NO dispara auto-commit', async () => {
      (mockCommitWorkflow.getStagedFiles as jest.Mock).mockReturnValue([]);

      const onAutoCommitStatus = jest.fn();
      const client = makeMockClient([
        { content: makeCodeBlock(10), tool_calls: null },
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
      ]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          actionType: 'implementation',
          domains: ['backend'],
          riskLevel: 'low',
          requiresQaApproval: false,
          requiresSecurityReview: false,
          requiresArchitectureReview: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
        onAutoCommitStatus,
        onQAReview: jest.fn(),
        allAgents: [{
          id: 'qa-engineer',
          name: 'QA Engineer',
          icon: '🔍',
          description: 'QA reviewer',
          systemPromptAddition: '',
          triggers: [],
        }],
      });

      await agent.processInput('test');

      expect(onAutoCommitStatus).not.toHaveBeenCalled();
    });

    it('QA rechaza: NO dispara auto-commit', async () => {
      const onAutoCommitStatus = jest.fn();
      const client = makeMockClient([
        { content: makeCodeBlock(10), tool_calls: null },
        { content: 'Rechazado. El código tiene problemas de seguridad.', tool_calls: null },
      ]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          actionType: 'implementation',
          domains: ['backend'],
          riskLevel: 'low',
          requiresQaApproval: false,
          requiresSecurityReview: false,
          requiresArchitectureReview: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
        onAutoCommitStatus,
        onQAReview: jest.fn(),
        allAgents: [{
          id: 'qa-engineer',
          name: 'QA Engineer',
          icon: '🔍',
          description: 'QA reviewer',
          systemPromptAddition: '',
          triggers: [],
        }],
      });

      await agent.processInput('test');

      expect(onAutoCommitStatus).not.toHaveBeenCalled();
    });

    it('multiples inputs con QA aprobando: onAutoCommitStatus nunca es llamado', async () => {
      const onAutoCommitStatus = jest.fn();
      const client = makeMockClient([
        { content: makeCodeBlock(10), tool_calls: null },
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
        { content: makeCodeBlock(10), tool_calls: null },
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
      ]);
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          actionType: 'implementation',
          domains: ['backend'],
          riskLevel: 'low',
          requiresQaApproval: false,
          requiresSecurityReview: false,
          requiresArchitectureReview: false,
        },
      });
      const agent = new AgentLoop({
        ...baseOpts,
        client,
        orchestrator,
        onAutoCommitStatus,
        onQAReview: jest.fn(),
        allAgents: [{
          id: 'qa-engineer',
          name: 'QA Engineer',
          icon: '🔍',
          description: 'QA reviewer',
          systemPromptAddition: '',
          triggers: [],
        }],
      });

      await agent.processInput('test');
      await agent.processInput('test2');

      expect(onAutoCommitStatus).not.toHaveBeenCalled();
    });

    it('executeCommit() via @commit sigue funcionando independientemente de QA', async () => {
      const orchestrator = makeMockOrchestrator({
        task: {
          ...createTaskContext('test'),
          status: 'new' as TaskStatus,
          actionType: 'implementation',
          domains: ['backend'],
          riskLevel: 'low',
          requiresQaApproval: false,
          requiresSecurityReview: false,
          requiresArchitectureReview: false,
        },
      });
      const client = makeMockClient([
        { content: makeCodeBlock(10), tool_calls: null },
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
        // QA review del pre-commit en executeCommit
        { content: 'Aprobado. El código se ve bien, puede continuar.', tool_calls: null },
      ]);
      const agent = new AgentLoop({ ...baseOpts, client, orchestrator });

      await agent.processInput('test');
      const result = await agent.executeCommit();

      expect(result.success).toBe(true);
    });
  });
});
