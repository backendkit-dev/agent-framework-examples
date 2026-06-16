#!/usr/bin/env node
/**
 * start-all.mjs — arranca el stack completo en orden correcto
 *
 * Orden: agentes → orchestrator (HTTP :3500) → gateway (:3400)
 * Cada paso espera el health-check antes de continuar.
 *
 * Uso:
 *   node start-all.mjs            # build + start
 *   node start-all.mjs --no-build # skip build (ya compilado)
 */

import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NO_BUILD  = process.argv.includes('--no-build');

// ── Paths ──────────────────────────────────────────────────────────────────────

const EXAMPLES_DIR   = __dirname;
const BK_ROOT        = resolve(EXAMPLES_DIR, '../backendkit-agents');
const ORCH_PKG       = resolve(BK_ROOT, 'packages/orchestrator-mcp-agent');
const ORCH_SERVER    = resolve(ORCH_PKG, 'dist/server.js');
const MCP_AGENTS_DIR = resolve(EXAMPLES_DIR, 'workflow.mcp-agents');
const GATEWAY_DIR    = resolve(EXAMPLES_DIR, 'orchestrator-gateway');

// ── Helpers ────────────────────────────────────────────────────────────────────

const colors = {
    cyan:   s => `\x1b[36m${s}\x1b[0m`,
    green:  s => `\x1b[32m${s}\x1b[0m`,
    yellow: s => `\x1b[33m${s}\x1b[0m`,
    red:    s => `\x1b[31m${s}\x1b[0m`,
    gray:   s => `\x1b[90m${s}\x1b[0m`,
    bold:   s => `\x1b[1m${s}\x1b[0m`,
};

function log(msg)  { process.stdout.write(`${colors.cyan('[>]')} ${msg}\n`); }
function ok(msg)   { process.stdout.write(`    ${colors.green('✓')} ${msg}\n`); }
function fail(msg) { process.stdout.write(`    ${colors.red('✗')} ${msg}\n`); }
function info(msg) { process.stdout.write(`    ${colors.gray(msg)}\n`); }

function parseEnvFile(filePath) {
    if (!existsSync(filePath)) return {};
    return Object.fromEntries(
        readFileSync(filePath, 'utf-8')
            .split('\n')
            .filter(l => /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(l))
            .map(l => {
                const [k, ...rest] = l.split('=');
                return [k.trim(), rest.join('=').trim().replace(/^["']|["']$/g, '')];
            }),
    );
}

async function waitForHealth(url, label, timeoutMs = 30_000) {
    process.stdout.write(`    Waiting for ${label} `);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
            if (r.status < 500) {
                process.stdout.write(` ${colors.green('ready!')}\n`);
                return true;
            }
        } catch { /* not up yet */ }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write(` ${colors.red('TIMEOUT')}\n`);
    return false;
}

function build(label, cwd) {
    log(`Building ${label}...`);
    execSync('npm run build', { cwd, stdio: 'inherit' });
    ok(`${label} built`);
}

const procs = [];

function startProc(label, args, cwd, env = {}) {
    info(`Starting ${label}...`);
    const p = spawn('node', args, {
        cwd,
        env:   { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Prefix cada línea de output con el label
    const prefix = colors.gray(`[${label}] `);
    const pipe = (stream) =>
        stream.on('data', d => d.toString().split('\n').filter(Boolean)
            .forEach(l => process.stdout.write(`${prefix}${l}\n`)));
    pipe(p.stdout);
    pipe(p.stderr);
    p.on('exit', code => {
        if (code !== 0 && code !== null)
            process.stdout.write(`${prefix}${colors.red(`exited with code ${code}`)}\n`);
    });
    procs.push(p);
    return p;
}

function stopAll() {
    process.stdout.write(`\n${colors.yellow('Stopping all processes...')}\n`);
    for (const p of procs) {
        if (!p.killed) p.kill('SIGTERM');
    }
}

process.on('SIGINT',  stopAll);
process.on('SIGTERM', stopAll);

// ── Main ───────────────────────────────────────────────────────────────────────

const orchEnv     = parseEnvFile(resolve(MCP_AGENTS_DIR, '.env'));
const gatewayEnv  = parseEnvFile(resolve(GATEWAY_DIR, '.env'));

const TRIAGE_PORT     = orchEnv.TRIAGE_PORT    ?? '3301';
const FORMATTER_PORT  = orchEnv.FORMATTER_PORT ?? '3302';
const ORCH_HTTP_PORT  = orchEnv.ORCHESTRATOR_HTTP_PORT ?? '3500';
const GATEWAY_PORT    = gatewayEnv.GATEWAY_PORT ?? '3400';

process.stdout.write('\n');
process.stdout.write(colors.bold('  Agent Framework Stack\n'));
process.stdout.write(colors.gray('  ─────────────────────\n'));

// 1. Build
if (!NO_BUILD) {
    build('orchestrator-mcp-agent', ORCH_PKG);
    build('gateway', GATEWAY_DIR);
} else {
    info('Skipping build (--no-build)');
}

// 2. Agentes especialistas
log('Starting specialist agents...');
startProc('triage',    ['agents/triage-agent.mjs'],    MCP_AGENTS_DIR, orchEnv);
startProc('formatter', ['agents/formatter-agent.mjs'], MCP_AGENTS_DIR, orchEnv);

if (!await waitForHealth(`http://localhost:${TRIAGE_PORT}/health`,    `triage :${TRIAGE_PORT}`))   { stopAll(); process.exit(1); }
if (!await waitForHealth(`http://localhost:${FORMATTER_PORT}/health`, `formatter :${FORMATTER_PORT}`)) { stopAll(); process.exit(1); }

// 3. Orchestrator en modo HTTP
log('Starting orchestrator (HTTP mode)...');
if (!existsSync(ORCH_SERVER)) {
    fail(`${ORCH_SERVER} not found — run without --no-build`);
    process.exit(1);
}
startProc('orchestrator', [ORCH_SERVER], MCP_AGENTS_DIR, orchEnv);

if (!await waitForHealth(`http://localhost:${ORCH_HTTP_PORT}/health`, `orchestrator :${ORCH_HTTP_PORT}`)) {
    stopAll(); process.exit(1);
}

// 4. Gateway
log('Starting gateway...');
startProc('gateway', [resolve(GATEWAY_DIR, 'dist/server.js')], GATEWAY_DIR, gatewayEnv);

if (!await waitForHealth(`http://localhost:${GATEWAY_PORT}/api/health`, `gateway :${GATEWAY_PORT}`)) {
    stopAll(); process.exit(1);
}

// 5. Done
process.stdout.write('\n');
process.stdout.write(colors.gray('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
process.stdout.write(`  ${colors.green('Stack is up')}\n`);
process.stdout.write(`\n`);
process.stdout.write(`    Agents       :${TRIAGE_PORT} (triage)  :${FORMATTER_PORT} (formatter)\n`);
process.stdout.write(`    Orchestrator :${ORCH_HTTP_PORT}\n`);
process.stdout.write(`    Gateway      :${GATEWAY_PORT}\n`);
process.stdout.write(`    Studio       http://localhost:3000  (cd agent-framework && npm run dev)\n`);
process.stdout.write(colors.gray('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
process.stdout.write('\n');
process.stdout.write(colors.gray('  Ctrl+C to stop everything\n\n'));
