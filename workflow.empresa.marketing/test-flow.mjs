#!/usr/bin/env node
/**
 * Test runner para workflow.empresa.marketing
 *
 * Uso:
 *   node test-flow.mjs articulo-blog      # flow de creación de artículo con gate SEO
 *   node test-flow.mjs campana-leads      # campaña de lead gen con gate de estrategia
 *   node test-flow.mjs dynamic            # planificación dinámica libre
 *   TASK="..." node test-flow.mjs dynamic # tarea custom
 */

import { spawn }   from 'node:child_process';
import { createInterface } from 'node:readline';
import * as path   from 'node:path';
import * as fs     from 'node:fs';
import * as url    from 'node:url';

// ── Config ────────────────────────────────────────────────────────────────────

const __dirname   = path.dirname(url.fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, 'orchestrator.yaml');
const SERVER_PATH = path.resolve(
    __dirname,
    '../../backendkit-agents/packages/orchestrator-agent/dist/server.js',
);

// ── Payloads de ejemplo para cada flow ───────────────────────────────────────

const FLOWS = {
    'articulo-blog': {
        flow_id: 'articulo-blog',
        task: 'Crear artículo de blog: Cómo reducir el time-to-market con CI/CD',
        payload: {
            tema:      'Cómo implementar CI/CD para reducir el time-to-market en equipos de desarrollo',
            objetivo:  'Posicionar a la empresa como experta en DevOps y atraer CTOs que buscan acelerar sus equipos',
            audiencia: 'CTOs y VPs de Engineering de empresas tech (50-300 empleados) que tienen deploys manuales o procesos lentos',
            keywords:  'CI/CD implementación, continuous delivery, reducir time-to-market, pipeline de despliegue',
            tono:      'Técnico pero accesible — como explicarle a un CTO que sabe de tecnología pero no es especialista en DevOps',
        },
    },
    'campana-leads': {
        flow_id: 'campana-leads',
        task: 'Diseñar campaña de generación de leads para servicios de Data Engineering',
        payload: {
            servicio:    'Data Engineering — construcción de data pipelines, data warehouses y plataformas de analytics',
            segmento:    'Directores de Analytics, CTOs y CEOs de empresas con más de 50 empleados que tienen datos pero no los aprovechan. Sectores: retail, fintech, healthtech.',
            objetivo:    'Generar 20 leads calificados (MQL) en 60 días para el equipo de ventas',
            presupuesto: '$3.000 USD mensuales en paid + tiempo del equipo de contenido',
            duracion:    '60 días con posibilidad de extensión si los resultados son positivos',
            canal:       'LinkedIn Ads como canal principal, blog/SEO como apoyo orgánico',
        },
    },
    'dynamic': {
        flow_id: undefined,
        task: process.env.TASK ?? 'Crear una estrategia de contenido para posicionar a la empresa en el segmento de startups fintech que necesitan desarrollo de software',
        payload: {},
    },
};

// ── MCP Client mínimo (stdio) ─────────────────────────────────────────────────

class McpClient {
    constructor(serverPath) {
        this._nextId = 1;
        this._pending = new Map();

        const args = serverPath.endsWith('.js') ? [serverPath] : [];
        const cmd  = serverPath.endsWith('.js') ? 'node' : serverPath;

        const env = { ...process.env };
        const dotenv = path.join(__dirname, '.env');
        if (fs.existsSync(dotenv)) {
            for (const line of fs.readFileSync(dotenv, 'utf-8').split('\n')) {
                const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
                if (m && m[2] && !(m[1] in env)) {
                    env[m[1]] = m[2].replace(/^["']|["']$/g, '');
                }
            }
        }

        this._proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], env });

        const rl = createInterface({ input: this._proc.stdout });
        rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const msg = JSON.parse(line);
                if (msg.id !== undefined && this._pending.has(msg.id)) {
                    const { resolve, reject } = this._pending.get(msg.id);
                    this._pending.delete(msg.id);
                    if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
                    else resolve(msg.result);
                }
            } catch { }
        });

        this._proc.on('error', (err) => {
            console.error('[MCP] Server process error:', err.message);
        });
    }

    _send(msg) { this._proc.stdin.write(JSON.stringify(msg) + '\n'); }

    async initialize() {
        const id = this._nextId++;
        const p = new Promise((res, rej) => this._pending.set(id, { resolve: res, reject: rej }));
        this._send({ jsonrpc: '2.0', id, method: 'initialize', params: {
            protocolVersion: '2024-11-05', capabilities: {},
            clientInfo: { name: 'test-flow', version: '0.1.0' },
        }});
        await p;
        this._send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    }

    async callTool(name, args) {
        const id = this._nextId++;
        const p = new Promise((res, rej) => {
            this._pending.set(id, { resolve: res, reject: rej });
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    rej(new Error(`Timeout esperando respuesta de ${name}`));
                }
            }, 120_000);
        });
        this._send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
        return p;
    }

    close() { this._proc.stdin.end(); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(result) {
    if (!result?.content) return String(result);
    return result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}

function printSection(title, text) {
    const line = '─'.repeat(60);
    console.log(`\n${line}\n  ${title}\n${line}`);
    console.log(text);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const flowKey = process.argv[2] ?? 'articulo-blog';
    const flowDef = FLOWS[flowKey];
    if (!flowDef) {
        console.error(`Flow desconocido: ${flowKey}\nOpciones: ${Object.keys(FLOWS).join(', ')}`);
        process.exit(1);
    }

    if (!fs.existsSync(SERVER_PATH)) {
        console.error(`No se encuentra el servidor:\n  ${SERVER_PATH}`);
        process.exit(1);
    }

    console.log(`\n🚀 Iniciando orchestrator-agent (marketing)...`);
    console.log(`   Flow:   ${flowKey}`);
    console.log(`   Config: ${CONFIG_PATH}`);

    const client = new McpClient(SERVER_PATH);

    try {
        await client.initialize();
        console.log('   MCP: conectado ✓\n');

        const runArgs = { config_path: CONFIG_PATH, task: flowDef.task };
        if (flowDef.flow_id) runArgs.flow_id = flowDef.flow_id;
        if (Object.keys(flowDef.payload).length > 0) runArgs.payload = flowDef.payload;

        const startResult = await client.callTool('orchestrator_run', runArgs);
        const startText   = extractText(startResult);
        printSection('RUN INICIADO', startText);

        const runIdMatch = startText.match(/runId:\s*`?([a-z0-9-]+)`?/i);
        if (!runIdMatch) { console.error('\n[ERROR] No se pudo extraer el runId.'); process.exit(1); }
        const runId = runIdMatch[1];

        let attempts = 0;
        let lastStatusLine = '';
        console.log(`\nEsperando resultados (runId: ${runId})...\n`);

        while (attempts < 80) {
            await sleep(5000);
            attempts++;

            const statusResult = await client.callTool('orchestrator_status', {
                config_path: CONFIG_PATH, run_id: runId,
            });
            const statusText = extractText(statusResult);
            const statusLine = statusText.match(/status:\s*\*\*([^*]+)\*\*/)?.[1]
                            ?? statusText.match(/^status:\s*(\S+)/m)?.[1]
                            ?? 'unknown';

            if (statusLine !== lastStatusLine) {
                process.stdout.write(`  [${new Date().toLocaleTimeString()}] status: ${statusLine}\n`);
                lastStatusLine = statusLine;
            }

            if (statusLine === 'complete') { printSection('RESULTADO FINAL', statusText); break; }
            if (statusLine === 'failed')   { printSection('ERROR', statusText); break; }

            if (statusLine === 'waiting_gate') {
                printSection('GATE — APROBACIÓN REQUERIDA', statusText);
                console.log('\nAprobando automáticamente...\n');
                await sleep(2000);
                const approveResult = await client.callTool('orchestrator_approve', {
                    config_path: CONFIG_PATH, run_id: runId,
                    approved: true, notes: 'Aprobado automáticamente por test-flow.mjs',
                });
                printSection('GATE APROBADO', extractText(approveResult));
                lastStatusLine = '';
            }
        }

        if (attempts >= 80) console.log('\n[TIMEOUT] Revisá orchestrator_status manualmente.');

    } finally {
        client.close();
    }
}

main().catch(err => { console.error('\n[FATAL]', err.message); process.exit(1); });
