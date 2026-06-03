/**
 * @description Evalua la respuesta del LLM para detectar problemas de calidad.
 * Delega en ResponseEvaluator y extrae bloques <recap> del contenido.
 */
import { ResponseEvaluator, EvaluationIssue } from '../evaluation/index';

export interface EvaluationResult {
  cleanContent: string;
  shouldCorrect: boolean;
  issues: EvaluationIssue[];
}

/**
 * @description Evalua la respuesta del LLM para detectar problemas de calidad.
 * Delega en ResponseEvaluator y retorna si debe corregirse.
 */
export async function evaluateResponse(
  response: string,
  evaluator: ResponseEvaluator,
  agentId?: string,
): Promise<EvaluationResult> {
  try {
    const result = await evaluator.evaluate(response, { agentId });
    return {
      cleanContent: response,
      shouldCorrect: !result.approved,
      issues: result.issues ?? [],
    };
  } catch {
    // Si el evaluador falla, pasar la respuesta sin correccion
    return {
      cleanContent: response,
      shouldCorrect: false,
      issues: [],
    };
  }
}

/**
 * @description Extrae el bloque <recap>...</recap> del final de la respuesta
 * y lo separa del contenido principal.
 */
export function extractRecap(content: string): { clean: string; recap: string | null } {
  const recapMatch = content.match(/<recap>([\s\S]*?)<\/recap>\s*$/);
  if (!recapMatch) {
    return { clean: content, recap: null };
  }
  return {
    clean: content.slice(0, recapMatch.index).trim(),
    recap: recapMatch[1].trim(),
  };
}

/**
 * @description Construye un mensaje de contexto para auto-correccion
 * basado en los issues detectados por el evaluador.
 */
export function buildCorrectiveContext(issues: EvaluationIssue[]): string {
  if (issues.length === 0) return '';

  const lines: string[] = ['Problemas detectados en la respuesta anterior:'];
  for (const issue of issues) {
    lines.push(`- [${issue.severity}] ${issue.description}`);
    if (issue.detail) {
      lines.push(`  Sugerencia: ${issue.detail}`);
    }
  }

  return lines.join('\n');
}
