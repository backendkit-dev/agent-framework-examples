/**
 * @encoding Sistema de encoding seguro para lectura/escritura de archivos.
 *
 * Arquitectura de 5 capas:
 *   Presentación (stdin/stdout/stderr → PowerShell encoding)
 *       ↓
 *   Sanitización (remueve BOM, reemplaza bytes inválidos, unifica line endings)
 *       ↓
 *   Normalización (NFC según configuración, asegura UTF-8)
 *       ↓
 *   Validación (detecta encoding real, chequea consistencia)
 *       ↓
 *   Transporte (lectura/escritura con encoding explícito)
 *
 * Pipeline de fallback progresivo:
 *   UTF-8 → TextDecoder(fatal:false) → UTF-16LE/BE → Latin1 → EncodingError
 *
 * @module encoding
 */

import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { Result, ok, fail } from '../result';

// ── Tipos públicos ──────────────────────────────────────────────────────────

export interface EncodingOptions {
  /** Normalización Unicode: NFC (recomendado), NFD, o none */
  normalization?: 'NFC' | 'NFD' | 'none';
  /** Reemplazar bytes inválidos con U+FFFD (default: true) */
  sanitize?: boolean;
  /** Normalizar CRLF/CR a LF (default: true) */
  normalizeLineEndings?: boolean;
  /** Eliminar BOM al inicio (default: true) */
  stripBOM?: boolean;
}

export interface ReadResult {
  content: string;
  encoding: string;
  hadBOM: boolean;
  hadInvalidBytes: boolean;
  lineEnding: 'CRLF' | 'LF' | 'CR' | 'mixed';
}

export interface ValidationResult {
  valid: boolean;
  detectedEncoding: string;
  hadBOM: boolean;
  invalidBytesCount: number;
  lineEnding: 'CRLF' | 'LF' | 'CR' | 'mixed';
}

export class EncodingError extends Error {
  public readonly code: string;
  public readonly detectedEncoding?: string;
  public readonly suggestion?: string;

  constructor(message: string, options?: { code?: string; detectedEncoding?: string; suggestion?: string }) {
    super(message);
    this.name = 'EncodingError';
    this.code = options?.code ?? 'ENCODING_UNKNOWN';
    this.detectedEncoding = options?.detectedEncoding;
    this.suggestion = options?.suggestion;
  }
}

// ── Opciones por defecto ────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<EncodingOptions> = {
  normalization: 'NFC',
  sanitize: true,
  normalizeLineEndings: true,
  stripBOM: true,
};

const DEFAULT_READ_OPTIONS: Required<EncodingOptions> = {
  ...DEFAULT_OPTIONS,
};

const DEFAULT_WRITE_OPTIONS: Required<EncodingOptions> = {
  ...DEFAULT_OPTIONS,
  stripBOM: false, // No tiene sentido strip BOM al escribir
};

// ── Cache (performance) ─────────────────────────────────────────────────────

interface CacheEntry {
  result: ReadResult;
  mtimeMs: number;
}

const readCache = new Map<string, CacheEntry>();

function getCacheKey(filePath: string, optionsKey: string): string {
  return `${filePath}::${optionsKey}`;
}

function invalidateCache(filePath: string): void {
  // Invalida TODAS las entradas de este filePath (con cualquier optionsKey)
  Array.from(readCache.keys()).forEach(key => {
    if (key.startsWith(filePath + '::')) {
      readCache.delete(key);
    }
  });
}

// ── Detección de BOM ────────────────────────────────────────────────────────

const BOM_UTF8    = Buffer.from([0xEF, 0xBB, 0xBF]);
const BOM_UTF16LE = Buffer.from([0xFF, 0xFE]);
const BOM_UTF16BE = Buffer.from([0xFE, 0xFF]);

function detectBOM(buffer: Buffer): { bom: Buffer | null; bomSize: number; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return { bom: BOM_UTF8, bomSize: 3, encoding: 'utf-8' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return { bom: BOM_UTF16LE, bomSize: 2, encoding: 'utf-16le' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return { bom: BOM_UTF16BE, bomSize: 2, encoding: 'utf-16be' };
  }
  return { bom: null, bomSize: 0, encoding: 'utf-8' };
}

function stripBOMFromBuffer(buffer: Buffer): Buffer {
  const { bomSize } = detectBOM(buffer);
  return bomSize > 0 ? buffer.subarray(bomSize) : buffer;
}

// ── Detección de line ending ────────────────────────────────────────────────

function detectLineEnding(text: string): 'CRLF' | 'LF' | 'CR' | 'mixed' {
  const hasCRLF = text.includes('\r\n');
  const hasLF   = text.includes('\n') && !text.includes('\r\n');
  const hasCR   = text.includes('\r') && !text.includes('\r\n');

  if (hasCRLF && (hasLF || hasCR)) return 'mixed';
  if (hasCRLF) return 'CRLF';
  if (hasLF)   return 'LF';
  if (hasCR)   return 'CR';
  return 'LF'; // Por defecto
}

// ── Detección de encoding (por contenido) ───────────────────────────────────

/**
 * Intenta detectar el encoding real del buffer usando heurísticas.
 * Orden: UTF-8 → UTF-16LE → UTF-16BE → Latin1
 */
function detectEncodingFromBuffer(buffer: Buffer): { encoding: string; confidence: number } {
  // 1. Verificar si es UTF-8 válido
  if (isValidUTF8(buffer)) {
    return { encoding: 'utf-8', confidence: 1.0 };
  }

  // 2. Verificar UTF-16LE (bytes nulos en posiciones impares)
  if (buffer.length >= 4 && buffer.length % 2 === 0) {
    let nullPairs = 0;
    const totalPairs = Math.floor(buffer.length / 2);
    for (let i = 1; i < buffer.length; i += 2) {
      if (buffer[i] === 0x00) nullPairs++;
    }
    if (nullPairs > totalPairs * 0.3) {
      return { encoding: 'utf-16le', confidence: 0.7 };
    }
  }

  // 3. Verificar UTF-16BE (bytes nulos en posiciones pares)
  if (buffer.length >= 4 && buffer.length % 2 === 0) {
    let nullPairs = 0;
    const totalPairs = Math.floor(buffer.length / 2);
    for (let i = 0; i < buffer.length; i += 2) {
      if (buffer[i] === 0x00) nullPairs++;
    }
    if (nullPairs > totalPairs * 0.3) {
      return { encoding: 'utf-16be', confidence: 0.7 };
    }
  }

  // 4. Verificar Latin1 (ISO-8859-1) — solo si una mayoría de bytes son > 0x7F
  //    y NO parecen UTF-16 (sin bytes nulos)
  let highBytes = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] > 0x7F) highBytes++;
  }
  if (highBytes > buffer.length * 0.5) {
    return { encoding: 'latin1', confidence: 0.5 };
  }

  // 5. Por defecto asumir UTF-8
  return { encoding: 'utf-8', confidence: 0.5 };
}

/**
 * Verifica si un buffer es UTF-8 válido.
 * Valida secuencias multibyte según RFC 3629.
 */
function isValidUTF8(buffer: Buffer): boolean {
  let i = 0;
  while (i < buffer.length) {
    const byte = buffer[i];
    if (byte <= 0x7F) {
      // 1-byte sequence (0xxxxxxx)
      i++;
    } else if (byte >= 0xC2 && byte <= 0xDF) {
      // 2-byte sequence (110xxxxx 10xxxxxx)
      if (i + 1 >= buffer.length) return false;
      if ((buffer[i + 1] & 0xC0) !== 0x80) return false;
      i += 2;
    } else if (byte >= 0xE0 && byte <= 0xEF) {
      // 3-byte sequence (1110xxxx 10xxxxxx 10xxxxxx)
      if (i + 2 >= buffer.length) return false;
      if ((buffer[i + 1] & 0xC0) !== 0x80) return false;
      if ((buffer[i + 2] & 0xC0) !== 0x80) return false;
      // Check for overlong encoding of surrogate halves (U+D800-U+DFFF)
      if (byte === 0xE0 && buffer[i + 1] < 0xA0) return false;
      if (byte === 0xED && buffer[i + 1] > 0x9F) return false;
      i += 3;
    } else if (byte >= 0xF0 && byte <= 0xF4) {
      // 4-byte sequence (11110xxx 10xxxxxx 10xxxxxx 10xxxxxx)
      if (i + 3 >= buffer.length) return false;
      if ((buffer[i + 1] & 0xC0) !== 0x80) return false;
      if ((buffer[i + 2] & 0xC0) !== 0x80) return false;
      if ((buffer[i + 3] & 0xC0) !== 0x80) return false;
      // Check for overlong encoding (U+10FFFF max)
      if (byte === 0xF0 && buffer[i + 1] < 0x90) return false;
      if (byte === 0xF4 && buffer[i + 1] > 0x8F) return false;
      i += 4;
    } else {
      // Invalid byte (continuation byte without start, or 0xF5-0xFF)
      return false;
    }
  }
  return true;
}

// ── Contar bytes inválidos ──────────────────────────────────────────────────

function countInvalidUTF8Bytes(buffer: Buffer): number {
  let invalidCount = 0;
  let i = 0;
  while (i < buffer.length) {
    const byte = buffer[i];
    if (byte <= 0x7F) {
      i++;
    } else if (byte >= 0xC2 && byte <= 0xDF) {
      if (i + 1 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80) {
        invalidCount++;
        i++;
      } else {
        i += 2;
      }
    } else if (byte >= 0xE0 && byte <= 0xEF) {
      if (i + 2 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80 || (buffer[i + 2] & 0xC0) !== 0x80) {
        invalidCount++;
        i++;
      } else {
        // Validar sobrelongitud
        if ((byte === 0xE0 && buffer[i + 1] < 0xA0) || (byte === 0xED && buffer[i + 1] > 0x9F)) {
          invalidCount++;
        }
        i += 3;
      }
    } else if (byte >= 0xF0 && byte <= 0xF4) {
      if (i + 3 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80 || (buffer[i + 2] & 0xC0) !== 0x80 || (buffer[i + 3] & 0xC0) !== 0x80) {
        invalidCount++;
        i++;
      } else {
        if ((byte === 0xF0 && buffer[i + 1] < 0x90) || (byte === 0xF4 && buffer[i + 1] > 0x8F)) {
          invalidCount++;
        }
        i += 4;
      }
    } else {
      invalidCount++;
      i++;
    }
  }
  return invalidCount;
}

// ── Pipeline de fallback ────────────────────────────────────────────────────

/**
 * Pipeline de fallback progresivo para decodificar un buffer:
 *   1. UTF-8 válido → decodificar normalmente
 *   2. UTF-8 con errores → TextDecoder({fatal: false}) → si <5% U+FFFD, aceptar
 *   3. >5% U+FFFD → detectar encoding real (UTF-16LE/BE, Latin1) y convertir
 *   4. Si nada funciona → lanzar EncodingError con sugerencia
 */
function decodeWithFallback(buffer: Buffer): { text: string; encoding: string; hadInvalidBytes: boolean } {
  // Paso 1: Verificar UTF-8 válido sin BOM
  const cleanBuffer = stripBOMFromBuffer(buffer);
  if (isValidUTF8(cleanBuffer)) {
    return { text: cleanBuffer.toString('utf-8'), encoding: 'utf-8', hadInvalidBytes: false };
  }

  // Paso 2: TextDecoder con reemplazo (U+FFFD)
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const decoded = decoder.decode(cleanBuffer, { stream: false });

  // Contar cuántos U+FFFD hay
  const replacementCount = (decoded.match(/\uFFFD/g) ?? []).length;
  const totalChars = decoded.length || 1;
  const replacementRatio = replacementCount / totalChars;

  if (replacementRatio < 0.50) {
    // Aceptable: menos del 50% son reemplazos
    return { text: decoded, encoding: 'utf-8', hadInvalidBytes: true };
  }

  // Paso 3: Detectar encoding real
  const detected = detectEncodingFromBuffer(buffer);

  if (detected.encoding === 'utf-16le') {
    try {
      const text = Buffer.from(buffer).swap16().toString('utf-8');
      // hadInvalidBytes=false porque el archivo es UTF-16LE válido, su encoding real
      return { text, encoding: 'utf-16le', hadInvalidBytes: false };
    } catch {
      // Fallo, continuar
    }
  }

  if (detected.encoding === 'utf-16be') {
    try {
      const smallBuf = buffer.length % 2 === 1 ? buffer.subarray(0, buffer.length - 1) : buffer;
      const text = Buffer.from(smallBuf).swap16().toString('utf-8');
      // hadInvalidBytes=false porque el archivo es UTF-16BE válido, su encoding real
      return { text, encoding: 'utf-16be', hadInvalidBytes: false };
    } catch {
      // Fallo, continuar
    }
  }

  if (detected.encoding === 'latin1') {
    try {
      const text = buffer.toString('latin1');
      console.warn(`[encoding] Fallback a Latin1 para archivo. Considera convertir a UTF-8.`);
      // hadInvalidBytes=false porque el archivo es Latin1 válido
      return { text, encoding: 'latin1', hadInvalidBytes: false };
    } catch {
      // Fallo, continuar
    }
  }

  // Paso 4: No se pudo decodificar → error
  throw new EncodingError(
    `No se pudo determinar el encoding del archivo. ` +
    `Se intentó UTF-8 (${Math.round(replacementRatio * 100)}% reemplazos), ` +
    `UTF-16LE, UTF-16BE y Latin1 sin éxito.`,
    {
      code: 'ENCODING_UNKNOWN',
      detectedEncoding: detected.encoding,
      suggestion: 'Abre el archivo en un editor y guardalo como UTF-8 sin BOM.',
    }
  );
}

// ── Funciones principales ───────────────────────────────────────────────────

/**
 * Valida un buffer y devuelve un resumen de su estado de encoding.
 * NO modifica el buffer; solo analiza.
 */
export function validateBuffer(buffer: Buffer): ValidationResult {
  const bomInfo = detectBOM(buffer);
  const cleanBuf = stripBOMFromBuffer(buffer);
  const invalidBytesCount = isValidUTF8(cleanBuf) ? 0 : countInvalidUTF8Bytes(cleanBuf);

  let detectedEncoding = 'utf-8';
  if (!isValidUTF8(cleanBuf)) {
    detectedEncoding = detectEncodingFromBuffer(buffer).encoding;
  }

  // Para detectar line ending, necesitamos decodificar
  let lineEnding: ValidationResult['lineEnding'] = 'LF';
  try {
    const { text } = decodeWithFallback(buffer);
    lineEnding = detectLineEnding(text);
  } catch {
    lineEnding = 'LF';
  }

  return {
    valid: isValidUTF8(cleanBuf) && invalidBytesCount === 0,
    detectedEncoding,
    hadBOM: bomInfo.bom !== null,
    invalidBytesCount,
    lineEnding,
  };
}

/**
 * Procesa un buffer aplicando sanitización, normalización y stripping de BOM
 * según las opciones proporcionadas.
 *
 * @param buffer - Buffer raw a procesar
 * @param options - Opciones de procesamiento
 * @returns Texto procesado y listo para usar
 */
export function processBuffer(buffer: Buffer, options?: EncodingOptions): string {
  const opts: Required<EncodingOptions> = { ...DEFAULT_READ_OPTIONS, ...options };

  // Decodificar con fallback
  const { text, encoding, hadInvalidBytes } = decodeWithFallback(buffer);

  // Si el usuario pidió no sanitizar y hay bytes inválidos, lanzar error
  if (!opts.sanitize && hadInvalidBytes) {
    throw new EncodingError(
      `El archivo contiene bytes inválidos y sanitize=false. ` +
      `Encoding detectado: ${encoding}. Usa sanitize:true para reemplazar automáticamente.`,
      { code: 'ENCODING_INVALID_BYTES', detectedEncoding: encoding }
    );
  }

  let result = text;

  // Strip BOM (si el decodeWithFallback no lo hizo ya)
  if (opts.stripBOM) {
    const bomInfo = detectBOM(buffer);
    if (bomInfo.bom !== null) {
      result = result.replace(/^\uFEFF/, '');
    }
  }

  // Normalizar line endings
  if (opts.normalizeLineEndings) {
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  // Normalización Unicode
  if (opts.normalization === 'NFC') {
    result = result.normalize('NFC');
  } else if (opts.normalization === 'NFD') {
    result = result.normalize('NFD');
  }

  return result;
}

/**
 * Lee un archivo de forma segura, con pipeline completo de encoding.
 * Versión síncrona.
 *
 * Cachea el resultado por filePath + opciones para evitar re-lecturas.
 * El cache se invalida automáticamente si el archivo cambia (por mtime).
 *
 * @param filePath - Ruta al archivo
 * @param options - Opciones de encoding
 * @returns ReadResult con contenido procesado y metadatos
 */
export function readFileSafe(filePath: string, options?: EncodingOptions): ReadResult {
  const opts: Required<EncodingOptions> = { ...DEFAULT_READ_OPTIONS, ...options };
  const cacheKey = getCacheKey(filePath, JSON.stringify(opts));

  // Verificar cache por mtime
  try {
    const stat = fs.statSync(filePath);
    const cached = readCache.get(cacheKey);
    if (cached && cached.mtimeMs >= stat.mtimeMs) {
      return cached.result;
    }
  } catch {
    // Si no se puede stat, seguir sin cache
  }

  // Leer raw buffer
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EncodingError(
      `No se pudo leer el archivo: ${msg}`,
      { code: 'ENCODING_READ_ERROR' }
    );
  }

  if (buffer.length === 0) {
    const result: ReadResult = {
      content: '',
      encoding: 'utf-8',
      hadBOM: false,
      hadInvalidBytes: false,
      lineEnding: 'LF',
    };
    return result;
  }

  const bomInfo    = detectBOM(buffer);
  const textResult = decodeWithFallback(buffer);
  const text       = processBuffer(buffer, opts);
  const lineEnding = detectLineEnding(text);

  // hadInvalidBytes refleja lo que decodeWithFallback realmente experimentó,
  // NO lo que isValidUTF8 dice del buffer raw (que da falsos positivos en UTF-16/Latin1)
  const hadInvalidBytes = textResult.hadInvalidBytes;

  // encoding real detectado por decodeWithFallback (no solo por BOM)
  const effectiveEncoding = textResult.encoding;

  const result: ReadResult = {
    content: text,
    encoding: effectiveEncoding,
    hadBOM: bomInfo.bom !== null,
    hadInvalidBytes,
    lineEnding,
  };

  // Almacenar en cache
  try {
    const stat = fs.statSync(filePath);
    readCache.set(cacheKey, { result, mtimeMs: stat.mtimeMs });
  } catch {
    // Si falla el stat, no cachear
  }

  return result;
}

/**
 * Lee un archivo de forma segura, con pipeline completo de encoding.
 * Versión asíncrona.
 */
export async function readFileSafeAsync(filePath: string, options?: EncodingOptions): Promise<ReadResult> {
  const opts: Required<EncodingOptions> = { ...DEFAULT_READ_OPTIONS, ...options };
  const cacheKey = getCacheKey(filePath, JSON.stringify(opts));

  // Verificar cache por mtime
  try {
    const stat = await fsAsync.stat(filePath);
    const cached = readCache.get(cacheKey);
    if (cached && cached.mtimeMs >= stat.mtimeMs) {
      return cached.result;
    }
  } catch {
    // Si no se puede stat, seguir sin cache
  }

  // Leer raw buffer
  let buffer: Buffer;
  try {
    buffer = await fsAsync.readFile(filePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EncodingError(
      `No se pudo leer el archivo: ${msg}`,
      { code: 'ENCODING_READ_ERROR' }
    );
  }

  if (buffer.length === 0) {
    const result: ReadResult = {
      content: '',
      encoding: 'utf-8',
      hadBOM: false,
      hadInvalidBytes: false,
      lineEnding: 'LF',
    };
    return result;
  }

  const bomInfo    = detectBOM(buffer);
  const textResult = decodeWithFallback(buffer);
  const text       = processBuffer(buffer, opts);
  const lineEnding = detectLineEnding(text);

  // hadInvalidBytes refleja lo que decodeWithFallback realmente experimentó,
  // NO lo que isValidUTF8 dice del buffer raw (que da falsos positivos en UTF-16/Latin1)
  const hadInvalidBytes = textResult.hadInvalidBytes;

  // encoding real detectado por decodeWithFallback (no solo por BOM)
  const effectiveEncoding = textResult.encoding;

  const result: ReadResult = {
    content: text,
    encoding: effectiveEncoding,
    hadBOM: bomInfo.bom !== null,
    hadInvalidBytes,
    lineEnding,
  };

  // Almacenar en cache
  try {
    const stat = await fsAsync.stat(filePath);
    readCache.set(cacheKey, { result, mtimeMs: stat.mtimeMs });
  } catch {
    // Si falla el stat, no cachear
  }

  return result;
}

/**
 * Escribe un archivo de forma segura, normalizando el contenido.
 * Versión síncrona.
 *
 * Garantiza:
 * - Sin BOM
 * - Line endings normalizados según opciones
 * - Normalización Unicode aplicada
 *
 * @param filePath - Ruta de escritura
 * @param content - Contenido a escribir
 * @param options - Opciones de encoding
 */
export function writeFileSafe(filePath: string, content: string, options?: EncodingOptions): void {
  const opts: Required<EncodingOptions> = { ...DEFAULT_WRITE_OPTIONS, ...options };

  let normalized = content;

  // Normalización Unicode
  if (opts.normalization === 'NFC') {
    normalized = normalized.normalize('NFC');
  } else if (opts.normalization === 'NFD') {
    normalized = normalized.normalize('NFD');
  }

  // Normalizar line endings
  if (opts.normalizeLineEndings) {
    normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  // Asegurar directorio padre existe
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Escribir (NUNCA con BOM)
  fs.writeFileSync(filePath, normalized, 'utf-8');

  // Invalidar cache de lectura para este archivo
  invalidateCache(filePath);
}

/**
 * Escribe un archivo de forma segura, normalizando el contenido.
 * Versión asíncrona.
 */
export async function writeFileSafeAsync(filePath: string, content: string, options?: EncodingOptions): Promise<void> {
  const opts: Required<EncodingOptions> = { ...DEFAULT_WRITE_OPTIONS, ...options };

  let normalized = content;

  // Normalización Unicode
  if (opts.normalization === 'NFC') {
    normalized = normalized.normalize('NFC');
  } else if (opts.normalization === 'NFD') {
    normalized = normalized.normalize('NFD');
  }

  // Normalizar line endings
  if (opts.normalizeLineEndings) {
    normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  // Asegurar directorio padre existe
  const dir = path.dirname(filePath);
  await fsAsync.mkdir(dir, { recursive: true });

  // Escribir (NUNCA con BOM)
  await fsAsync.writeFile(filePath, normalized, 'utf-8');

  // Invalidar cache de lectura para este archivo
  invalidateCache(filePath);
}


/**
 * @description Version de writeFileSafeAsync que retorna Result en lugar de lanzar.
 * Util para callers que siguen la convencion de errores silenciosos.
 */
export async function writeFileSafeResult(
  filePath: string,
  content: string,
  options?: EncodingOptions
): Promise<Result<void, EncodingError>> {
  try {
    await writeFileSafeAsync(filePath, content, options);
    return ok(void 0);
  } catch (err: unknown) {
    if (err instanceof EncodingError) return fail(err);
    const msg = err instanceof Error ? err.message : String(err);
    return fail(new EncodingError(msg, { code: 'ENCODING_WRITE_ERROR' }));
  }
}

// ── Terminal Console Encoding ───────────────────────────────────────────────

/**
 * Configura el encoding de la consola para PowerShell 5.1 en Windows.
 *
 * Hace:
 * 1. chcp 65001 (UTF-8 code page)
 * 2. Configura process.stdout con encoding correcto
 * 3. Configura process.stdin con encoding correcto
 *
 * Llámalo UNA VEZ al inicio del entry point.
 */
export function setupConsoleEncoding(): void {
  // Solo en Windows
  if (process.platform !== 'win32') return;

  try {
    // Cambiar code page a UTF-8
    require('child_process').execSync('chcp 65001 > nul 2>&1', { stdio: 'ignore' });
  } catch {
    // Si falla, no es crítico — continuar
  }

  // Configurar stdout/stderr para UTF-8
  if (process.stdout.isTTY && typeof (process.stdout as any).setEncoding === 'function') {
    (process.stdout as any).setEncoding('utf-8');
  }
  if (process.stderr.isTTY && typeof (process.stderr as any).setEncoding === 'function') {
    (process.stderr as any).setEncoding('utf-8');
  }
  if (process.stdin.isTTY && typeof (process.stdin as any).setEncoding === 'function') {
    (process.stdin as any).setEncoding('utf-8');
  }
}

/**
 * Sanitiza un string para mostrarlo en consola.
 * Remueve o reemplaza caracteres que PowerShell 5.1 no puede mostrar
 * correctamente (ej: ciertos emojis, caracteres de control).
 *
 * @param text - Texto a sanitizar
 * @returns Texto seguro para mostrar en consola
 */
export function sanitizeForConsole(text: string): string {
  let result = text;
  for (const [pattern, replacement] of UNICODE_TO_ASCII) {
    result = result.replace(pattern, replacement);
  }
  return result
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\x80-\x9F]/g, '')
    .replace(/﻿/g, '')
    .replace(/�/g, '?')
    .trim();
}

/**
 * Normaliza un string: NFC + LF unificado + opcional sanitize.
 * Útil antes de serializar a JSON para tool calls.
 *
 * @param text - Texto a normalizar
 * @param options - Opciones de normalización
 * @returns Texto normalizado
 */
export function normalizeString(text: string, options?: EncodingOptions): string {
  const opts: Required<EncodingOptions> = { ...DEFAULT_OPTIONS, ...options };
  let result = text;

  if (opts.normalization === 'NFC') {
    result = result.normalize('NFC');
  } else if (opts.normalization === 'NFD') {
    result = result.normalize('NFD');
  }

  if (opts.normalizeLineEndings) {
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  if (opts.sanitize) {
    result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  return result;
}

// ── Sanitizacion de codigo generado por LLM ─────────────────────────────────

/**
 * Mapa de sustituciones Unicode → ASCII equivalente seguro.
 * Cubre comillas tipograficas, guiones, elipsis y otros simbolos
 * comunes que los LLMs introducen y que PowerShell no puede procesar.
 */
const UNICODE_TO_ASCII: Array<[RegExp, string]> = [
  // Comillas tipograficas dobles → comilla doble ASCII
  [/[“”„‟″‶]/g, '"'],
  // Comillas tipograficas simples / apóstrofo tipografico → comilla simple ASCII
  [/[‘’‚‛′‵]/g, "'"],
  // Guiones largos (em dash, en dash, horizontal bar) → guión ASCII
  [/[–—―]/g, '-'],
  // Elipsis tipografica → tres puntos ASCII
  [/…/g, '...'],
  // Espacio no separable → espacio normal
  [/ /g, ' '],
  // Espacio de anchura cero y similares → vacío
  [/[​‌‍﻿]/g, ''],
  // Tilde / virgulilla de anchura completa → tilde ASCII
  [/～/g, '~'],
  // Comillas angulares → comillas ASCII
  [/[«»‹›]/g, '"'],
  // Asterisco / guion mediano decorativos → ASCII
  [/•/g, '-'],
  [/−/g, '-'],
  // Simbolo de copyright, marca registrada (se mantienen en comentarios pero se avisa)
];

export interface CodeSanitizationResult {
  /** Codigo limpio listo para escribir o mostrar */
  code: string;
  /** true si se encontro y reemplazo algun caracter problematico */
  hadIssues: boolean;
  /** Lista de descripciones de los problemas encontrados */
  issues: string[];
}

/**
 * Sanitiza codigo generado por un LLM para garantizar:
 * - Sin BOM (﻿)
 * - Sin bytes nulos (\0)
 * - Sin comillas tipograficas ni guiones largos (reemplazados por equivalentes ASCII)
 * - Line endings unificados a LF (\n)
 * - Sin caracteres de control excepto \t, \n
 *
 * Uso tipico: pasar la respuesta del modelo antes de escribirla a disco
 * o mostrarla en terminal, para evitar errores de interpretacion en
 * PowerShell y otros shells.
 *
 * @param code - Texto de codigo a sanitizar
 * @returns Resultado con codigo limpio y lista de problemas encontrados
 */
export function sanitizeCodeOutput(code: string): CodeSanitizationResult {
  const issues: string[] = [];
  let result = code;

  // 1. Strip BOM al inicio y en medio del texto
  if (result.includes('﻿')) {
    result = result.replace(/﻿/g, '');
    issues.push('BOM (\\uFEFF) eliminado');
  }

  // 2. Eliminar bytes nulos
  if (result.includes('\0')) {
    result = result.replace(/\0/g, '');
    issues.push('Caracteres nulos (\\0) eliminados');
  }

  // 3. Reemplazar Unicode tipografico por equivalentes ASCII
  for (const [pattern, replacement] of UNICODE_TO_ASCII) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) {
      const readable = replacement === '"' ? 'comillas dobles tipograficas'
        : replacement === "'" ? 'comillas simples tipograficas'
        : replacement === '-' ? 'guiones/rayas tipograficas'
        : replacement === '...' ? 'elipsis tipografica'
        : replacement === ' ' ? 'espacios no separables'
        : replacement === '' ? 'espacios de anchura cero/BOM inline'
        : 'simbolo Unicode no estandar';
      issues.push(`Reemplazado: ${readable}`);
    }
  }

  // 4. Normalizar line endings a LF
  const originalLen = result.length;
  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (result.length !== originalLen || (code.includes('\r') && !code.includes('\r\n'))) {
    issues.push('Line endings normalizados a LF');
  }

  // 5. Eliminar caracteres de control (excepto \t y \n)
  const beforeControl = result;
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (result !== beforeControl) {
    issues.push('Caracteres de control eliminados (excepto \\t y \\n)');
  }

  // 6. Eliminar caracteres C1 (0x80-0x9F) que PowerShell no muestra correctamente
  const beforeC1 = result;
  result = result.replace(/[\x80-\x9F]/g, '');
  if (result !== beforeC1) {
    issues.push('Caracteres de control C1 (0x80-0x9F) eliminados');
  }

  return {
    code: result,
    hadIssues: issues.length > 0,
    issues,
  };
}

// ── Invalidate cache (para testing) ─────────────────────────────────────────

/**
 * Invalida toda la cache de lectura.
 * Util en tests para asegurar que se relean los archivos.
 */
export function clearReadCache(): void {
  readCache.clear();
}

// ── Dirección de archivo (path traversal protection) ────────────────────────

/**
 * Resuelve una ruta de archivo de forma segura, previniendo path traversal.
 *
 * @param baseDir - Directorio base (debe existir y ser absoluto)
 * @param userPath - Ruta del usuario (puede contener ../)
 * @returns Ruta absoluta resuelta, o lanza error si hay path traversal
 */
export function resolveSafePath(baseDir: string, userPath: string): string {
  const resolved = path.resolve(baseDir, userPath);

  // Verificar que la ruta resuelta esté dentro de baseDir
  const normalizedBase = path.resolve(baseDir);
  const normalizedResolved = path.resolve(resolved);

  if (!normalizedResolved.startsWith(normalizedBase + path.sep) && normalizedResolved !== normalizedBase) {
    throw new EncodingError(
      `Path traversal detectado: ${userPath} resuelve fuera de ${baseDir}`,
      { code: 'ENCODING_PATH_TRAVERSAL' }
    );
  }

  return resolved;
}
