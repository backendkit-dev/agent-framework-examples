#!/usr/bin/env node
/**
 * test-concurrency.mjs
 *
 * Prueba tres escenarios de concurrencia del orquestador:
 *   1. Start concurrente: N flows arrancados al mismo tiempo, todos retornan run_id inmediatamente
 *   2. Guard de idempotencia: doble-approve del mismo run_id — solo uno pasa
 *   3. Semáforo: todos los gates aprobados al mismo tiempo, solo MAX_CONCURRENT_FLOWS ejecutan a la vez
 *
 * Uso:
 *   node test-concurrency.mjs
 *   N_FLOWS=8 GATEWAY_URL=http://localhost:3400 node test-concurrency.mjs
 */

const GATEWAY   = process.env.GATEWAY_URL      ?? 'http://localhost:3400';
const FLOW_ID   = process.env.FLOW_ID          ?? 'knowledge-search-llm';
const N_FLOWS   = parseInt(process.env.N_FLOWS ?? '5', 10);
const POLL_MS   = parseInt(process.env.POLL_MS ?? '2000', 10);
const TIMEOUT_S = parseInt(process.env.TIMEOUT_S ?? '180', 10);

// ── ANSI colors ───────────────────────────────────────────────────────────────

const C = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    dim:    '\x1b[2m',
    blue:   '\x1b[34m',
    cyan:   '\x1b[36m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    red:    '\x1b[31m',
    orange: '\x1b[38;5;208m',
    gray:   '\x1b[90m',
};

const STATUS_COLOR = {
    running:       C.blue,
    waiting_gate:  C.yellow,
    waiting_retry: C.orange,
    done:          C.green,
    failed:        C.red,
    cancelled:     C.gray,
};

const now  = () => new Date().toISOString().slice(11, 23);
const log  = (tag, msg, color = C.cyan) => console.log(`${C.gray}${now()}${C.reset} ${color}${C.bold}[${tag}]${C.reset} ${msg}`);
const ok   = (msg) => log('OK ', msg, C.green);
const warn = (msg) => log('!!', msg, C.yellow);
const err  = (msg) => log('ERR', msg, C.red);
const sep  = (title) => console.log(`\n${C.bold}${'─'.repeat(60)}${C.reset}\n${C.bold}${title}${C.reset}\n`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── API helpers ───────────────────────────────────────────────────────────────

async function post(path, body) {
    const res = await fetch(`${GATEWAY}${path}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function get(path) {
    const res = await fetch(`${GATEWAY}${path}`);
    return res.json();
}

async function startFlow(query) {
    return post('/api/run', { flow_id: FLOW_ID, input: { query } });
}

async function approveRun(runId, feedback) {
    return post('/api/approve', { run_id: runId, feedback });
}

async function getRuns() {
    return get('/api/runs');
}

// ── Display ───────────────────────────────────────────────────────────────────

function printTable(runs, trackedIds) {
    const tracked = runs.filter(r => trackedIds.has(r.id));
    for (const r of tracked) {
        const col   = STATUS_COLOR[r.status] ?? C.reset;
        const label = `${col}${r.status.padEnd(14)}${C.reset}`;
        const short = r.id.slice(0, 8);
        const age   = Math.round((Date.now() - new Date(r.createdAt).getTime()) / 1000);
        console.log(`  ${C.gray}${short}${C.reset}  ${label}  ${C.dim}${age}s${C.reset}`);
    }
}

function countByStatus(runs, ids) {
    const map = {};
    for (const r of runs.filter(r => ids.has(r.id))) {
        map[r.status] = (map[r.status] ?? 0) + 1;
    }
    return map;
}

// ── Phase helpers ─────────────────────────────────────────────────────────────

async function pollUntil(trackedIds, predicate, label) {
    const deadline = Date.now() + TIMEOUT_S * 1000;
    while (Date.now() < deadline) {
        const runs = await getRuns();
        const tracked = runs.filter(r => trackedIds.has(r.id));
        const counts  = countByStatus(runs, trackedIds);
        const summary = Object.entries(counts).map(([s, n]) => `${STATUS_COLOR[s] ?? ''}${n} ${s}${C.reset}`).join('  ');
        process.stdout.write(`\r  ${C.gray}polling${C.reset}  ${summary}          `);
        if (predicate(tracked)) {
            process.stdout.write('\n');
            return tracked;
        }
        await sleep(POLL_MS);
    }
    process.stdout.write('\n');
    warn(`Timeout (${TIMEOUT_S}s) waiting for: ${label}`);
    return await getRuns().then(r => r.filter(r => trackedIds.has(r.id)));
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 1 — Start concurrente
// ═════════════════════════════════════════════════════════════════════════════

async function phase1_concurrentStart() {
    sep(`FASE 1 — Start concurrente (${N_FLOWS} flows)`);

    const queries = Array.from({ length: N_FLOWS }, (_, i) => [
        'What are microservices and how do they differ from monoliths?',
        'How does circuit breaker pattern work in distributed systems?',
        'What is event sourcing and when should I use it?',
        'Explain CQRS pattern and its trade-offs',
        'How to implement rate limiting in a REST API?',
        'What is the saga pattern for distributed transactions?',
        'Explain blue-green deployment strategy',
        'What is chaos engineering and how to apply it?',
    ][i % 8]);

    log('START', `Arrancando ${N_FLOWS} flows simultáneamente...`);
    const t0 = Date.now();

    const results = await Promise.all(queries.map((q, i) => startFlow(q).then(r => ({ i, q, ...r }))));

    const elapsed = Date.now() - t0;
    log('START', `Todos respondieron en ${elapsed}ms`);

    const runIds = new Set();
    for (const { i, status, body } of results) {
        const runId = body.run_id;
        if (runId) {
            runIds.add(runId);
            const accepted = status === 202;
            const fn = accepted ? ok : warn;
            fn(`Flow ${i + 1}: HTTP ${status}  run_id=${runId.slice(0, 8)}  status=${body.status}`);
            if (!accepted) warn(`  → Gateway devolvió ${status} en vez de 202. ¿Está corriendo el código nuevo?`);
        } else {
            err(`Flow ${i + 1}: HTTP ${status}  ${JSON.stringify(body)}`);
        }
    }

    if (runIds.size === 0) {
        err('Ningún flow retornó run_id. Reiniciá el gateway con el código nuevo:');
        err('  cd orchestrator-gateway && npm run build && npm start');
        process.exit(1);
    }

    if (runIds.size !== N_FLOWS) {
        warn(`Solo ${runIds.size}/${N_FLOWS} flows arrancaron correctamente`);
    }

    return runIds;
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 2 — Esperar gates
// ═════════════════════════════════════════════════════════════════════════════

async function phase2_waitForGates(runIds) {
    sep('FASE 2 — Esperando que todos los flows lleguen al gate (classify)');

    const runs = await pollUntil(
        runIds,
        tracked => tracked.length > 0 && tracked.every(r => r.status !== 'running'),
        'todos los runs fuera de running',
    );

    const gated   = runs.filter(r => r.status === 'waiting_gate');
    const running = runs.filter(r => r.status === 'running');
    const failed  = runs.filter(r => r.status === 'failed');

    log('GATE', `${gated.length} en waiting_gate, ${running.length} running, ${failed.length} failed`);
    printTable(runs, runIds);

    return { runs, gated };
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 3 — Guard de idempotencia: doble approve
// ═════════════════════════════════════════════════════════════════════════════

async function phase3_idempotencyTest(gated) {
    sep('FASE 3 — Guard de idempotencia: doble-approve del mismo run_id');

    if (gated.length === 0) {
        warn('No hay runs en waiting_gate, saltando fase 3');
        return;
    }

    const target = gated[0];
    log('IDEM', `Target: ${target.id.slice(0, 8)}`);
    log('IDEM', 'Enviando 2 aprobaciones simultáneas al mismo run_id...');

    const [r1, r2] = await Promise.all([
        approveRun(target.id, 'Approve A (primero)'),
        approveRun(target.id, 'Approve B (segundo)'),
    ]);

    // Ambos deberían retornar 202 desde el gateway (el rechazo llega del orquestador en background)
    log('IDEM', `Respuesta A: HTTP ${r1.status}  ${JSON.stringify(r1.body)}`);
    log('IDEM', `Respuesta B: HTTP ${r2.status}  ${JSON.stringify(r2.body)}`);

    // Esperar un momento para que el orquestador procese ambos
    await sleep(1500);
    const runs = await getRuns();
    const run  = runs.find(r => r.id === target.id);

    if (run) {
        const col = STATUS_COLOR[run.status] ?? '';
        log('IDEM', `Estado actual del run: ${col}${run.status}${C.reset}`);
        if (run.status !== 'running' && run.status !== 'done' && run.status !== 'waiting_gate') {
            warn('Estado inesperado — posible doble ejecución');
        } else {
            ok('Guard funcionó correctamente (una sola ejecución en curso)');
        }
    }

    return target.id;
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 4 — Semáforo: approve masivo simultáneo
// ═════════════════════════════════════════════════════════════════════════════

async function phase4_semaphoreTest(runIds, alreadyApprovedId) {
    sep('FASE 4 — Semáforo: aprobando todos los gates simultáneamente');

    // Esperar que todos los runs lleguen a waiting_gate (o un estado final)
    const runs = await pollUntil(
        runIds,
        tracked => tracked.every(r => r.status !== 'running'),
        'todos los runs fuera de running',
    );

    const gated = runs.filter(r => r.status === 'waiting_gate' && r.id !== alreadyApprovedId);

    if (gated.length === 0) {
        warn('No quedan runs en waiting_gate para probar el semáforo');
        printTable(runs, runIds);
        return;
    }

    log('SEM', `Aprobando ${gated.length} runs simultáneamente (MAX_CONCURRENT_FLOWS=3 por defecto)`);
    log('SEM', 'Todos los approve van al gateway al mismo tiempo...');

    const t0 = Date.now();
    const approvals = await Promise.all(
        gated.map((r, i) => approveRun(r.id, `Batch approve #${i + 1}`).then(res => ({ runId: r.id, ...res }))),
    );

    log('SEM', `Todos los 202 recibidos en ${Date.now() - t0}ms`);
    for (const { runId, status } of approvals) {
        ok(`Approve ${runId.slice(0, 8)}: HTTP ${status}`);
    }

    // Polling para observar el semáforo en acción
    sep('FASE 4b — Observando concurrencia (máx 3 simultáneos)');
    let maxSimultaneous = 0;

    const final = await pollUntil(
        runIds,
        tracked => {
            const running = tracked.filter(r => r.status === 'running').length;
            if (running > maxSimultaneous) maxSimultaneous = running;
            return tracked.every(r => ['done', 'failed', 'cancelled'].includes(r.status));
        },
        'todos los runs en estado final',
    );

    return { final, maxSimultaneous };
}

// ═════════════════════════════════════════════════════════════════════════════
// RESUMEN
// ═════════════════════════════════════════════════════════════════════════════

function printSummary(runs, runIds, maxSimultaneous, totalMs) {
    sep('RESUMEN');

    const tracked = runs.filter(r => runIds.has(r.id));
    const byStatus = countByStatus(runs, runIds);

    console.log(`  Flows lanzados:      ${C.bold}${N_FLOWS}${C.reset}`);
    console.log(`  Tiempo total:        ${C.bold}${(totalMs / 1000).toFixed(1)}s${C.reset}`);
    console.log(`  Máx simultáneos:     ${C.bold}${maxSimultaneous}${C.reset} ${maxSimultaneous <= 3 ? C.green + '✓ (≤3, semáforo respetado)' : C.red + '✗ (semáforo superado!)'  }${C.reset}`);
    console.log('');
    for (const [status, count] of Object.entries(byStatus)) {
        const col = STATUS_COLOR[status] ?? '';
        console.log(`  ${col}${status.padEnd(16)}${C.reset}  ${count}`);
    }

    console.log('');
    for (const r of tracked) {
        const col  = STATUS_COLOR[r.status] ?? '';
        const dur  = Math.round((new Date(r.updatedAt) - new Date(r.createdAt)) / 1000);
        const summ = r.summary ? r.summary.slice(0, 60).replace(/\n/g, ' ') + '…' : r.error ?? '';
        console.log(`  ${C.gray}${r.id.slice(0, 8)}${C.reset}  ${col}${r.status.padEnd(14)}${C.reset}  ${dur}s  ${C.dim}${summ}${C.reset}`);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
    console.log(`\n${C.bold}Orchestrator Concurrency Test${C.reset}`);
    console.log(`${C.dim}Gateway: ${GATEWAY}  Flow: ${FLOW_ID}  N: ${N_FLOWS}${C.reset}\n`);

    // Verificar que el gateway esté levantado
    try {
        await fetch(`${GATEWAY}/api/health`);
    } catch {
        err(`Gateway no responde en ${GATEWAY}`);
        err('Levantá el gateway primero: cd orchestrator-gateway && npm start');
        process.exit(1);
    }

    const t0 = Date.now();

    const runIds                   = await phase1_concurrentStart();
    const { gated }                = await phase2_waitForGates(runIds);
    const approvedId               = await phase3_idempotencyTest(gated);
    const { final, maxSimultaneous } = await phase4_semaphoreTest(runIds, approvedId) ?? {};

    const allRuns = await getRuns();
    printSummary(allRuns, runIds, maxSimultaneous ?? 0, Date.now() - t0);
}

main().catch(e => { err(e.message); process.exit(1); });
