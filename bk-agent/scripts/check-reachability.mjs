#!/usr/bin/env node
/**
 * Regla de arquitectura (ADR-002): ningun archivo de `src/` puede quedar
 * inalcanzable desde los entrypoints publicados.
 *
 * Entrypoints: `bin/cli.ts` (el CLI) y `src/index.ts` (superficie de libreria).
 * Si este check falla, hay codigo que no se ejecuta ni se testea: o se cablea,
 * o se archiva en `legacy/` (ver legacy/README.md).
 *
 * Uso: node scripts/check-reachability.mjs [--list]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = ['bin/cli.ts', 'src/index.ts'];

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, base + '.ts', path.join(base, 'index.ts')]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* no existe: seguir */
    }
  }
  return null;
}

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function reachableFrom(entries) {
  const seen = new Set();
  const queue = entries.map((e) => path.resolve(ROOT, e));
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source)) !== null) {
      const target = resolveImport(file, match[1] || match[2]);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const reachable = reachableFrom(ENTRIES);
const allSrc = walk(path.join(ROOT, 'src'));
const unreachable = allSrc.filter((file) => !reachable.has(file));

if (unreachable.length === 0) {
  console.log(`[check-reachability] OK: los ${allSrc.length} archivos de src/ son alcanzables.`);
  process.exit(0);
}

console.error(`[check-reachability] ${unreachable.length} archivo(s) de src/ no son alcanzables desde ${ENTRIES.join(' ni ')}:`);
for (const file of unreachable) {
  console.error('  - ' + path.relative(ROOT, file).replace(/\\/g, '/'));
}
console.error('\nCablealos, o archiva en legacy/ (ADR-002).');
process.exit(1);
