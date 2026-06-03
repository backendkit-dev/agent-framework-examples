/**
 * @description Integración: verifica que después de completeSprint() se genera
 * el archivo de lecciones aprendidas, y que buildSystemPrompt lo inyecta.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { AuditReporter } from '../../src/orchestrator/audit-reporter';
import { buildSystemPrompt } from '../../src/agent/system-prompt';

describe('Lessons Memo — generación e inyección en system prompt', () => {
  let tmpDir: string;
  let reporter: AuditReporter;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-test-'));
    reporter = new AuditReporter({ projectRoot: tmpDir, useGlobalDir: false });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('completeSprint() genera el archivo de informe final', async () => {
    await reporter.recordGate('test', 'qa-engineer', 'GO', [
      {
        id: 'f001',
        dimension: 'Calidad',
        hallazgo: 'Tests pasaron correctamente',
        severidad: 'low',
        evidencia: 'All tests green',
        recomendacion: 'Mantener cobertura actual',
        agenteResponsable: 'qa-engineer',
      },
    ]);

    const { reportPath } = await reporter.completeSprint({
      name: 'sprint-test',
      version: '1.0.0',
      purpose: 'test purposes',
      newFiles: [],
      modifiedFiles: [],
      testCount: 0,
      testTime: '0s',
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
    });

    expect(fs.existsSync(reportPath)).toBe(true);
    const content = fs.readFileSync(reportPath, 'utf-8');
    expect(content).toContain('sprint-test');
  });

  it('el memo de lecciones aprendidas se crea en la ruta del reporter', async () => {
    // Registrar un NO-GO para que haya hallazgos que aprender
    await reporter.recordGate('security', 'security-agent', 'NO-GO', [
      {
        id: 'f002',
        dimension: 'Seguridad',
        hallazgo: 'Hardcoded API key detectada',
        severidad: 'high',
        evidencia: 'const apiKey = "sk-..."',
        recomendacion: 'Usar variables de entorno',
        agenteResponsable: 'security-agent',
      },
    ]);

    await reporter.completeSprint({
      name: 'sprint-security',
      version: '1.1.0',
      purpose: 'security test',
      newFiles: [],
      modifiedFiles: [],
      testCount: 0,
      testTime: '0s',
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
    });

    // El memo se genera en la ruta de docs del reporter
    const docsDir = path.join(tmpDir, 'docs', 'auditorias');
    const memoFile = path.join(docsDir, 'lecciones-aprendidas.md');
    expect(fs.existsSync(memoFile)).toBe(true);

    const memo = fs.readFileSync(memoFile, 'utf-8');
    expect(memo.length).toBeGreaterThan(10);
  });

  it('buildSystemPrompt inyecta el memo en el prompt cuando está disponible', () => {
    const lessonsMemo = '## Lecciones del sprint anterior\n\n- Usar variables de entorno para API keys.';

    const prompt = buildSystemPrompt(
      { vault: { path: '', auto_sync: false, auto_use: false, search_paths: [] }, extraction: { enabled: false, trigger: 'never', patterns: false, snippets: false, configs: false, ask_before_extract: false }, usage: { enabled: false, priority: 'vault_first', search_before_generate: false }, notification: { enabled: false, style: 'inline', emojis: false } } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      lessonsMemo
    );

    expect(prompt).toContain('Lecciones del sprint anterior');
    expect(prompt).toContain('API keys');
  });

  it('buildSystemPrompt no falla si el memo es null o vacío', () => {
    expect(() => buildSystemPrompt({} as any, undefined, undefined, null)).not.toThrow();
    expect(() => buildSystemPrompt({} as any, undefined, undefined, '')).not.toThrow();
    expect(() => buildSystemPrompt({} as any, undefined, undefined, undefined)).not.toThrow();
  });
});
