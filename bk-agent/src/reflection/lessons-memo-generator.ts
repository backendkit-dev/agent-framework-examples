/**
 * @description LessonsMemoGenerator — Genera un memo de lecciones aprendidas
 * a partir de los patrones detectados por el Reflection Engine.
 *
 * El memo se inyecta en el system prompt de los agentes para que aprendan
 * de errores pasados automaticamente. Cierra el ciclo:
 *
 *   Codigo -> Auditoria -> Reflection Engine -> LessonsMemo -> System Prompt
 *
 * @example
 * ```ts
 * const generator = new LessonsMemoGenerator(engine);
 * const memo = await generator.generate();
 * // Inyectar memo en el system prompt del agente
 * ```
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { ReflectionEngine } from './reflection-engine';
import { DetectedPattern } from './types';

// ── Constantes ───────────────────────────────────────────────────────────────

const MEMO_FILENAME = 'lecciones-aprendidas.md';

// ── LessonsMemoGenerator ─────────────────────────────────────────────────────

export class LessonsMemoGenerator {
  private engine: ReflectionEngine;

  constructor(engine: ReflectionEngine) {
    this.engine = engine;
  }

  /**
   * @description Genera el memo de lecciones aprendidas basado en los patrones
   * detectados por el Reflection Engine.
   *
   * El memo incluye:
   * - Resumen de patrones por dominio
   * - Lecciones concretas extraidas de cada patron (que hacer y que evitar)
   * - Reglas promovidas a policyRules
   *
   * @returns Contenido del memo en markdown, o null si no hay patrones
   */
  async generate(): Promise<string | null> {
    const stats = await this.engine.getStats();

    if (stats.totalIncidents === 0) {
      return null;
    }

    // Obtener patrones detectados
    const allPatterns = this.engine.getLastPatterns();
    const promotedRules = this.engine.getLastPromotedRules();

    if (allPatterns.length === 0 && promotedRules.length === 0) {
      return null;
    }

    const sections: string[] = [];

    // Encabezado
    sections.push(`# Lecciones Aprendidas (Auto-generado)

> Generado automaticamente por el Reflection Engine.
> Basado en ${stats.totalIncidents} incidentes analizados en ${stats.activeDomains.length} dominios.

---

`);

    // --- Seccion 1: Resumen por dominio ---
    sections.push('## Resumen por Dominio\n');
    sections.push('| Dominio | Incidentes | Patrones Activos |');
    sections.push('|---------|------------|------------------|');

    for (const domain of stats.activeDomains) {
      const incidentCount = stats.countsByDomain[domain] ?? 0;
      const patternCount = stats.patternsByDomain[domain] ?? 0;
      const icon = this.getDomainIcon(domain);
      sections.push(`| ${icon} ${domain} | ${incidentCount} | ${patternCount} |`);
    }
    sections.push('');

    // --- Seccion 2: Lecciones por patron ---
    sections.push('## Lecciones Aprendidas\n');

    if (allPatterns.length === 0) {
      sections.push('_No hay patrones activos. Los incidentes registrados no han superado el umbral de promocion._\n');
    } else {
      for (const pattern of allPatterns) {
        sections.push(this.formatPatternAsLesson(pattern));
        sections.push('');
      }
    }

    // --- Seccion 3: Reglas promovidas ---
    if (promotedRules.length > 0) {
      sections.push('## Reglas de Politica Promovidas\n');
      sections.push('| ID | Nombre | Dominio | Trigger |');
      sections.push('|----|--------|---------|--------|');

      for (const rule of promotedRules) {
        const triggerInfo = rule.trigger
          ? `${rule.trigger.pattern} (x${rule.trigger.minOccurrences})`
          : 'auto-generada';
        sections.push(`| ${rule.id} | ${rule.name} | ${rule.trigger?.domain ?? 'N/A'} | ${triggerInfo} |`);
      }
      sections.push('');
    }

    // --- Seccion 4: Checklist de auto-revision ---
    sections.push('## Checklist de Auto-Revision\n');
    sections.push(`Basado en los patrones detectados, antes de finalizar cualquier implementacion, verifica:

${this.buildChecklist(allPatterns)}
`);

    return sections.join('\n');
  }

  /**
   * @description Genera y persiste el memo en disco.
   * La ruta es: ~/.deepseek-code/projects/{hash}/audits/lecciones-aprendidas.md
   *
   * @returns Ruta del archivo generado, o null si no hay lecciones
   */
  async persist(): Promise<string | null> {
    const content = await this.generate();
    if (!content) return null;

    const filePath = this.getMemoPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * @description Obtiene la ruta del archivo de memo.
   */
  getMemoPath(): string {
    const cwd = process.cwd();
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    const projectKey = cwd
      .replace(/[/\\]$/, '')
      .replace(/:[/\\]/g, '--')
      .replace(/[^a-zA-Z0-9-]/g, '-');
    return path.join(home, '.deepseek-code', 'projects', projectKey, 'audits', MEMO_FILENAME);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getDomainIcon(domain: string): string {
    const icons: Record<string, string> = {
      audit: 'audit',
      test: 'test',
      commit: 'commit',
      agent: 'agent',
      bootstrap: 'bootstrap',
    };
    return icons[domain] ?? domain;
  }

  /**
   * Convierte un DetectedPattern en una leccion con formato markdown.
   */
  private formatPatternAsLesson(pattern: DetectedPattern): string {
    const severityEmoji = this.getSeverityEmoji(pattern.severity);

    // Construir recomendacion concreta
    const recommendation = this.buildRecommendation(pattern);

    return [
      `### ${severityEmoji} ${this.formatFailureType(pattern.failureType)}`,
      '',
      `- **Dominio:** ${pattern.domain}`,
      `- **Ocurrencias:** ${pattern.count} (ultima: ${pattern.lastSeen.slice(0, 10)})`,
      `- **Severidad dominante:** ${pattern.severity}`,
      `- **Dimension:** ${pattern.dominantDimension}`,
      `- **Gate tipico:** ${pattern.dominantGate}`,
      '',
      '**Que evitar:**',
      `> ${pattern.recommendedAction || 'Este patron se ha repetido. Evitar en futuras implementaciones.'}`,
      '',
      '**Recomendacion:**',
      `> ${recommendation}`,
      '',
    ].join('\n');
  }

  /**
   * Genera una recomendacion concreta basada en el failureType.
   */
  private buildRecommendation(pattern: DetectedPattern): string {
    const ft = pattern.failureType;

    // Recomendaciones especificas por failureType
    const recommendations: Record<string, string> = {
      // Audit
      missing_rollback: 'Siempre implementar rollback/compensacion para operaciones de escritura. Verificar que cada write/save tiene su contraparte de rollback.',
      connection_leak: 'Verificar que todos los clientes HTTP/DB se cierren en finally blocks. Usar pattern try/finally o using.',
      security_vulnerability: 'Revisar OWASP Top 10 antes de implementar autenticacion, autorizacion o manejo de inputs del usuario.',
      missing_test_coverage: 'Todo nuevo metodo publico debe tener al menos un test unitario. Verificar cobertura antes de commitear.',
      incomplete_error_handling: 'Toda funcion que pueda fallar debe tener try/catch con manejo explicito del error. No dejar errores sin manejar.',
      architecture_violation: 'Revisar ADRs antes de implementar. Verificar que la implementacion respeta las decisiones arquitectonicas documentadas.',
      hardcoded_secret: 'Nunca hardcodear secrets, API keys o tokens. Usar variables de entorno o un vault de secrets.',

      // Test
      tsc_noEmit_type_error: 'Ejecutar tsc --noEmit antes de cada commit. Los errores de tipo deben resolverse en el codigo, no con `as any`.',
      coverage_below_threshold: 'No commitear si la cobertura baja del threshold. Agregar tests para el nuevo codigo ANTES de commitear.',
      flaky_test: 'Los tests flaky deben marcarse como flaky y aislarse. No ignorarlos.',
      test_without_assertion: 'Todo test debe tener al menos una assertion. Si no hay assertion, no es un test.',

      // Commit
      typecheck_failed_before_commit: 'Ejecutar type check antes de cada commit. No confiar solo en el IDE.',
      test_failed_before_commit: 'Ejecutar tests antes de commitear. Si fallan, diagnosticar y corregir.',
      branch_naming_invalid: 'Seguir la convencion de naming de ramas: feature/siglas_descripcion_fecha o fix/siglas_descripcion_fecha.',

      // Agent
      wrong_agent_selected: 'Verificar que el agente seleccionado sea el correcto para el dominio de la tarea. Usar capability matrix como referencia.',
      agent_hallucination: 'Verificar que todas las APIs, metodos y paquetes referenciados existan realmente. No inventar funcionalidades.',
      delegation_failed: 'Al delegar a otro agente, proporcionar contexto suficiente: archivos relevantes, historial y restricciones.',
      tool_execution_failed: 'Verificar que las herramientas invocadas esten disponibles en el entorno actual.',

      // Bootstrap
      missing_config_yaml: 'Verificar que los archivos de configuracion existan antes de arrancar. Si no existen, ejecutar seed.',
      memory_load_failure: 'Verificar que la memoria persistente este accesible. Si falla la carga, continuar con defaults.',
      manifest_corrupt: 'Validar YAML antes de escribir el manifest. Usar patron tmp+rename para escritura atomica.',
    };

    return recommendations[ft]
      ?? `Patron "${ft}" detectado ${pattern.count} veces. Revisar implementaciones previas para evitar repetir el mismo error.`;
  }

  /**
   * Construye un checklist de auto-revision basado en los patrones detectados.
   */
  private buildChecklist(patterns: DetectedPattern[]): string {
    const checks: string[] = [];

    // Checklist general siempre presente
    checks.push('### 1. Conexiones');
    checks.push('- [ ] Si cree un EMISOR (write, save, persist), verifique que exista un RECEPTOR (read, load, subscribe)');
    checks.push('- [ ] Si agrego un hook/punto de extension, esta cableado en algun lado?');
    checks.push('');

    checks.push('### 2. Logica');
    checks.push('- [ ] Si uso includes(), verifique que NO matchee su propia negacion ("no hay X".includes("X") = true)');
    checks.push('- [ ] Si hay scores/weights, la direccion es correcta? (mayor = mejor o mayor = peor?)');
    checks.push('- [ ] Si hay if/else, los branches estan en el orden correcto?');
    checks.push('');

    checks.push('### 3. Robustez');
    checks.push('- [ ] Todos los switch tienen caso default?');
    checks.push('- [ ] Todos los catch tienen manejo del error (no estan vacios)?');
    checks.push('- [ ] Las escrituras a archivo usan patron tmp+rename?');

    // Checklist especifica por patrones detectados
    const failureTypes = new Set(patterns.map(p => p.failureType));

    if (failureTypes.has('missing_rollback')) {
      checks.push('- [ ] Las operaciones de escritura tienen compensacion/rollback?');
    }
    if (failureTypes.has('security_vulnerability')) {
      checks.push('- [ ] Se reviso OWASP Top 10 para esta implementacion?');
    }
    if (failureTypes.has('hardcoded_secret')) {
      checks.push('- [ ] No hay secrets hardcodeados?');
    }

    return checks.join('\n');
  }

  private formatFailureType(type: string): string {
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case 'critical': return 'CRITICAL';
      case 'high': return 'HIGH';
      case 'medium': return 'MEDIUM';
      case 'low': return 'LOW';
      default: return 'INFO';
    }
  }
}
