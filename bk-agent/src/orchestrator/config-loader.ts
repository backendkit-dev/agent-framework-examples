/**
 * @description Cargador de configuracion del orquestador.
 *
 * Lee los archivos YAML desde ~/.deepseek-code/ (configuracion centralizada)
 * y los combina con valores por defecto.
 *
 * Archivos que carga:
 * - ~/.deepseek-code/orchestrator.yaml -> configuracion general
 * - ~/.deepseek-code/capability-matrix.yaml -> matriz de capacidades
 * - ~/.deepseek-code/policy-rules.yaml -> reglas de politicas
 *
 * Si un archivo no existe, usa los valores por defecto.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import {
  OrchestratorConfig,
  CapabilityMatrix,
  PolicyRule,
  defaultOrchestratorConfig,
} from './types';

// -- Rutas -------------------------------------------------------------------

/**
 * Obtiene la ruta al directorio de configuracion de DeepSeek Code.
 * Prioriza DEEPSEEK_CODE_CONFIG_DIR si esta definido, sino usa ~/.deepseek-code/
 */
function getConfigDir(): string {
  if (process.env.DEEPSEEK_CODE_CONFIG_DIR) {
    return process.env.DEEPSEEK_CODE_CONFIG_DIR;
  }
  return path.join(require('os').homedir(), '.deepseek-code');
}

function getConfigPath(filename: string): string {
  return path.join(getConfigDir(), filename);
}

// -- Loaders -----------------------------------------------------------------

/**
 * @description Carga la configuracion del orquestador.
 *
 * Busca en orden:
 * 1. ~/.deepseek-code/orchestrator.yaml
 * 2. .deepseek-code/orchestrator.yaml (local al proyecto)
 * 3. Valores por defecto
 */
export function loadOrchestratorConfig(): OrchestratorConfig {
  const defaults = defaultOrchestratorConfig();

  // Intentar global primero
  const globalPath = getConfigPath('orchestrator.yaml');
  if (fs.existsSync(globalPath)) {
    try {
      const content = fs.readFileSync(globalPath, 'utf-8');
      const parsed = yaml.parse(content);
      return mergeConfig(defaults, parsed);
    } catch (err) {
      console.warn(`[orchestrator] Error loading global config: ${err}`);
    }
  }

  // Intentar local al proyecto
  const localPath = path.join(process.cwd(), '.deepseek-code', 'orchestrator.yaml');
  if (fs.existsSync(localPath)) {
    try {
      const content = fs.readFileSync(localPath, 'utf-8');
      const parsed = yaml.parse(content);
      return mergeConfig(defaults, parsed);
    } catch (err) {
      console.warn(`[orchestrator] Error loading local config: ${err}`);
    }
  }

  return defaults;
}

/**
 * @description Carga la capability matrix.
 *
 * Busca en orden:
 * 1. ~/.deepseek-code/capability-matrix.yaml
 * 2. .deepseek-code/capability-matrix.yaml (local al proyecto)
 * 3. null (se usa solo routing por politicas)
 */
export function loadCapabilityMatrix(): CapabilityMatrix | null {
  // Intentar global primero
  const globalPath = getConfigPath('capability-matrix.yaml');
  if (fs.existsSync(globalPath)) {
    try {
      const content = fs.readFileSync(globalPath, 'utf-8');
      return yaml.parse(content) as CapabilityMatrix;
    } catch (err) {
      console.warn(`[orchestrator] Error loading global capability matrix: ${err}`);
    }
  }

  // Intentar local al proyecto
  const localPath = path.join(process.cwd(), '.deepseek-code', 'capability-matrix.yaml');
  if (fs.existsSync(localPath)) {
    try {
      const content = fs.readFileSync(localPath, 'utf-8');
      return yaml.parse(content) as CapabilityMatrix;
    } catch (err) {
      console.warn(`[orchestrator] Error loading local capability matrix: ${err}`);
    }
  }

  return null;
}

/**
 * @description Carga las policy rules.
 * 
 * Busca en orden:
 * 1. ~/.deepseek-code/policy-rules.yaml
 * 2. .deepseek-code/policy-rules.yaml (local al proyecto)
 * 3. null (se usan solo las reglas built-in)
 */
export function loadPolicyRules(): PolicyRule[] | null {
  // Intentar global primero
  const globalPath = getConfigPath('policy-rules.yaml');
  if (fs.existsSync(globalPath)) {
    try {
      const content = fs.readFileSync(globalPath, 'utf-8');
      return yaml.parse(content) as PolicyRule[];
    } catch (err) {
      console.warn(`[orchestrator] Error loading global policy rules: ${err}`);
    }
  }

  // Intentar local al proyecto
  const localPath = path.join(process.cwd(), '.deepseek-code', 'policy-rules.yaml');
  if (fs.existsSync(localPath)) {
    try {
      const content = fs.readFileSync(localPath, 'utf-8');
      return yaml.parse(content) as PolicyRule[];
    } catch (err) {
      console.warn(`[orchestrator] Error loading local policy rules: ${err}`);
    }
  }

  return null;
}

/**
 * @description Carga toda la configuracion del orquestador de una vez.
 * Util para inicializacion en startup.
 */
export function loadOrchestratorConfigAll(): {
  config: OrchestratorConfig;
  capabilityMatrix: CapabilityMatrix | null;
  policyRules: PolicyRule[] | null;
} {
  return {
    config: loadOrchestratorConfig(),
    capabilityMatrix: loadCapabilityMatrix(),
    policyRules: loadPolicyRules(),
  };
}

// -- Helpers -----------------------------------------------------------------

function mergeConfig(defaults: OrchestratorConfig, parsed: any): OrchestratorConfig {
  return {
    features: {
      ...defaults.features,
      ...(parsed.features ?? {}),
    },
    riskThresholds: validateRiskThresholds(
      { ...defaults.riskThresholds, ...(parsed.riskThresholds ?? {}) },
      defaults.riskThresholds
    ),
    riskWeights: validateRiskWeights(
      { ...defaults.riskWeights, ...(parsed.riskWeights ?? {}) },
      defaults.riskWeights
    ),
  };
}

function validateRiskWeights(
  weights: Record<string, unknown>,
  defaults: OrchestratorConfig['riskWeights']
): OrchestratorConfig['riskWeights'] {
  const clean = { ...defaults };
  for (const [k, v] of Object.entries(weights)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      (clean as any)[k] = v;
    } else {
      console.warn(`[OrchestratorConfig] Peso invalido para '${k}': ${v}. Se usa el default.`);
    }
  }
  return clean;
}

function validateRiskThresholds(
  t: OrchestratorConfig['riskThresholds'],
  defaults: OrchestratorConfig['riskThresholds']
): OrchestratorConfig['riskThresholds'] {
  if (!(t.low < t.medium && t.medium < t.high && t.high < t.critical)) {
    console.warn('[OrchestratorConfig] Thresholds de riesgo fuera de orden — se usan los defaults.');
    return defaults;
  }
  return t;
}
