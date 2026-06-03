/**
 * @description PolicyPromoter — Promueve patrones detectados a policyRules en manifest.yaml.
 *
 * Toma un DetectedPattern y escribe/actualiza una entry en policyRules del manifest.yaml.
 * La promoción convierte un hallazgo repetido en una regla determinista que el sistema
 * aplica sin pasar por el LLM.
 *
 * @example
 * ```ts
 * const promoter = new PolicyPromoter();
 * await promoter.promote(pattern, 'pol-test-001');
 * ```
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as yaml from 'yaml';
import { atomicWrite } from '../shared/utils/atomic-write';
import { DetectedPattern, ManifestPolicyRule, generatePolicyRuleId } from './types';
import { PolicyRule, PolicyCondition, PolicyAction } from '../orchestrator/types';
import { DomainRegistry } from './domain-registry';

// ── Constantes ───────────────────────────────────────────────────────────────

const MANIFEST_FILENAME = 'manifest.yaml';

/**
 * Palabras clave por failureType para el PolicyEngine (OR logic, case-insensitive).
 * Cubre los 40 failureTypes de los 5 dominios del Reflection Engine.
 */
const KEYWORD_MAP: Record<string, string[]> = {
  // audit domain
  missing_rollback:               ['transaccion', 'transaction', 'rollback', 'database', 'base de datos'],
  connection_leak:                ['conexion', 'connection', 'pool', 'socket', 'database'],
  security_vulnerability:         ['seguridad', 'auth', 'jwt', 'oauth', 'vulnerabilidad', 'security'],
  missing_test_coverage:          ['cobertura', 'coverage', 'test', 'prueba'],
  incomplete_error_handling:      ['error', 'exception', 'catch', 'manejo de errores'],
  missing_documentation:          ['documentacion', 'documentation', 'doc', 'readme'],
  architecture_violation:         ['arquitectura', 'architecture', 'capa', 'modulo', 'dependencia'],
  missing_logging:                ['log', 'logging', 'registro', 'logger'],
  unvalidated_input:              ['input', 'validacion', 'validation', 'request', 'form'],
  hardcoded_secret:               ['password', 'secret', 'api_key', 'token', 'credential'],
  // test domain
  tsc_noEmit_type_error:          ['typescript', 'type', 'tsc', 'compile'],
  jest_timeout:                   ['timeout', 'jest', 'async', 'await'],
  coverage_below_threshold:       ['cobertura', 'coverage', 'threshold', 'umbral'],
  flaky_test:                     ['flaky', 'intermittent', 'inestable'],
  missing_test_for_use_case:      ['caso de uso', 'use case', 'escenario', 'scenario'],
  test_without_assertion:         ['assertion', 'expect', 'assert'],
  integration_test_without_container: ['integration', 'container', 'docker', 'integracion'],
  property_test_missing:          ['property', 'generative', 'fuzzing'],
  // commit domain
  unknown_failure:                ['commit', 'mensaje', 'message'],
  missing_type:                   ['conventional', 'feat', 'fix', 'chore', 'tipo de commit'],
  wrong_scope:                    ['scope', 'alcance', 'modulo'],
  message_too_long:               ['commit', 'largo', 'mensaje largo'],
  missing_issue_reference:        ['issue', 'ticket', 'jira', 'referencia'],
  coverage_not_run:               ['cobertura', 'coverage', 'jest'],
  typecheck_failed_before_commit: ['typescript', 'typecheck', 'tsc', 'compile'],
  test_failed_before_commit:      ['test', 'jest', 'prueba fallida'],
  branch_naming_invalid:          ['branch', 'rama', 'naming', 'feature', 'hotfix'],
  // agent domain
  wrong_agent_selected:           ['agente', 'agent', 'routing', 'seleccion'],
  agent_timeout:                  ['timeout', 'agente', 'tiempo de espera'],
  agent_hallucination:            ['alucinacion', 'hallucination', 'incorrecto'],
  missing_agent_for_domain:       ['agente', 'dominio', 'especialista', 'domain'],
  tool_execution_failed:          ['tool', 'herramienta', 'ejecutar'],
  delegation_failed:              ['delegacion', 'delegation', 'agente'],
  response_rejected_by_evaluator: ['evaluador', 'evaluator', 'rechazado', 'rejected'],
  // bootstrap domain
  missing_config_yaml:            ['config', 'yaml', 'configuracion', 'archivo'],
  wrong_project_type_detected:    ['proyecto', 'project', 'tipo de proyecto'],
  memory_load_failure:            ['memoria', 'memory', 'carga'],
  manifest_corrupt:               ['manifest', 'corrupto', 'corrupt', 'yaml'],
  seed_config_failed:             ['seed', 'inicializacion', 'init'],
  agent_profile_load_failed:      ['perfil', 'profile', 'agente'],
  vault_sync_failed:              ['vault', 'obsidian', 'sync'],
};

// ── PolicyPromoter ───────────────────────────────────────────────────────────

export class PolicyPromoter {
  private manifestPath: string;
  private registry?: DomainRegistry;

  constructor(options?: { manifestPath?: string; registry?: DomainRegistry }) {
    if (options?.manifestPath) {
      this.manifestPath = options.manifestPath;
    } else {
      const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
      this.manifestPath = path.join(home, '.deepseek-code', MANIFEST_FILENAME);
    }
    if (options?.registry) {
      this.registry = options.registry;
    }
  }

  /**
   * @description Conecta un DomainRegistry para resolver keywords y acciones de dominios custom.
   */
  setRegistry(registry: DomainRegistry): void {
    this.registry = registry;
  }

  // ── Lectura/Escritura de manifest ─────────────────────────────────────────

  /**
   * @description Lee el manifest.yaml completo como objeto.
   */
  async readManifest(): Promise<Record<string, any>> {
    try {
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      return yaml.parse(content) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * @description Escribe el objeto completo en manifest.yaml.
   */
  async writeManifest(data: Record<string, any>): Promise<void> {
    await fs.mkdir(path.dirname(this.manifestPath), { recursive: true });
    const content = yaml.stringify(data, {
      indent: 2,
      lineWidth: 200,
      defaultStringType: 'PLAIN',
    });
    await atomicWrite(this.manifestPath, content);
  }

  // ── Operaciones con policyRules ────────────────────────────────────────────

  /**
   * @description Obtiene todas las policyRules actuales del manifest.
   */
  async getExistingRules(): Promise<ManifestPolicyRule[]> {
    const manifest = await this.readManifest();
    return manifest.policyRules ?? [];
  }

  async getRuleById(id: string): Promise<ManifestPolicyRule | undefined> {
    const rules = await this.getExistingRules();
    return rules.find(r => r.id === id);
  }

  /**
   * @description Busca si ya existe una regla para (domain, failureType).
   * Evita promoción duplicada en cada arranque.
   */
  async findRule(domain: string, failureType: string): Promise<ManifestPolicyRule | undefined> {
    const rules = await this.getExistingRules();
    return rules.find(r => r.trigger?.domain === domain && r.trigger?.pattern === failureType);
  }

  /**
   * @description Promueve un patrón detectado a policyRule en manifest.yaml.
   *
   * Si el patrón ya fue promovido (misma rule ID existente), actualiza la regla.
   * Si no existe, crea una nueva entrada.
   *
   * @param pattern - Patrón detectado por PatternDetector
   * @param existingRuleId - ID de regla existente (opcional, para actualizar)
   * @returns La ManifestPolicyRule creada o actualizada
   */
  async promote(
    pattern: DetectedPattern,
    existingRuleId?: string
  ): Promise<ManifestPolicyRule> {
    const manifest = await this.readManifest();
    const rules: ManifestPolicyRule[] = manifest.policyRules ?? [];

    // Generar o reutilizar ID
    const ruleId = existingRuleId ?? await this.generateNextId(pattern.domain);

    // Construir la nueva regla
    const condition = this.buildCondition(pattern);
    const action = this.buildAction(pattern);

    const newRule: ManifestPolicyRule = {
      id: ruleId,
      name: this.buildRuleName(pattern),
      if: condition,
      then: action,
      trigger: {
        domain: pattern.domain,
        pattern: pattern.failureType,
        minOccurrences: 3,
      },
      autoGenerated: true,
      createdAt: new Date().toISOString(),
      engineVersion: '1.0.0',
    };

    // Buscar si ya existe y actualizar, o agregar
    const existingIndex = rules.findIndex(r => r.id === ruleId);
    if (existingIndex >= 0) {
      rules[existingIndex] = newRule;
    } else {
      rules.push(newRule);
    }

    manifest.policyRules = rules;
    await this.writeManifest(manifest);

    return newRule;
  }

  /**
   * @description Actualiza la telemetría de outcomes de una regla.
   * Llamar después de que un evaluador emite GO (success) o NO-GO (failure) en una tarea
   * donde esta regla fue aplicada.
   */
  async updateOutcome(ruleId: string, outcome: 'success' | 'failure'): Promise<boolean> {
    const manifest = await this.readManifest();
    const rules: ManifestPolicyRule[] = manifest.policyRules ?? [];
    const index = rules.findIndex(r => r.id === ruleId);
    if (index === -1) return false;

    const rule = rules[index];
    const existing = rule.outcomes ?? { success: 0, failure: 0, lastSeen: '' };
    rules[index] = {
      ...rule,
      outcomes: {
        success: existing.success + (outcome === 'success' ? 1 : 0),
        failure: existing.failure + (outcome === 'failure' ? 1 : 0),
        lastSeen: new Date().toISOString(),
      },
    };

    manifest.policyRules = rules;
    await this.writeManifest(manifest);
    return true;
  }

  /**
   * @description Elimina una policyRule del manifest por su ID.
   */
  async removeRule(ruleId: string): Promise<boolean> {
    const manifest = await this.readManifest();
    const rules: ManifestPolicyRule[] = manifest.policyRules ?? [];
    const filtered = rules.filter(r => r.id !== ruleId);

    if (filtered.length === rules.length) return false;

    manifest.policyRules = filtered;
    await this.writeManifest(manifest);
    return true;
  }

  // ── Helpers de construcción ────────────────────────────────────────────────

  /**
   * @description Construye un nombre legible para la regla.
   */
  private buildRuleName(pattern: DetectedPattern): string {
    const readableType = pattern.failureType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    const domainLabel = pattern.domain.charAt(0).toUpperCase() + pattern.domain.slice(1);
    return `[${domainLabel}] ${readableType} — auto-generated policy`;
  }

  /**
   * @description Construye la condicion de la policyRule basada en el patron.
   * Para dominios built-in usa KEYWORD_MAP. Para dominios custom consulta DomainRegistry.
   */
  private buildCondition(pattern: DetectedPattern): PolicyCondition {
    const condition: PolicyCondition = {};

    // Keywords: built-in usa KEYWORD_MAP, custom usa registry
    const builtinKeywords = KEYWORD_MAP[pattern.failureType];
    const customKeywords = this.registry?.getKeywordsForFailureType(pattern.domain, pattern.failureType);
    const keywords = builtinKeywords ?? customKeywords;
    if (keywords?.length) {
      condition.keywords = keywords;
    }

    // Routing por actionType/domain segun dominio
    switch (pattern.domain) {
      case 'audit':
        if (pattern.failureType.includes('security')) {
          condition.domain = 'security';
        }
        break;

      case 'test':
        condition.actionType = 'test';
        break;

      case 'commit':
        condition.actionType = ['implementation', 'refactor', 'bugfix'];
        break;

      case 'agent':
      case 'bootstrap':
        break;

      default:
        // Dominio custom: sin actionType ni domain especifico, solo keywords
        break;
    }

    // riskLevel segun severidad
    if (pattern.severity === 'critical' || pattern.severity === 'high') {
      condition.riskLevel = ['high', 'critical'];
    } else if (pattern.severity === 'medium') {
      condition.riskLevel = 'medium';
    }

    return condition;
  }

  /**
   * @description Construye la acción de la policyRule.
   */
  private buildAction(pattern: DetectedPattern): PolicyAction {
    const action: PolicyAction = {};

    // Determinar acción según el dominio y tipo de fallo
    switch (pattern.domain) {
      case 'audit':
        action.requireQaApproval = true;
        if (pattern.failureType.includes('security')) {
          action.requireSecurityReview = true;
        }
        break;

      case 'test':
        action.mustInclude = action.mustInclude ?? [];
        action.mustInclude.push('qa-engineer');
        if (pattern.failureType.includes('coverage')) {
          action.mustExecute = ['test-coverage-check'];
        }
        break;

      case 'commit':
        action.mustInclude = action.mustInclude ?? [];
        action.mustInclude.push('qa-engineer');
        action.requireQaApproval = true;
        break;

      case 'agent':
        action.mustInclude = action.mustInclude ?? [];
        // Asignar agente especializado según el failureType
        if (pattern.failureType.includes('security')) {
          action.mustInclude.push('security-agent');
        } else if (pattern.failureType.includes('hallucination')) {
          action.mustInclude.push('general');
        }
        break;

      case 'bootstrap':
        action.requireQaApproval = false;
        break;

      default: {
        // Dominio custom: accion basada en la severidad del failureType
        const ftDef = this.registry?.getFailureTypeDef(pattern.domain, pattern.failureType);
        if (ftDef && (ftDef.severity === 'high' || ftDef.severity === 'critical')) {
          action.requireQaApproval = true;
        }
        break;
      }
    }

    return action;
  }

  /**
   * @description Genera el próximo ID de regla disponible para un dominio.
   * Busca el número más alto existente y suma 1.
   */
  private async generateNextId(domain: DetectedPattern['domain']): Promise<string> {
    const rules = await this.getExistingRules();
    const prefix = domain.toUpperCase().slice(0, 4);
    const pattern = `POL-${prefix}-`;

    let maxNum = 0;
    for (const rule of rules) {
      if (!rule.id || !rule.id.startsWith(pattern)) continue;
      const num = parseInt(rule.id.slice(pattern.length), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }

    return generatePolicyRuleId(domain, maxNum + 1);
  }
}
