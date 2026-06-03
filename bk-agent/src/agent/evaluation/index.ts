/**
 * @description Punto de entrada del modulo de evaluacion de respuestas.
 * Re-exporta tipos, la clase ResponseEvaluator y el LogicEvaluator
 * para consumo externo.
 */

export { ResponseEvaluator } from './evaluator';
export { LogicEvaluator } from './logic-evaluator';
export type { EvaluationIssue, EvaluationResult, EvaluatorOptions } from './types';
