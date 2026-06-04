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
    type ProvidersConfig,
} from '@bk/agent-coding';
import {
    CallbackTransport,
    SlashCommandRegistry,
    registerBuiltinCommands,
    getProjectDir,
    type AgentEvent,
    type AgentProfile,
    type IterationMode,
    type IterationStats,
} from '@bk/agent-core';

import { Terminal } from '../src/ui/terminal';
import { agentEvents } from '../src/ui/agent-events';
import {
    formatHeader,
    type HeaderInfo,
    formatToolCall,
    formatToolResult,
    formatCommandOutput,
    formatResponseHeader,
    formatSeparator,
    formatMarkdown,
    extractProjectName,
    formatFileDiff,
} from '../src/ui/formatters';
import { Spinner, type SpinnerMetrics } from '../src/ui/spinner';
import { registerNestJSHandlers } from '../src/skills/handlers/nestjs';
import { registerTypeScriptHandlers } from '../src/skills/handlers/typescript';
import { registerBuiltinHandlers } from '../src/skills/handlers/builtins';
import { PathAllowlist } from '../src/skills/handlers/path-allowlist';
import { defaultInstructions } from '../src/types/config';
import { loadSkills, loadVaultSkills, type Skill, type VaultSkill } from '../src/skills/loader';
import {
    listWorkspaces, ensureWorkspace, readWorkspaceMemory, DEFAULT_WORKSPACE,
    listCheckpoints, readCheckpoint, createCheckpoint, compactSession,
    type WorkspaceInfo,
} from '../src/memory/updater';
import {
    loadMemoryContext, getProjectMemoryDir, listLocalProjects, getGlobalAgentsDir, getGlobalSkillsDir,
    type MemoryContext,
} from '../src/bootstrap/memory-loader';

registerNestJSHandlers();
registerTypeScriptHandlers();

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

function buildBar(pct: number, width = 20): string {
    const filled = Math.round((pct / 100) * width);
    return chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
}

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
        chalk.cyan('/agents') + '                Lista de agentes disponibles',
        chalk.cyan('/models [id]') + '           Cambiar modelo de IA',
        chalk.cyan('/skills') + '               Ver/instalar skills',
        chalk.cyan('/iteration') + '             Ver/cambiar modo de iteracion',
        chalk.cyan('/memory') + '               Ver memoria del proyecto activo',
        chalk.cyan('/switch [ws]') + '           Cambiar workspace del proyecto',
        chalk.cyan('/checkpoint <nombre>') + '   Crear checkpoint de sesion',
        chalk.cyan('/checkpoint list') + '       Listar checkpoints',
        chalk.cyan('/checkpoint load <n>') + '   Cargar checkpoint',
        chalk.cyan('/init') + '                  Inicializar/analizar proyecto',
        chalk.cyan('/prompt new <frase>') + '    Generar prompt estructurado',
        chalk.cyan('@commit') + '                Planificar y ejecutar commit',
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
    .option('--iteration-mode <mode>', 'Modo de iteracion: interactive | auto | step-by-step', 'interactive')
    .option('--command-timeout <s>', 'Timeout en segundos para run_command (0 = sin limite)')
    .option('--no-stream', 'Deshabilitar streaming')
    .option('--no-qa', 'Desactivar revision automatica de QA')
    .option('--no-delegation', 'Desactivar delegacion a sub-agentes')
    .option('--headless', 'Modo headless: emite JSON-Lines a stdout para frontend externo')
    .action(async (options) => {
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
        const useStream = options.stream !== false;
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
        let pendingInput: string | null = null;
        let pendingContext: string | null = null;
        let activeWorkspace = DEFAULT_WORKSPACE;

        const sessionStats = { calls: 0, inputTokens: 0, outputTokens: 0 };
        const liveMetrics: SpinnerMetrics = {
            inputTokens: 0,
            outputTokens: 0,
            elapsedMs: 0,
            estimatedCostUsd: undefined,
            modelName: currentModel,
        };

        // Streaming recap filter state
        let streamTail = '';
        let suppressingRecap = false;
        let recapBuffer = '';

        // ── Memory / vault ────────────────────────────────────────────────────
        let vaultPath = '';
        let vaultConnected = false;
        let projectName = path.basename(cwd);

        // Try loading memory from local ~/.deepseek-code/projects/
        const localMemoryDir = getProjectMemoryDir(cwd);
        let memoryContext: MemoryContext | null = await loadMemoryContext(vaultPath, localMemoryDir, projectName);
        const projectBaseDir = memoryContext ? path.dirname(memoryContext.projectDir) : undefined;

        // ── Skills ────────────────────────────────────────────────────────────
        const skillsDir = getGlobalSkillsDir();
        let allSkills = await loadSkills(skillsDir);

        // ── Agents ────────────────────────────────────────────────────────────
        const allAgents: AgentProfile[] = AgentLoader.load({ appName: 'bk-agent', cwd, builtins: CODING_AGENTS });

        // ── Terminal / spinner setup ──────────────────────────────────────────
        const spinner = new Spinner();
        const { MessageBuffer } = await import('../src/ui/message-buffer');
        const messageBuffer = new MessageBuffer();
        let terminal!: Terminal;
        let updateHeaderCallback: () => void = () => {};

        const buildHeaderInfo = (): HeaderInfo => {
            const cur = allAgents.find(a => a.id === currentAgentId);
            return {
                model: currentModel,
                vaultConnected,
                vaultName: vaultPath ? path.basename(vaultPath) : undefined,
                projectName,
                memoryProject: memoryContext?.activeProject,
                memorySource: memoryContext?.source,
                activeWorkspace,
                agentIcon: cur?.icon,
                agentName: cur?.name,
                skillsCount: allSkills.length,
                customAgentsCount: allAgents.filter(a => (a as any).source !== 'builtin').length,
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
            const line = chalk.yellow('═'.repeat(60));
            messageBuffer.add({ role: 'system', content: `🧪 QA Engineer — revision automatica:\n${review.slice(0, 300)}`, timestamp: new Date(), meta: 'qa-review' });
            console.log(`\n${line}`);
            console.log(`  🧪  ${chalk.bold.yellow('QA Engineer')}  ${chalk.dim('· visto bueno')}`);
            console.log(line);
            console.log(formatMarkdown(review));
            console.log(formatSeparator());
        }

        // ── Transport event handler ───────────────────────────────────────────
        function handleEvent(event: AgentEvent): void {
            // Headless: pass through all framework events directly
            if (agentEvents.isHeadless()) {
                switch (event.type) {
                    case 'token': {
                        if (suppressingRecap) {
                            recapBuffer += event.content;
                            const endIdx = recapBuffer.indexOf('</recap>');
                            if (endIdx !== -1) {
                                const recap = recapBuffer.slice(0, endIdx).trim();
                                suppressingRecap = false;
                                recapBuffer = '';
                                if (recap) agentEvents.emit({ type: 'recap', text: recap } as any);
                            }
                            return;
                        }
                        streamTail += event.content;
                        const idx = streamTail.indexOf('<recap>');
                        if (idx !== -1) {
                            const before = streamTail.slice(0, idx);
                            if (before) agentEvents.emit({ type: 'token', content: before });
                            suppressingRecap = true;
                            recapBuffer = streamTail.slice(idx + 7);
                            streamTail = '';
                            return;
                        }
                        const safe = Math.max(0, streamTail.length - 8);
                        if (safe > 0) {
                            agentEvents.emit({ type: 'token', content: streamTail.slice(0, safe) });
                            streamTail = streamTail.slice(safe);
                        }
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
                        if (streamTail && !suppressingRecap) agentEvents.emit({ type: 'token', content: streamTail });
                        streamTail = '';
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
                    if (!useStream) return;
                    if (suppressingRecap) {
                        recapBuffer += event.content;
                        const endIdx = recapBuffer.indexOf('</recap>');
                        if (endIdx !== -1) {
                            const recap = recapBuffer.slice(0, endIdx).trim();
                            suppressingRecap = false;
                            recapBuffer = '';
                            if (recap) showRecap(recap);
                        }
                        return;
                    }
                    streamTail += event.content;
                    const idx = streamTail.indexOf('<recap>');
                    if (idx !== -1) {
                        if (idx > 0) process.stdout.write(streamTail.slice(0, idx));
                        suppressingRecap = true;
                        recapBuffer = streamTail.slice(idx + 7);
                        streamTail = '';
                        return;
                    }
                    const safe = Math.max(0, streamTail.length - 7);
                    if (safe > 0) {
                        process.stdout.write(streamTail.slice(0, safe));
                        streamTail = streamTail.slice(safe);
                    }
                    return;
                }
                case 'tool_call': {
                    terminal?.stopThinking();
                    spinner.stop();
                    terminal?.prepareForOutput();
                    const argsStr = event.args_preview ?? '';
                    messageBuffer.add({ role: 'tool', content: `${event.name}(${argsStr.slice(0, 60)})`, timestamp: new Date(), meta: event.name });
                    // Build a fake argsStr for formatToolCall (which expects JSON)
                    try {
                        const parsed = JSON.parse(argsStr);
                        console.log(formatToolCall(event.name, argsStr));
                        const diffOut = formatFileDiff(event.name, argsStr);
                        if (diffOut) process.stdout.write(diffOut + '\n');
                    } catch {
                        console.log(formatToolCall(event.name, JSON.stringify({ input: argsStr })));
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
                    terminal?.stopThinking();
                    spinner.stop();
                    terminal?.prepareForOutput();
                    const cols = Math.min(process.stdout.columns || 80, 80);
                    const line = chalk.cyan('═'.repeat(cols));
                    const toName = event.to_name ?? event.to;
                    const toIcon = event.to_icon ?? '🤖';
                    const desc = chalk.dim(`· agente activo`);
                    messageBuffer.add({ role: 'system', content: `Agente: ${toIcon} ${toName}`, timestamp: new Date(), meta: `agent:${event.to}` });
                    console.log(`\n${line}`);
                    console.log(`  ${toIcon}  ${chalk.bold(toName)}  ${desc}`);
                    console.log(line);
                    updateHeaderCallback();
                    return;
                }
                case 'block_start': {
                    terminal?.stopThinking();
                    spinner.stop();
                    terminal?.prepareForOutput();
                    streamTail = '';
                    suppressingRecap = false;
                    recapBuffer = '';
                    const cur = allAgents.find(a => a.id === event.agent_id);
                    if (!(cur as any)?.suppressDefaultOutput) {
                        process.stdout.write(formatResponseHeader() + '\n');
                    }
                    return;
                }
                case 'block_end': {
                    if (streamTail && !suppressingRecap) {
                        process.stdout.write(streamTail);
                    }
                    streamTail = '';
                    process.stdout.write('\n');
                    console.log(formatSeparator());
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
                    if (useStream && streamTail && !suppressingRecap) {
                        process.stdout.write(streamTail);
                        process.stdout.write('\n');
                    }
                    streamTail = '';
                    // Track last code block for Ctrl+Y
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
            const cols = Math.min(process.stdout.columns || 80, 80);
            const bar = chalk.dim('┄'.repeat(cols - 2));
            messageBuffer.add({ role: 'system', content: `※ recap: ${recap}`, timestamp: new Date(), meta: 'recap' });
            console.log(`\n${bar}`);
            console.log(chalk.bold.magenta('  ※ ') + chalk.bold.white('recap  ') + chalk.dim('·') + '  ' + chalk.italic(recap));
            console.log(bar);
        }

        // ── Engine factory ────────────────────────────────────────────────────
        const transport = new CallbackTransport(handleEvent);
        const engine = createCodingEngine({
            providers,
            defaultProvider,
            appName: 'bk-agent',
            workingDir: cwd,
            transport,
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
                const result = await terminal.confirm(`[step-by-step] Iteracion ${stats.iterations} - Continuar?`);
                return result !== 'no';
            },
            onToolApproval: async (toolName: string, agentId: string, argsPreview: string) => {
                if (agentEvents.isHeadless()) return 'approve';
                if (allowAll) return 'approve_all';
                terminal?.stopThinking();
                spinner.stop();
                const result = await terminal.confirm(`${agentId} → ${toolName}(${argsPreview.slice(0, 60)})`);
                if (result === 'all') { allowAll = true; return 'approve_all'; }
                return result !== 'no' ? 'approve' : 'reject';
            },
        });
        engine.setIterationMode(resolvedMode);

        // ── Run helper ────────────────────────────────────────────────────────
        async function runEngine(input: string): Promise<void> {
            running = true;
            streamTail = '';
            suppressingRecap = false;
            recapBuffer = '';
            try {
                const effectiveInput = pendingContext
                    ? `## Contexto inyectado\n${pendingContext}\n\n${input}`
                    : input;
                pendingContext = null;
                await engine.run(effectiveInput);
            } finally {
                running = false;
            }
        }

        // ── Initial header ────────────────────────────────────────────────────
        console.log(formatHeader(buildHeaderInfo()));

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
                `Vault:    ${vaultConnected ? 'conectado' : 'no conectado'}`,
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

        cmdRegistry.register('/agents', 'Lista agentes disponibles', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            const lines = ['Agentes disponibles:\n'];
            for (const a of allAgents) {
                const mark = a.id === currentAgentId ? ' <- activo' : '';
                lines.push(`  ${a.icon} ${a.id.padEnd(18)} ${a.name}${mark}`);
            }
            emit(lines.join('\n'));
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

        cmdRegistry.register('/proyectos', 'Listar proyectos locales conocidos', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput } as any);
            const projects = await listLocalProjects();
            if (!projects.length) { emit('No hay proyectos locales en ~/.deepseek-code/projects/'); return; }
            const lines = projects.map(p => `  ${p.isCurrent ? '->' : '  '} ${p.name}${p.isCurrent ? '  <- actual' : ''}\n     ${p.memoryDir}`);
            emit('Proyectos locales:\n\n' + lines.join('\n'));
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
            registerBuiltinHandlers({
                vaultPath,
                instructions: defaultInstructions(),
                askConfirmation: async () => true,
                projectRoot: cwd,
                memoryContext,
                onMemoryUpdate: null,
                pathAllowlist: new PathAllowlist({
                    allowedPaths: [cwd, vaultPath, (await import('os')).tmpdir()].filter(Boolean),
                    allowSubpaths: true,
                }),
            });

            agentEvents.emit({ type: 'ready' });

            const emitConfig = async () => {
                const workspaceList = projectBaseDir
                    ? (await listWorkspaces(projectBaseDir)).map((w: WorkspaceInfo) => w.name)
                    : ['default'];
                agentEvents.emit({
                    type: 'config',
                    agents: allAgents.map(a => ({ id: a.id, name: a.name, icon: a.icon ?? 'robot', description: a.description ?? '' })),
                    models: DEEPSEEK_MODELS.map(m => ({ id: m.id, name: m.name, badge: m.badge, note: m.note })),
                    commands: cmdRegistry.getAll().map(c => ({ name: c.name, description: c.description })),
                    currentAgent: currentAgentId,
                    currentModel,
                    skillsCount: allSkills.length,
                    activeWorkspace,
                    workspaces: workspaceList,
                } as any);
            };
            await emitConfig();

            // Headless /switch override
            cmdRegistry.register('/switch', 'Cambiar workspace del proyecto', async ({ args, emit, injectContext }) => {
                if (!projectBaseDir) { emit('Sin memoria activa.'); return; }
                if (!args || args === 'list') {
                    const workspaces = await listWorkspaces(projectBaseDir);
                    emit(workspaces.map((w: WorkspaceInfo, i: number) =>
                        `  ${i + 1}. ${w.name}${w.isDefault ? ' (default)' : ''}${w.name === activeWorkspace ? '  <- actual' : ''}`,
                    ).join('\n'));
                    return;
                }
                const workspace = await ensureWorkspace(projectBaseDir, args);
                const { sessionContent, projectContext } = await readWorkspaceMemory(projectBaseDir, args);
                memoryContext = { ...memoryContext!, memoryDir: workspace.memoryDir, projectDir: workspace.memoryDir, sessionContent, projectContext };
                activeWorkspace = args;
                injectContext?.(`## Workspace: ${args}\n\n${sessionContent || '*(empty)*'}`);
                pendingContext = `## Workspace: ${args}\n\n${sessionContent || '*(empty)*'}`;
                await emitConfig();
                emit(`Workspace: ${args}\n${workspace.memoryDir}`);
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
                                emit: emitBlock,
                                agents: allAgents.map(a => ({ id: a.id, name: a.name, description: a.description })),
                                skills: allSkills.map(s => ({ name: s.name, description: s.description, triggers: s.triggers ?? [] })),
                                effectiveAgentId: currentAgentId,
                                model: currentModel,
                                projectDir: memoryContext?.projectDir,
                                sessionContent: memoryContext?.sessionContent ?? '',
                                injectContext: (ctxMsg: string) => { pendingContext = ctxMsg; },
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
                chalk.dim('Vault:') + '  ' + (vaultConnected ? chalk.green('✓ ' + path.basename(vaultPath)) : chalk.dim('✗ no conectado')),
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
            const vaultSkills: VaultSkill[] = vaultPath ? await loadVaultSkills(vaultPath) : [];
            const installedNames = new Set(allSkills.map(s => s.name));
            const availableVault = vaultSkills.filter(vs => !installedNames.has(vs.name));
            const menuItems: { label: string; value: string }[] = [];
            for (const s of allSkills) {
                menuItems.push({ label: chalk.green('✓ ') + chalk.bold(s.name), value: `local:${s.name}` });
            }
            for (const vs of availableVault) {
                menuItems.push({ label: chalk.cyan('✦ ') + chalk.bold(vs.name), value: `vault:${vs.filePath}` });
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

        cmdRegistry.register('/agents', 'Lista agentes disponibles', async () => {
            const lines = ['Agentes disponibles:\n'];
            for (const a of allAgents) {
                const mark = a.id === currentAgentId ? chalk.green(' <- activo') : '';
                lines.push(`  ${a.icon} ${a.id.padEnd(18)} ${chalk.bold(a.name)}${mark}`);
                if (a.description) lines.push(`    ${chalk.dim(a.description)}`);
            }
            console.log(formatCommandOutput(lines.join('\n')));
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
            const workspaceCtx = activeWorkspace !== DEFAULT_WORKSPACE ? ` Workspace activo: ${activeWorkspace}.` : '';
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

        cmdRegistry.register('/prompt', 'Genera un prompt estructurado desde una frase', async ({ args }) => {
            if (!args.startsWith('new')) {
                console.log(formatCommandOutput(chalk.bold('📝 /prompt new <frase>') + '\n' + chalk.dim('Genera un prompt estructurado y lo guarda en prompt.md')));
                return;
            }
            const phrase = args.slice(3).trim();
            if (!phrase) { console.log(formatCommandOutput(chalk.yellow('Uso: /prompt new <frase inicial>'))); return; }
            await runEngine(`Genera un prompt para: ${phrase}\n\nEscribe el prompt final en prompt.md usando write_file.`);
        });

        cmdRegistry.register('/switch', 'Cambiar workspace del proyecto', async ({ args }) => {
            if (!projectBaseDir) { console.log(formatCommandOutput(chalk.yellow('Sin memoria activa.'))); return; }
            if (running) { console.log(formatCommandOutput(chalk.yellow('Agente ocupado — espera antes de cambiar workspace.'))); return; }
            let chosenName: string | null = args || null;
            if (!chosenName) {
                const workspaces = await listWorkspaces(projectBaseDir);
                const items = workspaces.map((w: WorkspaceInfo) => ({
                    label: (w.name === activeWorkspace ? chalk.green('✓ ') : '  ') + (w.isDefault ? chalk.dim(w.name) : chalk.cyan(w.name)),
                    value: w.name,
                }));
                chosenName = await terminal.filteredSelect(`Workspaces  ${chalk.dim('(actual: ' + activeWorkspace + ')')}`, items, [{ label: chalk.dim('+ Nuevo workspace…'), value: '__new__' }]);
                if (chosenName === '__new__') {
                    chosenName = await terminal.input('Nombre del workspace:');
                }
            }
            if (!chosenName) { console.log(formatCommandOutput(chalk.dim('Cancelado'))); return; }
            const workspace = await ensureWorkspace(projectBaseDir, chosenName);
            const { sessionContent, projectContext } = await readWorkspaceMemory(projectBaseDir, chosenName);
            memoryContext = { ...memoryContext!, memoryDir: workspace.memoryDir, projectDir: workspace.memoryDir, sessionContent, projectContext };
            activeWorkspace = chosenName;
            pendingContext = `## Workspace: ${chosenName}\n\n${sessionContent || '*(empty)*'}`;
            updateHeaderCallback();
            console.log(formatCommandOutput(chalk.green(`✓ Workspace: ${chosenName}`) + '\n' + chalk.dim(`  ${workspace.memoryDir}`) + (sessionContent ? '' : '\n' + chalk.dim('  (memoria vacia — workspace nuevo)'))));
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

        cmdRegistry.register('/proyectos', 'Listar proyectos locales conocidos', async () => {
            const projects = await listLocalProjects();
            if (!projects.length) { console.log(formatCommandOutput(chalk.dim('No hay proyectos locales.'))); return; }
            const lines = [chalk.bold('💾 Proyectos locales:'), ''];
            for (const p of projects) {
                const marker = p.isCurrent ? chalk.green('▶ ') : '  ';
                lines.push(marker + chalk.cyan(p.name) + (p.isCurrent ? chalk.dim('  <- actual') : ''));
                lines.push(chalk.dim(`    ${p.memoryDir}`));
            }
            console.log(formatCommandOutput(lines.join('\n')));
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
                        emit: (t) => console.log(formatCommandOutput(t)),
                        agents: allAgents.map(a => ({ id: a.id, name: a.name, description: a.description })),
                        skills: allSkills.map(s => ({ name: s.name, description: s.description, triggers: s.triggers ?? [] })),
                        effectiveAgentId: currentAgentId,
                        model: currentModel,
                        projectDir: memoryContext?.projectDir,
                        sessionContent: memoryContext?.sessionContent ?? '',
                        injectContext: (msg: string) => { pendingContext = msg; },
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

        // Register builtin skill handlers (for tool execution in terminal mode)
        registerBuiltinHandlers({
            vaultPath,
            instructions: defaultInstructions(),
            askConfirmation: async (msg: string) => {
                if (allowAll) return true;
                const result = await terminal.confirm(msg);
                if (result === 'all') allowAll = true;
                return result !== 'no';
            },
            projectRoot: cwd,
            memoryContext,
            onMemoryUpdate: null,
            pathAllowlist: new PathAllowlist({
                allowedPaths: [cwd, vaultPath, (await import('os')).tmpdir()].filter(Boolean),
                allowSubpaths: true,
            }),
        });

        // Header redraw callback
        updateHeaderCallback = () => {
            const h = formatHeader(buildHeaderInfo());
            const lineCount = h.split('\n').filter(l => l.trim()).length;
            terminal.setHeaderLines(lineCount);
            terminal.setOnRenderHeader(() => process.stdout.write(h));
        };
        updateHeaderCallback();

        spinner.setStatusCallback((text: string) => terminal.updateStatusLine(text));
        terminal.start();
    });

program.parse(process.argv);
