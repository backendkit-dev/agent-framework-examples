/**
 * @description Tests unitarios de AgentHook — sin disco real.
 * Mockea ReflectionEngine para cubrir branches no alcanzados.
 */

import { AgentHook } from '../../../src/reflection/hooks/agent-hook';
import { ReflectionEngine } from '../../../src/reflection/reflection-engine';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../src/reflection/reflection-engine');

const MockReflectionEngine = ReflectionEngine as jest.MockedClass<typeof ReflectionEngine>;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AgentHook — unit tests', () => {
  let mockEngine: jest.Mocked<ReflectionEngine>;
  let hook: AgentHook;

  beforeEach(() => {
    jest.clearAllMocks();

    const makeRecord = (overrides: any = {}) => ({
      id: 'fail_001',
      domain: 'agent',
      failureType: 'wrong_agent_selected',
      severity: 'medium',
      dimension: 'confiabilidad',
      gate: 'agent-loop',
      agenteResponsable: 'orchestrator',
      hallazgo: 'test',
      recomendacion: 'Revisar',
      archivos: [],
      fecha: new Date().toISOString(),
      ...overrides,
    });

    mockEngine = {
      reportIncident: jest.fn().mockImplementation(async (record: any) => ({
        record: makeRecord(record),
        patterns: [],
      })),
      reflect: jest.fn().mockResolvedValue({ patterns: [], promotedRules: [] }),
      getStats: jest.fn().mockResolvedValue({ totalIncidents: 5, unresolvedCount: 2 }),
      getCatalog: jest.fn().mockReturnValue({
        findByDomain: jest.fn().mockResolvedValue([
          { failureType: 'agent_timeout' },
          { failureType: 'agent_hallucination' },
        ]),
        findUnresolved: jest.fn().mockResolvedValue([{ id: 'fail_001' }]),
      }),
    } as any;

    (MockReflectionEngine as any).mockImplementation(() => mockEngine);

    hook = new AgentHook(mockEngine);
  });

  describe('reportAgentFailure()', () => {
    it('should auto-detect failureType when not provided', async () => {
      const result = await hook.reportAgentFailure(
        'Se selecciono agente incorrecto para seguridad',
        'orchestrator'
      );
      expect(result.record.failureType).toBe('wrong_agent_selected');
    });

    it('should use provided failureType', async () => {
      const result = await hook.reportAgentFailure(
        'Custom error',
        'agent-1',
        [],
        'agent_timeout'
      );
      expect(result.record.failureType).toBe('agent_timeout');
    });

    it('should use custom domain', async () => {
      const result = await hook.reportAgentFailure(
        'Error',
        'agent-1',
        [],
        undefined,
        'audit' as any
      );
      expect(result.record.domain).toBe('audit');
    });

    it('should use fallback severity when failureType unknown', async () => {
      const result = await hook.reportAgentFailure(
        'Texto sin patron conocido para agente',
        'agent-1'
      );
      expect(result.record.severity).toBe('medium');
    });
  });

  describe('reportHallucination()', () => {
    it('should truncate response to 200 chars', async () => {
      const longResponse = 'x'.repeat(500);
      const result = await hook.reportHallucination('agent-1', longResponse, 'invento');
      expect(result.record.hallazgo.length).toBeLessThanOrEqual(300); // 200 + prefix
      expect(result.record.failureType).toBe('agent_hallucination');
    });
  });

  describe('reportTimeout()', () => {
    it('should report agent_timeout', async () => {
      const result = await hook.reportTimeout('agent-1', 'analyze files');
      expect(result.record.failureType).toBe('agent_timeout');
    });
  });

  describe('reportWrongAgentSelection()', () => {
    it('should report wrong_agent_selected', async () => {
      const result = await hook.reportWrongAgentSelection('general', 'security');
      expect(result.record.failureType).toBe('wrong_agent_selected');
    });
  });

  describe('reflectAgentDomain()', () => {
    it('should call engine.reflect with agent domain', async () => {
      await hook.reflectAgentDomain();
      expect(mockEngine.reflect).toHaveBeenCalledWith({ domain: 'agent', autoPromote: true });
    });
  });

  describe('getAgentStats()', () => {
    it('should aggregate stats by failureType', async () => {
      const stats = await hook.getAgentStats();
      expect(stats.totalIncidents).toBe(5);
      expect(stats.unresolvedCount).toBe(1);
      expect(stats.patternsByFailureType.agent_timeout).toBe(1);
      expect(stats.patternsByFailureType.agent_hallucination).toBe(1);
    });
  });
});
