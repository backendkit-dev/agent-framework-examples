/**
 * @description Tests unitarios de FailureCatalog — sin disco real.
 * Mockea fs/promises y atomicWrite para cubrir branches no alcanzados
 * por los tests de integracion.
 */

import { FailureCatalog } from '../../src/reflection/failure-catalog';
import { FailureRecord } from '../../src/reflection/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  mkdir: jest.fn(),
}));

jest.mock('../../src/shared/utils/atomic-write', () => ({
  atomicWrite: jest.fn(),
}));

const mockReadFile = jest.requireMock('fs/promises').readFile;
const mockMkdir = jest.requireMock('fs/promises').mkdir;
const mockAtomicWrite = jest.requireMock('../../src/shared/utils/atomic-write').atomicWrite;

// ── Helpers ──────────────────────────────────────────────────────────────────

const sampleRecord: FailureRecord = {
  id: 'fail_test_001',
  domain: 'audit',
  failureType: 'connection_leak',
  severity: 'high',
  dimension: 'seguridad',
  gate: 'qa-engineer',
  agenteResponsable: 'qa',
  hallazgo: 'QueryRunner sin release en finally block',
  recomendacion: 'Agregar finally block con release()',
  archivos: ['src/database/connection.ts'],
  fecha: '2026-05-02T10:00:00.000Z',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FailureCatalog — unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use global dir when useGlobalDir is true (default)', () => {
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: true });
      const path = catalog.getCatalogPath();
      expect(path).toContain('.deepseek-code');
      expect(path).toContain('failures.json');
    });

    it('should use local .reflection dir when useGlobalDir is false', () => {
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      const path = catalog.getCatalogPath();
      expect(path).toContain('.reflection');
      expect(path).toContain('failures.json');
    });

    it('should default useGlobalDir to true when not provided', () => {
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test' });
      const path = catalog.getCatalogPath();
      expect(path).toContain('.deepseek-code');
    });

    it('should use process.cwd() when projectRoot is not provided', () => {
      const catalog = new FailureCatalog();
      const path = catalog.getCatalogPath();
      expect(path).toBeDefined();
      expect(path).toContain('failures.json');
    });
  });

  describe('load()', () => {
    it('should handle JSON parse failure gracefully', async () => {
      mockReadFile.mockResolvedValueOnce('invalid json{{{');
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      const records = await catalog.load();
      expect(records).toEqual([]);
    });

    it('should handle non-array JSON gracefully', async () => {
      mockReadFile.mockResolvedValueOnce('{"not": "an array"}');
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      const records = await catalog.load();
      expect(records).toEqual([]);
    });

    it('should handle file not found (ENOENT) gracefully', async () => {
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      mockReadFile.mockRejectedValueOnce(err);
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      const records = await catalog.load();
      expect(records).toEqual([]);
    });
  });

  describe('save() with MAX_RECORDS', () => {
    it('should slice records when exceeding MAX_RECORDS', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      mockAtomicWrite.mockResolvedValueOnce(undefined);
      mockMkdir.mockResolvedValueOnce(undefined);

      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();

      // Add MAX_RECORDS + 10 records
      const manyRecords: FailureRecord[] = Array.from({ length: 10010 }, (_, i) => ({
        ...sampleRecord,
        id: `fail_${i}`,
        hallazgo: `Record #${i}`,
      }));

      // Use addRecords to trigger save
      mockAtomicWrite.mockResolvedValueOnce(undefined);
      await catalog.addRecords(manyRecords);

      // Verify atomicWrite was called with sliced data (last 10000)
      expect(mockAtomicWrite).toHaveBeenCalled();
      const writeCall = mockAtomicWrite.mock.calls.find((c: any[]) => c[0]?.includes('failures.json'));
      expect(writeCall).toBeDefined();
      const writtenData = JSON.parse(writeCall[1]);
      expect(writtenData.length).toBe(10000);
      expect(writtenData[0].id).toBe('fail_10'); // first 10 were sliced off
    });
  });

  describe('markResolved()', () => {
    it('should return false when record not found', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();
      const result = await catalog.markResolved('nonexistent', 'abc123');
      expect(result).toBe(false);
    });

    it('should remove policy rule when all records of a failureType are resolved', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      mockAtomicWrite.mockResolvedValueOnce(undefined);
      mockMkdir.mockResolvedValueOnce(undefined);

      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();

      // Add one record
      await catalog.addRecord({ ...sampleRecord, id: 'fail_001' });

      // Mock promoter
      const mockPromoter = {
        findRule: jest.fn().mockResolvedValue({ id: 'POL-AUDI-001' }),
        removeRule: jest.fn().mockResolvedValue(true),
      };

      mockAtomicWrite.mockResolvedValueOnce(undefined);
      const result = await catalog.markResolved('fail_001', 'abc123', mockPromoter as any);
      expect(result).toBe(true);
      expect(mockPromoter.findRule).toHaveBeenCalledWith('audit', 'connection_leak');
      expect(mockPromoter.removeRule).toHaveBeenCalledWith('POL-AUDI-001');
    });

    it('should not remove policy rule when other unresolved records exist', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      mockAtomicWrite.mockResolvedValueOnce(undefined);
      mockMkdir.mockResolvedValueOnce(undefined);

      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();

      // Add two records of same failureType
      await catalog.addRecord({ ...sampleRecord, id: 'fail_001' });
      await catalog.addRecord({ ...sampleRecord, id: 'fail_002' });

      const mockPromoter = {
        findRule: jest.fn(),
        removeRule: jest.fn(),
      };

      mockAtomicWrite.mockResolvedValueOnce(undefined);
      const result = await catalog.markResolved('fail_001', 'abc123', mockPromoter as any);
      expect(result).toBe(true);
      // Should NOT remove because there's still an unresolved record
      expect(mockPromoter.removeRule).not.toHaveBeenCalled();
    });
  });

  describe('deleteRecord()', () => {
    it('should return false when record not found', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();
      const result = await catalog.deleteRecord('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getDomainCounts()', () => {
    it('should ignore unknown domains', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();

      // Manually inject a record with unknown domain
      (catalog as any).records = [
        { ...sampleRecord, id: 'fail_001', domain: 'unknown_domain' as any },
      ];

      const counts = await catalog.getDomainCounts();
      expect(counts.audit).toBe(0);
      expect(counts.test).toBe(0);
      expect(counts.commit).toBe(0);
      expect(counts.agent).toBe(0);
      expect(counts.bootstrap).toBe(0);
    });
  });

  describe('getFailureTypeCounts()', () => {
    it('should aggregate counts by domain:failureType', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();

      (catalog as any).records = [
        { ...sampleRecord, id: 'fail_001', domain: 'audit', failureType: 'connection_leak' },
        { ...sampleRecord, id: 'fail_002', domain: 'audit', failureType: 'connection_leak' },
        { ...sampleRecord, id: 'fail_003', domain: 'test', failureType: 'jest_timeout' },
      ];

      const counts = await catalog.getFailureTypeCounts();
      expect(counts.get('audit:connection_leak')).toBe(2);
      expect(counts.get('test:jest_timeout')).toBe(1);
    });
  });

  describe('findByDateRange()', () => {
    it('should filter records within date range', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();

      (catalog as any).records = [
        { ...sampleRecord, id: 'fail_001', fecha: '2026-01-01T00:00:00.000Z' },
        { ...sampleRecord, id: 'fail_002', fecha: '2026-02-01T00:00:00.000Z' },
        { ...sampleRecord, id: 'fail_003', fecha: '2026-03-01T00:00:00.000Z' },
      ];

      const result = await catalog.findByDateRange('2026-01-15T00:00:00.000Z', '2026-02-15T00:00:00.000Z');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('fail_002');
    });
  });

  describe('findByFailureType()', () => {
    it('should find records by failureType across domains', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();

      (catalog as any).records = [
        { ...sampleRecord, id: 'fail_001', failureType: 'connection_leak' },
        { ...sampleRecord, id: 'fail_002', failureType: 'jest_timeout' },
        { ...sampleRecord, id: 'fail_003', failureType: 'connection_leak' },
      ];

      const result = await catalog.findByFailureType('connection_leak');
      expect(result).toHaveLength(2);
    });
  });

  describe('getAllRecords()', () => {
    it('should return a copy of all records', async () => {
      mockReadFile.mockResolvedValueOnce('[]');
      const catalog = new FailureCatalog({ projectRoot: '/tmp/test', useGlobalDir: false });
      await catalog.load();

      (catalog as any).records = [{ ...sampleRecord, id: 'fail_001' }];
      const records = await catalog.getAllRecords();
      expect(records).toHaveLength(1);
      // Verify it's a copy
      records.push({ ...sampleRecord, id: 'fail_002' });
      expect((catalog as any).records).toHaveLength(1);
    });
  });
});
