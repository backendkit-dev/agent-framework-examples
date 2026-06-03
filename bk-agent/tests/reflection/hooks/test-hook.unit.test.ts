/**
 * @description Tests unitarios de TestHook — sin disco real.
 * Mockea ReflectionEngine para cubrir branches no alcanzados.
 */

import { TestHook } from '../../../src/reflection/hooks/test-hook';
import { ReflectionEngine } from '../../../src/reflection/reflection-engine';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../src/reflection/reflection-engine');

const MockReflectionEngine = ReflectionEngine as jest.MockedClass<typeof ReflectionEngine>;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TestHook — unit tests', () => {
  let mockEngine: jest.Mocked<ReflectionEngine>;
  let hook: TestHook;

  beforeEach(() => {
    jest.clearAllMocks();

    const makeRecord = (overrides: any = {}) => ({
      id: 'fail_001',
      domain: 'test',
      failureType: 'tsc_noEmit_type_error',
      severity: 'high',
      dimension: 'calidad',
      gate: 'jest',
      agenteResponsable: 'system',
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
      getStats: jest.fn().mockResolvedValue({ totalIncidents: 4, unresolvedCount: 2 }),
      getCatalog: jest.fn().mockReturnValue({
        findByDomain: jest.fn().mockResolvedValue([
          { failureType: 'tsc_noEmit_type_error' },
          { failureType: 'jest_timeout' },
          { failureType: 'coverage_below_threshold' },
        ]),
        findUnresolved: jest.fn().mockResolvedValue([{ id: 'fail_001' }, { id: 'fail_002' }]),
      }),
    } as any;

    (MockReflectionEngine as any).mockImplementation(() => mockEngine);

    hook = new TestHook(mockEngine);
  });

  describe('reportTestFailure()', () => {
    it('should auto-detect failureType when not provided', async () => {
      const result = await hook.reportTestFailure(
        'Error TS2345: Property X does not exist',
        ['src/file.ts']
      );
      expect(result.record.failureType).toBe('tsc_noEmit_type_error');
    });

    it('should use provided failureType', async () => {
      const result = await hook.reportTestFailure(
        'Custom error',
        ['src/file.ts'],
        'flaky_test'
      );
      expect(result.record.failureType).toBe('flaky_test');
    });

    it('should use custom domain', async () => {
      const result = await hook.reportTestFailure(
        'Error',
        ['src/file.ts'],
        undefined,
        'audit' as any
      );
      expect(result.record.domain).toBe('audit');
    });

    it('should use fallback severity for unknown failureType', async () => {
      const result = await hook.reportTestFailure(
        'Texto sin patron conocido para test',
        ['src/file.ts']
      );
      expect(result.record.severity).toBe('high');
    });

    it('should use fallback dimension for unknown failureType', async () => {
      const result = await hook.reportTestFailure(
        'Texto sin patron conocido',
        ['src/file.ts']
      );
      expect(result.record.dimension).toBe('calidad');
    });
  });

  describe('reportCoverageFailure()', () => {
    it('should report coverage_below_threshold', async () => {
      const result = await hook.reportCoverageFailure('80%', '65%', ['src/file.ts']);
      expect(result.record.failureType).toBe('coverage_below_threshold');
      expect(result.record.hallazgo).toContain('80%');
      expect(result.record.hallazgo).toContain('65%');
    });
  });

  describe('reportFlakyTest()', () => {
    it('should report flaky_test', async () => {
      const result = await hook.reportFlakyTest('UserService.spec.ts', '3/10', ['src/user.service.ts']);
      expect(result.record.failureType).toBe('flaky_test');
      expect(result.record.hallazgo).toContain('UserService.spec.ts');
    });
  });

  describe('reflectTestDomain()', () => {
    it('should call engine.reflect with test domain', async () => {
      await hook.reflectTestDomain();
      expect(mockEngine.reflect).toHaveBeenCalledWith({ domain: 'test', autoPromote: true });
    });
  });

  describe('getTestStats()', () => {
    it('should aggregate stats by failureType', async () => {
      const stats = await hook.getTestStats();
      expect(stats.totalIncidents).toBe(4);
      expect(stats.unresolvedCount).toBe(2);
      expect(stats.patternsByFailureType.tsc_noEmit_type_error).toBe(1);
      expect(stats.patternsByFailureType.jest_timeout).toBe(1);
      expect(stats.patternsByFailureType.coverage_below_threshold).toBe(1);
    });
  });
});
