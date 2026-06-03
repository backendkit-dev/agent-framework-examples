/**
 * @description Tipos publicos del modulo de evaluacion de respuestas.
 * Utilizados por ResponseEvaluator y por el AgentLoop para auto-correccion.
 */

export interface EvaluationIssue {
  type: 'quality' | 'hallucination' | 'coherence' | 'missing' | 'logic';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  detail?: string;
}

export interface EvaluationResult {
  /** Puntuacion 0-100 */
  score: number;
  /** Lista completa de issues detectados */
  issues: EvaluationIssue[];
  /** Issues de tipo hallucination (extraidos por conveniencia) */
  hallucinations: EvaluationIssue[];
  /** Issues de tipo logic (errores de logica/patrones) */
  logicIssues: EvaluationIssue[];
  /** True si el resultado es aceptable sin correccion */
  approved: boolean;
  /** Tiempo total de evaluacion en ms */
  elapsedMs: number;
}

export interface EvaluatorOptions {
  /** Ruta del proyecto actual para verificar existencia de archivos */
  projectRoot?: string;
  /** Historial de la conversacion para verificar coherencia */
  history?: Message[];
  /** Umbral minimo para considerar aprobado (0-100, default: 70) */
  approvalThreshold?: number;
  /** ID del agente que genero la respuesta (para reportes al Reflection Engine) */
  agentId?: string;
}

// Import necesario para EvaluatorOptions.history
import { Message } from '../../api/types';
