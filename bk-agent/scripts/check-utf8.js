#!/usr/bin/env node
/**
 * Verifica que los archivos sean UTF-8 valido y sin BOM.
 *
 * Uso:
 *   node scripts/check-utf8.js                 # recorre el proyecto (src, bin, tests, scripts, docs)
 *   node scripts/check-utf8.js <archivo> ...   # valida solo esos archivos (lint-staged)
 *
 * Antes este script solo miraba BOM UTF-16 (0xFF 0xFE / 0xFE 0xFF), por lo que
 * no detectaba BOM UTF-8 ni bytes invalidos: dos archivos del repo estaban en
 * UTF-8 invalido y 45 tenian BOM UTF-8 sin que nada lo impidiera.
 *
 * Salida: una linea por infraccion. Exit 1 si hay al menos una.
 */
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'legacy',
  '.git',
  'processed',
  'failed',
]);
const CHECK_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yaml', '.yml']);

function checkFile(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null; // paths raros o ilegibles: no bloquean el commit
  }

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'BOM UTF-8';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'BOM UTF-16 LE';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'BOM UTF-16 BE';

  try {
    // `fatal: true` lanza ante cualquier secuencia UTF-8 invalida.
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return 'UTF-8 invalido';
  }
  return null;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && CHECK_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

const args = process.argv.slice(2);
const files = args.length > 0 ? args : walk(path.resolve(__dirname, '..'), []);

let failed = 0;
for (const file of files) {
  const problem = checkFile(file);
  if (problem) {
    console.error(`[check-utf8] ${problem}: ${path.relative(process.cwd(), file)}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`[check-utf8] ${failed} archivo(s) con problemas de codificacion.`);
  process.exit(1);
}

if (args.length === 0) {
  console.log(`[check-utf8] OK: ${files.length} archivos en UTF-8 sin BOM.`);
}
