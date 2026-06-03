/**
 * @description Tests unitarios de CommitHook — sin disco real.
 * Mockea ReflectionEngine para cubrir branches no alcanzados.
 */

import { CommitHook } from '../../../src/reflection/hooks/commit-hook';
import { ReflectionEngine } from '../../../src/reflection/reflection-engine';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../src/reflection/reflection-engine');

const MockReflectionEngine = ReflectionEngine as jest.MockedClass<typeof ReflectionEngine>;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CommitHook — unit tests', () => {
  let mockEngine: jest.Mocked<ReflectionEngine>;
  let hook: CommitHook;

  beforeEach(() => {
    jest.clearAllMocks();

    const makeRecord = (overrides: any = {}) => ({
      id: 'fail_001',
      domain: 'commit',
      failureType: 'missing_type',
      severity: 'medium',
      dimension: 'convenciones',
      gate: 'commit-workflow',
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
      getStats: jest.fn().mockResolvedValue({ totalIncidents: 3, unresolvedCount: 1 }),
      getCatalog: jest.fn().mockReturnValue({
        findByDomain: jest.fn().mockResolvedValue([
          { failureType: 'missing_type' },
          { failureType: 'test_failed_before_commit' },
        ]),
        findUnresolved: jest.fn().mockResolvedValue([{ id: 'fail_001' }]),
      }),
    } as any;

    (MockReflectionEngine as any).mockImplementation(() => mockEngine);

    hook = new CommitHook(mockEngine);
  });

  describe('reportCommitFailure()', () => {
    it('should auto-detect failureType when not provided', async () => {
      const result = await hook.reportCommitFailure(
        'Mensaje sin tipo conventional commit',
        ['src/file.ts']
      );
      expect(result.record.failureType).toBe('missing_type');
    });

    it('should use provided failureType', async () => {
      const result = await hook.reportCommitFailure(
        'Custom error',
        ['src/file.ts'],
        'branch_naming_invalid'
      );
      expect(result.record.failureType).toBe('branch_naming_invalid');
    });

    it('should use custom domain', async () => {
      const result = await hook.reportCommitFailure(
        'Error',
        ['src/file.ts'],
        undefined,
        'audit' as any
      );
      expect(result.record.domain).toBe('audit');
    });

    it('should use fallback severity for unknown failureType', async () => {
      const result = await hook.reportCommitFailure(
        'Texto sin patron conocido para commit',
        ['src/file.ts']
      );
      expect(result.record.severity).toBe('medium');
    });

    it('should use fallback dimension for unknown failureType', async () => {
      const result = await hook.reportCommitFailure(
        'Texto sin patron conocido',
        ['src/file.ts']
      );
      expect(result.record.dimension).toBe('convenciones');
    });
  });

  describe('reportTypecheckFailure()', () => {
    it('should report typecheck_failed_before_commit', async () => {
      const result = await hook.reportTypecheckFailure('TS2322: Type error', ['src/types.ts']);
      expect(result.record.failureType).toBe('typecheck_failed_before_commit');
    });
  });

  describe('reportTestFailure()', () => {
    it('should report test_failed_before_commit', async () => {
      const result = await hook.reportTestFailure('Test "login" failed', ['src/auth.spec.ts']);
      expect(result.record.failureType).toBe('test_failed_before_commit');
    });
  });

  describe('reflectCommitDomain()', () => {
    it('should call engine.reflect with commit domain', async () => {
      await hook.reflectCommitDomain();
      expect(mockEngine.reflect).toHaveBeenCalledWith({ domain: 'commit', autoPromote: true });
    });
  });

  describe('getCommitStats()', () => {
    it('should aggregate stats by failureType', async () => {
      const stats = await hook.getCommitStats();
      expect(stats.totalIncidents).toBe(3);
      expect(stats.unresolvedCount).toBe(1);
      expect(stats.patternsByFailureType.missing_type).toBe(1);
      expect(stats.patternsByFailureType.test_failed_before_commit).toBe(1);
    });
  });
});
