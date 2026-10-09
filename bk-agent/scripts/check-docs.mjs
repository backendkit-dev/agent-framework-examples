#!/usr/bin/env node
/**
 * Verifica que los comandos slash documentados existan realmente en el CLI.
 *
 * Motivo: la auditoria encontro que el README y AGENT.md documentaban comandos y
 * herramientas que el binario no tenia (por ejemplo `execute_command` o los
 * handlers `nestjs.*`). Este check compara los comandos citados en los documentos
 * con los registrados en el codigo (framework + bin/cli.ts) y falla si sobran.
 *
 * Uso: node scripts/check-docs.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = [
    'README.md',
    'AGENT.md',
    'documentation/00-index.md',
    'documentation/14-architecture.md',
];
/**
 * Documentos mantenidos: ademas de los comandos, se comprueba que sus enlaces
 * relativos resuelvan **con el casing exacto** (en Windows un `Readme.Md`
 * trackeado como `README.md` funciona, pero rompe en Linux y en el paquete npm).
 */
const LINK_DOCS = [
    ...DOCS,
    'legacy/README.md',
    'docs/adr/ADR-002-bk-agent-cli-delgado.md',
    'docs/auditorias/remediacion-v1.0.0.md',
    'docs/auditorias/informe-auditoria-codigo-bk-agent-v1.0.0.md',
];
/** Tokens que parecen comandos pero son rutas del sistema. */
const PATH_DENYLIST = new Set(['dev', 'home', 'tmp', 'etc', 'usr', 'var', 'mnt', 'opt', 'root', 'api', 'bin']);

const require = createRequire(import.meta.url);

/** Comandos registrados en el codigo. */
function registeredCommands() {
    const names = new Set();

    // 1) Comandos del framework
    try {
        const core = require('@backendkit-labs/agent-core');
        const registry = new core.SlashCommandRegistry();
        core.registerBuiltinCommands(registry);
        for (const cmd of registry.getAll()) names.add(cmd.name);
    } catch (err) {
        console.error(`[check-docs] no se pudo cargar el framework: ${err.message}`);
        process.exit(1);
    }

    // 2) Comandos propios del CLI (registros literales en bin/cli.ts)
    const cli = fs.readFileSync(path.join(ROOT, 'bin', 'cli.ts'), 'utf8');
    for (const m of cli.matchAll(/cmdRegistry\.register\(\s*'(\/[^']+)'/g)) names.add(m[1]);

    return names;
}

/** Comandos citados en un documento. */
function documentedCommands(file) {
    const text = fs.readFileSync(file, 'utf8');
    const found = new Map(); // comando -> linea

    const addCandidate = (token, lineNumber) => {
        if (!/^\/[a-z][a-z0-9.-]*$/.test(token)) return;
        const head = token.slice(1).split('.')[0];
        if (PATH_DENYLIST.has(head)) return;
        if (!found.has(token)) found.set(token, lineNumber);
    };

    text.split('\n').forEach((line, i) => {
        // `comando` entre backticks
        for (const m of line.matchAll(/`(\/[a-z][a-zA-Z0-9.-]*)`/g)) addCandidate(m[1], i + 1);
        // primera columna de una tabla: | /comando · | ...
        const table = line.match(/^\|\s*`?(\/[a-z][a-zA-Z0-9.-]*)`?/);
        if (table) addCandidate(table[1], i + 1);
    });

    return found;
}

const registered = registeredCommands();
let problems = 0;
let checked = 0;

for (const rel of DOCS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const documented = documentedCommands(file);
    checked += documented.size;
    for (const [command, line] of documented) {
        if (!registered.has(command)) {
            console.error(`[check-docs] ${rel}:${line} documenta "${command}", que no esta registrado en el codigo`);
            problems++;
        }
    }
}

/** Existe con el casing exacto? (readdir distingue mayusculas/minusculas). */
function existsExact(absolute) {
    try {
        return fs.readdirSync(path.dirname(absolute)).includes(path.basename(absolute));
    } catch {
        return false;
    }
}

let links = 0;
for (const rel of LINK_DOCS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const dir = path.dirname(file);
    const text = fs.readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
            const target = m[1];
            if (/^(https?:|mailto:|#)/.test(target)) continue;
            const clean = decodeURIComponent(target.split('#')[0]);
            if (!clean) continue;
            links++;
            const abs = path.resolve(dir, clean);
            if (!existsExact(abs)) {
                console.error(`[check-docs] ${rel}:${i + 1} enlace roto (o casing distinto): ${target}`);
                problems++;
            }
        }
    });
}

if (problems > 0) {
    console.error(`[check-docs] ${problems} problema(s): comandos inexistentes o enlaces rotos.`);
    process.exit(1);
}

console.log(
    `[check-docs] OK: ${checked} comandos documentados, todos registrados (${registered.size} disponibles); ${links} enlaces locales validos.`,
);
