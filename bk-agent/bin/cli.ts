#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as yaml from 'yaml';
import {
    createCodingEngine,
    ConfigLoader,
    AgentLoader,
    CODING_AGENTS,
    CODING_TOOLS,
    type ProvidersConfig,
} from '@backendkit-labs/agent-coding';
import {
    CallbackTransport,
    SlashCommandRegistry,
    registerBuiltinCommands,
    getProjectDir,
    loadWorkspaces,
    saveWorkspaces,
    importProject,
    setActiveProject,
    deriveProjectName,
    buildWorkspaceContext,
    type AgentEvent,
    type AgentProfile,
    type IterationMode,
    type IterationStats,
} from '@backendkit-labs/agent-core';

import { Terminal } from '../src/ui/terminal';
import { agentEvents } from '../src/ui/agent-events';
import {
    formatHeader,
    type HeaderInfo,
    formatToolCall,
    formatToolResult,
    formatCommandOutput,
    formatAgentHeader,
    formatAgentHeaderCompact,

    formatMarkdown,
    formatFileDiff,
} from '../src/ui/formatters';
import { Spinner, type SpinnerMetrics } from '../src/ui/spinner';
import { decideApproval, decisionFromUserAnswer, requiresAlwaysAsk } from '../src/agent/approval-policy';
import { setupConsoleEncoding } from '../src/shared/utils/encoding';
import { sanitizeSingleLine } from '../src/shared/utils/sanitize-terminal';
import { HeadlessStreamFilter, type HeadlessEmission } from '../src/ui/headless-stream';
import { applyToolGuards } from '../src/security/apply-tool-guards';
import { applyExtraApprovals, type EngineWithGate } from '../src/security/apply-extra-approvals';
import type { ToolDefinitionLike } from '../src/security/tool-guards';
import {
    readDesignState,
    parseQaVerdict,
    buildQaRunPrompt as buildQARunPrompt,
    type DesignState,
} from '../src/spec/design-state';
import { loadSkills, type Skill } from '../src/skills/loader';
import {
    listCheckpoints, readCheckpoint, createCheckpoint, compactSession,
} from '../src/memory/updater';
import {
    loadMemoryContext, getGlobalSkillsDir,
    getProjectMemoryDir, type MemoryContext,
} from '../src/bootstrap/memory-loader';

// ── Model registry (for cost estimates) ──────────────────────────────────────

interface ModelInfo {
    id: string;
    name: string;
    badge: string;
    inputPriceM: number;
    outputPriceM: number;
    contextWindow: number;
    note: string;
}

const DEEPSEEK_MODELS: ModelInfo[] = [
    {
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        badge: '⚡',
        inputPriceM: 0.27,
        outputPriceM: 1.10,
        contextWindow: 64_000,
        note: 'Rapido · General, codigo, tareas cotidianas',
    },
    {
        id: 'deepseek-reasoner',
        name: 'DeepSeek R1',
        badge: '🧠',
        inputPriceM: 0.55,
        outputPriceM: 2.19,
        contextWindow: 64_000,
        note: 'Experto · Razonamiento, matematicas, problemas complejos',
    },
];

function buildHelpText(skills: Skill[]): string {
    const lines = [
        chalk.bold('Comandos disponibles:'),
        '',
        chalk.cyan('/help') + '                  Este mensaje',
        chalk.cyan('/clear') + '                 Limpiar pantalla',
        chalk.cyan('/reset-context') + '         Reiniciar conversacion (mantiene sistema)',
        chalk.cyan('/context') + '               Ver contexto activo del proyecto',
        chalk.cyan('/tokens') + '                Ver tokens de sesion',
        chalk.cyan('/usage') + '                 Tokens y costo de sub-agentes',
        chalk.cyan('/status') + '                Panel de estado del sistema',
        chalk.cyan('/agent [id]') + '            Cambiar agente activo',

        chalk.cyan('/models [id]') + '           Cambiar modelo de IA',
        chalk.cyan('/skills') + '               Ver/instalar skills',
        chalk.cyan('/iteration') + '             Ver/cambiar modo de iteracion',
        chalk.cyan('/memory') + '               Ver memoria del proyecto activo',
        chalk.cyan('/switch [ws] [proj]') + '     Cambiar workspace/proyecto activo (picker TUI)',
        chalk.cyan('/workspace [sub]') + '       Gestionar workspaces (create/add/remove/delete)',
        chalk.cyan('/checkpoint <nombre>') + '   Crear checkpoint de sesion',
        chalk.cyan('/checkpoint list') + '       Listar checkpoints',
        chalk.cyan('/checkpoint load <n>') + '   Cargar checkpoint',
        chalk.cyan('/init') + '                  Inicializar/analizar proyecto',
        chalk.cyan('/prompt new <frase>') + '    Generar prompt estructurado',
        '',
    ];
    if (skills.length > 0) {
        lines.push(chalk.bold(`Skills activos (${skills.length}):`));
        for (const s of skills) {
            lines.push(`  ${chalk.cyan(s.name)}  ${chalk.dim(s.triggers.slice(0, 3).join(', '))}`);
        }
        lines.push('');
    }
    lines.push(chalk.dim('Escribe tu pregunta o tarea directamente para hablar con el agente.'));
    return lines.join('\n');
}

// ── Commander ─────────────────────────────────────────────────────────────────

const program = new Command();

program
    .name('bk-agent')
    .description('AI coding agent especializado en Node.js y NestJS con BackendKit Labs')
    .version('1.0.0')
    .option('-k, --api-key <key>', 'API key de DeepSeek')
    .option('-m, --model <model>', 'Modelo a usar', 'deepseek-chat')
    .option('-b, --base-url <url>', 'URL base de la API')
    .option('--max-iterations <n>', 'Max iteraciones de herramientas por turno', '100')
    .option('--iteration-mode <mode>', 'Modo de iteracion: interactive | auto | step-by-step', 'step-by-step')
    .option('--command-timeout <s>', 'Timeout en segundos para run_command (0 = sin limite)')
    .option('--no-qa', 'Desactivar revision automatica de QA')
    .option('--headless', 'Modo headless: emite JSON-Lines a stdout para frontend externo')
    .option('--auto-approve', 'PELIGROSO: aprueba automaticamente toda escritura y comando sin confirmar (obligatorio en --headless para permitir mutaciones)')
    .action(async (options) => {
        // Configura la consola a UTF-8 en Windows (chcp 65001 + encoding de stdio).
        // Sin esto, PowerShell 5.1 pinta mojibake con los acentos y el box-drawing.
        setupConsoleEncoding();
        agentEvents.init(!!options.headless);

        // ── API key ───────────────────────────────────────────────────────────
        if (options.apiKey) {
            process.env.DEEPSEEK_API_KEY = options.apiKey;
            if (!agentEvents.isHeadless()) {
                console.warn(chalk.yellow('⚠️  API key por flag CLI. Recomendacion: usar DEEPSEEK_API_KEY en variable de entorno.'));
            }
        }

        const configLoader = new ConfigLoader('bk-agent');
        const fileConfig = configLoader.load();

        // Build providers from config (env vars already merged by ConfigLoader)
        const providers: ProvidersConfig = {};
        for (const [id, cfg] of Object.entries(fileConfig.providers ?? {})) {
            if (!cfg?.apiKey) continue;
            const provCfg = { ...cfg } as ProvidersConfig[string] & object;
            // CLI --model overrides only the default provider's model
            if (id === (fileConfig.defaultProvider ?? 'deepseek') && options.model) {
                (provCfg as any).model = options.model;
            }
            if (id === (fileConfig.defaultProvider ?? 'deepseek') && options.baseUrl) {
                (provCfg as any).baseUrl = options.baseUrl;
            }
            providers[id] = provCfg as any;
        }

        const defaultProvider = fileConfig.defaultProvider;
        if (!defaultProvider || !providers[defaultProvider]) {
            console.error(chalk.red('❌ Se requiere API key. Usa DEEPSEEK_API_KEY o --api-key'));
            console.error(chalk.dim(`   Configura: ${configLoader.configPath}`));
            process.exit(1);
        }

        const cwd = process.cwd();
        const maxIterations = parseInt(options.maxIterations as string, 10) || 100;
        const iterationMode = (options.iterationMode as string) || 'interactive';
        const validModes: IterationMode[] = ['interactive', 'auto', 'step-by-step'];
        const resolvedMode: IterationMode = validModes.includes(iterationMode as IterationMode)
            ? (iterationMode as IterationMode)
            : 'interactive';

        // ── State ─────────────────────────────────────────────────────────────
        let currentAgentId = 'general';
        let currentModel = (providers[defaultProvider] as any)?.model ?? options.model ?? 'deepseek-chat';
        let running = false;
        let allowAll = false;
        // Evita repetir el aviso de "mutacion denegada" en cada tool call de headless.
        let autoApproveWarned = false;
        let pendingInput: string | null = null;
        let pendingContext: string | null = null;
        // Quiet flag for spec.go autonomous loop — suppresses full response text,
        // only tool activity + recap are shown
        let specGoActive = false;

        // Workspace B+ state
        let activeWorkspaceName: string | null = null;
        let activeAppPath: string = cwd;

        const sessionStats = { calls: 0, inputTokens: 0, outputTokens: 0 };
        const liveMetrics: SpinnerMetrics = {
            inputTokens: 0,
            outputTokens: 0,
            elapsedMs: 0,
            estimatedCostUsd: undefined,
            modelName: currentModel,
        };

        // Response buffer — tokens accumulate here, rendered as Markdown on block_end
        let agentResponseBuffer = '';
        // Spinner label: se calcula de forma incremental (ver caso 'token') para
        // evitar re-dividir el buffer completo en cada token (era O(n^2)).
        let spinnerLabelChunk = '';
        let spinnerLabelDone = false;
        const SPINNER_LABEL_MAX_CHARS = 512;
        // Filtro del stream de tokens para headless (separa <recap> del texto).
        // La logica vive en src/ui/headless-stream.ts y esta cubierta por tests.
        let headlessStream = new HeadlessStreamFilter();

        // ── Memory ────────────────────────────────────────────────────────────
        // El vault de Obsidian no esta implementado en el CLI (no hay comando para
        // conectarlo): la memoria vive en ~/.deepseek-code/projects/{key}/memory/.
        let projectName = path.basename(cwd);

        // Load memory from the current active app path (starts as cwd)
        const loadAppMemory = async (appPath: string): Promise<MemoryContext | null> => {
            return loadMemoryContext('', getProjectMemoryDir(appPath), path.basename(appPath));
        };
        let memoryContext: MemoryContext | null = await loadAppMemory(cwd);

        // ── Skills ────────────────────────────────────────────────────────────
        const skillsDir = getGlobalSkillsDir();
        let allSkills = await loadSkills(skillsDir);

        // ── Agents ────────────────────────────────────────────────────────────
        const allAgents: AgentProfile[] = AgentLoader.load({ appName: 'bk-agent', cwd, builtins: CODING_AGENTS });

        // ── Terminal / spinner setup ──────────────────────────────────────────
        const spinner = new Spinner();
        const { MessageBuffer } = await import('../src/ui/message-buffer');
        const messageBuffer = new MessageBuffer();
        // Se asigna una sola vez, en el setup de la TUI, despues de definir los
        // handlers que la cierran por referencia: `const` no es viable aqui.
        // eslint-disable-next-line prefer-const
        let terminal!: Terminal;
        let updateHeaderCallback: () => void = () => {};

        const buildHeaderInfo = (): HeaderInfo => {
            const cur = allAgents.find(a => a.id === currentAgentId);
            const wsLabel = activeWorkspaceName
                ? `${activeWorkspaceName} · ${path.basename(activeAppPath)}`
                : undefined;
            return {
                model: currentModel,
                projectName,
                memoryProject: memoryContext?.activeProject,
                memorySource: memoryContext?.source,
                activeWorkspace: wsLabel,
                agentIcon: cur?.icon,
                agentName: cur?.name,
                skillsCount: allSkills.length,
                customAgentsCount: allAgents.filter(a => (a as any).source !== 'builtin').length,
                activeCwd: activeAppPath,
            };
        };

        // ── QA review handler ─────────────────────────────────────────────────
        function handleQAReview(review: string): void {
            if (agentEvents.isHeadless()) {
                agentEvents.emit({ type: 'qa_review', content: review } as any);
                return;
            }
            if (!terminal) return;
            terminal.prepareForOutput();
            messageBuffer.add({ role: 'system', content: `🧪 QA Engineer — revision automatica:\n${review.slice(0, 300)}`, timestamp: new Date(), meta: 'qa-review' });
            // Compact indicator — the full review is already rendered by the agent's block_end
            const verdictMatch = review.match(/VEREDICTO:\s*(.+)/i) ?? review.match(/Verdict:\s*(.+)/i);
            const verdict = verdictMatch ? '  ' + chalk.dim(verdictMatch[1].trim().slice(0, 70)) : '';
            process.stdout.write(
                chalk.dim('\n  ') + chalk.yellow('🧪') + chalk.bold.yellow('  QA Engineer') +
                '  ' + chalk.dim('· visto bueno') + verdict + '\n'
            );
        }

        // ── Transport event handler ───────────────────────────────────────────
        /** Emite al frontend las emisiones del filtro de stream headless. */
        function emitHeadless(emissions: HeadlessEmission[]): void {
            for (const emission of emissions) {
                if (emission.type === 'token') {
                    agentEvents.emit({ type: 'token', content: emission.content });
                } else {
                    agentEvents.emit({ type: 'recap', text: emission.text } as any);
                }
            }
        }

        function handleEvent(event: AgentEvent): void {
            // Headless: pass through all framework events directly
            if (agentEvents.isHeadless()) {
                switch (event.type) {
                    case 'token': {
                        emitHeadless(headlessStream.push(event.content));
                        return;
                    }
                    case 'metrics':
                        sessionStats.calls++;
                        sessionStats.inputTokens += event.input_tokens;
                        sessionStats.outputTokens += event.output_tokens;
                        agentEvents.emit(event);
                        return;
                    case 'agent_switch':
                        currentAgentId = event.to;
                        agentEvents.emit(event);
                        return;
                    case 'done':
                        emitHeadless(headlessStream.flush());
                        agentEvents.emit(event);
                        return;
                    default:
                        agentEvents.emit(event as any);
                }
                return;
            }

            // Terminal (TUI) mode
            switch (event.type) {
                case 'token': {
                    // Accumulate for formatted rendering on block_end
                    agentResponseBuffer += event.content;
                    // Update spinner label with the first meaningful line so the user
                    // sees what the agent is generating without verbose raw streaming.
                    // El label se deriva de un acumulador corto (primeros SPINNER_LABEL_MAX_CHARS
                    // caracteres o hasta el primer salto de linea) en lugar de re-dividir el
                    // buffer completo en cada token, que hacia la UI O(n^2) en respuestas largas.
                    if (!spinnerLabelDone) {
                        spinnerLabelChunk += event.content;
                        if (spinnerLabelChunk.length >= SPINNER_LABEL_MAX_CHARS || spinnerLabelChunk.includes('\n')) {
                            spinnerLabelDone = true;
                        }
                        const firstLine = spinnerLabelChunk
                            .split('\n')[0]
                            .replace(/\*\*/g, '')
                            .replace(/^#+\s*/, '')
                            .trim();
                        if (firstLine.length > 5) {
                            // sanitizeSingleLine evita que un \r o un escape del modelo
                            // rompa o falsifique la linea del footer.
                            const label = sanitizeSingleLine(firstLine);
                            spinner.update(label.length > 75 ? label.slice(0, 72) + '…' : label);
                        }
                    }
                    return;
                }
                case 'tool_call': {
                    terminal?.stopThinking();
                    spinner.stop();
                    terminal?.prepareForOutput();
                    // Show brief planning text (first line) then clear — it's narration,
                    // not the final response; the final response builds after the last tool call.
                    // First non-empty, non-recap line of the buffer as planning hint
                    const planningLines = agentResponseBuffer
                        .replace(/<recap>[\s\S]*?<\/recap>/g, '')
                        .split('\n')
                        .map(l => l.trim())
                        .filter(l => l.length > 0);
                    const brief = planningLines[0] ?? '';
                    if (brief.length > 10 && event.name !== 'ask_agent') {
                        process.stdout.write(
                            chalk.hex('#58A6FF').italic('  ↳ ' + (brief.length > 90 ? brief.slice(0, 87) + '…' : brief)) + '\n'
                        );
                    }
                    agentResponseBuffer = '';
                    spinnerLabelChunk = '';
                    spinnerLabelDone = false;
                    const argsStr = event.args_preview ?? '';
                    messageBuffer.add({ role: 'tool', content: `${event.name}(${argsStr.slice(0, 60)})`, timestamp: new Date(), meta: event.name });

                    // ask_agent: compact single line — use regex, not JSON.parse, because
                    // args_preview may be truncated and not valid JSON
                    if (event.name === 'ask_agent') {
                        const idMatch  = argsStr.match(/"agent_id"\s*:\s*"([^"]+)"/);
                        const qMatch   = argsStr.match(/"question"\s*:\s*"([^"]*)/);
                        const agentId  = idMatch?.[1] ?? '';
                        const rawQ     = (qMatch?.[1] ?? '').replace(/\\n/g, ' ').replace(/\*\*/g, '').replace(/#+\s*/g, '').trim();
                        const qPreview = rawQ.length > 65 ? rawQ.slice(0, 62) + '…' : rawQ;
                        const agentProfile = allAgents.find(a => a.id === agentId);
                        // Use the agent's own icon — no extra prefix to avoid duplication
                        const icon = agentProfile?.icon ?? '';
                        const name = agentProfile?.name ?? (agentId || '?');
                        process.stdout.write(
                            chalk.dim('  ') + chalk.cyan(icon) + chalk.bold(`  ${name}`) +
                            (qPreview ? chalk.dim('  ·  ' + qPreview) : '') + '\n'
                        );
                    } else {
                        try {
                            JSON.parse(argsStr);
                            console.log(formatToolCall(event.name, argsStr));
                            const diffOut = formatFileDiff(event.name, argsStr);
                            if (diffOut) process.stdout.write(diffOut + '\n');
                        } catch {
                            console.log(formatToolCall(event.name, JSON.stringify({ input: argsStr })));
                        }
                    }
                    spinner.startWithMetrics('Ejecutando…', liveMetrics);
                    return;
                }
                case 'tool_result': {
                    spinner.stop();
                    // result preview is short; rebuild a display string
                    const display = event.success
                        ? (event.preview ?? '✓')
                        : (event.preview ?? '✗ Error');
                    console.log(formatToolResult(display));
                    return;
                }
                case 'agent_switch': {
                    currentAgentId = event.to;
                    if ((event as any).from === 'orchestrator') return;
                    terminal?.stopThinking();
                    spinner.stop();
                    updateHeaderCallback();
                    return;
                }
                case 'block_start': {
                    terminal?.stopThinking();
                    spinner.stop();
                    terminal?.prepareForOutput();
                    agentResponseBuffer = '';
                    spinnerLabelChunk = '';
                    spinnerLabelDone = false;
                    const cur = allAgents.find(a => a.id === event.agent_id);
                    const agentIcon = event.agent_icon ?? cur?.icon ?? '◆';
                    const agentName = event.agent_name ?? cur?.name ?? event.agent_id;
                    if (event.agent_id === currentAgentId) {
                        // Main agent: full header with trailing dashes
                        process.stdout.write(formatAgentHeader(agentIcon, agentName) + '\n');
                    } else {
                        // Specialist: compact — name only, no fill dashes
                        process.stdout.write(formatAgentHeaderCompact(agentIcon, agentName) + '\n');
                    }
                    spinner.startWithMetrics('Pensando…', liveMetrics);
                    return;
                }
                case 'block_end': {
                    terminal?.stopThinking();
                    spinner.stop();
                    let text = agentResponseBuffer;
                    agentResponseBuffer = '';
                    // Extract ALL <recap> blocks — agents (orchestrator + sub-agents) may
                    // each add one. Remove all from displayed text and show only the last
                    // (most complete summary), deduplicated.
                    const allRecaps = [...text.matchAll(/<recap>([\s\S]*?)<\/recap>/g)];
                    text = text.replace(/<recap>[\s\S]*?<\/recap>/g, '').trim();
                    if (allRecaps.length > 0) {
                        const lastRecap = allRecaps[allRecaps.length - 1][1].trim();
                        showRecap(lastRecap);
                    }
                    if (text.trim() && !specGoActive) {
                        terminal?.prepareForOutput();
                        console.log(formatMarkdown(text));
                    }
                    process.stdout.write('\n');
                    return;
                }
                case 'thinking': {
                    terminal?.startThinking(event.label);
                    return;
                }
                case 'metrics': {
                    sessionStats.calls++;
                    sessionStats.inputTokens += event.input_tokens;
                    sessionStats.outputTokens += event.output_tokens;
                    liveMetrics.inputTokens = sessionStats.inputTokens;
                    liveMetrics.outputTokens = sessionStats.outputTokens;
                    const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
                    if (modelInfo && sessionStats.inputTokens + sessionStats.outputTokens > 0) {
                        liveMetrics.estimatedCostUsd =
                            (sessionStats.inputTokens / 1_000_000) * modelInfo.inputPriceM +
                            (sessionStats.outputTokens / 1_000_000) * modelInfo.outputPriceM;
                    }
                    return;
                }
                case 'done': {
                    terminal?.stopThinking();
                    spinner.stop();
                    // Any remaining buffer not flushed by block_end (edge case: no sub-agent blocks)
                    if (agentResponseBuffer.trim()) {
                        terminal?.prepareForOutput();
                        console.log(formatMarkdown(agentResponseBuffer));
                        agentResponseBuffer = '';
                    }
                    return;
                }
                case 'error': {
                    terminal?.stopThinking();
                    spinner.stop();
                    terminal?.prepareForOutput();
                    messageBuffer.add({ role: 'error', content: event.message, timestamp: new Date() });
                    console.log(formatCommandOutput(`${chalk.red('Error:')} ${event.message}`));
                    return;
                }
                case 'system': {
                    if (event.level === 'warn' || event.level === 'error') {
                        console.log(chalk.dim(`  [${event.level}] ${event.text}`));
                    }
                    return;
                }
                case 'compacting': {
                    if (event.phase === 'start') console.log(chalk.dim(`  [compacting] ${event.label}…`));
                    return;
                }
                default:
                    return;
            }
        }

        function showRecap(recap: string): void {
            if (!terminal) return;
            terminal.prepareForOutput();
            messageBuffer.add({ role: 'system', content: `※ recap: ${recap}`, timestamp: new Date(), meta: 'recap' });
            const preview = recap.length > 120 ? recap.slice(0, 117) + '…' : recap;
            process.stdout.write(chalk.dim('  ※  ') + chalk.dim.italic(preview) + '\n');
        }

        // ── Endurecimiento de las tools de archivos ───────────────────────────
        // Hallazgos A-1 y A-2 de la auditoria: el sandbox de rutas del framework es
        // lexico (un junction/symlink sale del proyecto) y read_file no distingue
        // archivos con credenciales. `createCodingEngine` pasa `tools: CODING_TOOLS`
        // por referencia a createBaseEngine y no hay API para inyectar tools
        // (hallazgo N-8), asi que se sustituyen las definiciones **antes** de crear
        // el engine. Es una medida temporal: se retira cuando el framework acepte
        // `tools`/`extraTools` (ver docs/auditorias/remediacion-v1.0.0.md).
        const toolGuards = applyToolGuards(CODING_TOOLS as unknown as ToolDefinitionLike[], {
            onSensitiveRead: async (sensitivePath: string) => {
                // En headless se deniega salvo --auto-approve, igual que el resto de
                // operaciones con impacto.
                if (agentEvents.isHeadless()) return !!options.autoApprove;
                terminal?.stopThinking();
                spinner.stop();
                const answer = await terminal.confirm(`Leer archivo sensible: ${sensitivePath}?`);
                return answer !== 'no';
            },
            log: (message) => {
                if (!agentEvents.isHeadless()) console.error(chalk.dim('  ' + message));
            },
        });
        if (toolGuards.missing.length > 0) {
            // Nunca en silencio: si el framework cambia su lista de tools, el guard
            // deja de aplicarse y hay que enterarse.
            const warning = `Guards de archivos no aplicados a: ${toolGuards.missing.join(', ')}`;
            if (agentEvents.isHeadless()) {
                agentEvents.emit({ type: 'system', level: 'warn', text: warning } as any);
            } else {
                console.warn(chalk.yellow(`⚠️  ${warning}`));
            }
        }

        // ── Engine factory ────────────────────────────────────────────────────
        const transport = new CallbackTransport(handleEvent);
        const engine = createCodingEngine({
            providers,
            defaultProvider,
            appName: 'bk-agent',
            workingDir: cwd,
            transport,
            ...(fileConfig.mcpServers?.length ? { mcpServers: fileConfig.mcpServers } : {}),
            orchestration: {
                enableQA: options.qa !== false,
                noQA: options.qa === false,
                onQAReview: handleQAReview,
            },
            maxIterations,
            onIterationLimit: async (stats: IterationStats) => {
                if (agentEvents.isHeadless()) {
                    agentEvents.emit({ type: 'system', level: 'warn', text: `limite de iteraciones: ${stats.maxIterations} -- continuando automaticamente` } as any);
                    return true;
                }
                process.stdout.write('\n');
                const result = await terminal.confirm(
                    `Limite de ${stats.maxIterations} iteraciones (tool calls: ${stats.toolCalls})? Continuar ${stats.maxIterations + 25} iteraciones mas?`
                );
                return result !== 'no';
            },
            onStep: async (stats: IterationStats) => {
                if (agentEvents.isHeadless()) return true;
                process.stdout.write('\n');
                const result = await terminal.confirm(
                    `paso ${stats.iterations} · ${stats.toolCalls} tool calls — Continuar?`
                );
                if (result === 'all') {
                    // User wants to run the rest without confirmations
                    engine.setIterationMode('auto');
                    return true;
                }
                return result !== 'no';
            },
            onToolApproval: async (toolName: string, agentId: string, argsPreview: string) => {
                const decision = decideApproval({
                    headless: agentEvents.isHeadless(),
                    autoApprove: !!options.autoApprove,
                    toolName,
                    argsPreview,
                    allowAll,
                });

                if (decision === 'reject') {
                    // Fail-closed en headless: se avisa una sola vez por sesion y se
                    // deniega. El frontend puede relanzar con --auto-approve.
                    if (!autoApproveWarned) {
                        autoApproveWarned = true;
                        agentEvents.emit({
                            type: 'system',
                            level: 'warn',
                            text: `Mutacion denegada (${toolName}): el modo headless no escribe ni ejecuta sin --auto-approve.`,
                        } as any);
                    }
                    return 'reject';
                }
                if (decision !== 'ask') return decision;

                terminal?.stopThinking();
                spinner.stop();
                const alwaysAsk = requiresAlwaysAsk(toolName, argsPreview);
                const result = await terminal.confirm(`${agentId} → ${toolName}(${argsPreview.slice(0, 60)})`);
                const answer = result === 'all' ? 'all' : result === 'no' ? 'no' : 'yes';
                const resolved = decisionFromUserAnswer(answer, alwaysAsk);
                if (resolved.allowAll) allowAll = true;
                return resolved.decision;
            },
        });
        engine.setIterationMode(resolvedMode);

        // ── Aprobaciones extra (hallazgo M-7) ─────────────────────────────────
        // `ApprovalGate` solo cubre write_file/edit_file/run_command, asi que las
        // tools de los servidores MCP (docker, design, curator…) y las de estado
        // del framework (save_context, update_session…) se ejecutaban sin
        // preguntar. Se envuelve `approvalGate.check`, que es el paso obligado de
        // toda tool call. No se pregunta por las MCP marcadas readOnlyHint ni en
        // modo `auto` (el framework deja el gate desactivado).
        const extraApprovals = applyExtraApprovals(engine as unknown as EngineWithGate, {
            onApproval: async (toolName: string, argsPreview: string) => {
                if (agentEvents.isHeadless()) return !!options.autoApprove;
                terminal?.stopThinking();
                spinner.stop();
                const answer = await terminal.confirm(`Ejecutar ${toolName}(${argsPreview.slice(0, 60)})?`);
                return answer !== 'no';
            },
            log: (message) => {
                if (!agentEvents.isHeadless()) console.error(chalk.dim('  ' + message));
            },
        });
        if (!extraApprovals.applied) {
            const warning = `Aprobaciones extra no aplicadas: ${extraApprovals.reason}`;
            if (agentEvents.isHeadless()) {
                agentEvents.emit({ type: 'system', level: 'warn', text: warning } as any);
            } else {
                console.warn(chalk.yellow(`⚠️  ${warning}`));
            }
        }

        // ── Run helper ────────────────────────────────────────────────────────
        async function runEngine(input: string): Promise<void> {
            running = true;
            // Estado del filtro headless limpio por turno.
            headlessStream = new HeadlessStreamFilter();
            try {
                const effectiveInput = pendingContext
                    ? `## Contexto inyectado\n${pendingContext}\n\n${input}`
                    : input;
                pendingContext = null;
                await engine.run(effectiveInput);
            } finally {
                // El timer de "thinking" solo se limpiaba en stopThinking(); si el
                // engine lanzaba, quedaba un setInterval eterno escribiendo al footer
                // y manteniendo vivo el proceso.
                terminal?.stopThinking();
                spinner.stop();
                running = false;
            }
        }

        // ── Initial header ────────────────────────────────────────────────────
        // En headless stdout es un protocolo JSON-Lines: el header ASCII lo
        // rompia (el frontend recibia lineas no-JSON antes del primer evento).
        if (!agentEvents.isHeadless()) {
            console.log(formatHeader(buildHeaderInfo()));
        }

        // ── Slash command registry ────────────────────────────────────────────
        const cmdRegistry = new SlashCommandRegistry();
        registerBuiltinCommands(cmdRegistry);

        // ─── Headless-mode slash commands (emit text) ─────────────────────────

        cmdRegistry.register('/help', 'Muestra los comandos disponibles', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            emit(buildHelpText(allSkills));
        });

        cmdRegistry.register('/clear', 'Limpiar pantalla', async () => {
            agentEvents.emit({ type: 'clear' } as any);
            agentEvents.emit({ type: 'done' });
        });

        cmdRegistry.register('/reset-context', 'Reiniciar conversacion', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            engine.clearHistory();
            emit('Conversacion reiniciada. Sistema y memoria se mantienen.');
        });

        cmdRegistry.register('/tokens', 'Uso de tokens en el contexto actual', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            const total = sessionStats.inputTokens + sessionStats.outputTokens;
            emit(`Tokens de sesion: entrada ${sessionStats.inputTokens.toLocaleString()} · salida ${sessionStats.outputTokens.toLocaleString()} · total ${total.toLocaleString()}`);
        });

        cmdRegistry.register('/usage', 'Tokens y costo de sub-agentes en esta sesion', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            const total = sessionStats.inputTokens + sessionStats.outputTokens;
            const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            const lines = [
                `Sub-agentes — llamadas: ${sessionStats.calls}`,
                `Entrada:  ${sessionStats.inputTokens.toLocaleString()} tk`,
                `Salida:   ${sessionStats.outputTokens.toLocaleString()} tk`,
                `Total:    ${total.toLocaleString()} tk`,
            ];
            if (modelInfo && total > 0) {
                const cost = ((sessionStats.inputTokens / 1_000_000) * modelInfo.inputPriceM + (sessionStats.outputTokens / 1_000_000) * modelInfo.outputPriceM).toFixed(5);
                lines.push(`Costo est.: $${cost} USD`);
            }
            emit(lines.join('\n'));
        });

        cmdRegistry.register('/status', 'Panel de estado del sistema', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            const cur = allAgents.find(a => a.id === currentAgentId);
            const lines = [
                `Agente:   ${cur ? cur.name + ' (' + currentAgentId + ')' : currentAgentId}`,
                `Modelo:   ${currentModel}`,
                `Skills:   ${allSkills.length} instalados`,
                `Agentes:  ${allAgents.length} perfiles`,
                `Tokens sesion: entrada ${sessionStats.inputTokens.toLocaleString()} · salida ${sessionStats.outputTokens.toLocaleString()}`,
            ];
            if (memoryContext?.activeProject) lines.push(`Memoria: ${memoryContext.activeProject}`);
            emit(lines.join('\n'));
        });

        cmdRegistry.register('/memory', 'Ver memoria persistente del proyecto activo', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            if (!memoryContext) { emit('Sin memoria activa.'); return; }
            emit(`Memoria: ${memoryContext.activeProject}\n\n${memoryContext.sessionContent || '(sesion-actual.md vacia)'}`);
        });

        cmdRegistry.register('/agent', 'Lista o cambia el agente activo', async ({ rawInput, args, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            if (!args) {
                const lines = ['Agentes disponibles — usa /agent <id> para cambiar:\n'];
                for (const a of allAgents) {
                    const mark = a.id === currentAgentId ? ' <- activo' : '';
                    lines.push(`  /agent ${a.id.padEnd(18)} ${a.icon} ${a.name}${mark}`);
                    if (a.description) lines.push(`    ${a.description}`);
                }
                emit(lines.join('\n'));
                return;
            }
            const profile = allAgents.find(a => a.id === args);
            if (!profile) { emit(`Agente no encontrado: ${args}\nUsa /agent para ver la lista.`); return; }
            engine.switchAgent(profile.id);
            engine.clearHistory();
            currentAgentId = profile.id;
            agentEvents.emit({ type: 'agent_switch', from: currentAgentId, to: profile.id, to_name: profile.name, to_icon: profile.icon });
            emit(`Agente cambiado a: ${profile.icon} ${profile.name} · historial reseteado`);
        });

        cmdRegistry.register('/models', 'Lista o cambia el modelo de IA', async ({ rawInput, args, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            if (!args) {
                const lines = ['Modelos disponibles — usa /models <id> para cambiar:\n'];
                for (const m of DEEPSEEK_MODELS) {
                    const mark = m.id === currentModel ? ' <- activo' : '';
                    lines.push(`  /models ${m.id.padEnd(20)} ${m.badge} ${m.name}${mark}`);
                    lines.push(`    $${m.inputPriceM}/$${m.outputPriceM}/M tokens · ${m.note}`);
                }
                emit(lines.join('\n'));
                return;
            }
            const modelInfo = DEEPSEEK_MODELS.find(m => m.id === args);
            if (!modelInfo) { emit(`Modelo no encontrado: ${args}`); return; }
            currentModel = modelInfo.id;
            liveMetrics.modelName = currentModel;
            // Note: model change takes effect on next run (engine reads from providers config)
            emit(`Modelo cambiado a: ${modelInfo.badge} ${modelInfo.name}`);
        });

        cmdRegistry.register('/skills', 'Lista los skills cargados', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            const lines = [`Skills instalados (${allSkills.length}):\n`];
            for (const s of allSkills) {
                lines.push(`  ${s.name} v${s.version}`);
                if (s.description) lines.push(`    ${s.description}`);
            }
            emit(lines.join('\n'));
        });

        cmdRegistry.register('/init', 'Inicializar o analizar proyecto con project-manager', async ({ rawInput }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            const pmProfile = allAgents.find(a => a.id === 'project-manager');
            if (!pmProfile) {
                agentEvents.emit({ type: 'block_start', agent_id: 'system', agent_name: 'Sistema' });
                agentEvents.emit({ type: 'token', content: 'Agente project-manager no encontrado.' });
                agentEvents.emit({ type: 'block_end', status: 'ok' });
                agentEvents.emit({ type: 'done' });
                return;
            }
            const fsInit = await import('fs/promises');
            const projectFiles = ['specification.md', 'design.md', 'package.json', 'go.mod', 'Cargo.toml', 'pom.xml', 'AGENT.md'];
            const found: string[] = [];
            for (const f of projectFiles) {
                try { await fsInit.access(path.join(cwd, f)); found.push(f); } catch { /* not present */ }
            }
            let promptMd: string | null = null;
            try { promptMd = await fsInit.readFile(path.join(cwd, 'prompt.md'), 'utf-8'); } catch { }
            const isExisting = found.length > 0;
            const baseMsg = isExisting
                ? `[/init] Proyecto existente detectado (${found.join(', ')}). Analiza el estado actual, identifica gaps en la documentacion y actualiza o crea specification.md y design.md segun corresponda.`
                : `[/init] Proyecto nuevo. Inicia el flujo de levantamiento de requisitos: haz las 4 preguntas requeridas antes de crear cualquier documento.`;
            const initMsg = promptMd ? `${baseMsg}\n\nContexto adicional desde prompt.md:\n\n${promptMd}` : baseMsg;
            engine.switchAgent(pmProfile.id);
            currentAgentId = pmProfile.id;
            agentEvents.emit({ type: 'agent_switch', from: currentAgentId, to: pmProfile.id, to_name: pmProfile.name, to_icon: pmProfile.icon });
            try {
                await runEngine(initMsg);
                agentEvents.emit({ type: 'done' });
            } catch (err: any) {
                agentEvents.emit({ type: 'error', message: err.message });
            }
        });

        cmdRegistry.register('/prompt', 'Genera un prompt estructurado desde una frase', async ({ rawInput, args }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            if (!args.startsWith('new')) {
                const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
                agentEvents.emit({ type: 'block_start', agent_id: 'system', agent_name: 'Sistema' });
                agentEvents.emit({ type: 'token', content: stripAnsi('Uso: /prompt new <frase inicial>') });
                agentEvents.emit({ type: 'block_end', status: 'ok' });
                agentEvents.emit({ type: 'done' });
                return;
            }
            const phrase = args.slice(3).trim();
            if (!phrase) {
                agentEvents.emit({ type: 'block_start', agent_id: 'system', agent_name: 'Sistema' });
                agentEvents.emit({ type: 'token', content: 'Uso: /prompt new <frase inicial>' });
                agentEvents.emit({ type: 'block_end', status: 'ok' });
                agentEvents.emit({ type: 'done' });
                return;
            }
            try {
                await runEngine(`Genera un prompt para: ${phrase}\n\nEscribe el prompt final en prompt.md usando write_file.`);
                agentEvents.emit({ type: 'done' });
            } catch (err: any) {
                agentEvents.emit({ type: 'error', message: err.message });
            }
        });

        // ── Headless mode ─────────────────────────────────────────────────────
        if (agentEvents.isHeadless()) {
            agentEvents.emit({ type: 'ready' });

            const emitConfig = async () => {
                const wsConfig = await loadWorkspaces('bk-agent');
                agentEvents.emit({
                    type: 'config',
                    agents: allAgents.map(a => ({ id: a.id, name: a.name, icon: a.icon ?? 'robot', description: a.description ?? '' })),
                    models: DEEPSEEK_MODELS.map(m => ({ id: m.id, name: m.name, badge: m.badge, note: m.note })),
                    commands: cmdRegistry.getAll().map(c => ({ name: c.name, description: c.description })),
                    currentAgent: currentAgentId,
                    currentModel,
                    skillsCount: allSkills.length,
                    activeWorkspace: activeWorkspaceName,
                    activeApp: activeAppPath,
                    workspaces: Object.entries(wsConfig).map(([name, entry]) => ({
                        name,
                        projects: entry.projects,
                        activeProject: entry.active,
                    })),
                } as any);
            };
            await emitConfig();

            // Called by /workspace switch and /switch when the active project changes
            const headlessOnCwdChange = async (newCwd: string): Promise<void> => {
                activeAppPath = newCwd;
                const wsConfig = await loadWorkspaces('bk-agent');
                let activeWsEntry: (typeof wsConfig)[string] | undefined;
                for (const [wsName, wsEntry] of Object.entries(wsConfig)) {
                    if (wsEntry.projects.some(p => p.cwd === newCwd)) {
                        activeWorkspaceName = wsName;
                        activeWsEntry = wsEntry;
                        break;
                    }
                }
                // Use commonRoot as workingDir when workspace spans multiple projects
                const effectiveDir = activeWsEntry?.commonRoot ?? newCwd;
                engine.updateWorkingDir(effectiveDir);
                memoryContext = await loadAppMemory(newCwd);
                projectName = path.basename(newCwd);
                if (activeWorkspaceName && activeWsEntry) {
                    pendingContext = await buildWorkspaceContext(activeWorkspaceName, activeWsEntry, 'bk-agent');
                } else {
                    pendingContext = `## Project: ${projectName}\n\n${memoryContext?.sessionContent || '*(empty)*'}`;
                }
                await emitConfig();
            };

            // Headless /switch — delegates to framework /workspace switch with onCwdChange
            cmdRegistry.register('/switch', 'Cambiar workspace/proyecto activo', async (ctx) => {
                const target = ctx.args.trim();
                await cmdRegistry.dispatch(
                    target ? `/workspace switch ${target}` : '/workspace switch',
                    { ...ctx, ...engine.getCommandBindings(), appName: 'bk-agent', onCwdChange: headlessOnCwdChange, injectContext: (m) => { pendingContext = m; } },
                );
                await emitConfig();
            });

            const { createInterface } = await import('readline');
            const rl = createInterface({ input: process.stdin, terminal: false });
            const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

            const emitBlock = (text: string): void => {
                agentEvents.emit({ type: 'block_start', agent_id: 'system', agent_name: 'Sistema' });
                agentEvents.emit({ type: 'token', content: stripAnsi(text) });
                agentEvents.emit({ type: 'block_end', status: 'ok' });
                agentEvents.emit({ type: 'done' });
            };

            rl.on('line', async (rawLine: string) => {
                const trimmed = rawLine.trim();
                if (!trimmed) return;
                try {
                    const msg = JSON.parse(trimmed);
                    if (msg.type === 'user_input') {
                        const text = String(msg.text ?? '').trim();
                        if (!text) return;
                        if (text.startsWith('/') || text.startsWith('@')) {
                            const handled = await cmdRegistry.dispatch(text, {
                                ...engine.getCommandBindings(),
                                emit: emitBlock,
                                agents: allAgents.map(a => ({ id: a.id, name: a.name, description: a.description })),
                                skills: allSkills.map(s => ({ name: s.name, description: s.description, triggers: s.triggers ?? [] })),
                                effectiveAgentId: currentAgentId,
                                model: currentModel,
                                projectDir: memoryContext?.projectDir,
                                sessionContent: memoryContext?.sessionContent ?? '',
                                injectContext: (ctxMsg: string) => { pendingContext = ctxMsg; },
                                appName: 'bk-agent',
                                onCwdChange: headlessOnCwdChange,
                            });
                            if (handled) return;
                            agentEvents.emit({ type: 'user_message', text } as any);
                            emitBlock(`Comando no disponible en modo desktop: ${text.split(' ')[0]}`);
                            return;
                        }
                        agentEvents.emit({ type: 'user_message', text } as any);
                        try {
                            await runEngine(text);
                        } catch (err: any) {
                            agentEvents.emit({ type: 'error', message: err.message });
                        }
                    } else if (msg.type === 'interrupt') {
                        engine.abort();
                        running = false;
                    }
                } catch { /* non-JSON line: ignore */ }
            });

            rl.on('close', () => {
                engine.abort();
                process.exit(0);
            });
            return;
        }

        // ── Terminal (TUI) overrides ──────────────────────────────────────────

        const showHeader = () => {
            console.clear();
            process.stdout.write(formatHeader(buildHeaderInfo()));
            updateHeaderCallback();
            terminal.useDirectPrompt();
        };

        const interrupt = () => {
            if (!running) return;
            terminal.stopThinking();
            spinner.stop();
            engine.abort();
            running = false;
            process.stdout.write('\n' + chalk.yellow('  ⊘ Abortado\n'));
        };

        process.on('SIGINT', interrupt);

        // Terminal command overrides (rich chalk output)
        cmdRegistry.register('/help', 'Muestra los comandos disponibles', async () => {
            console.log(formatCommandOutput(buildHelpText(allSkills)));
        });

        cmdRegistry.register('/clear', 'Limpiar pantalla', async () => {
            messageBuffer.clear();
            showHeader();
        });

        cmdRegistry.register('/reset-context', 'Reiniciar conversacion', async () => {
            engine.clearHistory();
            showHeader();
            console.log(formatCommandOutput('💬 Conversacion reiniciada — el sistema y la memoria se mantienen.'));
        });

        cmdRegistry.register('/context', 'Ver contexto activo del proyecto', async () => {
            const parts: string[] = [];
            if (memoryContext?.sessionContent) {
                parts.push(chalk.bold('🧠 Sesion activa') + chalk.dim(`  ${memoryContext.activeProject}`) + '\n' + formatMarkdown(memoryContext.sessionContent));
            }
            const text = parts.length > 0
                ? parts.join('\n\n' + chalk.dim('─'.repeat(40)) + '\n\n')
                : chalk.dim('(sin contexto cargado)');
            console.log(formatCommandOutput(text));
        });

        cmdRegistry.register('/tokens', 'Uso de tokens en el contexto actual', async () => {
            const total = sessionStats.inputTokens + sessionStats.outputTokens;
            console.log(formatCommandOutput(
                `Sesion — entrada: ${chalk.cyan(sessionStats.inputTokens.toLocaleString() + ' tk')}  salida: ${chalk.cyan(sessionStats.outputTokens.toLocaleString() + ' tk')}  total: ${chalk.cyan(total.toLocaleString() + ' tk')}`
            ));
        });

        cmdRegistry.register('/usage', 'Tokens y costo de sub-agentes en esta sesion', async () => {
            const total = sessionStats.inputTokens + sessionStats.outputTokens;
            const model = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            const lines: string[] = [
                chalk.bold('📊 Uso de tokens — sesion actual'),
                '',
                chalk.dim('Sub-agentes (ask_agent + QA):'),
                `  Llamadas:  ${chalk.cyan(String(sessionStats.calls))}`,
                `  Entrada:   ${chalk.cyan(sessionStats.inputTokens.toLocaleString() + ' tk')}`,
                `  Salida:    ${chalk.cyan(sessionStats.outputTokens.toLocaleString() + ' tk')}`,
                `  Total:     ${chalk.cyan(total.toLocaleString() + ' tk')}`,
            ];
            if (model && total > 0) {
                const cost = ((sessionStats.inputTokens / 1_000_000) * model.inputPriceM + (sessionStats.outputTokens / 1_000_000) * model.outputPriceM).toFixed(5);
                lines.push(`  Costo est: ${chalk.cyan('$' + cost + ' USD')}`);
            }
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/status', 'Panel de estado del sistema', async () => {
            const cur = allAgents.find(a => a.id === currentAgentId);
            const total = sessionStats.inputTokens + sessionStats.outputTokens;
            const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            const lines: string[] = [
                chalk.bold('📊 Estado del sistema'),
                '',
                chalk.dim('Agente:') + '  ' + (cur ? chalk.cyan(cur.icon + ' ' + cur.name + ' (' + currentAgentId + ')') : chalk.cyan(currentAgentId)),
                chalk.dim('Modelo:') + '  ' + chalk.cyan(currentModel),
                chalk.dim('Skills:') + '  ' + chalk.cyan(String(allSkills.length)) + chalk.dim(' instalados'),
                chalk.dim('Agentes:') + '  ' + chalk.cyan(String(allAgents.length)) + chalk.dim(' perfiles'),
                '',
                chalk.bold('📈 Sub-agentes (sesion)'),
                chalk.dim('Llamadas:') + '  ' + chalk.cyan(String(sessionStats.calls)),
                chalk.dim('Tokens:') + '  ' + chalk.cyan(total.toLocaleString() + ' tk'),
            ];
            if (sessionStats.calls > 0 && modelInfo) {
                const cost = ((sessionStats.inputTokens / 1_000_000) * modelInfo.inputPriceM + (sessionStats.outputTokens / 1_000_000) * modelInfo.outputPriceM).toFixed(6);
                lines.push(chalk.dim('Costo est.:') + '  ' + chalk.cyan('$' + cost + ' USD'));
            }
            if (memoryContext?.activeProject) {
                lines.push('');
                lines.push(chalk.bold('🧠 Memoria activa'));
                lines.push(chalk.dim('Proyecto:') + '  ' + chalk.magenta(memoryContext.activeProject));
            }
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/memory', 'Ver memoria persistente del proyecto activo', async () => {
            if (!memoryContext) {
                console.log(formatCommandOutput(chalk.dim('Sin memoria activa.')));
                return;
            }
            const icon = '💾';
            const src = chalk.dim(`  ${memoryContext.projectDir}`);
            const lines = [
                chalk.bold(`${icon} Memoria · ${memoryContext.activeProject}`) + src,
                '',
                memoryContext.sessionContent ? formatMarkdown(memoryContext.sessionContent) : chalk.dim('  (sesion-actual.md vacia)'),
            ];
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/skills', 'Ver, instalar o crear skills', async () => {
            const menuItems: { label: string; value: string }[] = [];
            for (const s of allSkills) {
                menuItems.push({ label: chalk.green('✓ ') + chalk.bold(s.name), value: `local:${s.name}` });
            }
            if (menuItems.length === 0) {
                menuItems.push({ label: chalk.dim('(sin skills disponibles)'), value: '__empty__' });
            }
            const subtitle = chalk.dim(`${allSkills.length} instalado${allSkills.length !== 1 ? 's' : ''}`);
            const chosen = await terminal.filteredSelect(`Skills  ${subtitle}`, menuItems, [{ label: chalk.dim('+ Crear nuevo skill…'), value: '__new__' }]);
            if (!chosen || chosen === '__empty__') return;
            if (chosen === '__new__') {
                const name = await terminal.input('Nombre del skill:');
                if (!name) { console.log(formatCommandOutput(chalk.dim('Cancelado.'))); return; }
                const desc = (await terminal.input('Descripcion:')) ?? '';
                const triggersRaw = await terminal.input('Triggers (separados por coma):');
                if (!triggersRaw) { console.log(formatCommandOutput(chalk.dim('Cancelado.'))); return; }
                const triggers = triggersRaw.split(',').map((t: string) => t.trim()).filter(Boolean);
                const fsio = await import('fs/promises');
                await fsio.mkdir(skillsDir, { recursive: true });
                await fsio.writeFile(path.join(skillsDir, `${name}.yaml`), yaml.stringify({ name, version: '1.0', description: desc, triggers, systemPromptAddition: `Eres experto en ${name}. ${desc}\n` }));
                allSkills = await loadSkills(skillsDir);
                updateHeaderCallback();
                console.log(formatCommandOutput(chalk.green(`✓ Skill creado: ${name}`) + '\n' + chalk.dim(`  triggers: ${triggers.join(', ')}`)));
                return;
            }
            if (chosen.startsWith('local:')) {
                const s = allSkills.find(sk => sk.name === chosen.slice(6));
                if (s) {
                    console.log(formatCommandOutput(
                        chalk.bold(`📚 ${s.name}`) + chalk.dim(`  v${s.version}`) + '\n' +
                        chalk.dim(`   ${s.description}`) + '\n' +
                        chalk.dim(`   triggers: ${s.triggers.join(', ')}`)
                    ));
                }
            }
        });

        cmdRegistry.register('/agent', 'Lista o cambia el agente activo', async ({ args }) => {
            if (running) { console.log(formatCommandOutput(chalk.yellow('Agente ocupado — espera antes de cambiar.'))); return; }
            if (!args) {
                const menuItems = allAgents.map(a => {
                    const active = a.id === currentAgentId;
                    return { label: `${active ? chalk.green('✓') : ' '} ${a.icon} ${chalk.bold(a.name)}`, description: a.description, value: a.id };
                });
                const chosen = await terminal.select(`Cambiar agente  ${chalk.dim('(actual: ' + currentAgentId + ')')}`, menuItems);
                if (!chosen || chosen === currentAgentId) {
                    if (!chosen) console.log(formatCommandOutput(chalk.dim('Cancelado')));
                    return;
                }
                args = chosen;
            }
            const profile = allAgents.find(a => a.id === args);
            if (!profile) { console.log(formatCommandOutput(chalk.red(`Agente no encontrado: ${args}`))); return; }
            const reset = await terminal.yesNo(`¿Resetear historial para ${profile.icon} ${profile.name}?`, true);
            engine.switchAgent(profile.id);
            if (reset) engine.clearHistory();
            currentAgentId = profile.id;
            updateHeaderCallback();
            console.log(formatCommandOutput(chalk.green(`✓ Agente: ${profile.icon} ${profile.name}`) + (reset ? chalk.dim('  · historial reseteado') : '')));
        });

        cmdRegistry.register('/models', 'Lista o cambia el modelo de IA', async () => {
            if (running) { console.log(formatCommandOutput(chalk.yellow('Agente ocupado — espera antes de cambiar modelo.'))); return; }
            const menuItems = DEEPSEEK_MODELS.map(m => {
                const active = m.id === currentModel;
                const price = chalk.dim(`$${m.inputPriceM}/$${m.outputPriceM}/M`);
                return { label: `${active ? chalk.green('✓') : ' '} ${m.badge} ${chalk.bold(m.name)}  ${price}`, description: m.note, value: m.id };
            });
            const chosen = await terminal.select('Cambiar modelo', menuItems);
            if (chosen && chosen !== currentModel) {
                currentModel = chosen;
                liveMetrics.modelName = currentModel;
                updateHeaderCallback();
                const info = DEEPSEEK_MODELS.find(m => m.id === chosen)!;
                console.log(formatCommandOutput(chalk.green(`✓ Modelo: ${info.badge} ${info.name}`) + chalk.dim(`  (${chosen})`)));
            } else if (!chosen) {
                console.log(formatCommandOutput(chalk.dim('Cancelado')));
            }
        });

        cmdRegistry.register('/iteration', 'Ver o cambiar modo de iteracion', async () => {
            const currentMode = engine.getIterationMode();
            const menuItems = validModes.map(m => ({
                label: (m === currentMode ? chalk.green('✓ ') : '  ') + m,
                value: m,
            }));
            const chosen = await terminal.select(`Modo de iteracion actual: ${chalk.cyan(currentMode)}`, menuItems);
            if (chosen && chosen !== currentMode) {
                engine.setIterationMode(chosen as IterationMode);
                console.log(formatCommandOutput(chalk.green(`✓ Modo cambiado a: ${chosen}`)));
            } else if (!chosen) {
                console.log(formatCommandOutput(chalk.dim('Cancelado')));
            }
        });

        cmdRegistry.register('/init', 'Inicializar o analizar proyecto con project-manager', async () => {
            if (running) { console.log(formatCommandOutput(chalk.yellow('Agente ocupado — espera antes de ejecutar /init.'))); return; }
            const pmProfile = allAgents.find(a => a.id === 'project-manager');
            if (!pmProfile) { console.log(formatCommandOutput(chalk.red('Agente project-manager no encontrado.'))); return; }
            const fsInit = await import('fs/promises');
            const projectFiles = ['specification.md', 'design.md', 'package.json', 'go.mod', 'Cargo.toml', 'pom.xml', 'AGENT.md'];
            const found: string[] = [];
            for (const f of projectFiles) {
                try { await fsInit.access(path.join(cwd, f)); found.push(f); } catch { }
            }
            let promptMdContent: string | null = null;
            try {
                promptMdContent = await fsInit.readFile(path.join(cwd, 'prompt.md'), 'utf-8');
                console.log(formatCommandOutput(chalk.cyan('  · prompt.md encontrado — usado como contexto inicial')));
            } catch { }
            const isExisting = found.length > 0;
            const workspaceCtx = activeWorkspaceName ? ` Workspace activo: ${activeWorkspaceName} | App: ${path.basename(activeAppPath)}.` : '';
            const baseMsg = isExisting
                ? `[/init] Proyecto existente (${found.join(', ')}).${workspaceCtx} Analiza, identifica gaps y actualiza especificacion y diseno.`
                : `[/init] Proyecto nuevo.${workspaceCtx} Inicia el flujo de levantamiento: 4 preguntas requeridas antes de crear documentos.`;
            const initMsg = promptMdContent ? `${baseMsg}\n\nDesde prompt.md:\n\n${promptMdContent}` : baseMsg;
            engine.switchAgent(pmProfile.id);
            engine.clearHistory();
            currentAgentId = pmProfile.id;
            updateHeaderCallback();
            console.log(formatCommandOutput(chalk.green(`✓ ${pmProfile.icon} Project Manager activado`) + chalk.dim(`  · ${isExisting ? 'proyecto existente' : 'nuevo'} · historial reseteado`)));
            await runEngine(initMsg);
        });

        // ── /spec.* — Spec-driven development ────────────────────────────────────
        // Design phase — only needs an active project, no plugin required
        const specDesignGuard = (): string | null => {
            if (running) { console.log(formatCommandOutput(chalk.yellow('Agente ocupado.'))); return null; }
            if (!activeAppPath) { console.log(formatCommandOutput(chalk.yellow('No hay proyecto activo.'))); return null; }
            return activeAppPath;
        };

        // Execution phase — requires design-agent MCP plugin for state tracking
        const specGuard = (): string | null => {
            if (running) { console.log(formatCommandOutput(chalk.yellow('Agente ocupado.'))); return null; }
            const hasMcp = (fileConfig.mcpServers ?? []).some((s: any) => s.name === 'design');
            if (!hasMcp) {
                console.log(formatCommandOutput(
                    chalk.yellow('⚠  Plugin "design" no configurado.') + '\n' +
                    chalk.dim('Agrega en ~/.bk-agent/config.json → mcpServers:\n') +
                    chalk.dim('  { "name": "design", "command": "node", "args": ["...dist/server.js"] }'),
                ));
                return null;
            }
            return activeAppPath;
        };

        const specReadFile = (dir: string, filename: string): string | null => {
            try { return require('fs').readFileSync(path.join(dir, filename), 'utf8'); }
            catch { return null; }
        };

        // Validado y testeado en src/spec/design-state.ts: un design.json corrupto
        // o incompleto devuelve null en vez de romper el comando con un TypeError.
        const specReadDesign = (dir: string): DesignState | null => readDesignState(dir);

        // Switches to agentId if not already active. Does NOT clear history (design is iterative).
        const specSwitchAgent = (agentId: string): void => {
            if (currentAgentId === agentId) return;
            const profile = allAgents.find(a => a.id === agentId);
            if (!profile) return;
            engine.switchAgent(profile.id);
            currentAgentId = profile.id;
            updateHeaderCallback();
            console.log(formatCommandOutput(chalk.green(`✓ ${profile.icon} ${profile.name} activado`)));
        };

        // ── Design phase ─────────────────────────────────────────────────────

        cmdRegistry.register('/spec.prompt', 'Guarda requisitos iniciales en prompt.md', async ({ args }) => {
            const dir = specDesignGuard(); if (!dir) return;
            if (!args.trim()) { console.log(formatCommandOutput(chalk.dim('Uso: /spec.prompt <descripción>  |  /spec.prompt --file <ruta>'))); return; }
            let content = args.trim();
            if (content.startsWith('--file ')) {
                const filePath = content.slice(7).trim();
                const absPath = path.isAbsolute(filePath) ? filePath : path.join(dir, filePath);
                try { content = require('fs').readFileSync(absPath, 'utf8'); }
                catch { console.log(formatCommandOutput(chalk.red(`No se pudo leer: ${absPath}`))); return; }
            }
            console.log(formatCommandOutput(chalk.cyan('Guardando prompt.md...')));
            await runEngine(
                `Guarda el siguiente contenido en el archivo "${dir}/prompt.md":\n\n${content}` +
                `\n\nDespués de guardar, confirma brevemente. NO llames ningún otro tool.`,
            );
        });

        cmdRegistry.register('/spec.specify', 'Genera specification.md desde prompt.md', async ({ args }) => {
            const dir = specDesignGuard(); if (!dir) return;
            specSwitchAgent('architecture');
            const hint = args.trim() ? `\nFoco adicional: ${args.trim()}` : '';
            console.log(formatCommandOutput(chalk.cyan('Generando specification.md...')));
            await runEngine(
                `Lee "${dir}/prompt.md" si existe.${hint}` +
                `\nGenera una especificación completa: requisitos funcionales, contratos de API, modelos de datos, reglas de negocio, casos de uso.` +
                `\nGuarda el resultado en "${dir}/specification.md".` +
                `\nMuestra un resumen de lo generado.` +
                `\nIMPORTANTE: Solo genera y guarda — no ejecutes ninguna otra acción.`,
            );
        });

        cmdRegistry.register('/spec.plan', 'Genera design.md (arquitectura) desde la especificación', async ({ args }) => {
            const dir = specDesignGuard(); if (!dir) return;
            specSwitchAgent('architecture');
            const hint = args.trim() ? `\nFoco adicional: ${args.trim()}` : '';
            console.log(formatCommandOutput(chalk.cyan('Generando design.md...')));
            await runEngine(
                `Lee "${dir}/specification.md" y "${dir}/prompt.md" si existen.${hint}` +
                `\nGenera un plan de arquitectura: C4 L1, stack técnico y justificación, componentes principales, flujo de datos, decisiones no obvias y trade-offs.` +
                `\nGuarda el resultado en "${dir}/design.md".` +
                `\nMuestra un resumen de la arquitectura propuesta.` +
                `\nIMPORTANTE: Solo genera y guarda — no ejecutes ninguna otra acción.`,
            );
        });

        cmdRegistry.register('/spec.init', 'Inicializa el roadmap de fases desde los documentos de diseño', async () => {
            const dir = specGuard(); if (!dir) return;
            specSwitchAgent('architecture');
            console.log(formatCommandOutput(chalk.cyan('Inicializando roadmap de fases...')));
            await runEngine(
                `Lee los documentos en "${dir}": specification.md, design.md (los que existan).` +
                `\nLista los subdirectorios de "${dir}" y lee el AGENT.md de cada uno que lo tenga.` +
                `\nDeriva las fases de desarrollo. Cada fase: nombre, descripción, criterios de verificación testables.` +
                `\nLuego llama design_init con cwd="${dir}", nombre del proyecto, descripción y las fases derivadas.` +
                `\nIMPORTANTE: NO llames design_next ni design_advance — inicializa y detente. NO delegues a otros agentes.`,
            );
            // After runEngine (QA may have fired — that's ok), show clean roadmap from design.json directly
            const stateInit = specReadDesign(dir);
            if (stateInit) {
                const done = stateInit.phases.filter((p: any) => p.status === 'complete').length;
                const lines = [`✅ Roadmap creado: ${stateInit.project}  [${done}/${stateInit.phases.length} fases]`, ''];
                for (const p of stateInit.phases) {
                    const icon = p.status === 'complete' ? '✓' : p.status === 'in_progress' ? '◉' : p.status === 'blocked' ? '✗' : '○';
                    lines.push(`  ${icon}  ${p.number}. ${p.name}`);
                }
                lines.push('', chalk.dim('Usa /spec.show.roadmap para detalles o /spec.next para comenzar la ejecución.'));
                console.log(formatCommandOutput(lines.join('\n')));
            }
        });

        // ── Show — lee archivos directamente sin coste de LLM ───────────────

        cmdRegistry.register('/spec.show.prompt', 'Muestra prompt.md', async () => {
            const dir = specDesignGuard(); if (!dir) return;
            const content = specReadFile(dir, 'prompt.md');
            console.log(formatCommandOutput(content ?? chalk.dim('(prompt.md no existe — usa /spec.prompt para crearlo)')));
        });

        cmdRegistry.register('/spec.show.specify', 'Muestra specification.md', async () => {
            const dir = specDesignGuard(); if (!dir) return;
            const content = specReadFile(dir, 'specification.md');
            console.log(formatCommandOutput(content ?? chalk.dim('(specification.md no existe — usa /spec.specify)')));
        });

        cmdRegistry.register('/spec.show.plan', 'Muestra design.md (arquitectura)', async () => {
            const dir = specDesignGuard(); if (!dir) return;
            const content = specReadFile(dir, 'design.md');
            console.log(formatCommandOutput(content ?? chalk.dim('(design.md no existe — usa /spec.plan)')));
        });

        cmdRegistry.register('/spec.show.roadmap', 'Muestra roadmap de fases — /spec.show.roadmap [fase]', async ({ args }) => {
            const dir = specDesignGuard(); if (!dir) return;
            const state = specReadDesign(dir);
            if (!state) {
                console.log(formatCommandOutput(chalk.dim('(No hay roadmap — usa /spec.init para crearlo)')));
                return;
            }
            const faseNum = parseInt(args.trim(), 10);
            const stageIcon: Record<string, string> = { spec: '📐 SPEC', implement: '🔨 IMPLEMENT', verify: '✅ VERIFY' };
            if (faseNum && !isNaN(faseNum)) {
                const p = state.phases.find((ph: any) => ph.number === faseNum);
                if (!p) { console.log(formatCommandOutput(chalk.red(`Fase ${faseNum} no encontrada`))); return; }
                const icon = p.status === 'complete' ? '✓' : p.status === 'in_progress' ? '◉' : p.status === 'blocked' ? '✗' : '○';
                const lines = [
                    `${icon}  Fase ${p.number}/${state.phases.length}: ${p.name}  [${p.status}${p.status === 'in_progress' ? ' / ' + (stageIcon[p.stage ?? ''] ?? p.stage) : ''}]`,
                    '',
                    p.description,
                ];
                if (p.criteria?.length) { lines.push('', 'Criterios:'); p.criteria.forEach((c: string) => lines.push(`  - ${c}`)); }
                if (p.log?.length)     { lines.push('', 'Log:');       p.log.slice(-3).forEach((l: string) => lines.push(`  ${l}`)); }
                console.log(formatCommandOutput(lines.join('\n')));
            } else {
                const done  = state.phases.filter((p: any) => p.status === 'complete').length;
                const total = state.phases.length;
                const cur   = state.phases.find((p: any) => p.number === state.currentPhase);
                const lines = [`${state.project}  [${done}/${total}]`, ''];
                for (const p of state.phases) {
                    const icon = p.status === 'complete' ? '✓' : p.status === 'in_progress' ? '◉' : p.status === 'blocked' ? '✗' : '○';
                    const tag  = p.status === 'in_progress' ? `  ${stageIcon[p.stage ?? ''] ?? p.stage}` : '';
                    lines.push(`  ${icon}  ${p.number}. ${p.name}${tag}`);
                }
                if (cur && done < total) lines.push('', `Fase ${cur.number}/${total} — ${stageIcon[cur.stage ?? ''] ?? cur.stage}`);
                else if (done === total) lines.push('', '✅ Todas las fases completas');
                console.log(formatCommandOutput(lines.join('\n')));
            }
        });

        // ── Revise — itera sobre documentos existentes ───────────────────────

        cmdRegistry.register('/spec.revise.prompt', 'Corrige o amplía prompt.md', async ({ args }) => {
            const dir = specDesignGuard(); if (!dir) return;
            if (!args.trim()) { console.log(formatCommandOutput(chalk.dim('Uso: /spec.revise.prompt <feedback>'))); return; }
            specSwitchAgent('architecture');
            console.log(formatCommandOutput(chalk.cyan('Revisando prompt.md...')));
            await runEngine(
                `Lee "${dir}/prompt.md".` +
                `\nEl desarrollador pide: ${args.trim()}` +
                `\nAplica los cambios manteniendo todo lo que no se menciona explícitamente.` +
                `\nGuarda el contenido actualizado en "${dir}/prompt.md".` +
                `\nMuestra qué cambió.`,
            );
        });

        cmdRegistry.register('/spec.revise.specify', 'Corrige o amplía specification.md', async ({ args }) => {
            const dir = specDesignGuard(); if (!dir) return;
            if (!args.trim()) { console.log(formatCommandOutput(chalk.dim('Uso: /spec.revise.specify <feedback>'))); return; }
            specSwitchAgent('architecture');
            console.log(formatCommandOutput(chalk.cyan('Revisando specification.md...')));
            await runEngine(
                `Lee "${dir}/specification.md".` +
                `\nEl desarrollador pide: ${args.trim()}` +
                `\nAplica los cambios al documento completo manteniendo todo lo que no se menciona.` +
                `\nGuarda el contenido actualizado en "${dir}/specification.md".` +
                `\nMuestra un diff resumido: qué se agregó, cambió o eliminó.`,
            );
        });

        cmdRegistry.register('/spec.revise.plan', 'Corrige o amplía design.md', async ({ args }) => {
            const dir = specDesignGuard(); if (!dir) return;
            if (!args.trim()) { console.log(formatCommandOutput(chalk.dim('Uso: /spec.revise.plan <feedback>'))); return; }
            specSwitchAgent('architecture');
            console.log(formatCommandOutput(chalk.cyan('Revisando design.md...')));
            await runEngine(
                `Lee "${dir}/design.md".` +
                `\nEl desarrollador pide: ${args.trim()}` +
                `\nAplica los cambios al documento completo manteniendo todo lo que no se menciona.` +
                `\nGuarda el contenido actualizado en "${dir}/design.md".` +
                `\nMuestra un diff resumido: qué se agregó, cambió o eliminó.`,
            );
        });

        // ── Execution phase ──────────────────────────────────────────────────

        cmdRegistry.register('/spec.next', 'Muestra instrucciones de la etapa actual y activa modo driving', async () => {
            const dir = specGuard(); if (!dir) return;
            specSwitchAgent('general');
            // If in IMPLEMENT after a failed VERIFY, inject QA findings as context
            let qaContext = '';
            const stateNext = specReadDesign(dir);
            if (stateNext) {
                const phase = stateNext.phases.find((p: any) => p.number === stateNext.currentPhase);
                if (phase?.stage === 'implement') {
                    const qaFile = path.join(dir, `qa-phase${phase.number}.md`);
                    const fs = require('fs') as typeof import('fs');
                    if (fs.existsSync(qaFile)) {
                        const qaContent = fs.readFileSync(qaFile, 'utf8').slice(0, 2000);
                        qaContext = `\n\nHallazgos de QA (qa-phase${phase.number}.md) de la iteración anterior — el agente debe abordarlos:\n${qaContent}`;
                    }
                }
            }
            console.log(formatCommandOutput(chalk.cyan('Cargando instrucciones de la etapa actual...')));
            await runEngine(
                `Llama design_next con cwd "${dir}".` +
                `\nMuestra las instrucciones de la etapa de forma clara.${qaContext}` +
                `\nIMPORTANTE: Solo presenta qué debe hacerse — NO empieces a implementar, NO ejecutes código, NO llames otros tools.`,
            );
            pendingContext =
                `[SPEC ACTIVO — cwd: ${dir}] Estás en modo spec-driven. Las instrucciones de la etapa activa se mostraron arriba. ` +
                `Responde preguntas y ayuda al usuario SOLO cuando lo pida explícitamente. ` +
                `NO avances de etapa ni llames design_advance por tu cuenta. ` +
                `Cuando el usuario termine, llamará /spec.advance.`;
        });

        cmdRegistry.register('/spec.run', 'Genera código de la fase actual — orquesta especialistas, QA entra al avanzar', async () => {
            const dir = specGuard(); if (!dir) return;
            const state = specReadDesign(dir);
            if (!state) { console.log(formatCommandOutput(chalk.dim('(No hay roadmap — usa /spec.init primero)'))); return; }
            const phase = state.phases.find((p: any) => p.number === state.currentPhase);
            if (!phase) { console.log(formatCommandOutput(chalk.red('No hay fase activa'))); return; }

            const stageLabel: Record<string, string> = { spec: '📐 SPEC', implement: '🔨 IMPLEMENT', verify: '✅ VERIFY' };
            console.log(formatCommandOutput(
                chalk.bold(`Fase ${phase.number}/${state.phases.length}: ${phase.name}`) +
                chalk.dim(`  [${stageLabel[phase.stage ?? ''] ?? phase.stage}]`),
            ));

            if (phase.stage === 'verify') {
                console.log(formatCommandOutput(
                    chalk.yellow('VERIFY se ejecuta automáticamente al avanzar desde IMPLEMENT.\n') +
                    chalk.green('  /spec.advance --passed') + chalk.dim(' "notas"  → fase completa\n') +
                    chalk.red('  /spec.advance --failed') + chalk.dim(' "notas"  → revierte a IMPLEMENT'),
                ));
                return;
            }

            // If in SPEC, advance to IMPLEMENT transparently before generating code
            if (phase.stage === 'spec') {
                console.log(formatCommandOutput(chalk.dim('Avanzando a IMPLEMENT...')));
                await runEngine(
                    `Llama design_advance con cwd "${dir}" y notes "avanzando a implementación".` +
                    `\nIMPORTANTE: Solo llama design_advance, nada más.`,
                );
            }

            // Inject QA findings if this is a retry after a failed VERIFY
            const fsRun = require('fs') as typeof import('fs');
            const qaFile = path.join(dir, `qa-phase${phase.number}.md`);
            const qaContext = fsRun.existsSync(qaFile)
                ? `\n\nHallazgos de QA (qa-phase${phase.number}.md) que deben corregirse en esta iteración:\n${fsRun.readFileSync(qaFile, 'utf8').slice(0, 2000)}`
                : '';

            specSwitchAgent('general');
            console.log(formatCommandOutput(chalk.cyan(`Implementando Fase ${phase.number}: ${phase.name}...`)));
            await runEngine(
                `Llama design_next con cwd "${dir}" para ver el contexto de la fase actual.` +
                `\nLee "${dir}/specification.md" y "${dir}/design.md" para entender el proyecto.` +
                `\nAnaliza qué agentes especializados se necesitan según el contexto de la fase:` +
                `\n  - Backend (NestJS, servicios, entidades, migraciones, tests) → delega a Backend Dev` +
                `\n  - Frontend (React, componentes, hooks, estilos, tests) → delega a Frontend Dev` +
                `\n  - Ambos → delega en paralelo a Backend Dev y Frontend Dev` +
                `\n  - Infraestructura (Docker, CI, scripts) → ejecuta directo` +
                `\nCada especialista genera los archivos de código en el directorio del proyecto.` +
                `\nGeneral consolida y muestra un resumen de qué archivos generó cada agente.${qaContext}` +
                `\nIMPORTANTE: NO llames design_advance — cuando termines el usuario llama /spec.advance para ir a VERIFY.`,
            );
        });

        cmdRegistry.register('/spec.qa', 'QA evalúa la fase actual y guarda hallazgos en qa-phase{N}.md', async () => {
            const dir = specDesignGuard(); if (!dir) return;
            const state = specReadDesign(dir);
            if (!state) { console.log(formatCommandOutput(chalk.dim('(No hay roadmap — usa /spec.init primero)'))); return; }
            const phase = state.phases.find((p: any) => p.number === state.currentPhase);
            if (!phase) { console.log(formatCommandOutput(chalk.red('No hay fase activa'))); return; }
            specSwitchAgent('qa-engineer');
            console.log(formatCommandOutput(chalk.cyan(`Evaluando Fase ${phase.number}: ${phase.name}...`)));
            await runEngine(buildQARunPrompt(dir, phase));
            console.log(formatCommandOutput(
                chalk.dim(`Hallazgos guardados en qa-phase${phase.number}.md.`) + '\n\n' +
                chalk.green('  /spec.advance --passed') + chalk.dim('  → fase completa, avanza a la siguiente\n') +
                chalk.red('  /spec.advance --failed') + chalk.dim(' "notas"  → revierte a IMPLEMENT; próximo /spec.next inyecta los hallazgos'),
            ));
        });

        cmdRegistry.register('/spec.advance', 'Avanza de etapa — /spec.advance [notas] [--passed|--failed]', async ({ args }) => {
            const dir = specGuard(); if (!dir) return;
            const hasPassed = args.includes('--passed');
            const hasFailed = args.includes('--failed');
            const notes = args.replace('--passed', '').replace('--failed', '').trim() || 'Etapa completada';
            // Guard: VERIFY requires explicit --passed or --failed
            const stateAdv = specReadDesign(dir);
            if (stateAdv) {
                const phase = stateAdv.phases.find((p: any) => p.number === stateAdv.currentPhase);
                if (phase?.stage === 'verify' && !hasPassed && !hasFailed) {
                    console.log(formatCommandOutput(
                        chalk.yellow('⚠  Estás en VERIFY — debés ser explícito:\n') +
                        chalk.green('  /spec.advance --passed') + chalk.dim(' "notas"  → fase completa\n') +
                        chalk.red('  /spec.advance --failed') + chalk.dim(' "notas"  → revierte a IMPLEMENT\n\n') +
                        chalk.dim('Tip: usa /spec.qa para que QA evalúe y guarde los hallazgos antes de decidir.'),
                    ));
                    return;
                }
            }
            const passedStr = hasPassed ? ', passed=true' : hasFailed ? ', passed=false' : '';
            console.log(formatCommandOutput(chalk.cyan(`Avanzando etapa — "${notes}"${passedStr ? `  ${passedStr.trim()}` : ''}...`)));
            await runEngine(
                `Llama design_advance con cwd "${dir}", notes "${notes}"${passedStr}.` +
                `\nMuestra la etapa y fase resultante.`,
            );
            pendingContext = null;
            // Auto-trigger QA when entering VERIFY stage
            const newState = specReadDesign(dir);
            if (newState) {
                const newPhase = newState.phases.find((p: any) => p.number === newState.currentPhase);
                if (newPhase?.stage === 'verify') {
                    specSwitchAgent('qa-engineer');
                    console.log(formatCommandOutput(chalk.cyan(`Evaluando Fase ${newPhase.number}: ${newPhase.name}...`)));
                    await runEngine(buildQARunPrompt(dir, newPhase));
                    console.log(formatCommandOutput(
                        chalk.dim(`Hallazgos en qa-phase${newPhase.number}.md.`) + '\n\n' +
                        chalk.green('  /spec.advance --passed') + chalk.dim(' "notas"  → fase completa\n') +
                        chalk.red('  /spec.advance --failed') + chalk.dim(' "notas"  → revierte a IMPLEMENT con hallazgos como contexto'),
                    ));
                }
            }
        });

        cmdRegistry.register('/spec.go', 'Ejecuta todas las fases del spec de forma autónoma hasta completar', async () => {
            const dir = specGuard(); if (!dir) return;
            const initState = specReadDesign(dir);
            if (!initState) { console.log(formatCommandOutput(chalk.dim('(No hay roadmap — usa /spec.init primero)'))); return; }

            const fsGo = require('fs') as typeof import('fs');
            const fsGoAsync = await import('fs/promises');
            const MAX_RETRIES_PER_PHASE = 3;
            const totalPhases = (initState.phases as any[]).length;
            const projectSlug = (initState.project as string).toLowerCase().replace(/[^a-z0-9]+/g, '-');
            // Project skills go to ~/.bk-agent/projects/{key}/skills/ — loaded by SkillLoader.loadProjectConfig()
            const specSkillDir = path.join(getProjectDir('bk-agent', dir), 'skills');
            const skillFilePath = path.join(specSkillDir, `${projectSlug}-conventions.yaml`);
            let keepGoing = true;
            specGoActive = true;

            console.log(formatCommandOutput(
                chalk.bold(`spec.go — ${initState.project}`) +
                chalk.dim(`  ${totalPhases} fases · max ${MAX_RETRIES_PER_PHASE} reintentos/fase`),
            ));

            while (keepGoing) {
                const current = specReadDesign(dir);
                if (!current) break;

                const allDone = (current.phases as any[]).every((p: any) => p.status === 'complete');
                if (allDone) {
                    console.log(formatCommandOutput(chalk.green('✅ Todas las fases completas')));
                    break;
                }

                const phase = (current.phases as any[]).find((p: any) => p.number === current.currentPhase);
                if (!phase || phase.status === 'complete') break;

                let phaseComplete = false;
                let retries = 0;

                while (!phaseComplete && retries <= MAX_RETRIES_PER_PHASE) {
                    // ── IMPLEMENT ────────────────────────────────────────────────────
                    const qaFilePath = path.join(dir, `qa-phase${phase.number}.md`);
                    const qaContext = retries > 0 && fsGo.existsSync(qaFilePath)
                        ? `\n\nHallazgos de QA que deben corregirse:\n${fsGo.readFileSync(qaFilePath, 'utf8').slice(0, 2000)}`
                        : '';
                    const retryLabel = retries > 0 ? chalk.dim(` (retry ${retries}/${MAX_RETRIES_PER_PHASE})`) : '';

                    console.log(formatCommandOutput(
                        chalk.cyan(`[${phase.number}/${totalPhases}] `) + chalk.bold(phase.name) +
                        chalk.dim('  IMPLEMENT') + retryLabel,
                    ));

                    if (phase.stage === 'spec') {
                        await runEngine(
                            `Llama design_advance con cwd "${dir}" y notes "avanzando a implementación".` +
                            `\nIMPORTANTE: Solo llama design_advance, nada más.`,
                        );
                    }

                    specSwitchAgent('general');
                    await runEngine(
                        `Llama design_next con cwd "${dir}" para ver el contexto de la fase actual.` +
                        `\nLee "${dir}/specification.md" y "${dir}/design.md" para entender el proyecto.` +
                        `\nAnaliza qué agentes se necesitan según el contexto de la fase:` +
                        `\n  - Backend (NestJS, servicios, entidades, tests) → delega a Backend Dev` +
                        `\n  - Frontend (React, componentes, hooks, tests) → delega a Frontend Dev` +
                        `\n  - Ambos → delega en paralelo a Backend Dev y Frontend Dev` +
                        `\n  - Infraestructura (Docker, CI, scripts) → ejecuta directo` +
                        `\nCada especialista genera los archivos en "${dir}".` +
                        `\nMuestra un resumen de qué archivos generó cada agente.${qaContext}` +
                        `\nIMPORTANTE: NO llames design_advance.`,
                    );

                    // ── Advance IMPLEMENT → VERIFY ───────────────────────────────────
                    await runEngine(
                        `Llama design_advance con cwd "${dir}" y notes "implementación completada".` +
                        `\nIMPORTANTE: Solo llama design_advance, nada más.`,
                    );
                    pendingContext = null;

                    // ── VERIFY (QA) ──────────────────────────────────────────────────
                    const verifyState = specReadDesign(dir);
                    const verifyPhase = (verifyState?.phases as any[])?.find((p: any) => p.number === current.currentPhase) ?? phase;

                    specSwitchAgent('qa-engineer');
                    console.log(formatCommandOutput(
                        chalk.cyan(`[${phase.number}/${totalPhases}] `) + chalk.bold(phase.name) + chalk.dim('  VERIFY'),
                    ));
                    await runEngine(buildQARunPrompt(dir, verifyPhase));

                    // ── Read QA verdict ──────────────────────────────────────────────
                    // parseQaVerdict comprueba NO-GO antes que GO (la cadena contiene "GO").
                    const qaContent = fsGo.existsSync(qaFilePath) ? fsGo.readFileSync(qaFilePath, 'utf8') : null;
                    const qaVerdict = parseQaVerdict(qaContent);

                    specSwitchAgent('general');

                    if (qaVerdict === 'GO' || qaVerdict === 'unknown') {
                        if (qaVerdict === 'unknown') {
                            console.log(formatCommandOutput(chalk.dim(`[${phase.number}/${totalPhases}] Sin veredicto claro — avanzando`)));
                        } else {
                            console.log(formatCommandOutput(chalk.green(`[${phase.number}/${totalPhases}] ✓ QA aprobó`)));
                        }

                        // ── Generate / update project skill from phase learnings ───────
                        console.log(formatCommandOutput(chalk.dim(`[${phase.number}/${totalPhases}] Generando skill de convenciones...`)));
                        await fsGoAsync.mkdir(specSkillDir, { recursive: true }).catch(() => {});
                        await runEngine(
                            `Lee los siguientes archivos del proyecto "${dir}":` +
                            `\n- specification.md` +
                            `\n- design.md` +
                            `\n- qa-phase${phase.number}.md` +
                            (fsGo.existsSync(skillFilePath) ? `\n- "${skillFilePath}" (skill existente a actualizar)` : '') +
                            `\nExtrae SOLO convenciones y decisiones técnicas específicas de ESTE proyecto:` +
                            `\n  - Nombres reales de módulos, entidades y servicios del proyecto` +
                            `\n  - Patrones que el QA aprobó o rechazó en esta fase` +
                            `\n  - Decisiones de arquitectura concretas tomadas` +
                            `\n  - Estructura de carpetas y convenciones de archivos del proyecto` +
                            `\nNO incluyas reglas genéricas de NestJS/React/TypeScript — solo lo específico de este proyecto.` +
                            `\nEscribe el resultado en "${skillFilePath}" con este formato YAML exacto:` +
                            `\nname: ${projectSlug}-conventions` +
                            `\nversion: "1.0"` +
                            `\ndescription: "Convenciones específicas del proyecto ${initState.project}"` +
                            `\ntriggers: [${projectSlug}, ...otras palabras clave del dominio del proyecto]` +
                            `\nagents:` +
                            `\n  - backend` +
                            `\n  - frontend` +
                            `\nsystemPromptAddition: |` +
                            `\n  ## Convenciones del proyecto: ${initState.project}` +
                            `\n  [convenciones extraídas]` +
                            `\nSi el archivo ya existe, combina el contenido acumulado con los nuevos aprendizajes sin duplicar.` +
                            `\nIMPORTANTE: Usa write_file. No incluyas comentarios en el YAML.`,
                        );

                        // Reload UI skill count after generation
                        allSkills = await loadSkills(skillsDir);
                        updateHeaderCallback();

                        await runEngine(
                            `Llama design_advance con cwd "${dir}", notes "QA aprobó — fase completada", passed=true.` +
                            `\nMuestra la etapa y fase resultante.`,
                        );
                        pendingContext = null;
                        phaseComplete = true;
                    } else {
                        retries++;
                        if (retries > MAX_RETRIES_PER_PHASE) {
                            console.log(formatCommandOutput(chalk.red(`[${phase.number}/${totalPhases}] ✗ QA rechazó tras ${MAX_RETRIES_PER_PHASE} intentos — deteniendo`)));
                            keepGoing = false;
                            break;
                        }
                        console.log(formatCommandOutput(chalk.yellow(`[${phase.number}/${totalPhases}] ⚠ QA rechazó — retry ${retries}/${MAX_RETRIES_PER_PHASE}`)));
                        await runEngine(
                            `Llama design_advance con cwd "${dir}", notes "QA rechazó — reintentando", passed=false.` +
                            `\nMuestra la etapa y fase resultante.`,
                        );
                        pendingContext = null;
                        // Refresh phase after revert to IMPLEMENT
                        const retryState = specReadDesign(dir);
                        if (retryState) {
                            const refreshed = (retryState.phases as any[]).find((p: any) => p.number === retryState.currentPhase);
                            if (refreshed) Object.assign(phase, refreshed);
                        }
                    }
                }

                if (!keepGoing) break;
            }

            specGoActive = false;
            specSwitchAgent('general');
            console.log(formatCommandOutput(
                chalk.dim(`spec.go finalizado — usa `) + chalk.white('/spec.show.roadmap') + chalk.dim(' para ver el estado'),
            ));
        });

        // ── Info ─────────────────────────────────────────────────────────────

        cmdRegistry.register('/spec.context', 'Muestra todos los documentos de diseño y estado de ejecución', async () => {
            const dir = specGuard(); if (!dir) return;
            await runEngine(
                `Llama design_read_context con cwd "${dir}".` +
                `\nMuestra todos los documentos de diseño y el estado de ejecución encontrados.`,
            );
        });

        cmdRegistry.register('/spec.overview', 'Vista de todos los proyectos con diseño activo', async () => {
            const dir = specGuard(); if (!dir) return;
            await runEngine(`Llama design_overview y muestra el estado spec-driven de todos los proyectos conocidos.`);
        });

        cmdRegistry.register('/prompt', 'Genera un prompt estructurado desde una frase', async ({ args }) => {
            if (!args.startsWith('new')) {
                console.log(formatCommandOutput(chalk.bold('📝 /prompt new <frase>') + '\n' + chalk.dim('Genera un prompt estructurado y lo guarda en prompt.md')));
                return;
            }
            const phrase = args.slice(3).trim();
            if (!phrase) { console.log(formatCommandOutput(chalk.yellow('Uso: /prompt new <frase inicial>'))); return; }
            await runEngine(`Genera un prompt para: ${phrase}\n\nEscribe el prompt final en prompt.md usando write_file.`);
        });

        // Called by /workspace switch (framework) and /switch (TUI alias) when project changes
        const tuiOnCwdChange = async (newCwd: string): Promise<void> => {
            activeAppPath = newCwd;
            const wsConfig = await loadWorkspaces('bk-agent');
            let activeWsEntry: (typeof wsConfig)[string] | undefined;
            for (const [wsName, wsEntry] of Object.entries(wsConfig)) {
                if (wsEntry.projects.some(p => p.cwd === newCwd)) {
                    activeWorkspaceName = wsName;
                    activeWsEntry = wsEntry;
                    break;
                }
            }
            // Use commonRoot as workingDir when workspace spans multiple projects
            const effectiveDir = activeWsEntry?.commonRoot ?? newCwd;
            engine.updateWorkingDir(effectiveDir);
            memoryContext = await loadAppMemory(newCwd);
            projectName = path.basename(newCwd);
            if (activeWorkspaceName && activeWsEntry) {
                pendingContext = await buildWorkspaceContext(activeWorkspaceName, activeWsEntry, 'bk-agent');
            } else {
                pendingContext = `## Project: ${projectName}\n\n${memoryContext?.sessionContent || '*(empty)*'}`;
            }
            updateHeaderCallback();
            // onRenderHeader() only fires on scroll — force immediate redraw inline
            // so the user sees updated workspace/project in the current output stream
            process.stdout.write('\n' + formatHeader(buildHeaderInfo()) + '\n');
        };

        cmdRegistry.register('/switch', 'Cambiar workspace/proyecto activo (picker TUI)', async ({ args }) => {
            if (running) { console.log(formatCommandOutput(chalk.yellow('Agente ocupado — espera antes de cambiar workspace.'))); return; }

            // /switch <wsName> [projectName] — directo sin picker
            if (args) {
                await cmdRegistry.dispatch(`/workspace switch ${args}`, {
                    ...engine.getCommandBindings(),
                    emit: (t) => console.log(formatCommandOutput(t)),
                    appName: 'bk-agent',
                    onCwdChange: tuiOnCwdChange,
                    injectContext: (m) => { pendingContext = m; },
                    effectiveAgentId: currentAgentId,
                    model: currentModel,
                });
                return;
            }

            // Sin args: picker TUI de dos niveles (workspace → proyecto)
            const wsConfig = await loadWorkspaces('bk-agent');
            const wsNames = Object.keys(wsConfig);

            if (!wsNames.length) {
                console.log(formatCommandOutput(
                    chalk.dim('Sin workspaces configurados.') + '\n' +
                    chalk.dim('  /workspace import <ruta> [nombre]  — importar proyecto actual\n') +
                    chalk.dim('  /workspace create <nombre>         — crear workspace vacío'),
                ));
                return;
            }

            // Nivel 1: elegir workspace
            const wsItems = wsNames.map(n => {
                const ws = wsConfig[n]!;
                const count = ws.projects.length;
                const active = n === activeWorkspaceName ? chalk.green('✓ ') : '  ';
                return {
                    label: active + chalk.cyan(n) + chalk.dim(`  (${count} proyecto${count !== 1 ? 's' : ''})`),
                    value: n,
                };
            });
            const chosenWs = await terminal.filteredSelect(
                `Workspaces  ${chalk.dim('(actual: ' + (activeWorkspaceName ?? 'ninguno') + ')')}`,
                wsItems,
                [{ label: chalk.dim('+ Nuevo workspace…'), value: '__new__' }],
            );

            if (!chosenWs) { console.log(formatCommandOutput(chalk.dim('Cancelado'))); return; }

            // "Nuevo workspace" inline
            if (chosenWs === '__new__') {
                const wsName = await terminal.input('Nombre del workspace:');
                if (!wsName) { console.log(formatCommandOutput(chalk.dim('Cancelado'))); return; }
                const rawCwd = await terminal.input(`Ruta del proyecto (Enter = ${cwd}):`);
                const projectCwd = rawCwd ? path.resolve(rawCwd) : cwd;
                const projectName = deriveProjectName(projectCwd);
                const updated = importProject(wsConfig, wsName, { name: projectName, cwd: projectCwd });
                await saveWorkspaces('bk-agent', updated);
                await tuiOnCwdChange(projectCwd);
                console.log(formatCommandOutput(chalk.green(`✓ Workspace creado: ${wsName} | ${projectName}`) + '\n' + chalk.dim(`  ${projectCwd}`)));
                return;
            }

            // Nivel 2: elegir proyecto dentro del workspace
            const ws = wsConfig[chosenWs]!;
            let chosenCwd: string | null = null;

            if (ws.projects.length === 1) {
                chosenCwd = ws.projects[0]!.cwd;
            } else {
                const projItems = ws.projects.map(p => ({
                    label: (p.cwd === activeAppPath ? chalk.green('✓ ') : '  ') +
                           chalk.bold(p.name) + chalk.dim(`  ${p.cwd}`),
                    value: p.cwd,
                }));
                const picked = await terminal.filteredSelect(
                    `Proyectos en ${chosenWs}`,
                    projItems,
                    [{ label: chalk.dim('+ Añadir proyecto…'), value: '__add__' }],
                );
                if (!picked) { console.log(formatCommandOutput(chalk.dim('Cancelado'))); return; }
                if (picked === '__add__') {
                    const rawCwd = await terminal.input('Ruta del proyecto:');
                    if (!rawCwd) { console.log(formatCommandOutput(chalk.dim('Cancelado'))); return; }
                    chosenCwd = path.resolve(rawCwd);
                    const pName = deriveProjectName(chosenCwd);
                    const updated = importProject(wsConfig, chosenWs, { name: pName, cwd: chosenCwd });
                    await saveWorkspaces('bk-agent', updated);
                } else {
                    chosenCwd = picked;
                }
            }

            if (!chosenCwd) return;
            const updated = setActiveProject(wsConfig, chosenWs, ws.projects.find(p => p.cwd === chosenCwd)?.name ?? '');
            await saveWorkspaces('bk-agent', updated);
            await tuiOnCwdChange(chosenCwd);
            console.log(formatCommandOutput(
                chalk.green(`✓ Workspace: ${chosenWs} | ${path.basename(chosenCwd)}`) + '\n' +
                chalk.dim(`  ${chosenCwd}`) +
                (!memoryContext?.sessionContent ? '\n' + chalk.dim('  (memoria vacía — proyecto nuevo)') : ''),
            ));
        });

        cmdRegistry.register('/checkpoint', 'Crear / listar / cargar checkpoints de sesion', async ({ args }) => {
            if (!memoryContext) { console.log(formatCommandOutput(chalk.yellow('Sin memoria activa.'))); return; }
            if (!args) { console.log(formatCommandOutput(chalk.dim('Uso: /checkpoint <nombre> | list | load <nombre>'))); return; }
            if (args === 'list') {
                const cps = await listCheckpoints(memoryContext.projectDir);
                if (!cps.length) { console.log(formatCommandOutput(chalk.dim('Sin checkpoints guardados.'))); return; }
                console.log(formatCommandOutput(cps.map((cp, i) => `  ${i + 1}. ${chalk.cyan(cp.date)} — ${cp.feature}`).join('\n')));
                return;
            }
            if (args.startsWith('load ')) {
                const target = args.slice(5).trim();
                const cps = await listCheckpoints(memoryContext.projectDir);
                const match = cps.find(cp => cp.feature.includes(target) || cp.filename.includes(target));
                if (!match) { console.log(formatCommandOutput(chalk.red(`Checkpoint no encontrado: ${target}`))); return; }
                const content = await readCheckpoint(memoryContext.projectDir, match.filename);
                if (content) {
                    pendingContext = `## Checkpoint: ${match.feature} (${match.date})\n\n${content}`;
                    console.log(formatCommandOutput(chalk.green(`Checkpoint cargado: ${match.feature}`)));
                }
                return;
            }
            const cpPath = await createCheckpoint(memoryContext.projectDir, args, '', memoryContext.sessionContent);
            const doCompact = await terminal.yesNo('¿Compactar sesion-actual.md tras el checkpoint?', false);
            if (doCompact) await compactSession(memoryContext.projectDir, args, path.basename(cpPath));
            console.log(formatCommandOutput(chalk.green(`✓ Checkpoint: ${args}`) + '\n' + chalk.dim(`  ${cpPath}`) + (doCompact ? '\n' + chalk.dim('  sesion-actual.md compactada') : '')));
        });

        // ── Terminal setup ────────────────────────────────────────────────────

        const SLASH_COMMANDS = cmdRegistry.getAll().map(c => c.name);

        terminal = new Terminal({
            completions: SLASH_COMMANDS,
            messageBuffer,
            onEscape: interrupt,
            onClose: async () => { engine.abort(); },
            onLine: async (line: string) => {
                const trimmed = line.trim();
                if (!trimmed) return;

                if (trimmed === 'salir' || trimmed === 'exit') {
                    console.log(chalk.dim('\nHasta luego.'));
                    engine.abort();
                    terminal.close();
                    return;
                }

                if (trimmed.startsWith('/')) {
                    const handled = await cmdRegistry.dispatch(trimmed, {
                        ...engine.getCommandBindings(),
                        emit: (t) => console.log(formatCommandOutput(t)),
                        agents: allAgents.map(a => ({ id: a.id, name: a.name, description: a.description })),
                        skills: allSkills.map(s => ({ name: s.name, description: s.description, triggers: s.triggers ?? [] })),
                        effectiveAgentId: currentAgentId,
                        model: currentModel,
                        projectDir: memoryContext?.projectDir,
                        sessionContent: memoryContext?.sessionContent ?? '',
                        injectContext: (msg: string) => { pendingContext = msg; },
                        appName: 'bk-agent',
                        onCwdChange: tuiOnCwdChange,
                        prompt: async (question, options) => {
                            if (options?.length) return terminal.select(question, options.map(o => ({ label: o.label, value: o.value })));
                            return terminal.input(question);
                        },
                    });
                    if (handled) return;
                    console.log(formatCommandOutput(chalk.yellow(`Comando desconocido: ${trimmed.split(' ')[0]}`)));
                    return;
                }

                messageBuffer.add({ role: 'user', content: trimmed, timestamp: new Date() });

                if (running) {
                    pendingInput = trimmed;
                    console.log(formatCommandOutput(chalk.dim('⏳ En cola — se ejecutara al terminar.')));
                    return;
                }

                try {
                    await runEngine(trimmed);
                    while (pendingInput !== null) {
                        const queued = pendingInput;
                        pendingInput = null;
                        console.log(formatCommandOutput(chalk.dim(`▶ Ejecutando mensaje en cola: ${queued.slice(0, 60)}${queued.length > 60 ? '…' : ''}`)));
                        await runEngine(queued);
                    }
                } catch (error: any) {
                    spinner.stop();
                    messageBuffer.add({ role: 'error', content: error.message, timestamp: new Date() });
                    console.log(formatCommandOutput(`Error: ${error.message}`));
                }
            },
        });

        // Header redraw callback
        updateHeaderCallback = () => {
            const h = formatHeader(buildHeaderInfo());
            const lineCount = h.split('\n').filter(l => l.trim()).length;
            terminal.setHeaderLines(lineCount);
            terminal.setOnRenderHeader(() => process.stdout.write(h));
        };
        updateHeaderCallback();

        // Footer idle — estilo status bar de Claude Code: modelo · agente · tokens · ayuda
        terminal.setFooterInfo(() => {
            const cur = allAgents.find(a => a.id === currentAgentId);
            const parts = [currentModel, `${cur?.icon ?? '🤖'} ${cur?.name ?? currentAgentId}`];
            const total = sessionStats.inputTokens + sessionStats.outputTokens;
            if (total > 0) parts.push((total / 1000).toFixed(1) + 'k tk');
            if (liveMetrics.estimatedCostUsd) parts.push('$' + liveMetrics.estimatedCostUsd.toFixed(4));
            parts.push('/help');
            return parts.join(' · ');
        });

        spinner.setStatusCallback((text: string) => terminal.updateStatusLine(text));
        terminal.start();
    });

program.parse(process.argv);
