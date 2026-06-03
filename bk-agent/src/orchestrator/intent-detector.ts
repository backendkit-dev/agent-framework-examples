/**
 * @description Intent Detector — Clasifica el input del usuario en un ActionType.
 * 
 * Usa un enfoque de dos niveles:
 * 1. Keyword scoring rápido (síncrono, sin LLM)
 * 2. Clasificación semántica vía LLM cuando hay ambigüedad
 * 
 * El detector transforma lenguaje natural ambiguo ("necesito mejorar la
 * consistencia entre órdenes y pagos") en una acción formal como
 * 'design' o 'implementation'.
 */

import { ActionType, createTaskContext, TaskContext } from '../types/task-context';
import { AgentClient } from '../api/client';

// ── Keywords por acción ──────────────────────────────────────────────────────

interface IntentKeyword {
  words: string[];
  weight: number;
}

const INTENT_KEYWORDS: Record<ActionType, IntentKeyword[]> = {
  design: [
    { words: ['diseña', 'diseñar', 'diseño', 'planifica', 'planificar', 'planea'], weight: 3 },
    { words: ['arquitectura', 'arquitectónico', 'estructura'], weight: 3 },
    { words: ['diagrama', 'c4', 'adr'], weight: 3 },
    { words: ['cómo debería', 'cómo implementar', 'qué patrón'], weight: 2 },
    { words: ['trade-off', 'comparar', 'alternativa'], weight: 2 },
    { words: ['bounded context', 'contexto del dominio', 'ddd'], weight: 3 },
    { words: ['event sourcing', 'cqrs', 'saga', 'outbox'], weight: 3 },
  ],
  implementation: [
    { words: ['implementa', 'implementar', 'crea', 'crear', 'construye'], weight: 3 },
    { words: ['escribe', 'escribir', 'codifica', 'codificar'], weight: 2 },
    { words: ['endpoint', 'api', 'controlador', 'servicio'], weight: 2 },
    { words: ['componente', 'hook', 'useEffect', 'useState'], weight: 2 },
    { words: ['clase', 'interfaz', 'función', 'método'], weight: 1 },
    { words: ['agrega', 'agregar', 'añade', 'añadir'], weight: 2 },
    { words: ['configura', 'configurar'], weight: 1 },
  ],
  review: [
    { words: ['revisa', 'revisar', 'revisión', 'review'], weight: 3 },
    { words: ['analiza', 'analizar', 'análisis'], weight: 2 },
    { words: ['código existente', 'código actual'], weight: 2 },
    { words: ['encuentra problemas', 'detecta errores'], weight: 2 },
    { words: ['code review', 'pull request', 'pr'], weight: 3 },
    { words: ['retroalimentación', 'feedback'], weight: 1 },
  ],
  security_audit: [
    { words: ['audita', 'auditar', 'auditoría', 'auditoria'], weight: 3 },
    { words: ['seguridad', 'vulnerabilidad', 'owasp'], weight: 3 },
    { words: ['penetración', 'pentest', 'hacking'], weight: 3 },
    { words: ['jwt', 'token', 'autenticación', 'autenticacion'], weight: 2 },
    { words: ['cifrado', 'encriptación', 'hash', 'bcrypt'], weight: 2 },
    { words: ['xss', 'csrf', 'inyección', 'inyeccion', 'sql injection'], weight: 3 },
    { words: ['hardening', 'secrets', 'secretos'], weight: 2 },
  ],
  documentation: [
    { words: ['documenta', 'documentar', 'documentación'], weight: 3 },
    { words: ['readme', 'readme.md', 'README'], weight: 3 },
    { words: ['comentario', 'comentarios', 'jsdoc'], weight: 2 },
    { words: ['manual', 'guía', 'tutorial', 'wiki'], weight: 2 },
    { words: ['swagger', 'openapi', 'api doc'], weight: 2 },
    { words: ['changelog', 'release notes'], weight: 2 },
  ],
  refactor: [
    { words: ['refactoriza', 'refactorizar', 'refactor'], weight: 3 },
    { words: ['mejora', 'mejorar', 'optimiza', 'optimizar'], weight: 2 },
    { words: ['limpia', 'limpiar', 'clean code'], weight: 2 },
    { words: ['deuda técnica', 'technical debt'], weight: 3 },
    { words: ['simplifica', 'simplificar'], weight: 2 },
    { words: ['extrae', 'extraer', 'separar'], weight: 2 },
  ],
  bugfix: [
    { words: ['corrige', 'corregir', 'corrección', 'correccion'], weight: 3 },
    { words: ['bug', 'error', 'fallo', 'issue'], weight: 3 },
    { words: ['arregla', 'arreglar', 'fix', 'hotfix'], weight: 3 },
    { words: ['no funciona', 'está roto', 'falla'], weight: 3 },
    { words: ['excepción', 'exception', 'stack trace'], weight: 2 },
    { words: ['null pointer', 'undefined', 'crash'], weight: 2 },
  ],
  test: [
    { words: ['test', 'tests', 'testing', 'prueba', 'pruebas'], weight: 3 },
    { words: ['unitario', 'unitarios', 'unit test', 'integración', 'integration'], weight: 3 },
    { words: ['cobertura', 'coverage', 'tdd', 'bdd'], weight: 3 },
    { words: ['jest', 'vitest', 'playwright', 'cypress'], weight: 2 },
    { words: ['mock', 'stub', 'spy', 'fixture'], weight: 2 },
    { words: ['e2e', 'end to end', 'contrato', 'contract'], weight: 2 },
  ],
  research: [
    { words: ['investiga', 'investigar', 'investigación'], weight: 3 },
    { words: ['explora', 'explorar', 'averigua'], weight: 2 },
    { words: ['qué es', 'cómo funciona', 'diferencia entre'], weight: 2 },
    { words: ['comparativa', 'comparación'], weight: 2 },
    { words: ['encuentra', 'busca', 'búsqueda'], weight: 1 },
  ],
  optimize: [
    { words: ['optimiza', 'optimizar', 'optimización'], weight: 3 },
    { words: ['rendimiento', 'performance', 'lento', 'lentitud'], weight: 3 },
    { words: ['cuello de botella', 'bottleneck'], weight: 3 },
    { words: ['caché', 'cache', 'redis', 'memcached'], weight: 2 },
    { words: ['consulta lenta', 'slow query', 'índice', 'indice'], weight: 2 },
    { words: ['latencia', 'throughput', 'concurrencia'], weight: 2 },
  ],
  deploy: [
    { words: ['despliega', 'desplegar', 'deploy'], weight: 3 },
    { words: ['docker', 'kubernetes', 'k8s', 'contenedor'], weight: 2 },
    { words: ['ci/cd', 'pipeline', 'github actions'], weight: 2 },
    { words: ['infraestructura', 'terraform', 'cloud'], weight: 2 },
    { words: ['release', 'versión', 'versión'], weight: 2 },
  ],
  unknown: [],
};

// ── Intent Detector ──────────────────────────────────────────────────────────

export interface IntentDetectionResult {
  actionType: ActionType;
  confidence: number;
  scores: Record<ActionType, number>;
  method: 'keyword' | 'llm';
}

/**
 * @description Detecta el tipo de acción a partir del input del usuario.
 * 
 * Primero intenta clasificar con keywords (rápido, sin LLM).
 * Si hay ambigüedad (múltiples acciones con score similar), usa LLM.
 * 
 * @param input - Texto del usuario
 * @param client - Cliente DeepSeek (opcional, solo para fallback LLM)
 * @returns Resultado con el actionType detectado y nivel de confianza
 */
export async function detectIntent(
  input: string,
  client?: AgentClient
): Promise<IntentDetectionResult> {
  const lower = input.toLowerCase();
  const scores = computeKeywordScores(lower);

  // Encontrar la mejor acción
  const sorted = Object.entries(scores)
    .filter(([action]) => action !== 'unknown')
    .sort(([, a], [, b]) => b - a);

  const best = sorted[0];
  const second = sorted[1];

  // Si no hay señal clara
  if (!best || best[1] === 0) {
    // Intentar con LLM antes de rendirse
    if (client) {
      try {
        const llmResult = await classifyWithLLM(input, client);
        return llmResult;
      } catch {
        return { actionType: 'implementation', confidence: 0.1, scores, method: 'keyword' };
      }
    }
    return { actionType: 'implementation', confidence: 0.1, scores, method: 'keyword' };
  }

  // Si hay un ganador claro (margen >= 2 puntos)
  const margin = best[1] - (second?.[1] ?? 0);
  if (margin >= 2) {
    return {
      actionType: best[0] as ActionType,
      confidence: Math.min(1, best[1] / 15),
      scores,
      method: 'keyword',
    };
  }

  // Ambigüedad: usar LLM si está disponible
  if (client) {
    try {
      const llmResult = await classifyWithLLM(input, client);
      return llmResult;
    } catch {
      // Fallback: usar el mejor score aunque sea ambiguo
      return {
        actionType: best[0] as ActionType,
        confidence: 0.5,
        scores,
        method: 'keyword',
      };
    }
  }

  // Sin LLM: devolver el mejor con confianza baja
  return {
    actionType: best[0] as ActionType,
    confidence: 0.4,
    scores,
    method: 'keyword',
  };
}

/**
 * Clasifica el intent usando el LLM cuando hay ambigüedad.
 */
async function classifyWithLLM(
  input: string,
  client: AgentClient
): Promise<IntentDetectionResult> {
  const actions = Object.keys(INTENT_KEYWORDS)
    .filter(a => a !== 'unknown')
    .join(', ');

  const prompt = `Clasifica la siguiente solicitud en UNO de estos tipos de acción: ${actions}.

Responde ÚNICAMENTE con JSON: {"action":"<tipo>"}

Solicitud: "${input.slice(0, 500)}"`;

  const response = await client.chat(
    [{ role: 'user', content: prompt }],
    undefined,
    0.0
  );

  const content = response.content ?? '';
  const match = content.match(/"action"\s*:\s*"([\w-]+)"/);
  const actionType = (match?.[1] as ActionType) ?? 'unknown';

  // Recalcular scores con el LLM como desempate
  const scores = computeKeywordScores(input.toLowerCase());
  if (actionType !== 'unknown') {
    scores[actionType] = (scores[actionType] ?? 0) + 3; // bonus LLM
  }

  return {
    actionType,
    confidence: 0.7,
    scores,
    method: 'llm',
  };
}

/**
 * Verifica si un keyword aparece en el texto con word boundary (para palabras simples)
 * o como substring exacto (para frases con espacios).
 */
function matchesKeyword(text: string, keyword: string): boolean {
  if (!keyword.includes(' ')) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(keyword.toLowerCase());
}

/**
 * Computa scores basados en keywords para cada acción.
 * Usa word boundaries para palabras simples y coincidencia exacta para frases.
 */
function computeKeywordScores(lower: string): Record<ActionType, number> {
  const scores: Record<string, number> = {};

  for (const [action, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let total = 0;
    for (const kw of keywords) {
      for (const word of kw.words) {
        if (matchesKeyword(lower, word)) {
          total += kw.weight;
        }
      }
    }
    scores[action] = total;
  }

  return scores as Record<ActionType, number>;
}

/**
 * @description Enriquce un TaskContext con el actionType detectado.
 * Es el entry point principal para el orquestador.
 */
export async function enrichTaskWithIntent(
  task: TaskContext,
  client?: AgentClient
): Promise<TaskContext> {
  const result = await detectIntent(task.rawPrompt, client);
  return {
    ...task,
    actionType: result.actionType,
    status: 'classified',
    updatedAt: new Date(),
  };
}
