/**
 * @encoding Tests unitarios para el sistema de encoding.
 * Tests para: validateBuffer, processBuffer, normalizeString,
 * sanitizeForConsole, readFileSafe, writeFileSafe, clearReadCache.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  validateBuffer,
  processBuffer,
  normalizeString,
  sanitizeForConsole,
  readFileSafe,
  writeFileSafe,
  clearReadCache,
  EncodingError,
} from '../../src/shared/utils/encoding';

const BOM_UTF8 = Buffer.from([0xEF, 0xBB, 0xBF]);
const TMP_DIR  = path.join(os.tmpdir(), 'encoding-test-' + Date.now());

beforeAll(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  clearReadCache();
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

// ── validateBuffer ──────────────────────────────────────────────────────────

describe('validateBuffer', () => {
  test('detecta UTF-8 válido sin BOM', () => {
    const buf = Buffer.from('Hello World', 'utf-8');
    const result = validateBuffer(buf);
    expect(result.valid).toBe(true);
    expect(result.hadBOM).toBe(false);
    expect(result.invalidBytesCount).toBe(0);
    expect(result.detectedEncoding).toBe('utf-8');
  });

  test('detecta BOM al inicio', () => {
    const buf = Buffer.concat([BOM_UTF8, Buffer.from('Hola', 'utf-8')]);
    const result = validateBuffer(buf);
    expect(result.hadBOM).toBe(true);
    expect(result.valid).toBe(true); // BOM se quita antes de validar
  });

  test('detecta bytes inválidos', () => {
    const buf = Buffer.from([0x48, 0x65, 0xFF, 0x6C, 0x6C, 0x6F]); // 'He\xFFllo'
    const result = validateBuffer(buf);
    expect(result.valid).toBe(false);
    expect(result.invalidBytesCount).toBeGreaterThan(0);
  });

  test('detecta line endings CRLF', () => {
    const buf = Buffer.from('line1\r\nline2\r\nline3', 'utf-8');
    const result = validateBuffer(buf);
    expect(result.lineEnding).toBe('CRLF');
  });

  test('detecta line endings LF', () => {
    const buf = Buffer.from('line1\nline2\nline3', 'utf-8');
    const result = validateBuffer(buf);
    expect(result.lineEnding).toBe('LF');
  });

  test('buffer vacío es válido', () => {
    const buf = Buffer.alloc(0);
    const result = validateBuffer(buf);
    expect(result.valid).toBe(true);
    expect(result.hadBOM).toBe(false);
  });
});

// ── processBuffer ───────────────────────────────────────────────────────────

describe('processBuffer', () => {
  test('elimina BOM', () => {
    const buf = Buffer.concat([BOM_UTF8, Buffer.from('Hola', 'utf-8')]);
    const result = processBuffer(buf, { stripBOM: true });
    expect(result).toBe('Hola');
    expect(result.charCodeAt(0)).not.toBe(0xFEFF);
  });

  test('reemplaza bytes inválidos con U+FFFD', () => {
    // Byte 0x80 es continuation byte standalone -> inválido en UTF-8 -> TextDecoder produce U+FFFD
    const buf = Buffer.from([0x48, 0x80, 0x6C, 0x6C, 0x6F]);
    const result = processBuffer(buf, { sanitize: true });
    expect(result).toContain('\uFFFD');
  });

  test('lanza error si sanitize=false y hay bytes inválidos', () => {
    const buf = Buffer.from([0x48, 0xFF, 0x6C]);
    expect(() => processBuffer(buf, { sanitize: false })).toThrow(EncodingError);
  });

  test('normaliza CRLF a LF', () => {
    const buf = Buffer.from('line1\r\nline2\r\nline3', 'utf-8');
    const result = processBuffer(buf, { normalizeLineEndings: true });
    expect(result).toBe('line1\nline2\nline3');
    expect(result.includes('\r\n')).toBe(false);
  });

  test('normaliza CR a LF', () => {
    const buf = Buffer.from('line1\rline2\rline3', 'utf-8');
    const result = processBuffer(buf, { normalizeLineEndings: true });
    expect(result).toBe('line1\nline2\nline3');
  });

  test('normaliza Unicode a NFC', () => {
    // 'é' en NFD es 'e' + combining acute accent (U+00E9 vs U+0065 U+0301)
    const nfd = 'e\u0301'; // é en NFD
    const buf = Buffer.from(nfd, 'utf-8');
    const result = processBuffer(buf, { normalization: 'NFC' });
    expect(result).toBe('\u00E9'); // é en NFC
    expect(result.normalize('NFC')).toBe(result);
  });

  test('buffer vacío devuelve string vacío', () => {
    const buf = Buffer.alloc(0);
    const result = processBuffer(buf);
    expect(result).toBe('');
  });
});

// ── readFileSafe ────────────────────────────────────────────────────────────

describe('readFileSafe', () => {
  test('lee archivo UTF-8 válido (round-trip)', () => {
    const filePath = path.join(TMP_DIR, 'utf8-valid.txt');
    const original = 'Hola Mundo ñññ áéíóú 😊';
    fs.writeFileSync(filePath, original, 'utf-8');

    const result = readFileSafe(filePath);
    expect(result.content).toBe(original);
    expect(result.hadBOM).toBe(false);
    expect(result.hadInvalidBytes).toBe(false);
    expect(result.encoding).toBe('utf-8');
  });

  test('lee archivo con BOM', () => {
    const filePath = path.join(TMP_DIR, 'with-bom.txt');
    const content = 'Hola con BOM';
    fs.writeFileSync(filePath, '\uFEFF' + content, 'utf-8');

    const result = readFileSafe(filePath);
    expect(result.content).toBe(content); // BOM removido
    expect(result.hadBOM).toBe(true);
  });

  test('repara archivo corrupto (bytes inválidos)', () => {
    const filePath = path.join(TMP_DIR, 'corrupt.txt');
    const buf = Buffer.from([0x48, 0x65, 0xFF, 0x6C, 0x6C, 0x6F]); // 'He?llo'
    fs.writeFileSync(filePath, buf);

    const result = readFileSafe(filePath, { sanitize: true });
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.hadInvalidBytes).toBe(true);
  });

  test('lanza error si el archivo no existe', () => {
    expect(() => readFileSafe('/no/existe/file.txt')).toThrow();
  });

  test('archivo vacío devuelve contenido vacío', () => {
    const filePath = path.join(TMP_DIR, 'empty.txt');
    fs.writeFileSync(filePath, '', 'utf-8');

    const result = readFileSafe(filePath);
    expect(result.content).toBe('');
    expect(result.hadBOM).toBe(false);
    expect(result.hadInvalidBytes).toBe(false);
  });

  test('usa cache y no relee si mtime no cambió', () => {
    const filePath = path.join(TMP_DIR, 'cache-test.txt');
    fs.writeFileSync(filePath, 'original', 'utf-8');

    const first = readFileSafe(filePath);
    expect(first.content).toBe('original');

    // Sin modificar mtime, debe servir cache
    const second = readFileSafe(filePath);
    expect(second.content).toBe('original');
  });
});

// ── writeFileSafe ───────────────────────────────────────────────────────────

describe('writeFileSafe', () => {
  test('escribe sin BOM', () => {
    const filePath = path.join(TMP_DIR, 'no-bom.txt');
    writeFileSafe(filePath, 'Hola');

    const buf = fs.readFileSync(filePath);
    expect(buf[0]).not.toBe(0xEF);
    expect(buf[1]).not.toBe(0xBB);
    expect(buf[2]).not.toBe(0xBF);
  });

  test('usa line endings LF', () => {
    const filePath = path.join(TMP_DIR, 'lf-ending.txt');
    writeFileSafe(filePath, 'line1\nline2', { normalizeLineEndings: true });
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('line1\nline2');
  });

  test('crea directorios padre automáticamente', () => {
    const filePath = path.join(TMP_DIR, 'sub', 'deep', 'nested.txt');
    writeFileSafe(filePath, 'test');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('invalida cache de lectura', () => {
    const filePath = path.join(TMP_DIR, 'invalidate-cache.txt');
    writeFileSafe(filePath, 'primera version');

    const first = readFileSafe(filePath);
    expect(first.content).toBe('primera version');

    writeFileSafe(filePath, 'segunda version');
    const second = readFileSafe(filePath);
    expect(second.content).toBe('segunda version');
  });
});

// ── normalizeString ─────────────────────────────────────────────────────────

describe('normalizeString', () => {
  test('normaliza a NFC', () => {
    const nfd = 'e\u0301'; // é en NFD
    const result = normalizeString(nfd, { normalization: 'NFC' });
    expect(result).toBe('\u00E9');
  });

  test('unifica CRLF y CR a LF', () => {
    const input = 'a\r\nb\rc';
    const result = normalizeString(input, { normalizeLineEndings: true });
    expect(result).toBe('a\nb\nc');
  });

  test('remueve caracteres de control', () => {
    const input = 'a\x00b\x01c';
    const result = normalizeString(input, { sanitize: true });
    expect(result).toBe('abc');
  });
});

// ── sanitizeForConsole ──────────────────────────────────────────────────────

describe('sanitizeForConsole', () => {
  test('remueve caracteres de control (excepto \\n, \\r, \\t)', () => {
    const input = 'a\x00b\x01c\nd\r\te';
    const result = sanitizeForConsole(input);
    expect(result).toBe('abc\nd\r\te');
  });

  test('reemplaza U+FFFD por ?', () => {
    const result = sanitizeForConsole('Hola\uFFFDmundo');
    expect(result).toBe('Hola?mundo');
  });

  test('remueve BOM en medio del texto', () => {
    const result = sanitizeForConsole('Hola\uFEFFmundo');
    expect(result).toBe('Holamundo');
  });

  test('texto vacío no falla', () => {
    expect(sanitizeForConsole('')).toBe('');
  });
});
