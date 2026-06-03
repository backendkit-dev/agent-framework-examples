/**
 * @string-utils Tests unitarios para sanitizeFilename
 *
 * Tests para:
 * - Conversión a minúsculas
 * - Espacios → guiones
 * - Caracteres inválidos Windows eliminados
 * - Guiones múltiples colapsados
 * - Guiones iniciales/finales recortados
 * - Fallback a "untitled" para input vacío o solo inválido
 * - Caracteres acentuados (Unicode) normalizados
 */

import { sanitizeFilename } from '../src/shared/utils/string-utils';

describe('sanitizeFilename', () => {
  // ── Casos normales ────────────────────────────────────────────────────────

  test('convierte a minúsculas', () => {
    expect(sanitizeFilename('HELLO WORLD')).toBe('hello-world');
  });

  test('reemplaza espacios por guiones', () => {
    expect(sanitizeFilename('mi archivo')).toBe('mi-archivo');
  });

  test('reemplaza múltiples espacios por un solo guión', () => {
    expect(sanitizeFilename('mi   archivo')).toBe('mi-archivo');
  });

  // ── Caracteres inválidos ──────────────────────────────────────────────────

  test('elimina caracteres inválidos de Windows: < > : " / \\ | ? *', () => {
    const input = 'a<b>c:d"e/f\\g|h?i*j';
    expect(sanitizeFilename(input)).toBe('abcdefghij');
  });

  test('elimina caracteres inválidos mezclados con espacios', () => {
    expect(sanitizeFilename('file: name?')).toBe('file-name');
  });

  // ── Guiones ───────────────────────────────────────────────────────────────

  test('colapsa guiones múltiples en uno solo', () => {
    expect(sanitizeFilename('a---b')).toBe('a-b');
  });

  test('colapsa guiones múltiples con espacios', () => {
    expect(sanitizeFilename('a - - - b')).toBe('a-b');
  });

  test('recorta guiones al inicio', () => {
    expect(sanitizeFilename('-hola')).toBe('hola');
  });

  test('recorta guiones al final', () => {
    expect(sanitizeFilename('hola-')).toBe('hola');
  });

  test('recorta guiones al inicio y final', () => {
    expect(sanitizeFilename('-hola-')).toBe('hola');
  });

  test('maneja solo guiones', () => {
    expect(sanitizeFilename('---')).toBe('untitled');
  });

  // ── Casos borde ───────────────────────────────────────────────────────────

  test('string vacío retorna untitled', () => {
    expect(sanitizeFilename('')).toBe('untitled');
  });

  test('string solo con espacios retorna untitled', () => {
    expect(sanitizeFilename('   ')).toBe('untitled');
  });

  test('solo caracteres inválidos retorna untitled', () => {
    expect(sanitizeFilename('<>:"/\\|?*')).toBe('untitled');
  });

  test('solo caracteres inválidos con espacios retorna untitled', () => {
    expect(sanitizeFilename('  <>  ')).toBe('untitled');
  });

  test('null-like inputs no rompen (string "null")', () => {
    expect(sanitizeFilename('null')).toBe('null');
  });

  test('undefined-like inputs no rompen (string "undefined")', () => {
    expect(sanitizeFilename('undefined')).toBe('undefined');
  });

  // ── Casos reales ──────────────────────────────────────────────────────────

  test('nombre de sprint con caracteres especiales', () => {
    expect(sanitizeFilename('checkpoint-<nombre>-crear-checkp')).toBe('checkpoint-nombre-crear-checkp');
  });

  test('nombre de sprint con espacios y puntos', () => {
    expect(sanitizeFilename('Sprint 2.1: Implementar Auth')).toBe('sprint-2.1-implementar-auth');
  });

  // ── Caracteres acentuados (Unicode) ───────────────────────────────────────

  test('elimina acentos del español (ó, í, é, á, ú, ñ)', () => {
    expect(sanitizeFilename('integración completa')).toBe('integracion-completa');
  });

  test('elimina acentos del sprint que causó el bug', () => {
    expect(sanitizeFilename('3. Probar la integración completa')).toBe('3-probar-la-integracion-completa');
  });

  test('mezcla de acentos y caracteres especiales', () => {
    expect(sanitizeFilename('Éste es un ñoño: sprint')).toBe('este-es-un-nono-sprint');
  });

  test('diéresis y otros caracteres Unicode', () => {
    expect(sanitizeFilename('über cool naïve résumé')).toBe('uber-cool-naive-resume');
  });
});
