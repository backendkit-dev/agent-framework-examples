/**
 * @description Tests unitarios de PatternDetector — sin disco real.
 * Mockea FailureCatalog para cubrir branches no alcanzados.
 */

import { PatternDetector } from '../../src/reflection/pattern-detector';
import { FailureCatalog } from '../../src/reflection/failure-catalog';
import { FailureRecord } from '../../src/reflection/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../src/reflection/failure-catalog');

const MockFailureCatalog = FailureCatalog as jest.MockedClass<typeof FailureCatalog>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<FailureRecord> = {}): FailureRecord {
  return {
    id: 'fail_001',
    domain: 'audit',
    failureType: 'connection_leak',
    severity: 'high',
    dimension: 'seguridad',
    gate: 'qa',
    agenteResponsable: 'qa',
    hallazgo: 'test',
    recomendacion: 'fix',
    archivos: [],
    fecha: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PatternDetector — unit tests', () => {
  let mockCatalog: jest.Mocked<FailureCatalog>;
  let detector: PatternDetector;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCatalog = {
      getAllRecords: jest.fn(),
      findByDomain: jest.fn(),
      findByDomainAndType: jest.fn(),
    } as any;

    (MockFailureCatalog as any).mockImplementation(() => mockCatalog);

    detector = new PatternDetector(mockCatalog as any);
  });

  describe('scan()', () => {
    it('should use default threshold when none provided', async () => {
      mockCatalog.getAllRecords.mockResolvedValue([]);
      const result = await detector.scan();
      expect(result).toEqual([]);
    });

    it('should use custom threshold', async () => {
      mockCatalog.getAllRecords.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak' }),
        makeRecord({ id: '2', failureType: 'connection_leak' }),
      ]);
      const result = await detector.scan(2);
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(2);
    });
  });

  describe('scanByFailureType()', () => {
    it('should filter by specific failureType', async () => {
      mockCatalog.findByDomainAndType.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak' }),
        makeRecord({ id: '2', failureType: 'connection_leak' }),
        makeRecord({ id: '3', failureType: 'connection_leak' }),
      ]);

      const result = await detector.scanByFailureType('audit', 'connection_leak', 3);
      expect(result).toHaveLength(1);
      expect(result[0].failureType).toBe('connection_leak');
    });

    it('should return empty when no records match threshold', async () => {
      mockCatalog.findByDomainAndType.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak' }),
      ]);

      const result = await detector.scanByFailureType('audit', 'connection_leak', 3);
      expect(result).toHaveLength(0);
    });

    it('should return empty when no records exist', async () => {
      mockCatalog.findByDomainAndType.mockResolvedValue([]);
      const result = await detector.scanByFailureType('audit', 'nonexistent', 3);
      expect(result).toHaveLength(0);
    });
  });

  describe('getNearMissPatterns()', () => {
    it('should return patterns with count = threshold - 1', async () => {
      mockCatalog.getAllRecords.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak' }),
        makeRecord({ id: '2', failureType: 'connection_leak' }),
      ]);

      const result = await detector.getNearMissPatterns(3);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].count).toBe(2);
    });

    it('should exclude patterns that already meet threshold', async () => {
      mockCatalog.getAllRecords.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak' }),
        makeRecord({ id: '2', failureType: 'connection_leak' }),
        makeRecord({ id: '3', failureType: 'connection_leak' }),
        makeRecord({ id: '4', failureType: 'jest_timeout', domain: 'test' }),
        makeRecord({ id: '5', failureType: 'jest_timeout', domain: 'test' }),
      ]);

      const result = await detector.getNearMissPatterns(3);
      // connection_leak has 3 (meets threshold) → excluded
      // jest_timeout has 2 (near miss) → included
      expect(result.every(p => p.count < 3)).toBe(true);
    });

    it('should use custom threshold for near-miss calculation', async () => {
      mockCatalog.getAllRecords.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak' }),
        makeRecord({ id: '2', failureType: 'connection_leak' }),
        makeRecord({ id: '3', failureType: 'connection_leak' }),
        makeRecord({ id: '4', failureType: 'connection_leak' }),
      ]);

      const result = await detector.getNearMissPatterns(5);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].count).toBe(4);
    });
  });

  describe('detectPatterns() — internal logic', () => {
    it('should determine dominant severity correctly', async () => {
      mockCatalog.getAllRecords.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak', severity: 'medium' }),
        makeRecord({ id: '2', failureType: 'connection_leak', severity: 'high' }),
        makeRecord({ id: '3', failureType: 'connection_leak', severity: 'low' }),
      ]);

      const result = await detector.scan(3);
      expect(result).toHaveLength(1);
      expect(result[0].severity).toBe('high');
    });

    it('should determine dominant dimension and gate', async () => {
      mockCatalog.getAllRecords.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak', dimension: 'seguridad', gate: 'qa' }),
        makeRecord({ id: '2', failureType: 'connection_leak', dimension: 'seguridad', gate: 'qa' }),
        makeRecord({ id: '3', failureType: 'connection_leak', dimension: 'rendimiento', gate: 'jest' }),
      ]);

      const result = await detector.scan(3);
      expect(result[0].dominantDimension).toBe('seguridad');
      expect(result[0].dominantGate).toBe('qa');
    });

    it('should use last record recommendation', async () => {
      mockCatalog.getAllRecords.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak', recomendacion: 'first fix' }),
        makeRecord({ id: '2', failureType: 'connection_leak', recomendacion: 'second fix' }),
        makeRecord({ id: '3', failureType: 'connection_leak', recomendacion: 'last fix' }),
      ]);

      const result = await detector.scan(3);
      expect(result[0].recommendedAction).toBe('last fix');
    });

    it('should sort patterns by count descending', async () => {
      mockCatalog.getAllRecords.mockResolvedValue([
        makeRecord({ id: '1', failureType: 'connection_leak' }),
        makeRecord({ id: '2', failureType: 'connection_leak' }),
        makeRecord({ id: '3', failureType: 'connection_leak' }),
        makeRecord({ id: '4', failureType: 'connection_leak' }),
        makeRecord({ id: '5', failureType: 'jest_timeout', domain: 'test' }),
        makeRecord({ id: '6', failureType: 'jest_timeout', domain: 'test' }),
        makeRecord({ id: '7', failureType: 'jest_timeout', domain: 'test' }),
        makeRecord({ id: '8', failureType: 'jest_timeout', domain: 'test' }),
        makeRecord({ id: '9', failureType: 'jest_timeout', domain: 'test' }),
      ]);

      const result = await detector.scan(3);
      expect(result[0].count).toBe(5); // jest_timeout has 5
      expect(result[1].count).toBe(4); // connection_leak has 4
    });
  });
});
