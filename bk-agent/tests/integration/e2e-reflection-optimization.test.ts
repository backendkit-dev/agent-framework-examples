/**
 * @description E2E — Verificacion practica de las optimizaciones del Reflection Engine.
 *
 * Cubre exactamente lo que implementamos en el plan de optimizacion:
 *   TASK-03: AgentHook reporta incidentes al ReflectionEngine
 *   TASK-04: reportWrongAgentSelection alimenta agent-domain
 *   TASK-07: Policies promovidas llevan keywords[] especificos (KEYWORD_MAP)
 *   TASK-09: Negacion previene falsos positivos en audit/test detection
 *   TASK-10: completeSprint() → AuditReflectionBridge → ReflectionEngine acumula datos
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { ReflectionEngine } from '../../src/reflection/reflection-engine';
import { AgentHook } from '../../src/reflection/hooks/agent-hook';
import { detectAuditFailureType } from '../../src/reflection/domains/audit-domain';
import { detectTestFailureType } from '../../src/reflection/domains/test-domain';
import { evaluatePolicies } from '../../src/orchestrator/policy-engine';
import { PolicyRule } from '../../src/orchestrator/types';
import { TaskContext } from '../../src/types/task-context';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEngine(tmpDir: string) {
  return new ReflectionEngine({ projectRoot: tmpDir, useGlobalDir: false });
}

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    id: 'task-e2e-001',
    description: 'Implementar endpoint de autenticacion',
    actionType: 'implementation',
    domains: ['backend'],
    riskLevel: 'high',
    status: 'pending',
    assignedAgents: [],
    requiresQaApproval: false,
    requiresSecurityReview: false,
    requiresArchitectureReview: false,
    hopCount: 0,
    filesModified: [],
    riskFactors: {
      breaking_change: false,
      security_sensitive: false,
      cross_service_impact: false,
      db_transactional: false,
      production_critical: false,
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  TASK-09: Negacion previene falsos positivos
// ═══════════════════════════════════════════════════════════════════════════

describe('TASK-09 — Negacion previene falsos positivos en deteccion', () => {
  describe('AuditDomain', () => {
    it('detecta connection_leak en texto afirmativo', () => {
      expect(detectAuditFailureType('QueryRunner sin release en finally block')).toBe('connection_leak');
      expect(detectAuditFailureType('Conexion no liberada correctamente')).toBe('connection_leak');
    });

    it('NO detecta connection_leak cuando el negador precede inmediatamente al keyword', () => {
      // "connection" esta a 10 chars de "verificar" → cae dentro de la ventana de 25 chars
      const result = detectAuditFailureType('verificar connection en el modulo');
      expect(result).not.toBe('connection_leak');
    });

    it('NO detecta security_vulnerability en frases de verificacion', () => {
      const result = detectAuditFailureType('validar que no haya vulnerabilidad SQL en el query');
      expect(result).not.toBe('security_vulnerability');
    });

    it('detecta security_vulnerability en texto afirmativo', () => {
      expect(detectAuditFailureType('SQL injection detectada en el endpoint')).toBe('security_vulnerability');
    });

    it('NO detecta missing_test_coverage cuando hay negador "sin"', () => {
      // "sin test coverage" en contexto como "evitar sin test coverage" deberia no disparar
      const result = detectAuditFailureType('evitar sin test coverage por negligencia');
      expect(result).not.toBe('missing_test_coverage');
    });
  });

  describe('TestDomain', () => {
    it('detecta tsc_noEmit_type_error en texto directo', () => {
      expect(detectTestFailureType('Error TS2345: Property X does not exist')).toBe('tsc_noEmit_type_error');
    });

    it('NO detecta tsc_noEmit_type_error cuando hay negador', () => {
      const result = detectTestFailureType('verificar si hay errores typescript antes de compilar');
      expect(result).not.toBe('tsc_noEmit_type_error');
    });

    it('detecta jest_timeout en texto directo', () => {
      expect(detectTestFailureType('Test timed out after 5000ms')).toBe('jest_timeout');
    });

    it('NO detecta jest_timeout cuando el negador precede inmediatamente al keyword', () => {
      // "timeout" esta a 8 chars de "validar" → cae dentro de la ventana de 25 chars
      const result = detectTestFailureType('validar timeout del test');
      expect(result).not.toBe('jest_timeout');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  TASK-03 / TASK-04: AgentHook alimenta el ReflectionEngine
// ═══════════════════════════════════════════════════════════════════════════

describe('TASK-03/04 — AgentHook registra incidentes en ReflectionEngine', () => {
  let tmpDir: string;
  let engine: ReflectionEngine;
  let hook: AgentHook;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-agent-hook-'));
    engine = makeEngine(tmpDir);
    await engine.initialize();
    hook = new AgentHook(engine);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reportAgentFailure registra en domain agent', async () => {
    await hook.reportAgentFailure('Respuesta rechazada por el evaluador', 'general', [], 'response_rejected_by_evaluator');

    const stats = await engine.getStats();
    expect(stats.totalIncidents).toBe(1);
    expect(stats.countsByDomain.agent).toBe(1);
  });

  it('reportHallucination registra agent_hallucination', async () => {
    await hook.reportHallucination('general', 'Invento una API inexistente', 'metodo fabricado');

    const records = await engine.getCatalog().findByDomain('agent');
    expect(records).toHaveLength(1);
    expect(records[0].failureType).toBe('agent_hallucination');
  });

  it('reportWrongAgentSelection registra wrong_agent_selected', async () => {
    await hook.reportWrongAgentSelection('general', 'security');

    const records = await engine.getCatalog().findByDomain('agent');
    expect(records).toHaveLength(1);
    expect(records[0].failureType).toBe('wrong_agent_selected');
  });

  it('3 reportAgentFailure del mismo tipo generan patron detectable', async () => {
    for (let i = 0; i < 3; i++) {
      await hook.reportAgentFailure(`Alucinacion ${i}`, 'general', [], 'agent_hallucination', 'agent');
    }

    const { patterns } = await engine.reflect();
    const p = patterns.find(x => x.failureType === 'agent_hallucination');
    expect(p).toBeDefined();
    expect(p!.count).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  TASK-07: Policies promovidas llevan keywords[] del KEYWORD_MAP
// ═══════════════════════════════════════════════════════════════════════════

describe('TASK-07 — Policies promovidas incluyen keywords especificos', () => {
  let tmpDir: string;
  let engine: ReflectionEngine;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-keywords-'));
    // HOME debe setearse ANTES de crear el engine para que PolicyPromoter use tmpDir
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    engine = new ReflectionEngine({ projectRoot: tmpDir, useGlobalDir: true });
    await engine.initialize();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('policy promovida de agent_hallucination tiene keywords de KEYWORD_MAP', async () => {
    const fecha = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await engine.reportIncident({
        domain: 'agent',
        failureType: 'agent_hallucination',
        severity: 'high',
        dimension: 'calidad',
        gate: 'qa',
        agenteResponsable: 'general',
        hallazgo: `Alucinacion de agente ${i}`,
        recomendacion: 'Habilitar evaluador logico',
        archivos: [],
        fecha,
      });
    }

    const { promotedRules } = await engine.reflect({ autoPromote: true });
    const rule = promotedRules.find(r => r.trigger?.pattern === 'agent_hallucination');
    expect(rule).toBeDefined();
    expect(rule!.if.keywords).toBeDefined();
    expect(rule!.if.keywords!.length).toBeGreaterThan(0);
    // KEYWORD_MAP para agent_hallucination: ['alucinacion', 'hallucination', 'incorrecto']
    expect(rule!.if.keywords).toContain('alucinacion');
  });

  it('policy promovida de hardcoded_secret tiene keywords de seguridad', async () => {
    const fecha = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await engine.reportIncident({
        domain: 'audit',
        failureType: 'hardcoded_secret',
        severity: 'critical',
        dimension: 'seguridad',
        gate: 'security',
        agenteResponsable: 'security-agent',
        hallazgo: `API key hardcodeada ${i}`,
        recomendacion: 'Usar variables de entorno',
        archivos: ['src/config.ts'],
        fecha,
      });
    }

    const { promotedRules } = await engine.reflect({ autoPromote: true });
    const rule = promotedRules.find(r => r.trigger?.pattern === 'hardcoded_secret');
    expect(rule).toBeDefined();
    // KEYWORD_MAP para hardcoded_secret: ['password', 'secret', 'api_key', 'token', 'credential']
    expect(rule!.if.keywords).toContain('secret');
    expect(rule!.if.keywords).toContain('token');
  });

  it('policy promovida NO usa customExpression — solo keywords[]', async () => {
    const fecha = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await engine.reportIncident({
        domain: 'commit',
        failureType: 'missing_type',
        severity: 'high',
        dimension: 'calidad',
        gate: 'commit',
        agenteResponsable: 'system',
        hallazgo: `Commit sin tipo ${i}`,
        recomendacion: 'Usar conventional commits',
        archivos: [],
        fecha,
      });
    }

    const { promotedRules } = await engine.reflect({ autoPromote: true });
    const rule = promotedRules.find(r => r.trigger?.pattern === 'missing_type');
    expect(rule).toBeDefined();
    expect((rule!.if as any).customExpression).toBeUndefined();
    expect(rule!.if.keywords).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  TASK-10: completeSprint() alimenta el ReflectionEngine via AuditReporter
// ═══════════════════════════════════════════════════════════════════════════

describe('TASK-10 — completeSprint() conecta AuditReporter con ReflectionEngine', () => {
  let tmpDir: string;
  let engine: ReflectionEngine;
  let AuditReporter: any;

  beforeAll(async () => {
    const mod = await import('../../src/orchestrator/audit-reporter');
    AuditReporter = mod.AuditReporter;
  });

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-complete-sprint-'));
    engine = makeEngine(tmpDir);
    await engine.initialize();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recordGate + completeSprint registra hallazgos NO-GO en el engine', async () => {
    const reporter = new AuditReporter({ projectRoot: tmpDir, useGlobalDir: false });
    reporter.connectReflectionEngine(engine);

    await reporter.recordGate('security', 'security-agent', 'NO-GO condicional', [
      {
        id: 'f1',
        dimension: 'seguridad',
        hallazgo: 'SQL injection detectada en el query builder',
        severidad: 'high',
        evidencia: 'src/db/query.ts',
        recomendacion: 'Usar parametros preparados',
        agenteResponsable: 'security-agent',
      },
    ]);

    await reporter.completeSprint({
      name: 'Sprint-E2E',
      version: '1.0.0',
      purpose: 'Verificacion E2E',
      newFiles: [],
      modifiedFiles: [],
      testCount: 0,
      testTime: '0s',
    });

    const stats = await engine.getStats();
    expect(stats.totalIncidents).toBeGreaterThanOrEqual(1);
    expect(stats.countsByDomain.audit).toBeGreaterThanOrEqual(1);
  });

  it('hallazgos GO no incrementan incidentes en el engine', async () => {
    const reporter = new AuditReporter({ projectRoot: tmpDir, useGlobalDir: false });
    reporter.connectReflectionEngine(engine);

    await reporter.recordGate('qa', 'qa-engineer', 'GO', []);

    await reporter.completeSprint({
      name: 'Sprint-GO',
      version: '1.0.0',
      purpose: 'Verificacion GO',
      newFiles: [],
      modifiedFiles: [],
      testCount: 5,
      testTime: '2s',
    });

    const stats = await engine.getStats();
    // Gates GO sin hallazgos no deben generar incidentes
    expect(stats.totalIncidents).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Pipeline completo: incidentes → patron → policy con keywords → evaluatePolicies
// ═══════════════════════════════════════════════════════════════════════════

describe('Pipeline completo: incidente → patron → policy → evaluatePolicies()', () => {
  let tmpDir: string;
  let engine: ReflectionEngine;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pipeline-'));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    engine = new ReflectionEngine({ projectRoot: tmpDir, useGlobalDir: true });
    await engine.initialize();
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('policy promovida matchea en evaluatePolicies() cuando el userInput contiene keyword', async () => {
    // 1. Simular 3 incidentes de wrong_agent_selected
    const fecha = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await engine.reportIncident({
        domain: 'agent',
        failureType: 'wrong_agent_selected',
        severity: 'high',
        dimension: 'routing',
        gate: 'orchestrator',
        agenteResponsable: 'general',
        hallazgo: `Agente incorrecto seleccionado para dominio de seguridad (${i + 1})`,
        recomendacion: 'Mejorar routing',
        archivos: [],
        fecha,
      });
    }

    // 2. Promover pattern a policy
    const { promotedRules } = await engine.reflect({ autoPromote: true });
    expect(promotedRules.length).toBeGreaterThanOrEqual(1);

    const policy = promotedRules.find(r => r.trigger?.pattern === 'wrong_agent_selected');
    expect(policy).toBeDefined();
    expect(policy!.if.keywords).toContain('agente');

    // 3. Construir PolicyRule compatible con evaluatePolicies
    const rules: PolicyRule[] = [{ if: policy!.if, then: policy!.then }];
    const task = makeTask({ actionType: 'implementation', riskLevel: 'high' });

    // 4. userInput con keyword del KEYWORD_MAP → debe matchear
    const withKeyword = evaluatePolicies(task, rules, 'necesito revisar el routing del agente');
    expect(withKeyword.appliedRules.length).toBeGreaterThanOrEqual(1);

    // 5. userInput sin keywords → no matchea (solo condicion de keywords, no actionType/riskLevel que ya matchean por riskLevel high)
    // Nota: la policy de agent domain no tiene actionType constraint, solo keywords y riskLevel.
    // Un task con riskLevel=low y sin keywords no deberia matchear.
    const taskLow = makeTask({ actionType: 'implementation', riskLevel: 'low' });
    const withoutKeyword = evaluatePolicies(taskLow, rules, 'quiero un commit nuevo');
    expect(withoutKeyword.appliedRules.length).toBe(0);
  });
});
