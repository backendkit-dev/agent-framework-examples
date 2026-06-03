/**
 * @description Evaluador de respuestas del agente.
 * Analiza calidad, coherencia y detecta alucinaciones combinando
 * heuristicas rapidas (primer pase) con evaluacion LLM (segundo pase).
 *
 * El evaluador permite al sistema auto-corregirse: si detecta
 * inventos (APIs que no existen, archivos que no estan, metodos
 * que nunca se definieron), inyecta contexto correctivo antes
 * de que el usuario vea el resultado.
 *
 * AHORA TAMBIEN: detecta patrones de error logicos reutilizables
 * (includes con falsos positivos, catch vacio, logica invertida,
 * switch sin default, hooks huerfanos, etc.) usando LogicEvaluator.
 */

import { AgentClient } from '../../api/client';
import { Message } from '../../api/types';
import { EvaluationIssue, EvaluationResult, EvaluatorOptions } from './types';
import {
  checkFileReferences,
  checkImports,
  checkInventedApis,
  checkCoherence,
  checkCodeQuality,
  severityPenalty,
} from './heuristics';
import { LogicEvaluator } from './logic-evaluator';

export class ResponseEvaluator {
  private client: AgentClient;
  private approvalThreshold: number;
  private logicEvaluator: LogicEvaluator;
  private reflectionEngine: any = null;

  constructor(client: AgentClient, options?: { approvalThreshold?: number }) {
    this.client = client;
    this.approvalThreshold = options?.approvalThreshold ?? 70;
    this.logicEvaluator = new LogicEvaluator();
  }

  /**
   * @description Conecta el evaluador con el Reflection Engine.
   * Guarda la referencia para reportar incidentes (alucinaciones, errores logicos)
   * al sistema de auto-aprendizaje.
   */
  connectReflectionEngine(engine: any): void {
    this.reflectionEngine = engine;
  }

  /**
   * @description Evalua una respuesta del agente en busca de problemas de
   * calidad, coherencia, alucinaciones y errores logicos.
   *
   * Realiza tres pases:
   * 1. Heuristico: verifica referencias a archivos, APIs conocidas, imports
   * 2. Logico: detecta patrones de error reutilizables (nuevo)
   * 3. LLM: evalua coherencia y detecta invenciones mas sutiles
   *
   * @returns Resultado estructurado con score, issues y decision de aprobacion
   */
  async evaluate(response: string, options?: EvaluatorOptions): Promise<EvaluationResult> {
    const startMs = Date.now();
    const issues: EvaluationIssue[] = [];

    // --- Pase 1: Heuristicas ---

    // 1a. Verificar referencias a archivos del proyecto
    if (options?.projectRoot) {
      const fileIssues = checkFileReferences(response, options.projectRoot);
      issues.push(...fileIssues);
    }

    // 1b. Verificar imports/packages inventados
    const importIssues = checkImports(response);
    issues.push(...importIssues);

    // 1c. Verificar APIs inventadas en bloques de codigo
    const apiIssues = checkInventedApis(response);
    issues.push(...apiIssues);

    // 1d. Verificar coherencia con el historial
    if (options?.history) {
      const coherenceIssues = checkCoherence(response, options.history);
      issues.push(...coherenceIssues);
    }

    // 1e. Verificar bloques de codigo incompletos o sintacticamente rotos
    const codeIssues = checkCodeQuality(response);
    issues.push(...codeIssues);

    // --- Pase 2: Evaluacion Logica (NUEVO) ---
    // Detecta patrones de error reutilizables en el codigo generado
    const logicIssues = this.logicEvaluator.evaluate(response);
    issues.push(...logicIssues);

    // --- Si hay issues criticos/altos -> Pase 3: LLM ---

    const criticalOrHigh = issues.filter(
      i => i.severity === 'critical' || i.severity === 'high'
    );

    if (criticalOrHigh.length > 0) {
      const llmIssues = await this.llmEvaluate(response, options?.history);
      issues.push(...llmIssues);
    }

    // --- Calculo de score ---

    const dedupedIssues = this.deduplicateIssues(issues);
    const hallucinations = dedupedIssues.filter(i => i.type === 'hallucination');
    const detectedLogicIssues = dedupedIssues.filter(i => i.type === 'logic');
    const score = this.computeScore(dedupedIssues);

    // Reportar alucinaciones al Reflection Engine si esta conectado
    if (hallucinations.length > 0 && this.reflectionEngine) {
      const first = hallucinations[0];
      this.reflectionEngine.reportIncident({
        domain: 'agent',
        failureType: 'agent_hallucination',
        severity: 'Media',
        dimension: 'confiabilidad',
        gate: 'evaluator',
        agenteResponsable: options?.agentId ?? 'unknown',
        hallazgo: first.description,
        recomendacion: `Revisar la respuesta del agente: ${first.detail ?? first.description}`,
        archivos: [],
        fecha: new Date().toISOString(),
      });
    }

    const approved = score >= this.approvalThreshold;

    return {
      score,
      issues: dedupedIssues,
      hallucinations,
      logicIssues: detectedLogicIssues,
      approved,
      elapsedMs: Date.now() - startMs,
    };
  }

  // --- Pase 2: Evaluacion LLM ---

  private async llmEvaluate(response: string, history?: Message[]): Promise<EvaluationIssue[]> {
    const issues: EvaluationIssue[] = [];

    try {
      const recentContext = history
        ?.slice(-4)
        .filter(m => typeof m.content === 'string' && m.content)
        .map(m => `[${m.role}]: ${String(m.content).slice(0, 300)}`)
        .join('\n') ?? '';

      const evaluationPrompt = `Eres un evaluador de respuestas de IA. Tu tarea es detectar ALUCINACIONES e ISSUES DE CALIDAD en la siguiente respuesta.

Una alucinacion es: una API que no existe, un metodo inventado, un paquete npm falso, una funcionalidad que el sistema no tiene, o una referencia a codigo/archivos que no se han definido en esta conversacion.

Tambien detecta ERRORES LOGICOS como:
- includes() que matchea su propia negacion (ej: "no hay problema".includes("problema") = true)
- Catch vacio que traga errores silenciosamente
- Switch/match sin caso default
- Scores/weights en direccion incorrecta
- Escritura de archivos sin patron atomico (tmp+rename)

Responde UNICAMENTE con un JSON array. Si no hay issues, devuelve [].

Formato exacto:
[{"type":"hallucination|quality|coherence|logic","severity":"critical|high|medium|low","description":"...","detail":"..."}]

Contexto de la conversacion (ultimos mensajes):
${recentContext || '(sin historial)'}

Respuesta a evaluar:
${response.slice(0, 4000)}`;

      const llmResponse = await this.client.chat(
        [{ role: 'user', content: evaluationPrompt }],
        undefined,
        0.0
      );

      const content = llmResponse.content ?? '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as EvaluationIssue[];
          issues.push(...parsed);
        } catch {
          // Si falla el parseo, ignorar
        }
      }
    } catch {
      // Si falla el LLM, no bloquear
    }

    return issues;
  }

  // --- Calculo de score ---

  private deduplicateIssues(issues: EvaluationIssue[]): EvaluationIssue[] {
    const seen = new Set<string>();
    return issues.filter(i => {
      const key = i.description.slice(0, 80).toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private computeScore(issues: EvaluationIssue[]): number {
    const validSeverities = new Set(['critical', 'high', 'medium', 'low']);
    let score = 100;

    for (const issue of issues) {
      if (!validSeverities.has(issue.severity)) continue;
      score -= severityPenalty(issue.severity);
    }

    return Math.max(0, Math.min(100, score));
  }
}
