/**
 * @description Resultado tipado de la ejecución de una tool.
 * Estandariza el contrato entre tool-executor y el loop:
 * toda herramienta devuelve éxito o fallo de forma predecible,
 * eliminando strings planos sin estructura.
 *
 * @template T Tipo del payload en caso de éxito (default: string).
 */
export type ToolResult<T = string> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: string };

export const ToolResult = {
  success<T>(data: T): ToolResult<T> {
    return { success: true, data, error: null };
  },
  fail(error: string): ToolResult<string> {
    return { success: false, data: null, error };
  },
};
