/**
 * @description Result<T, E> — discriminated union para operaciones fallibles.
 * Reemplaza la convencion de retornar null/{} con un tipo que preserva
 * informacion del error. Los modulos de carga nunca lanzan excepciones;
 * devuelven Result.ok o Result.fail.
 *
 * @example
 * ```ts
 * function load(id: string): Result<Data, LoadError> {
 *   try { return ok(doLoad(id)); }
 *   catch (e) { return fail(new LoadError(e)); }
 * }
 *
 * const result = load('x');
 * if (isOk(result)) use(result.value);
 * const val = unwrapOr(result, fallback);
 * ```
 */

export type Result<T, E> =
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * @description Crea un Result exitoso.
 */
export function ok<T, E>(value: T): Result<T, E> {
  return { success: true, value };
}

/**
 * @description Crea un Result fallido.
 */
export function fail<T, E>(error: E): Result<T, E> {
  return { success: false, error };
}

/**
 * @description Type guard: comprueba si el Result es exitoso.
 */
export function isOk<T, E>(result: Result<T, E>): result is { success: true; value: T } {
  return result.success === true;
}

/**
 * @description Type guard: comprueba si el Result es fallido.
 */
export function isFail<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return result.success === false;
}

/**
 * @description Extrae el valor o retorna un default si es fallido.
 * Util para callers que quieren ignorar el error (equivalente a `x ?? default`).
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return isOk(result) ? result.value : defaultValue;
}

/**
 * @description Transforma el valor interno si es Ok, preservando el error.
 */
export function map<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return isOk(result) ? ok(fn(result.value)) : result;
}

/**
 * @description Transforma el error interno si es Fail, preservando el valor.
 */
export function mapError<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return isFail(result) ? fail(fn(result.error)) : result;
}

/**
 * @description Encadena operaciones que retornan Result.
 */
export function flatMap<T, E, U>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return isOk(result) ? fn(result.value) : result;
}

/**
 * @description Ejecuta una funcion segura que no debe lanzar.
 * Captura cualquier excepcion y la convierte en Result.fail.
 */
export function fromThrowable<T, E>(fn: () => T, errorFactory: (err: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (err: unknown) {
    return fail(errorFactory(err));
  }
}

/**
 * @description Ejecuta una funcion async segura que no debe lanzar.
 * Captura cualquier excepcion y la convierte en Result.fail.
 */
export async function fromPromise<T, E>(
  promise: Promise<T>,
  errorFactory: (err: unknown) => E,
): Promise<Result<T, E>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (err: unknown) {
    return fail(errorFactory(err));
  }
}

/**
 * @description Combina multiples Results en uno solo.
 * Si todos son Ok, retorna un array con los valores.
 * Si alguno es Fail, retorna el primer error.
 */
export function combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (isFail(r)) return r;
    values.push(r.value);
  }
  return ok(values);
}

/**
 * @description Particiona un array de Results en [exitosos, fallidos].
 */
export function partition<T, E>(results: Result<T, E>[]): [T[], E[]] {
  const okValues: T[] = [];
  const errValues: E[] = [];
  for (const r of results) {
    if (isOk(r)) {
      okValues.push(r.value);
    } else {
      errValues.push(r.error);
    }
  }
  return [okValues, errValues];
}
