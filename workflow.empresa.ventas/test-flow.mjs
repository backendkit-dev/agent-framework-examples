#!/usr/bin/env node
/**
 * Test runner para workflow.empresa.ventas
 *
 * Actúa como cliente MCP real: spawea el orchestrator-agent,
 * envía tool calls y muestra el resultado en vivo.
 *
 * Uso:
 *   node test-flow.mjs calificacion-lead    # flow estático con payload de ejemplo
 *   node test-flow.mjs propuesta-comercial  # flow estático con payload de ejemplo
 *   node test-flow.mjs dynamic              # planificación dinámica libre
 *   TASK="..." node test-flow.mjs dynamic   # tarea custom
 */

import { spawn }   from 'node:child_process';
import { createInterface } from 'node:readline';
import * as path   from 'node:path';
import * as fs     from 'node:fs';
import * as url    from 'node:url';

// ── Config ────────────────────────────────────────────────────────────────────

const __dirname    = path.dirname(url.fileURLToPath(import.meta.url));
const CONFIG_PATH  = path.resolve(__dirname, 'orchestrator.yaml');
const SERVER_PATH  = path.resolve(
    __dirname,
    '../../backendkit-agents/packages/orchestrator-agent/dist/server.js',
);
// Fallback: if installed globally as orchestrator-agent binary
// const SERVER_PATH = 'orchestrator-agent';

// ── Payloads de ejemplo para cada flow ───────────────────────────────────────

const FLOWS = {
    'calificacion-lead': {
        flow_id: 'calificacion-lead',
        task: 'Calificar nuevo lead: empresa TechRetail SA',
        payload: {
            empresa:     'TechRetail SA',
            contacto:    'Lucía Fernández',
            cargo:       'CTO',
            email:       'lucia@techretail.com',
            descripcion: 'Cadena de retail con 350 empleados que quiere modernizar su plataforma de e-commerce y migrar a cloud. Tienen un ERP legacy en on-premise. Presupuesto estimado entre $80k y $150k USD. Proceso de decisión dentro de los próximos 60 días.',
        },
    },
    'propuesta-comercial': {
        flow_id: 'propuesta-comercial',
        task: 'Elaborar propuesta comercial para TechRetail SA',
        payload: {
            empresa:    'TechRetail SA',
            contacto:   'Lucía Fernández',
            cargo:      'CTO',
            servicio:   'Migración cloud + modernización e-commerce',
            necesidad:  'Migrar plataforma legacy de e-commerce a cloud (AWS), con nueva capa de APIs y mejoras de performance. El sistema actual no aguanta las cargas de temporada alta.',
            presupuesto:'$80.000 - $150.000 USD',
            timeline:   '6 meses, inicio previsto agosto 2026',
            contexto:   'Empresa de retail con 350 empleados. La CTO tiene autonomía de decisión hasta $100k. Para montos mayores necesita aprobación del CEO. Ya tuvieron 2 temporadas con caídas del sistema en Black Friday.',
        },
    },
    'dynamic': {
        flow_id: undefined,
        task: process.env.TASK ?? 'Investigar el potencial comercial del sector fintech en Argentina y proponer una estrategia de prospección para los próximos 3 meses',
        payload: {},
    },
};

// ── MCP Client mínimo (stdio) ─────────────────────────────────────────────────

class McpClient {
    constructor(serverPath) {
        this._nextId = 1;
        this._pending = new Map();
        this._buffer  = '';

        const args = serverPath.endsWith('.js') ? [serverPath] : [];
        const cmd  = serverPath.endsWith('.js') ? 'node' : serverPath;

        // Heredar las vars de entorno del proceso actual (incluye DEEPSEEK_API_KEY desde .env)
        const env = { ...process.env };

        // Cargar .env del directorio del workflow si existe
        const dotenv = path.join(__dirname, '.env');
        if (fs.existsSync(dotenv)) {
            for (const line of fs.readFileSync(dotenv, 'utf-8').split('\n')) {
                const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
                if (m && m[2] && !(m[1] in env)) {
                    env[m[1]] = m[2].replace(/^["']|["']$/g, '');
                }
            }
        }

        this._proc = spawn(cmd, args, {
            stdio: ['pipe', 'pipe', 'inherit'],
            env,
        });

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
            } catch { /* ignore non-JSON lines */ }
        });

        this._proc.on('error', (err) => {
            console.error('[MCP] Server process error:', err.message);
        });
    }

    _send(msg) {
        this._proc.stdin.write(JSON.stringify(msg) + '\n');
    }

    async initialize() {
        const id = this._nextId++;
        const p = new Promise((res, rej) => this._pending.set(id, { resolve: res, reject: rej }));
        this._send({
            jsonrpc: '2.0', id,
            method:  'initialize',
            params:  {
                protocolVersion: '2024-11-05',
                capabilities:    {},
                clientInfo:      { name: 'test-flow', version: '0.1.0' },
            },
        });
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
        this._send({
            jsonrpc: '2.0', id,
            method:  'tools/call',
            params:  { name, arguments: args },
        });
        return p;
    }

    close() {
        this._proc.stdin.end();
    }
}

// ── Helpers de display ────────────────────────────────────────────────────────

function extractText(result) {
    if (!result?.content) return String(result);
    return result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
}

function printSection(title, text) {
    const line = '─'.repeat(60);
    console.log(`\n${line}`);
    console.log(`  ${title}`);
    console.log(line);
    console.log(text);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const flowKey = process.argv[2] ?? 'calificacion-lead';
    const flowDef = FLOWS[flowKey];
    if (!flowDef) {
        console.error(`Flow desconocido: ${flowKey}`);
        console.error(`Opciones: ${Object.keys(FLOWS).join(', ')}`);
        process.exit(1);
    }

    if (!fs.existsSync(SERVER_PATH)) {
        console.error(`No se encuentra el servidor en:\n  ${SERVER_PATH}`);
        console.error('Asegurate de buildear el orchestrator-agent primero:');
        console.error('  cd backendkit-agents/packages/orchestrator-agent && npm run build');
        process.exit(1);
    }

    console.log(`\n🚀 Iniciando orchestrator-agent...`);
    console.log(`   Flow:   ${flowKey}`);
    console.log(`   Config: ${CONFIG_PATH}`);

    const client = new McpClient(SERVER_PATH);

    try {
        // 1. Handshake MCP
        await client.initialize();
        console.log('   MCP: conectado ✓\n');

        // 2. Lanzar el run
        const runArgs = {
            config_path: CONFIG_PATH,
            task:        flowDef.task,
        };
        if (flowDef.flow_id)                  runArgs.flow_id = flowDef.flow_id;
        if (Object.keys(flowDef.payload).length > 0) runArgs.payload = flowDef.payload;

        const startResult = await client.callTool('orchestrator_run', runArgs);
        const startText   = extractText(startResult);
        printSection('RUN INICIADO', startText);

        // Extraer runId del texto
        const runIdMatch = startText.match(/runId:\s*`?([a-z0-9-]+)`?/i);
        if (!runIdMatch) {
            console.error('\n[ERROR] No se pudo extraer el runId. Abortando.');
            process.exit(1);
        }
        const runId = runIdMatch[1];

        // 3. Polling hasta completar o gate
        let attempts = 0;
        const MAX_ATTEMPTS = 80; // ~6.5 min max (5s * 80)
        let lastStatusLine = '';

        console.log(`\nEsperando resultados (runId: ${runId})...\n`);

        while (attempts < MAX_ATTEMPTS) {
            await sleep(5000);
            attempts++;

            const statusResult = await client.callTool('orchestrator_status', {
                config_path: CONFIG_PATH,
                run_id:      runId,
            });
            const statusText = extractText(statusResult);

            // Extraer el campo status: **valor** del texto del servidor
            const statusLine = statusText.match(/status:\s*\*\*([^*]+)\*\*/)?.[1]
                            ?? statusText.match(/^status:\s*(\S+)/m)?.[1]
                            ?? 'unknown';

            // Mostrar progreso solo cuando el status cambia
            if (statusLine !== lastStatusLine) {
                process.stdout.write(`  [${new Date().toLocaleTimeString()}] status: ${statusLine}\n`);
                lastStatusLine = statusLine;
            }

            // Detectar terminación por el campo status exacto
            if (statusLine === 'complete') {
                printSection('RESULTADO FINAL', statusText);
                break;
            }

            if (statusLine === 'failed') {
                printSection('ERROR', statusText);
                break;
            }

            if (statusLine === 'waiting_gate') {
                printSection('GATE — APROBACIÓN REQUERIDA', statusText);
                console.log('\nEl flujo está esperando aprobación manual.');
                console.log(`Para aprobar: orchestrator_approve con run_id="${runId}" y approved=true`);
                console.log('En este test, aprobamos automáticamente...\n');

                await sleep(2000);
                const approveResult = await client.callTool('orchestrator_approve', {
                    config_path: CONFIG_PATH,
                    run_id:      runId,
                    approved:    true,
                    notes:       'Aprobado automáticamente por test-flow.mjs',
                });
                printSection('GATE APROBADO', extractText(approveResult));
                lastStatusLine = '';
            }
        }

        if (attempts >= MAX_ATTEMPTS) {
            console.log('\n[TIMEOUT] El run tardó demasiado. Revisá orchestrator_status manualmente.');
        }

    } finally {
        client.close();
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
    console.error('\n[FATAL]', err.message);
    process.exit(1);
});
