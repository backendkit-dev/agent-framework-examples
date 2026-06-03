/**
 * @description Detecta cambios de direccion en el input del usuario
 * (nuevos dominios, action types, correcciones explicitas).
 * Permite al orquestador decidir si debe re-ejecutar el pipeline.
 */
import { TaskContext } from '../../types/task-context';

export interface DirectionChange {
  changed: boolean;
  reason?: string;
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  architecture: ['arquitectura', 'architecture', 'diseno', 'design', 'estructura', 'componentes'],
  backend: ['backend', 'api', 'servicio', 'service', 'endpoint', 'rest', 'graphql'],
  frontend: ['frontend', 'ui', 'interfaz', 'componente', 'react', 'vue', 'angular'],
  security: ['seguridad', 'security', 'auth', 'autenticacion', 'autorizacion', 'jwt', 'oauth'],
  database: ['base de datos', 'database', 'db', 'sql', 'schema', 'query', 'consulta'],
  testing: ['test', 'testing', 'prueba', 'jest', 'vitest', 'coverage'],
  devops: ['devops', 'deploy', 'ci/cd', 'docker', 'kubernetes', 'infra'],
  documentation: ['documentacion', 'documentation', 'docs', 'readme'],
};

const ACTION_TYPE_KEYWORDS: Record<string, string[]> = {
  design: ['disenar', 'planificar', 'arquitectura', 'diagrama'],
  implementation: ['implementar', 'crear', 'agregar', 'add', 'nuevo'],
  review: ['revisar', 'review', 'auditar'],
  test: ['test', 'probar', 'coverage'],
  bugfix: ['bug', 'error', 'falla', 'corregir', 'fix'],
  refactor: ['refactor', 'mejorar', 'optimizar'],
};

const CORRECTION_PATTERNS = [
  /te\s+equivocaste/, /esta[aá]s?\s+mal/, /incorrecto/, /no\s+funciona/,
  /esta[aá]\s+roto/, /no\s+es\s+correcto/, /alucinaste/, /inventaste/,
  /ese\s+m[eé]todo\s+no\s+existe/, /esa\s+funci[oó]n\s+no\s+existe/,
  /eso\s+no\s+existe/, /that'?s?\s+(wrong|incorrect)/, /you('re|\s+are)\s+wrong/,
];

/**
 * @description Detecta si hubo un cambio de direccion significativo en el input del usuario.
 * Compara dominios y actionType entre el input actual y el contexto previo.
 * Si hay cambio, es necesario re-ejecutar el orquestador.
 */
export function detectDirectionChange(
  currentInput: string,
  previousTask: TaskContext | undefined,
): DirectionChange {
  if (!previousTask) {
    return { changed: false };
  }

  const lower = currentInput.toLowerCase();

  const newDomains: string[] = [];
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) {
      newDomains.push(domain);
    }
  }

  const oldDomains = previousTask.domains || [];
  const hasNewDomains = newDomains.some(d => !oldDomains.includes(d));

  let newActionType: string | undefined;
  for (const [action, keywords] of Object.entries(ACTION_TYPE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) {
      newActionType = action;
      break;
    }
  }

  const hasNewActionType = newActionType && newActionType !== previousTask.actionType;

  const hasTestIntent = lower.includes('test') || lower.includes('prueba');
  const wasNotTest = previousTask.actionType !== 'test';

  if (hasTestIntent && wasNotTest) {
    return { changed: true, reason: 'Nuevo intento detectado: testing' };
  }

  if (hasNewDomains) {
    return {
      changed: true,
      reason: `Nuevos dominios detectados: ${newDomains.filter(d => !oldDomains.includes(d)).join(', ')}`,
    };
  }

  if (hasNewActionType) {
    return { changed: true, reason: `Nuevo tipo de accion: ${newActionType}` };
  }

  return { changed: false };
}

/**
 * @description Detecta si el input del usuario es una correccion explicita
 * (ej: "te equivocaste", "eso no existe").
 * @returns El input truncado a 300 caracteres si es correccion, null si no.
 */
export function detectUserCorrection(input: string): string | null {
  const lower = input.toLowerCase();
  return CORRECTION_PATTERNS.some(p => p.test(lower)) ? input.slice(0, 300) : null;
}
