#!/usr/bin/env node
/**
 * Verifica que los archivos pasados como argumento sean UTF-8 (sin BOM UTF-16).
 * Detecta UTF-16 LE (0xFF 0xFE) y UTF-16 BE (0xFE 0xFF).
 */
const fs = require('fs');
const files = process.argv.slice(2);
let failed = false;

for (const file of files) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      console.error(`[check-utf8] UTF-16 LE detectado: ${file}`);
      failed = true;
    } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      console.error(`[check-utf8] UTF-16 BE detectado: ${file}`);
      failed = true;
    }
  } catch {
    // Si no se puede leer, dejar pasar (manejo de paths raros)
  }
}

if (failed) process.exit(1);
