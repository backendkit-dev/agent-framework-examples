/**
 * Sanitiza un string para usarlo como nombre de archivo (multiplataforma).
 *
 * - Convierte a minúsculas
 * - Reemplaza espacios por guiones
 * - Elimina caracteres inválidos en Windows: < > : " / \ | ? *
 * - Normaliza caracteres acentuados a su versión sin tilde (ó → o, í → i, etc.)
 * - Preserva puntos para versiones (ej: "2.1") pero limpia adyacentes a guiones
 * - Colapsa guiones múltiples en uno solo
 * - Recorta guiones al inicio y final
 * - Si el resultado está vacío, retorna "untitled"
 *
 * @param input - String a sanitizar
 * @returns Nombre de archivo seguro
 */
export function sanitizeFilename(input: string): string {
  if (!input || input.trim().length === 0) return 'untitled';

  // Normalización Unicode: descompone caracteres acentuados (NFD)
  // y elimina los diacríticos (tildes, diéresis, etc.)
  // Luego aplica las reglas de sanitización estándar
  const sanitized = input
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')         // Elimina acentos: ó→o, í→i, é→e, etc.
    .replace(/\s+/g, '-')                     // Espacios → guiones
    .replace(/[<>:"/\\|?*,;!¡¿?@#$%^&()+=[\]{}~`]/g, '')  // Caracteres especiales inválidos (preserva puntos)
    .replace(/\.(?=-)|(?<=-)\./g, '')         // Limpia puntos adyacentes a guiones: "3.-probar" → "3-probar"
    .replace(/-+/g, '-')                      // Colapsa guiones múltiples
    .replace(/^-+|-+$/g, '');                 // Recorta guiones al inicio/final

  return sanitized.length > 0 ? sanitized : 'untitled';
}
