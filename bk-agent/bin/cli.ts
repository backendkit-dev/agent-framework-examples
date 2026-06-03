#!/usr/bin/env node
/**
 * @description Punto de entrada principal de la CLI DeepSeek Code.
 * Configura Commander.js, carga la configuracion del proyecto, inicializa
 * el agente conversacional con todos sus componentes (skills, agentes,
 * memoria, vault) y arranca la terminal interactiva.
 * El desarrollador obtiene un asistente de codificacion completo con un
 * solo comando: deepseek-code.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as yaml from 'yaml';
import { AgentClient } from '../src/api/client';
import { AgentLoop } from '../src/agent/loop';
import { Orchestrator } from '../src/orchestrator/index';
import { loadOrchestratorConfigAll } from '../src/orchestrator/config-loader';

import { Terminal } from '../src/ui/terminal';
import { detectProjectFiles } from '../src/bootstrap/detector';
import { loadConfig, getDefaultConfig } from '../src/bootstrap/config-loader';
import { loadContext } from '../src/bootstrap/context-loader';
import { runContextPipeline, formatPipelineForPrompt, StageCache } from '../src/context/pipeline';
import { loadInstructions } from '../src/bootstrap/instructions-loader';
import { getToolDefinitions } from '../src/tools/definitions';
import { runResearch } from '../src/research/research-loop';
import { loadSkills, loadVaultSkills, VaultSkill } from '../src/skills/loader';
import { Skill } from '../src/skills/loader';
import { BUILTIN_PROFILES, AgentProfile, buildAgentFileContent, mergeWithBuiltins } from '../src/agent/profiles';
import { IterationManager, IterationMode } from '../src/agent/iteration-manager';
import { loadCustomAgents, LoadAgentsResult } from '../src/agent/loader';
import { loadMemoryContext, getProjectMemoryDir, listLocalProjects, getGlobalAgentsDir, getGlobalSkillsDir, MemoryContext } from '../src/bootstrap/memory-loader';
import { ReflectionEngine, BootstrapHook } from '../src/reflection';
import { listProjects, switchProject, createCheckpoint, compactSession, listCheckpoints, readCheckpoint, listWorkspaces, ensureWorkspace, readWorkspaceMemory, DEFAULT_WORKSPACE } from '../src/memory/updater';
import { registerNestJSHandlers } from '../src/skills/handlers/nestjs';
import { registerTypeScriptHandlers } from '../src/skills/handlers/typescript';
import { registerBuiltinHandlers } from '../src/skills/handlers/builtins';
import { PathAllowlist } from '../src/skills/handlers/path-allowlist';
import { defaultInstructions, AIAssistantConfig } from '../src/types/config';
import { runGlobalSeed } from '../src/bootstrap/global-seed';
import { runGlobalSeed as runFrameworkSeed, SlashCommandRegistry, registerBuiltinCommands } from '@bk/agent-core';
import { Spinner, SpinnerMetrics } from '../src/ui/spinner';
import { agentEvents } from '../src/ui/agent-events';
import {
    formatHeader,
    HeaderInfo,
    formatToolCall,
    formatToolCallStart,
    formatToolCallEnd,
    formatToolResult,
    formatCommandOutput,
    formatResponseHeader,
    formatSeparator,
    formatMarkdown,
    extractProjectName,
    formatFileDiff,
} from '../src/ui/formatters';

registerNestJSHandlers();
registerTypeScriptHandlers();

const SLASH_COMMANDS = [
    '/help', '/clear', '/reset-context', '/context', '/tokens', '/usage', '/skills', '/research ', '/models',
    '/agent', '/obsidian ', '/memory', '/switch ', '/checkpoint ', '/proyectos', '/reload-files', '/status',
    '/iteration', '/reflection', '/init', '/prompt ', '@commit',
];

interface ModelInfo {
    id: string;
    name: string;
    badge: string;
    inputPriceM: number;   // USD per million input tokens
    outputPriceM: number;  // USD per million output tokens
    contextWindow: number; // max tokens de contexto
    note: string;
}

const DEEPSEEK_MODELS: ModelInfo[] = [
    {
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        badge: '\u26a1',
        inputPriceM: 0.27,
        outputPriceM: 1.10,
        contextWindow: 64_000,
        note: 'Rapido \u00b7 General, codigo, tareas cotidianas',
    },
    {
        id: 'deepseek-reasoner',
        name: 'DeepSeek R1',
        badge: '\U0001f9e0',
        inputPriceM: 0.55,
        outputPriceM: 2.19,
        contextWindow: 64_000,
        note: 'Experto \u00b7 Razonamiento, matematicas, problemas complejos',
    },
];

const program = new Command();

program
    .name('bk-agent')
    .description('AI coding agent especializado en Node.js y NestJS con BackendKit Labs')
    .version('1.0.0')
    .option('-k, --api-key <key>', 'API key de DeepSeek')
    .option('-m, --model <model>', 'Modelo a usar', 'deepseek-chat')
    .option('-b, --base-url <url>', 'URL base de la API')
    .option('--no-vault', 'Desactivar integracion con Vault')
    .option('--skill <name>', 'Activar solo un skill por nombre')
    .option('--max-iterations <n>', 'Max iteraciones de herramientas por turno', '100')
    .option('--iteration-mode <mode>', 'Modo de iteracion: interactive | auto | step-by-step', 'interactive')
    .option('--command-timeout <s>', 'Timeout en segundos para execute_command (0 = sin limite)')
    .option('--no-stream', 'Deshabilitar streaming (muestra respuesta completa de una vez)')
    .option('--no-qa', 'Desactivar revision automatica de QA')
    .option('--no-delegation', 'Desactivar delegacion a sub-agentes (ask_agent)')
    .option('--headless', 'Modo headless: emite JSON-Lines a stdout para frontend externo (Rust TUI)')
    .action(async (options) => {
        agentEvents.init(!!options.headless);
        const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            console.error(chalk.red('\u274c Se requiere API key. Usa DEEPSEEK_API_KEY (recomendado) o --api-key'));
            process.exit(1);
        }
        if (options.apiKey && process.env.DEEPSEEK_API_KEY) {
            console.warn(chalk.yellow('\u26a0\ufe0f  Usando --api-key. DEEPSEEK_API_KEY tambien esta definida. Se usara --api-key.'));
        } else if (options.apiKey) {
            console.warn(chalk.yellow('\u26a0\ufe0f  API key por flag CLI. Esto es visible en el historial de procesos.'));
            console.warn(chalk.yellow('   Recomendacion: usar DEEPSEEK_API_KEY en variable de entorno en su lugar.'));
        }

        // ~/.deepseek-code/ -- inicializacion global + por proyecto
        {
            const cwd = process.cwd();
            const home = process.env.USERPROFILE ?? process.env.HOME ?? '~';
            const agentMdPath = path.join(cwd, 'AGENT.md');
            const userMdPath = path.join(home, '.deepseek-code', 'USER.md');

            await runFrameworkSeed('bk-agent', cwd).catch((e: Error) => {
                console.warn(chalk.yellow(`  [seed] Framework seed error: ${e.message}`));
            });

            let seedResult = { createdAgentMd: false, createdUserMd: false, createdDirs: [] as string[] };
            try {
                seedResult = await runGlobalSeed(cwd);
            } catch (e) {
                console.warn(chalk.yellow(`  [seed] Error: ${(e as Error).message}`));
            }

            // AGENT.md
            if (seedResult.createdAgentMd) {
                console.log(chalk.green(`  [seed] AGENT.md creado en: ${agentMdPath}`));
                console.log(chalk.dim('         Editalo con el stack y convenciones del proyecto.'));
            }
            // else {
            //     console.log(chalk.dim(`  [config] Proyecto: ${agentMdPath}`));
            // }

            // USER.md
            if (seedResult.createdUserMd) {
                console.log(chalk.green(`  [seed] Perfil creado en: ${userMdPath}`));
                console.log(chalk.dim('         Editalo para personalizar el comportamiento del agente.'));
            }
            // else {
            //     console.log(chalk.dim(`  [config] Perfil:   ${userMdPath}`));
            // }

            // Materializar built-ins como archivos editables (solo si no existen)
            const fs = await import('fs/promises');
            for (const profile of BUILTIN_PROFILES) {
                if (!profile.systemPromptAddition) continue;
                const agentFile = path.join(getGlobalAgentsDir(), `${profile.id}.md`);
                try { await fs.access(agentFile); } catch {
                    await fs.writeFile(agentFile, buildAgentFileContent(profile));
                }
            }
        }
        // .deepseek-code/ local -- solo backups pre-edicion (especifico del proyecto)
        {
            const fs = await import('fs/promises');
            await fs.mkdir(path.join(process.cwd(), '.deepseek-code', 'backups'), { recursive: true });
        }

        // -- Inicializar Reflection Engine + BootstrapHook -------------
        const reflectionEngine = new ReflectionEngine({ projectRoot: process.cwd() });
        await reflectionEngine.initialize();
        const bootstrapHook = new BootstrapHook(reflectionEngine);

        const detected = await detectProjectFiles(process.cwd(), { hook: bootstrapHook });
        let config = getDefaultConfig();
        let contextMarkdown = '';
        let instructions = defaultInstructions();
        let vaultPath = '';
        let vaultConnected = false;
        let projectName = '';

        if (detected.exists && !options.noVault) {
            config = (await loadConfig(detected.configFile, { hook: bootstrapHook })) || config;
            contextMarkdown = (await loadContext(detected.contextFile)) || '';
            instructions = (await loadInstructions(detected.instructionsFile)) || instructions;

            // Extraer nombre del proyecto desde context.md
            projectName = extractProjectName(contextMarkdown);

            try {
                const fs = await import('fs/promises');
                vaultPath = (await fs.readFile(detected.vaultLinkFile, 'utf-8')).trim();
                vaultConnected = true;
            } catch { }
        }

        // Si no se encontro nombre en context.md, usar el nombre del directorio actual
        if (!projectName) {
            projectName = path.basename(process.cwd());
        }

        const skillsDir = getGlobalSkillsDir();
        const agentsDir = getGlobalAgentsDir();
        let vaultAgentsDir = vaultPath ? path.join(vaultPath, '00-Memoria-DeepSeek', 'agentes') : '';
        // Los builtin skills son sembrados en ~/.bk-agent/skills/ por runGlobalSeed al arrancar
        let allSkills = await loadSkills(skillsDir);
        let activeSkills = options.skill
            ? allSkills.filter((s: Skill) => s.name === options.skill)
            : allSkills;

        let agentsLoad: LoadAgentsResult = await loadCustomAgents(agentsDir, vaultAgentsDir);
        if (agentsLoad.errors.length) {
            console.warn(chalk.yellow(`\u26a0  ${agentsLoad.errors.length} agente(s) custom con errores:`));
            agentsLoad.errors.forEach(e => console.warn(chalk.dim(`   ${e.file}: ${e.message}`)));
        }
        let allAgents: AgentProfile[] = mergeWithBuiltins(agentsLoad.agents);
        let currentAgentId = 'general';

        let currentModel = options.model as string;
        const useStream = options.stream !== false;
        const maxIterations = parseInt(options.maxIterations as string, 10) || 100;
        const commandTimeoutMs = options.commandTimeout !== undefined
            ? (parseInt(options.commandTimeout as string, 10) || 0) * 1000 || undefined
            : undefined;

        // Parsear modo de iteracion
        const iterationMode = (options.iterationMode as string) || 'interactive';
        const validModes: IterationMode[] = ['interactive', 'auto', 'step-by-step'];
        const resolvedMode: IterationMode = validModes.includes(iterationMode as IterationMode)
            ? (iterationMode as IterationMode)
            : 'interactive';

        // Crear IterationManager
        const iterationManager = new IterationManager({
            mode: resolvedMode,
            maxIterations,
            batchSize: 25,
            onLimitReached: async (stats) => {
                if (agentEvents.isHeadless()) {
                    agentEvents.emit({ type: 'system', level: 'warn', text: `limite de iteraciones: ${stats.maxIterations} -- continuando automaticamente` });
                    return true;
                }
                process.stdout.write('\n');
                const result = await terminal.confirm(
                    `Limite de ${stats.maxIterations} iteraciones alcanzado ` +
                    `(tool calls: ${stats.toolCalls})? Continuar ${stats.maxIterations + 25} iteraciones mas?`
                );
                return result !== 'no';
            },
            onStep: async (stats) => {
                if (agentEvents.isHeadless()) return true;
                process.stdout.write('\n');
                const result = await terminal.confirm(
                    `[step-by-step] Iteracion ${stats.iterations} - ${stats.toolCalls} tool calls - Continuar?`
                );
                return result !== 'no';
            },
        });

        // Si el modo es auto, mostrar info al arrancar
        if (resolvedMode === 'auto') {
            console.log(chalk.dim(`  [iteration] Modo auto: ${maxIterations} iteraciones maximo, sin confirmacion.`));
        } else if (resolvedMode === 'step-by-step') {
            console.log(chalk.dim(`  [iteration] Modo step-by-step: confirmacion despues de CADA paso.`));
        }

        // -- Cargar memoria: vault primero, global ~/.deepseek-code/ como fallback
        const localMemoryDir = getProjectMemoryDir();
        let memoryContext: MemoryContext | null = await loadMemoryContext(vaultPath, localMemoryDir, projectName, { hook: bootstrapHook });
        // projectBaseDir is the parent of memory/ — constant for the lifetime of the process
        const projectBaseDir = memoryContext ? path.dirname(memoryContext.projectDir) : undefined;
        let activeWorkspace = DEFAULT_WORKSPACE;

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
                customAgentsCount: agentsLoad.agents.length,
            };
        };

        console.log(formatHeader(buildHeaderInfo()));

        // Callback para actualizar el header en scroll -- se declara aqui porque
        // se usa en onAgentAutoSwitch (antes de crear el AgentLoop) y en otros
        // lugares despues de crear el terminal.
        let updateHeaderCallback: () => void = () => { };

        const client = new AgentClient(apiKey, currentModel, options.baseURL);
        const spinner = new Spinner();

        // -- Metricas en vivo para el spinner --------------------------
        const liveMetrics: SpinnerMetrics = {
            inputTokens: 0,
            outputTokens: 0,
            elapsedMs: 0,
            estimatedCostUsd: undefined,
            modelName: currentModel,
        };

        function updateLiveMetrics(stats: { inputTokens: number; outputTokens: number; calls: number }) {
            liveMetrics.inputTokens = stats.inputTokens;
            liveMetrics.outputTokens = stats.outputTokens;
            const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            if (modelInfo && stats.inputTokens + stats.outputTokens > 0) {
                liveMetrics.estimatedCostUsd =
                    (stats.inputTokens / 1_000_000) * modelInfo.inputPriceM +
                    (stats.outputTokens / 1_000_000) * modelInfo.outputPriceM;
            }
        }

        // El thinking se gestiona completamente desde terminal.startThinking/stopThinking.

        const { MessageBuffer } = await import('../src/ui/message-buffer');
        const messageBuffer = new MessageBuffer();
        let terminal: Terminal;
        let allowAll = false;
        let pendingInput: string | null = null;
        let pendingCommitRequest = false;
        // Tracking de tiempos de tool calls para mostrar duracion
        const toolTimings = new Map<string, { name: string; start: number }>();
        // -- Inicializar Orchestrator multi-agente (Fase 2) -------------
        const orchestratorConfig = loadOrchestratorConfigAll();
        const orchestrator = new Orchestrator({
            client,
            config: orchestratorConfig.config,
            customRules: orchestratorConfig.policyRules ?? undefined,
            capabilityMatrix: orchestratorConfig.capabilityMatrix ?? undefined,
        });

        // -- Context Pipeline (5 stages deterministas) -------------
        const pipelineCache = new StageCache();
        const pipelineResult = await runContextPipeline({
            cwd: process.cwd(),
            cache: pipelineCache,
            forceRefresh: false,
        });

        // Mostrar stats del pipeline si hubo cambios
        if (pipelineResult.meta.changedStages.length > 0) {
            const stagesLabel = pipelineResult.meta.changedStages.join(', ');
            console.log(chalk.dim('  [context] Pipeline: ' + stagesLabel + ' (' + pipelineResult.meta.elapsedMs + 'ms)'));
        }

        // Mostrar resumen de lo que se esta trabajando actualmente
        const _session = pipelineResult.session;
        if (_session.content) {
            const _parts: string[] = [];
            if (_session.currentFeature) _parts.push(_session.currentFeature);
            if (_session.progress) _parts.push(_session.progress);
            if (_parts.length === 0) {
                // Fallback: strip frontmatter y markdown, mostrar texto plano
                const _stripped = _session.content
                    .replace(/^---[\s\S]*?---\s*/m, '')
                    .replace(/^#{1,6}\s+.+$/gm, '')
                    .replace(/^>\s*/gm, '')
                    .replace(/\*\*/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                _parts.push(_stripped);
            }
            const _raw = _parts.join(' - ');
            const _display = _raw.length > 300 ? _raw.slice(0, 300) + '...' : _raw;
            console.log(chalk.dim('  [context] ' + _display));
        }

        const pipelineSections = formatPipelineForPrompt(pipelineResult);

        // Filtro de streaming para suprimir <recap>...</recap> inline.
        // El bloque siempre aparece al final; onRecap renderiza el box estilizado.
        let streamTail = '';
        let suppressingRecap = false;

        const agent = new AgentLoop({
            client,
            config,
            instructions,
            vaultPath,
            localMemoryDir,
            localProjectName: projectName,
            contextMarkdown: contextMarkdown + '\n' + pipelineSections.join('\n'),
            contextFiles: {
                agentMd: pipelineResult.instructions.agentMd,
                userMd: pipelineResult.instructions.userMd,
            },
            lessonsMemo: pipelineResult.lessons.memo,
            tools: getToolDefinitions(),
            activeSkills,
            maxIterations,
            commandTimeoutMs,
            memoryContext,
            allAgents,
            iterationManager,  // Pasar IterationManager en lugar de onIterationLimit

            onAgentAutoSwitch: (profile) => {
                if (agentEvents.isHeadless()) {
                    agentEvents.emit({ type: 'agent_switch', from: currentAgentId, to: profile.id, to_name: profile.name, to_icon: profile.icon, method: 'auto' });
                    currentAgentId = profile.id;
                    return;
                }
                // Cambiar modelo si el agente lo requiere (sin banner -- lo muestra onAgentRouting)
                currentAgentId = profile.id;
                if (profile.model && profile.model !== client.getModel()) {
                    client.setModel(profile.model);
                    currentModel = profile.model;
                    liveMetrics.modelName = currentModel;
                }
                updateHeaderCallback();
            },

            onAgentRouting: (profile, method) => {
                if (agentEvents.isHeadless()) {
                    agentEvents.emit({ type: 'agent_switch', from: currentAgentId, to: profile.id, to_name: profile.name, to_icon: profile.icon, method });
                    currentAgentId = profile.id;
                    return;
                }
                terminal.stopThinking();
                spinner.stop();
                terminal.prepareForOutput();
                const BADGES = {
                    override: '[manual]',
                    textual: '[auto]',
                    llm: '[router]',
                };
                const badge = BADGES[method];
                const line = chalk.cyan('\u2550'.repeat(60));
                const desc = chalk.dim(`\u00b7 ${profile.description}`);
                messageBuffer.add({
                    role: 'system',
                    content: `Agente cambiado a ${profile.icon} ${profile.name} (${badge}) -- ${profile.description}`,
                    timestamp: new Date(),
                    meta: `agent:${profile.id}`,
                });
                console.log(`\n${line}`);
                console.log(`  ${profile.icon}  ${chalk.bold(profile.name)}  ${badge}  ${desc}`);
                console.log(line);
            },

            orchestrator,
            onOrchestration: (result) => {
                if (agentEvents.isHeadless()) {
                    const agents = result.selectedAgents.map((a: any) => a.agentId).join(', ');
                    agentEvents.emit({ type: 'system', level: 'info', text: `orquestacion: ${result.task.actionType} · ${result.task.riskLevel} · agentes: ${agents}` });
                    return;
                }
                const task = result.task;
                const agents = result.selectedAgents.map(a => a.agentId).join(', ');
                const gates = result.requiredGates.join(', ') || 'ninguno';
                messageBuffer.add({
                    role: 'system',
                    content: `\U0001f50d Orquestacion: ${task.actionType} \u00b7 ${task.riskLevel} \u00b7 agentes: ${agents} \u00b7 gates: ${gates}`,
                    timestamp: new Date(),
                    meta: 'orchestration',
                });
                console.log(chalk.dim(`\n  \U0001f50d ${chalk.bold('Orquestacion')}  \u00b7  ${task.actionType}  \u00b7  ${task.riskLevel}  \u00b7  ${agents}  \u00b7  gates: ${gates}`));
                // TASK-12: mostrar policies auto-generadas que estan activas (las que usan keywords)
                const autoPolicies = result.appliedPolicies.filter(p => p.reason.includes('keywords=['));
                for (const p of autoPolicies) {
                    console.log(chalk.dim(`     [auto-policy] ${p.reason}`));
                }
            },

            noDelegation: !options.delegation,

            onDelegating: (fromAgentId, toAgent) => {
                if (agentEvents.isHeadless()) {
                    agentEvents.emit({ type: 'agent_switch', from: fromAgentId, to: toAgent.id, to_name: toAgent.name, to_icon: toAgent.icon, method: 'delegate' });
                    return;
                }
                terminal.stopThinking();
                spinner.stop();
                terminal.prepareForOutput();
                const fromAgent = allAgents.find(a => a.id === fromAgentId);
                const fromIcon = fromAgent?.icon ?? '\U0001f916';
                const cols = Math.min(process.stdout.columns || 80, 80);
                const label = `  ${fromIcon} ${chalk.dim('\u2192')} ${toAgent.icon}  ${chalk.bold(toAgent.name)}`;
                const fill = Math.max(1, cols - label.replace(/\x1b\[[0-9;]*m/g, '').length - 1);
                messageBuffer.add({
                    role: 'system',
                    content: `${fromIcon} \u2192 ${toAgent.icon} ${toAgent.name} -- consultando especialista`,
                    timestamp: new Date(),
                    meta: `delegate:${toAgent.id}`,
                });
                console.log('\n' + label + '  ' + chalk.dim('\u00b7'.repeat(fill)));
                spinner.startWithTimer('consultando');
            },

            onSpecialistStreamStart: (profile) => {
                if (agentEvents.isHeadless()) {
                    agentEvents.emit({ type: 'block_start', agent_id: profile.id, agent_name: profile.name, agent_icon: profile.icon });
                    return;
                }
                spinner.stop();
                terminal.prepareForOutput();
                process.stdout.write(`\n${profile.icon}  ${chalk.bold(profile.name)}\n`);
            },

            onSpecialistChunk: (delta: string) => {
                if (agentEvents.isHeadless()) { agentEvents.emit({ type: 'token', content: delta }); return; }
                process.stdout.write(delta);
            },

            onSpecialistDone: (profile, elapsedMs, inputTokens, outputTokens) => {
                if (agentEvents.isHeadless()) {
                    const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
                    const costUsd = modelInfo
                        ? (inputTokens / 1_000_000) * modelInfo.inputPriceM + (outputTokens / 1_000_000) * modelInfo.outputPriceM
                        : undefined;
                    agentEvents.emit({ type: 'metrics', input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd });
                    agentEvents.emit({ type: 'block_end', status: 'ok', agent_id: profile.id });
                    return;
                }
                spinner.stop();
                terminal.prepareForOutput();
                process.stdout.write('\n');
                const elapsed = (elapsedMs / 1000).toFixed(1);
                const stats = [
                    chalk.dim(`\u2191 ${inputTokens.toLocaleString()} tk`),
                    chalk.dim(`\u2193 ${outputTokens.toLocaleString()} tk`),
                    chalk.dim(`\u00b7`),
                    chalk.dim(`${elapsed}s`),
                ].join('  ');
                console.log('  ' + stats);
                // Agregar al buffer de mensajes
                messageBuffer.add({
                    role: 'system',
                    content: `${profile.icon} ${profile.name} completado -- ${elapsed}s, \u2191${inputTokens.toLocaleString()} \u2193${outputTokens.toLocaleString()} tk`,
                    timestamp: new Date(),
                    meta: `specialist:${profile.id}`,
                });
                // Actualizar metricas de sesion en el spinner
                const sessionStats = agent.getSessionStats();
                updateLiveMetrics(sessionStats);
                liveMetrics.elapsedMs += elapsedMs;
                console.log(formatSeparator());
            },

            onRecap: (recap) => {
                if (agentEvents.isHeadless()) {
                    agentEvents.emit({ type: 'recap', text: recap });
                    return;
                }
                terminal.prepareForOutput();
                const cols = Math.min(process.stdout.columns || 80, 80);
                const bar = chalk.dim('\u2504'.repeat(cols - 2));
                messageBuffer.add({
                    role: 'system',
                    content: `\u203b recap: ${recap}`,
                    timestamp: new Date(),
                    meta: 'recap',
                });
                console.log(`\n${bar}`);
                console.log(chalk.bold.magenta('  \u203b ') + chalk.bold.white('recap  ') + chalk.dim('\u00b7') + '  ' + chalk.italic(recap));
                console.log(bar);
            },

            onQAReview: (review) => {
                if (agentEvents.isHeadless()) { agentEvents.emit({ type: 'qa_review', content: review }); return; }
                terminal.prepareForOutput();
                const line = chalk.yellow('\u2550'.repeat(60));
                messageBuffer.add({
                    role: 'system',
                    content: `\U0001f9ea QA Engineer -- revision automatica:\n${review.slice(0, 300)}`,
                    timestamp: new Date(),
                    meta: 'qa-review',
                });
                console.log(`\n${line}`);
                console.log(`  \U0001f9ea  ${chalk.bold.yellow('QA Engineer')}  ${chalk.dim('\u00b7 visto bueno')}`);
                console.log(line);
                console.log(formatMarkdown(review));
                console.log(formatSeparator());
            },

            askConfirmation: async (msg: string) => {
                if (agentEvents.isHeadless()) return true;
                if (allowAll) return true;
                terminal.stopThinking();
                spinner.stop();
                const result = await terminal.confirm(msg);
                if (result === 'all') allowAll = true;
                return result !== 'no';
            },

            onThinking: () => {
                if (agentEvents.isHeadless()) {
                    const cur = allAgents.find((a: any) => a.id === currentAgentId);
                    agentEvents.emit({ type: 'thinking', label: cur ? `${cur.icon} ${cur.name}` : currentAgentId });
                    return;
                }
                const cur = allAgents.find(a => a.id === currentAgentId);
                const label = cur ? `${cur.icon} ${cur.name}` : '\U0001f916';
                terminal.startThinking(label);
            },

            onStreamStart: useStream ? () => {
                if (agentEvents.isHeadless()) {
                    const cur = allAgents.find((a: any) => a.id === currentAgentId);
                    agentEvents.emit({ type: 'block_start', agent_id: currentAgentId, agent_name: cur?.name, agent_icon: cur?.icon });
                    streamTail = '';
                    suppressingRecap = false;
                    return;
                }
                terminal.stopThinking();
                terminal.prepareForOutput();
                streamTail = '';
                suppressingRecap = false;
                // Agentes con renderer propio (ej: qa-engineer) no muestran el header generico
                const curAgent = allAgents.find(a => a.id === currentAgentId);
                if (!curAgent?.suppressDefaultOutput) {
                    process.stdout.write(formatResponseHeader() + '\n');
                }
            } : undefined,

            onReasoningChunk: (delta: string) => {
                if (agentEvents.isHeadless()) return;
                terminal.setThinkingContent(delta, 0);
            },

            onChunk: useStream ? (delta: string) => {
                if (agentEvents.isHeadless()) {
                    if (suppressingRecap) { return; }
                    streamTail += delta;
                    const idx = streamTail.indexOf('<recap>');
                    if (idx !== -1) {
                        // Emit text before the recap tag, then suppress the rest
                        const before = streamTail.slice(0, idx);
                        if (before) agentEvents.emit({ type: 'token', content: before });
                        suppressingRecap = true;
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

                if (suppressingRecap) return;

                // Agentes con renderer propio (ej: qa-engineer via onQAReview) no streaman al terminal
                const curAgent = allAgents.find(a => a.id === currentAgentId);
                if (curAgent?.suppressDefaultOutput) return;

                streamTail += delta;
                const idx = streamTail.indexOf('<recap>');

                if (idx !== -1) {
                    // Escribir solo lo anterior al tag; el resto lo renderiza onRecap
                    if (idx > 0) process.stdout.write(streamTail.slice(0, idx));
                    suppressingRecap = true;
                    streamTail = '';
                    return;
                }

                // Mantener los últimos 7 chars en buffer por si el tag está partido entre chunks
                const safe = Math.max(0, streamTail.length - 7);
                if (safe > 0) {
                    process.stdout.write(streamTail.slice(0, safe));
                    streamTail = streamTail.slice(safe);
                }
            } : undefined,

            onToolCall: (name: string, argsStr: string) => {
                if (agentEvents.isHeadless()) {
                    // Flush any pending stream tail before reporting the tool call
                    if (streamTail) {
                        agentEvents.emit({ type: 'token', content: streamTail });
                        streamTail = '';
                    }
                    let preview = '';
                    try {
                        const args = JSON.parse(argsStr);
                        const [, val] = Object.entries(args)[0] ?? [];
                        if (val !== undefined) preview = String(val).slice(0, 80);
                    } catch {}
                    agentEvents.emit({ type: 'tool_call', name, args_preview: preview });
                    return;
                }
                terminal.stopThinking();
                spinner.stop();
                terminal.prepareForOutput();
                let argsDisplay = '';
                try {
                    const args = JSON.parse(argsStr);
                    const [, val] = Object.entries(args)[0] ?? [];
                    if (val !== undefined) {
                        argsDisplay = String(val).length > 60 ? String(val).slice(0, 60) + '\u2026' : String(val);
                    }
                } catch { }
                messageBuffer.add({
                    role: 'tool',
                    content: `${name}(${argsDisplay})`,
                    timestamp: new Date(),
                    meta: name,
                });
                console.log(formatToolCall(name, argsStr));
                const diffOutput = formatFileDiff(name, argsStr);
                if (diffOutput) process.stdout.write(diffOutput + '\n');
                updateLiveMetrics(agent.getSessionStats());
                spinner.startWithMetrics('Ejecutando\u2026', liveMetrics);
            },

            onToolResult: (_name: string, result: string) => {
                if (agentEvents.isHeadless()) {
                    const success = !result.startsWith('Error');
                    agentEvents.emit({ type: 'tool_result', name: _name, success, preview: success ? undefined : result.slice(0, 120) });
                    return;
                }
                spinner.stop();
                console.log(formatToolResult(result));
            },

            onToolDone: () => { if (!agentEvents.isHeadless()) spinner.stop(); },

            onResponse: (content: string) => {
                if (agentEvents.isHeadless()) {
                    if (streamTail && !suppressingRecap) agentEvents.emit({ type: 'token', content: streamTail });
                    streamTail = '';
                    const stats = agent.getSessionStats();
                    const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
                    const costUsd = modelInfo
                        ? (stats.inputTokens / 1_000_000) * modelInfo.inputPriceM + (stats.outputTokens / 1_000_000) * modelInfo.outputPriceM
                        : undefined;
                    agentEvents.emit({ type: 'metrics', input_tokens: stats.inputTokens, output_tokens: stats.outputTokens, cost_usd: costUsd });
                    agentEvents.emit({ type: 'block_end', status: 'ok' });
                    return;
                }
                terminal.stopThinking();
                spinner.stop();
                terminal.prepareForOutput();
                // Trackear último bloque de código para Ctrl+Y
                const codeMatch = content.match(/```(?:\w+)?\n([\s\S]*?)```/);
                if (codeMatch) terminal.setLastCode(codeMatch[1].trim());
                messageBuffer.add({
                    role: 'assistant',
                    content,
                    timestamp: new Date(),
                });
                // onResponse y onQAReview son callbacks independientes que AgentLoop invoca secuencialmente.
                // Sin suppressDefaultOutput, el mismo contenido se mostraria dos veces: una aqui como respuesta generica
                // y otra en onQAReview con formato especifico. La flag declara que el agente tiene su propio renderer.
                // Idealmente AgentLoop unificaria estos callbacks, pero requeria cambiar el contrato de todos los handlers.
                const currentAgent = allAgents.find(a => a.id === currentAgentId);
                if (currentAgent?.suppressDefaultOutput) return;
                if (!useStream) {
                    console.log(formatResponseHeader());
                    console.log(formatMarkdown(content));
                } else {
                    // Flush de cualquier tail que no formó parte de un <recap>
                    if (streamTail && !suppressingRecap) process.stdout.write(streamTail);
                    streamTail = '';
                    process.stdout.write('\n');
                }
                console.log(formatSeparator());
            },

            onMemoryRefreshed: (ctx) => {
                memoryContext = ctx as MemoryContext | null;
            },
        });

        // -- Helpers ---------------------------------------------------
        const showHeader = () => {
            console.clear();
            const h = formatHeader(buildHeaderInfo());
            process.stdout.write(h);
            updateHeaderCallback();
            terminal.useDirectPrompt();
        };

        const interrupt = () => {
            if (!agent.isBusy()) return;  // nada que abortar
            terminal.stopThinking();
            spinner.stop();
            agent.abort();
            // Mostrar mensaje limpio sin limpiar pantalla ni doblar el prompt.
            // El handler de onLine llama showPrompt() cuando processInput retorna.
            process.stdout.write('\n' + chalk.yellow('  \u2298 Abortado\n'));
        };

        process.on('SIGINT', interrupt);

        // -- Aplicar override del agente inicial si existe -------------
        // (caso: usuario tiene agents/general.md custom -- sin esto el override
        // se carga pero nunca se aplica al iniciar la sesion)
        const initialProfile = allAgents.find(a => a.id === currentAgentId);
        if (initialProfile?.systemPromptAddition) {
            agent.setCurrentAgent(initialProfile.id, initialProfile.systemPromptAddition);
            if (initialProfile.model && initialProfile.model !== client.getModel()) {
                client.setModel(initialProfile.model);
                currentModel = initialProfile.model;
                updateHeaderCallback();
            }
        }

        // ── Slash command registry ────────────────────────────────────────────────
        // Handlers close over let-variables (currentModel, currentAgentId, etc.)
        // so they always read the latest values at call time.
        const cmdRegistry = new SlashCommandRegistry();
        registerBuiltinCommands(cmdRegistry);

        cmdRegistry.register('/help', 'Muestra los comandos disponibles', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            emit(buildHelpText(allSkills));
        });

        cmdRegistry.register('/clear', 'Limpiar pantalla', async () => {
            agentEvents.emit({ type: 'clear' });
            agentEvents.emit({ type: 'done' });
        });

        cmdRegistry.register('/reset-context', 'Reiniciar conversacion', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            agent.resetHistory();
            emit('Conversacion reiniciada. Sistema y memoria se mantienen.');
        });

        cmdRegistry.register('/tokens', 'Uso de tokens en el contexto actual', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            const n = agent.getContextTokens();
            const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            const max = modelInfo?.contextWindow ?? 32000;
            const pct = Math.round((n / max) * 100);
            emit(`Tokens en contexto: ${n.toLocaleString()} / ${max.toLocaleString()} (${pct}%)\nModelo: ${currentModel}`);
        });

        cmdRegistry.register('/usage', 'Tokens y costo de sub-agentes en esta sesion', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            const stats = agent.getSessionStats();
            const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            const total = stats.inputTokens + stats.outputTokens;
            const lines = [
                `Sub-agentes — llamadas: ${stats.calls}`,
                `Entrada:  ${stats.inputTokens.toLocaleString()} tk`,
                `Salida:   ${stats.outputTokens.toLocaleString()} tk`,
                `Total:    ${total.toLocaleString()} tk`,
            ];
            if (modelInfo && total > 0) {
                const cost = ((stats.inputTokens / 1_000_000) * modelInfo.inputPriceM + (stats.outputTokens / 1_000_000) * modelInfo.outputPriceM).toFixed(5);
                lines.push(`Costo est.: $${cost} USD`);
            }
            emit(lines.join('\n'));
        });

        cmdRegistry.register('/status', 'Panel de estado del sistema', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            const cur = allAgents.find(a => a.id === currentAgentId);
            const contextTokens = agent.getContextTokens();
            const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            const max = modelInfo?.contextWindow ?? 32000;
            const pct = Math.round((contextTokens / max) * 100);
            const imStats = iterationManager.stats;
            const lines = [
                `Agente:   ${cur ? cur.name + ' (' + currentAgentId + ')' : currentAgentId}`,
                `Modelo:   ${currentModel}`,
                `Vault:    ${vaultConnected ? 'conectado' : 'no conectado'}`,
                `Skills:   ${allSkills.length} instalados`,
                `Agentes:  ${allAgents.length} perfiles`,
                `Contexto: ${contextTokens.toLocaleString()} / ${max.toLocaleString()} tk (${pct}%)`,
                `Modo iteracion: ${iterationManager.mode}  ·  pasos: ${imStats.iterations}  ·  tool calls: ${imStats.toolCalls}`,
            ];
            if (memoryContext?.activeProject) lines.push(`Memoria: ${memoryContext.activeProject}`);
            emit(lines.join('\n'));
        });

        cmdRegistry.register('/memory', 'Ver memoria persistente del proyecto activo', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            if (!memoryContext) { emit('Sin memoria activa.'); return; }
            emit(`Memoria: ${memoryContext.activeProject}\n\n${memoryContext.sessionContent || '(sesion-actual.md vacia)'}`);
        });

        cmdRegistry.register('/reload-files', 'Recarga AGENT.md y USER.md del workspace', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            const result = await agent.reloadContextFiles();
            const lines = ['Archivos recargados:'];
            lines.push(result.agentMd ? `  AGENT.md  OK (${result.agentMd.split('\n').length} lineas)` : '  AGENT.md  no encontrado');
            lines.push(result.userMd  ? `  USER.md   OK (${result.userMd.split('\n').length} lineas)`  : '  USER.md   no encontrado');
            emit(lines.join('\n'));
        });

        cmdRegistry.register('/init', 'Inicializar o analizar proyecto con project-manager', async ({ rawInput }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            const pmProfile = allAgents.find(a => a.id === 'project-manager');
            if (!pmProfile) { agentEvents.emit({ type: 'block_start', agent_id: 'system', agent_name: 'Sistema' }); agentEvents.emit({ type: 'token', content: 'Agente project-manager no encontrado.' }); agentEvents.emit({ type: 'block_end', status: 'ok' }); agentEvents.emit({ type: 'done' }); return; }
            const fsInit = await import('fs/promises');
            const projectFiles = ['especification.md', 'disene.md', 'package.json', 'go.mod', 'Cargo.toml', 'pom.xml', 'AGENT.md'];
            const found: string[] = [];
            for (const f of projectFiles) {
                try { await fsInit.access(path.join(process.cwd(), f)); found.push(f); } catch { /* no presente */ }
            }
            let promptMdContent: string | null = null;
            try { promptMdContent = await fsInit.readFile(path.join(process.cwd(), 'prompt.md'), 'utf-8'); } catch { /* sin prompt.md */ }
            const isExisting = found.length > 0;
            const baseMsg = isExisting
                ? `[/init] Proyecto existente detectado (${found.join(', ')}). Analiza el estado actual, identifica gaps en la documentacion y actualiza o crea especification.md y disene.md segun corresponda.`
                : `[/init] Proyecto nuevo. Inicia el flujo de levantamiento de requisitos: haz las 4 preguntas requeridas antes de crear cualquier documento.`;
            const initMsg = promptMdContent ? `${baseMsg}\n\nContexto adicional desde prompt.md:\n\n${promptMdContent}` : baseMsg;
            agent.setCurrentAgent(pmProfile.id, pmProfile.systemPromptAddition, true);
            currentAgentId = pmProfile.id;
            if (pmProfile.model && pmProfile.model !== client.getModel()) {
                client.setModel(pmProfile.model);
                currentModel = pmProfile.model;
            }
            try {
                await agent.processInput(initMsg);
                agentEvents.emit({ type: 'done' });
            } catch (err: any) {
                agentEvents.emit({ type: 'error', message: err.message });
            }
        });

        cmdRegistry.register('/agent', 'Lista o cambia el agente activo', async ({ rawInput, args, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            if (args === 'reload') {
                agentsLoad = await loadCustomAgents(agentsDir, vaultAgentsDir);
                allAgents = mergeWithBuiltins(agentsLoad.agents);
                emit(`Agentes recargados: ${agentsLoad.agents.length} custom + builtins`);
                return;
            }
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
            agent.setCurrentAgent(profile.id, profile.systemPromptAddition, true);
            currentAgentId = profile.id;
            if (profile.model && profile.model !== client.getModel()) {
                client.setModel(profile.model);
                currentModel = profile.model;
            }
            emit(`Agente cambiado a: ${profile.icon} ${profile.name} · historial reseteado`);
        });

        cmdRegistry.register('/agents', 'Lista agentes disponibles', async ({ rawInput, args, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            const lines = ['Agentes disponibles — usa /agent <id> para cambiar:\n'];
            for (const a of allAgents) {
                const mark = a.id === currentAgentId ? ' <- activo' : '';
                lines.push(`  /agent ${a.id.padEnd(18)} ${a.icon} ${a.name}${mark}`);
                if (a.description) lines.push(`    ${a.description}`);
            }
            emit(lines.join('\n'));
        });

        cmdRegistry.register('/models', 'Lista o cambia el modelo de IA', async ({ rawInput, args, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
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
            if (!modelInfo) { emit(`Modelo no encontrado: ${args}\nUsa /models para ver la lista.`); return; }
            client.setModel(modelInfo.id);
            currentModel = modelInfo.id;
            emit(`Modelo cambiado a: ${modelInfo.badge} ${modelInfo.name} (${modelInfo.id})`);
        });

        cmdRegistry.register('/skills', 'Lista los skills cargados', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            const lines = [`Skills instalados (${allSkills.length}):\n`];
            for (const s of allSkills as Skill[]) {
                lines.push(`  ${s.name} v${s.version}`);
                if (s.description) lines.push(`    ${s.description}`);
            }
            emit(lines.join('\n'));
        });

        cmdRegistry.register('/iteration', 'Ver o cambiar modo de iteracion', async ({ rawInput, args, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            if (!args) {
                emit([
                    `Modo actual: ${iterationManager.mode}  ·  pasos: ${iterationManager.stats.iterations}  ·  tool calls: ${iterationManager.stats.toolCalls}`,
                    '',
                    'Cambiar modo:',
                    '  /iteration interactive    pregunta al alcanzar el limite',
                    '  /iteration auto           sin confirmacion automatico',
                    '  /iteration step-by-step   confirmacion en cada paso',
                    '  /iteration reset-limit    reinicia el contador',
                ].join('\n'));
                return;
            }
            if (args === 'reset-limit') { iterationManager.resetLimit(); emit('Contador reiniciado.'); return; }
            if (!validModes.includes(args as IterationMode)) { emit(`Modo invalido: ${args}`); return; }
            iterationManager.setMode(args as IterationMode);
            emit(`Modo cambiado a: ${args}`);
        });

        // /checkpoint is registered by registerBuiltinCommands (framework)
        // projectDir + sessionContent + injectContext are injected at dispatch time

        cmdRegistry.register('/proyectos', 'Listar proyectos locales conocidos', async ({ rawInput, emit }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            const projects = await listLocalProjects();
            if (!projects.length) { emit('No hay proyectos locales en ~/.deepseek-code/projects/'); return; }
            const lines = projects.map(p => `  ${p.isCurrent ? '->' : '  '} ${p.name}${p.isCurrent ? '  <- actual' : ''}\n     ${p.memoryDir}`);
            emit('Proyectos locales:\n\n' + lines.join('\n'));
        });

        cmdRegistry.register('/prompt', 'Genera un prompt estructurado desde una frase', async ({ rawInput, args }) => {
            agentEvents.emit({ type: 'user_message', text: rawInput });
            if (!args.startsWith('new')) {
                const stripAnsi2 = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
                agentEvents.emit({ type: 'block_start', agent_id: 'system', agent_name: 'Sistema' });
                agentEvents.emit({ type: 'token', content: stripAnsi2('Uso: /prompt new <frase inicial>\nEjemplo: /prompt new "analizar logs de errores y resumirlos"') });
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
                await agent.processInput(`Genera un prompt para: ${phrase}\n\nEscribe el prompt final en prompt.md usando write_file.`);
                agentEvents.emit({ type: 'done' });
            } catch (err: any) {
                agentEvents.emit({ type: 'error', message: err.message });
            }
        });

        // -- Headless mode: stdin JSON-Lines reader en lugar de Terminal --
        if (agentEvents.isHeadless()) {
            registerBuiltinHandlers({
                vaultPath,
                instructions,
                askConfirmation: async () => true,
                projectRoot: process.cwd(),
                memoryContext,
                onMemoryUpdate: (vaultPath || localMemoryDir) ? async () => {
                    const fresh = await loadMemoryContext(vaultPath, localMemoryDir, projectName);
                    if (fresh) { memoryContext = fresh; agent.reloadMemory(fresh); }
                } : null,
                pathAllowlist: new PathAllowlist({
                    allowedPaths: [
                        process.cwd(), vaultPath,
                        (await import('os')).tmpdir(),
                        path.join(process.env.USERPROFILE ?? process.env.HOME ?? '~', '.deepseek-code'),
                    ].filter(Boolean),
                    allowSubpaths: true,
                }),
            });

            agentEvents.emit({ type: 'ready' });
            const emitConfig = async () => {
                const workspaceList = projectBaseDir
                    ? (await listWorkspaces(projectBaseDir)).map(w => w.name)
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
                });
            };
            await emitConfig();

            // Headless /switch override — no interactive picker, updates state + re-emits config
            cmdRegistry.register('/switch', 'Cambiar workspace del proyecto', async ({ args, emit, injectContext }) => {
                if (!projectBaseDir) { emit('Sin memoria activa.'); return; }
                if (!args || args === 'list') {
                    const workspaces = await listWorkspaces(projectBaseDir);
                    emit(workspaces.map((w, i) =>
                        `  ${i + 1}. ${w.name}${w.isDefault ? ' (default)' : ''}${w.name === activeWorkspace ? '  <- actual' : ''}`,
                    ).join('\n'));
                    return;
                }
                const workspace = await ensureWorkspace(projectBaseDir, args);
                const { sessionContent, projectContext } = await readWorkspaceMemory(projectBaseDir, args);
                memoryContext = { ...memoryContext!, memoryDir: workspace.memoryDir, projectDir: workspace.memoryDir, sessionContent, projectContext };
                activeWorkspace = args;
                agent.reloadMemory(memoryContext);
                injectContext?.(`## Workspace: ${args}\n\n${sessionContent || '*(empty)*'}`);
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

                        // -- Slash commands (via registry) --------------------------
                        if (text.startsWith('/') || text.startsWith('@')) {
                            const handled = await cmdRegistry.dispatch(text, {
                                emit: emitBlock,
                                agents: allAgents.map(a => ({ id: a.id, name: a.name, description: a.description })),
                                skills: allSkills.map(s => ({ name: s.name, description: s.description, triggers: s.triggers ?? [] })),
                                effectiveAgentId: currentAgentId,
                                model: currentModel,
                                projectDir: memoryContext?.projectDir,
                                projectBaseDir,
                                sessionContent: memoryContext?.sessionContent ?? '',
                                injectContext: (msg) => agent.injectContextMessage(msg),
                            });
                            if (handled) return;
                            agentEvents.emit({ type: 'user_message', text });
                            emitBlock(`Comando no disponible en modo desktop: ${text.split(' ')[0]}`);
                            return;
                        }
                        // -----------------------------------------------------------

                        agentEvents.emit({ type: 'user_message', text });
                        try {
                            await agent.processInput(text);
                            agentEvents.emit({ type: 'done' });
                        } catch (err: any) {
                            agentEvents.emit({ type: 'error', message: err.message });
                        }
                    } else if (msg.type === 'interrupt') {
                        agent.abort();
                    }
                } catch {
                    // linea no-JSON: ignorar
                }
            });

            rl.on('close', async () => {
                await agent.shutdown().catch(() => {});
                process.exit(0);
            });

            return;
        }

        // -- Terminal command overrides (rich chalk output) ----------------
        cmdRegistry.register('/help', 'Muestra los comandos disponibles', async () => {
            console.log(formatCommandOutput(buildHelpText(allSkills)));
        });

        cmdRegistry.register('/clear', 'Limpiar pantalla', async () => {
            messageBuffer.clear();
            showHeader();
        });

        cmdRegistry.register('/reset-context', 'Reiniciar conversacion', async () => {
            agent.resetHistory();
            showHeader();
            console.log(formatCommandOutput('\u{1F4AC} Conversacion reiniciada -- el sistema y la memoria se mantienen.'));
        });

        cmdRegistry.register('/context', 'Ver contexto activo del proyecto', async () => {
            const parts: string[] = [];
            if (memoryContext) {
                if (memoryContext.projectContext) {
                    parts.push(
                        chalk.bold(`\u{1F4CB} ${memoryContext.activeProject}`) +
                        chalk.dim('  contexto-proyecto.md') + '\n' +
                        formatMarkdown(memoryContext.projectContext)
                    );
                }
                if (memoryContext.sessionContent) {
                    parts.push(
                        chalk.bold('\u{1F9E0} Sesion activa') +
                        chalk.dim(`  ${memoryContext.activeProject}`) + '\n' +
                        formatMarkdown(memoryContext.sessionContent)
                    );
                }
            }
            if (contextMarkdown) {
                const cwdLabel = chalk.dim(`(${path.basename(process.cwd())}/.ai-assistant/context.md)`);
                parts.push(
                    chalk.bold('\u{1F4C1} Workspace') + ' ' + cwdLabel + '\n' +
                    formatMarkdown(contextMarkdown)
                );
            }
            const text = parts.length > 0
                ? parts.join('\n\n' + chalk.dim('─'.repeat(40)) + '\n\n')
                : chalk.dim('(sin contexto)');
            console.log(formatCommandOutput(text));
        });

        cmdRegistry.register('/tokens', 'Uso de tokens en el contexto actual', async () => {
            const n = agent.getContextTokens();
            const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            const maxTokens = modelInfo?.contextWindow ?? 32000;
            const pct = Math.round((n / maxTokens) * 100);
            const bar = buildBar(pct, 24);
            console.log(formatCommandOutput(
                `${chalk.cyan(n.toLocaleString())} / ${maxTokens.toLocaleString()}  ${bar}  ${chalk.dim(pct + '%')}  ${chalk.dim('(' + currentModel + ')')}`
            ));
        });

        cmdRegistry.register('/usage', 'Tokens y costo de sub-agentes en esta sesion', async () => {
            const stats = agent.getSessionStats();
            const contextTk = agent.getContextTokens();
            const model = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            const lines: string[] = [
                chalk.bold('\u{1F4CA} Uso de tokens -- sesion actual'),
                '',
                chalk.dim('Contexto:') + '  ' + chalk.cyan(contextTk.toLocaleString() + ' tk'),
            ];
            if (stats.calls > 0) {
                const total = stats.inputTokens + stats.outputTokens;
                lines.push('');
                lines.push(chalk.dim('Sub-agentes (ask_agent + QA):'));
                lines.push(`  Llamadas:  ${chalk.cyan(String(stats.calls))}`);
                lines.push(`  Entrada:   ${chalk.cyan(stats.inputTokens.toLocaleString() + ' tk')}`);
                lines.push(`  Salida:    ${chalk.cyan(stats.outputTokens.toLocaleString() + ' tk')}`);
                lines.push(`  Total:     ${chalk.cyan(total.toLocaleString() + ' tk')}`);
                if (model) {
                    const cost = (
                        (stats.inputTokens / 1_000_000) * model.inputPriceM +
                        (stats.outputTokens / 1_000_000) * model.outputPriceM
                    ).toFixed(5);
                    lines.push(`  Costo est: ${chalk.cyan('$' + cost + ' USD')}`);
                }
            } else {
                lines.push(chalk.dim('  (sin llamadas a sub-agentes en esta sesion)'));
            }
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/skills', 'Ver, instalar o crear skills', async () => {
            const vaultSkills: VaultSkill[] = vaultPath ? await loadVaultSkills(vaultPath) : [];
            const installedNames = new Set(allSkills.map((s: Skill) => s.name));
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
            const subtitle = chalk.dim(
                `${allSkills.length} instalado${allSkills.length !== 1 ? 's' : ''}` +
                (vaultPath ? `  ·  ${availableVault.length} en vault` : '') +
                '  ·  + crear nuevo'
            );
            const chosen = await terminal.filteredSelect(
                `Skills  ${subtitle}`,
                menuItems,
                [{ label: chalk.dim('+ Crear nuevo skill…'), value: '__new__' }]
            );
            if (!chosen || chosen === '__empty__') return;
            if (chosen === '__new__') {
                const name = await terminal.input('Nombre del skill (ej: mi-skill):');
                if (!name) { console.log(formatCommandOutput(chalk.dim('Cancelado.'))); return; }
                const desc = (await terminal.input('Descripcion:')) ?? '';
                const triggersRaw = await terminal.input('Triggers (palabras clave, separadas por coma):');
                if (!triggersRaw) { console.log(formatCommandOutput(chalk.dim('Cancelado.'))); return; }
                const triggers = triggersRaw.split(',').map((t: string) => t.trim()).filter(Boolean);
                const fsio = await import('fs/promises');
                await fsio.mkdir(skillsDir, { recursive: true });
                await fsio.writeFile(
                    path.join(skillsDir, `${name}.yaml`),
                    yaml.stringify({ name, version: '1.0', description: desc, triggers, systemPromptAddition: `Eres experto en ${name}. ${desc}\n` })
                );
                allSkills = await loadSkills(skillsDir);
                activeSkills = options.skill ? allSkills.filter((s: Skill) => s.name === options.skill) : allSkills;
                agent.setActiveSkills(activeSkills);
                updateHeaderCallback();
                const resultLines = [
                    chalk.green(`✓ Skill creado: ${name}`),
                    chalk.dim(`  .deepseek-code/skills/${name}.yaml`),
                    chalk.dim(`  triggers: ${triggers.join(', ')}`),
                ];
                if (vaultPath) {
                    const saveToVault = await terminal.yesNo('¿Guardar tambien en el vault?', true);
                    if (saveToVault) {
                        const categoryRaw = await terminal.input('Categoria en vault (ej: Resiliencia, Seguridad, General):');
                        const category = categoryRaw?.trim() || 'General';
                        const skillDir = path.join(vaultPath, '04-Recursos', 'Skills', category, name);
                        await fsio.mkdir(skillDir, { recursive: true });
                        const today = new Date().toISOString().split('T')[0];
                        const skillMd = [
                            '---',
                            `name: ${name}`,
                            `description: ${desc}`,
                            'tags:',
                            ...triggers.map(t => `  - ${t}`),
                            `fecha_creacion: ${today}`,
                            'estado: completado',
                            '---',
                            '',
                            `# ${name}`,
                            '',
                            `> ${desc}`,
                            '',
                            '---',
                            '',
                            '## \u{1F4CB} Alcance',
                            '',
                            '- [ ] Documenta aqui que cubre este skill',
                            '',
                            '## \u{1F504} Workflow',
                            '',
                            '- [ ] Agrega los pasos de implementacion',
                            '',
                        ].join('\n');
                        await fsio.writeFile(path.join(skillDir, 'SKILL.md'), skillMd);
                        resultLines.push(chalk.dim(`  vault: 04-Recursos/Skills/${category}/${name}/SKILL.md`));
                    }
                }
                console.log(formatCommandOutput(resultLines.join('\n')));
                return;
            }
            if (chosen.startsWith('vault:')) {
                const filePath = chosen.slice(6);
                const vs = vaultSkills.find(v => v.filePath === filePath);
                if (!vs) return;
                const ok = await terminal.yesNo(`¿Instalar "${vs.name}" desde vault?`, true);
                if (!ok) { console.log(formatCommandOutput(chalk.dim('Cancelado.'))); return; }
                const fsio = await import('fs/promises');
                await fsio.mkdir(skillsDir, { recursive: true });
                const systemPromptAddition = vs.body
                    ? vs.body
                    : `Eres experto en ${vs.name}.\n${vs.description}\nAplica las mejores practicas del vault.\n`;
                await fsio.writeFile(
                    path.join(skillsDir, `${vs.name}.yaml`),
                    yaml.stringify({
                        name: vs.name,
                        version: vs.version || '1.0',
                        description: vs.description,
                        triggers: vs.tags,
                        systemPromptAddition,
                    })
                );
                allSkills = await loadSkills(skillsDir);
                activeSkills = options.skill ? allSkills.filter((s: Skill) => s.name === options.skill) : allSkills;
                agent.setActiveSkills(activeSkills);
                updateHeaderCallback();
                console.log(formatCommandOutput(
                    chalk.green(`✓ Skill instalado: ${vs.name}`) +
                    '\n' + chalk.dim(`  .deepseek-code/skills/${vs.name}.yaml`) +
                    '\n' + chalk.dim(`  triggers: ${vs.tags.join(', ')}`)
                ));
                return;
            }
            if (chosen.startsWith('local:')) {
                const skillName = chosen.slice(6);
                const s = allSkills.find((sk: Skill) => sk.name === skillName);
                if (s) {
                    const lines = [
                        chalk.bold(`\u{1F4DA} ${s.name}`) + chalk.dim(`  v${s.version}`),
                        chalk.dim(`   ${s.description}`),
                        chalk.dim(`   triggers: ${s.triggers.join(', ')}`),
                        ...(s.tools?.length ? [chalk.dim(`   tools: ${s.tools.map(t => t.name).join(', ')}`)] : []),
                    ];
                    console.log(formatCommandOutput(lines.join('\n')));
                }
            }
        });

        cmdRegistry.register('/memory', 'Ver memoria persistente del proyecto activo', async () => {
            if (!memoryContext) {
                console.log(formatCommandOutput(chalk.dim('Sin memoria activa.')));
                return;
            }
            const isLocal = memoryContext.source === 'local';
            const icon = isLocal ? '\u{1F4BE}' : '\u{1F9E0}';
            const src = isLocal ? chalk.dim('  (memoria local -- sin vault)') : chalk.dim(`  ${memoryContext.projectDir}`);
            const lines = [
                chalk.bold(`${icon} Memoria · ${memoryContext.activeProject}`) + src,
                '',
                memoryContext.sessionContent
                    ? formatMarkdown(memoryContext.sessionContent)
                    : chalk.dim('  (sesion-actual.md vacia)'),
            ];
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/switch', 'Cambiar proyecto activo (vault)', async ({ args }) => {
            if (!projectBaseDir) {
                console.log(formatCommandOutput(chalk.yellow('Sin memoria activa.')));
                return;
            }
            if (agent.isBusy()) {
                console.log(formatCommandOutput(chalk.yellow('Agente ocupado -- espera antes de cambiar workspace.')));
                return;
            }

            let chosenName: string | null = args || null;
            if (!chosenName) {
                const workspaces = await listWorkspaces(projectBaseDir);
                const items = workspaces.map(w => ({
                    label: (w.name === activeWorkspace ? chalk.green('✓ ') : '  ') +
                        (w.isDefault ? chalk.dim(w.name) : chalk.cyan(w.name)),
                    value: w.name,
                }));
                const fixedItems = [{ label: chalk.dim('+ Nuevo workspace…'), value: '__new__' }];
                chosenName = await terminal.filteredSelect(
                    `Workspaces  ${chalk.dim('(actual: ' + activeWorkspace + ')')}`,
                    items,
                    fixedItems,
                );
                if (!chosenName) {
                    console.log(formatCommandOutput(chalk.dim('Cancelado.')));
                    return;
                }
                if (chosenName === '__new__') {
                    chosenName = await terminal.input('Nombre del workspace:');
                    if (!chosenName) {
                        console.log(formatCommandOutput(chalk.dim('Cancelado.')));
                        return;
                    }
                }
            }

            const workspace = await ensureWorkspace(projectBaseDir, chosenName);
            const { sessionContent, projectContext } = await readWorkspaceMemory(projectBaseDir, chosenName);
            memoryContext = {
                ...memoryContext!,
                memoryDir: workspace.memoryDir,
                projectDir: workspace.memoryDir,
                sessionContent,
                projectContext,
            };
            activeWorkspace = chosenName;
            agent.reloadMemory(memoryContext);
            updateHeaderCallback();
            console.log(formatCommandOutput(
                chalk.green(`✓ Workspace: ${chosenName}`) +
                '\n' + chalk.dim(`  ${workspace.memoryDir}`) +
                (sessionContent ? '' : '\n' + chalk.dim('  (memoria vacia — workspace nuevo)'))
            ));
        });

        cmdRegistry.register('/proyectos', 'Listar proyectos locales conocidos', async () => {
            const projects = await listLocalProjects();
            if (projects.length === 0) {
                console.log(formatCommandOutput(chalk.dim('No hay proyectos locales en ~/.deepseek-code/projects/')));
            } else {
                const lines = [chalk.bold('\u{1F4BE} Proyectos locales conocidos:'), ''];
                for (const p of projects) {
                    const marker = p.isCurrent ? chalk.green('▶ ') : '  ';
                    lines.push(marker + chalk.cyan(p.name) + (p.isCurrent ? chalk.dim('  <- actual') : ''));
                    lines.push(chalk.dim(`    ${p.memoryDir}`));
                }
                console.log(formatCommandOutput(lines.join('\n')));
            }
        });

        cmdRegistry.register('/prompt', 'Genera un prompt estructurado desde una frase', async ({ args }) => {
            if (!args.startsWith('new')) {
                console.log(formatCommandOutput(
                    chalk.bold('\u{1F4DD} /prompt new <frase>') + '\n' +
                    chalk.dim('Genera un prompt estructurado y lo guarda en prompt.md\n') +
                    chalk.dim('Ejemplo: /prompt new "analizar logs de errores y resumirlos"')
                ));
                return;
            }
            const phrase = args.slice(3).trim();
            if (!phrase) {
                console.log(formatCommandOutput(chalk.yellow('Uso: /prompt new <frase inicial>')));
                return;
            }
            await agent.processInput(`Genera un prompt para: ${phrase}\n\nEscribe el prompt final en prompt.md usando write_file.`);
        });

        cmdRegistry.register('/checkpoint', 'Crear / listar / cargar checkpoints de sesion', async ({ args }) => {
            if (!memoryContext) {
                console.log(formatCommandOutput(chalk.yellow('Sin memoria activa.')));
                return;
            }
            if (!args) {
                console.log(formatCommandOutput(chalk.dim('Uso: /checkpoint <nombre> | list | load <nombre>')));
                return;
            }
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
                    agent.injectContextMessage(`## Checkpoint: ${match.feature} (${match.date})\n\n${content}`);
                    console.log(formatCommandOutput(chalk.green(`Checkpoint cargado: ${match.feature}`)));
                }
                return;
            }
            // Create + optional compact (terminal-specific step)
            const cpPath = await createCheckpoint(memoryContext.projectDir, args, '', memoryContext.sessionContent);
            const doCompact = await terminal.yesNo('¿Compactar sesion-actual.md tras el checkpoint?', false);
            if (doCompact) {
                await compactSession(memoryContext.projectDir, args, path.basename(cpPath));
                const refreshed = await loadMemoryContext(vaultPath, localMemoryDir, projectName);
                if (refreshed) { memoryContext = refreshed; agent.reloadMemory(refreshed); updateHeaderCallback(); }
            }
            console.log(formatCommandOutput(
                chalk.green(`✓ Checkpoint: ${args}`) +
                '\n' + chalk.dim(`  ${cpPath}`) +
                (doCompact ? '\n' + chalk.dim('  sesion-actual.md compactada') : '')
            ));
        });

        cmdRegistry.register('/obsidian', 'Ver o configurar vault de Obsidian', async ({ args }) => {
            if (!args) {
                const display = vaultPath || chalk.dim('(no configurado)');
                console.log(formatCommandOutput(`Vault: ${display}`));
                return;
            }
            const fsio = await import('fs/promises');
            try {
                const stat = await fsio.stat(args);
                if (!stat.isDirectory()) throw new Error('no es un directorio');
            } catch (e: any) {
                console.log(formatCommandOutput(chalk.red(`✗ Ruta invalida: ${e.message}`)));
                return;
            }
            const cwd2 = process.cwd();
            await fsio.mkdir(path.join(cwd2, '.obsidian-vault'), { recursive: true });
            await fsio.writeFile(path.join(cwd2, '.obsidian-vault', 'link.txt'), args);
            const aiDir = path.join(cwd2, '.ai-assistant');
            await fsio.mkdir(path.join(aiDir, 'agents'), { recursive: true });
            const created: string[] = [];
            for (const [file, content] of [
                ['config.yaml', yaml.stringify({
                    vault: { path: args, auto_sync: true, auto_use: true, search_paths: ['04-Recursos'] },
                    extraction: { enabled: true, trigger: 'on_feature_complete', patterns: true, snippets: true, configs: true, ask_before_extract: false },
                    usage: { enabled: true, priority: 'vault_first', search_before_generate: false },
                    notification: { enabled: true, style: 'inline', emojis: true },
                })],
                ['context.md', `# Contexto del Proyecto\n\n**Nombre:** ${path.basename(cwd2)}\n**Fecha:** ${new Date().toISOString().split('T')[0]}\n`],
                ['instructions.md', `# Instrucciones para DeepSeek Code\n\n## Reglas\n1. Leer .ai-assistant/config.yaml\n2. Buscar patrones en vault antes de generar\n`],
            ] as [string, string][]) {
                const filePath = path.join(aiDir, file);
                try { await fsio.access(filePath); }
                catch { await fsio.writeFile(filePath, content); created.push(file); }
            }
            const newVaultAgentsDir = path.join(args, '00-Memoria-DeepSeek', 'agentes');
            await fsio.mkdir(newVaultAgentsDir, { recursive: true });
            vaultPath = args;
            vaultConnected = true;
            vaultAgentsDir = newVaultAgentsDir;
            agent.setVaultPath(args);
            const lines = [chalk.green(`✓ Vault configurado: ${args}`)];
            if (created.length) lines.push(chalk.dim(`  Creados: ${created.join(', ')}`));
            lines.push(chalk.dim('  Reinicia para recargar config.yaml completa'));
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/agent', 'Lista o cambia el agente activo', async ({ args }) => {
            if (args === 'reload' || args === 'r') {
                if (agent.isBusy()) {
                    console.log(formatCommandOutput(chalk.yellow('Agente ocupado -- espera a que termine.')));
                    return;
                }
                agentsLoad = await loadCustomAgents(agentsDir, vaultAgentsDir);
                allAgents = mergeWithBuiltins(agentsLoad.agents);
                updateHeaderCallback();
                const lines = [chalk.green(`✓ Recargados ${agentsLoad.agents.length} agente(s) custom`)];
                if (agentsLoad.errors.length) {
                    lines.push(chalk.yellow(`  ${agentsLoad.errors.length} con errores:`));
                    agentsLoad.errors.forEach(e => lines.push(chalk.dim(`    ${e.file}: ${e.message}`)));
                }
                const cur = allAgents.find(a => a.id === currentAgentId);
                if (cur) {
                    agent.setCurrentAgent(cur.id, cur.systemPromptAddition);
                    lines.push(chalk.dim(`  Agente actual (${currentAgentId}) re-aplicado`));
                }
                console.log(formatCommandOutput(lines.join('\n')));
                return;
            }
            if (agent.isBusy()) {
                console.log(formatCommandOutput(chalk.yellow('Agente ocupado -- espera a que termine antes de cambiar.')));
                return;
            }
            const menuItems = allAgents.map(a => {
                const active = a.id === currentAgentId;
                const check = active ? chalk.green('✓') : ' ';
                const modelTag = a.model ? chalk.dim(` · ${a.model}`) : '';
                const tag = a.customized
                    ? chalk.dim(' [editado]')
                    : a.vault ? chalk.dim(' [vault]')
                        : !a.builtin ? chalk.dim(' [custom]') : '';
                return {
                    label: `${check} ${a.icon} ${chalk.bold(a.name)}${modelTag}${tag}`,
                    description: a.description,
                    value: a.id,
                };
            });
            const chosen = await terminal.select(
                `Cambiar agente  ${chalk.dim('(actual: ' + currentAgentId + ' · /agent reload para releer disco)')}`,
                menuItems
            );
            if (!chosen || chosen === currentAgentId) {
                if (!chosen) console.log(formatCommandOutput(chalk.dim('Cancelado -- agente sin cambios')));
                return;
            }
            const profile = allAgents.find(a => a.id === chosen)!;
            const reset = await terminal.yesNo(
                `¿Resetear historial para ${profile.icon} ${profile.name}?`,
                true
            );
            agent.setCurrentAgent(profile.id, profile.systemPromptAddition, reset);
            currentAgentId = chosen;
            if (profile.model && profile.model !== client.getModel()) {
                client.setModel(profile.model);
                currentModel = profile.model;
            }
            updateHeaderCallback();
            const fsio = await import('fs/promises');
            const saveDir = getGlobalAgentsDir();
            const agentFile = path.join(saveDir, `${chosen}.md`);
            let savedMsg = '';
            if (profile.builtin && chosen !== 'general') {
                try {
                    await fsio.access(agentFile);
                } catch {
                    try {
                        await fsio.mkdir(saveDir, { recursive: true });
                        await fsio.writeFile(agentFile, buildAgentFileContent(profile));
                        const location = vaultAgentsDir ? 'vault/agentes' : 'agents';
                        savedMsg = chalk.dim(`  · guardado en ${location}/${chosen}.md`);
                    } catch { /* non-fatal */ }
                }
            }
            console.log(formatCommandOutput(
                chalk.green(`✓ Agente: ${profile.icon} ${profile.name}`) +
                (profile.model ? chalk.dim(`  · modelo: ${profile.model}`) : '') +
                (reset ? chalk.dim('  · historial reseteado') : '') +
                savedMsg
            ));
        });

        cmdRegistry.register('/agents', 'Lista agentes disponibles (alias de /agent)', async () => {
            const lines = ['Agentes disponibles — usa /agent <id> para cambiar:\n'];
            for (const a of allAgents) {
                const mark = a.id === currentAgentId ? ' <- activo' : '';
                lines.push(`  /agent ${a.id.padEnd(18)} ${a.icon} ${a.name}${mark}`);
                if (a.description) lines.push(`    ${a.description}`);
            }
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/init', 'Inicializar o analizar proyecto con project-manager', async () => {
            if (agent.isBusy()) {
                console.log(formatCommandOutput(chalk.yellow('Agente ocupado -- espera a que termine.')));
                return;
            }
            const pmProfile = allAgents.find(a => a.id === 'project-manager');
            if (!pmProfile) {
                console.log(formatCommandOutput(chalk.red('Agente project-manager no encontrado.')));
                return;
            }
            const fsInit = await import('fs/promises');
            const projectFiles = ['especification.md', 'disene.md', 'package.json', 'go.mod', 'Cargo.toml', 'pom.xml', 'AGENT.md'];
            const found: string[] = [];
            for (const f of projectFiles) {
                try {
                    await fsInit.access(path.join(process.cwd(), f));
                    found.push(f);
                } catch { /* not present */ }
            }
            let promptMdContent: string | null = null;
            try {
                promptMdContent = await fsInit.readFile(path.join(process.cwd(), 'prompt.md'), 'utf-8');
                console.log(formatCommandOutput(chalk.cyan('  · prompt.md encontrado -- usado como contexto inicial')));
            } catch { /* not present */ }
            const isExisting = found.length > 0;
            const workspaceCtx = activeWorkspace !== DEFAULT_WORKSPACE
                ? ` Workspace activo: ${activeWorkspace} — enfoca el analisis en ese contexto.`
                : '';
            const baseMsg = isExisting
                ? `[/init] Proyecto existente detectado (${found.join(', ')}).${workspaceCtx} Analiza el estado actual, identifica gaps en la documentacion y actualiza o crea especification.md y disene.md segun corresponda.`
                : `[/init] Proyecto nuevo.${workspaceCtx} Inicia el flujo de levantamiento de requisitos: haz las 4 preguntas requeridas antes de crear cualquier documento.`;
            const initMsg = promptMdContent
                ? `${baseMsg}\n\nContexto adicional desde prompt.md:\n\n${promptMdContent}`
                : baseMsg;
            agent.setCurrentAgent(pmProfile.id, pmProfile.systemPromptAddition, true);
            currentAgentId = pmProfile.id;
            if (pmProfile.model && pmProfile.model !== client.getModel()) {
                client.setModel(pmProfile.model);
                currentModel = pmProfile.model;
            }
            updateHeaderCallback();
            console.log(formatCommandOutput(
                chalk.green(`✓ ${pmProfile.icon} Project Manager activado`) +
                chalk.dim(`  · ${isExisting ? 'proyecto existente' : 'proyecto nuevo'} · historial reseteado`)
            ));
            await agent.processInput(initMsg);
        });

        cmdRegistry.register('/models', 'Lista o cambia el modelo de IA', async () => {
            if (agent.isBusy()) {
                console.log(formatCommandOutput(chalk.yellow('Agente ocupado -- espera a que termine antes de cambiar modelo.')));
                return;
            }
            const menuItems = DEEPSEEK_MODELS.map(m => {
                const active = m.id === client.getModel();
                const price = chalk.dim(`$${m.inputPriceM}/$${m.outputPriceM}/M tokens`);
                const check = active ? chalk.green('✓') : ' ';
                return {
                    label: `${check} ${m.badge} ${chalk.bold(m.name)}  ${price}`,
                    description: m.note,
                    value: m.id,
                };
            });
            const chosen = await terminal.select('Cambiar modelo (↑↓ Enter · Esc cancelar)', menuItems);
            if (chosen && chosen !== client.getModel()) {
                client.setModel(chosen);
                currentModel = chosen;
                updateHeaderCallback();
                const info = DEEPSEEK_MODELS.find(m => m.id === chosen)!;
                console.log(formatCommandOutput(
                    chalk.green(`✓ Modelo cambiado a ${info.badge} ${info.name}`) +
                    chalk.dim(`  (${chosen})`)
                ));
            } else if (!chosen) {
                console.log(formatCommandOutput(chalk.dim('Cancelado -- modelo sin cambios')));
            }
        });

        cmdRegistry.register('/reload-files', 'Recarga AGENT.md y USER.md del workspace', async () => {
            const result = await agent.reloadContextFiles();
            const lines = [chalk.green('✓ Archivos recargados:')];
            if (result.agentMd) {
                const count = result.agentMd.split('\n').length;
                lines.push(chalk.dim(`  · AGENT.md  ✓ (${count} lineas)`));
            } else {
                lines.push(chalk.dim(`  · AGENT.md  ✗ (no encontrado)`));
            }
            if (result.userMd) {
                const count = result.userMd.split('\n').length;
                lines.push(chalk.dim(`  · USER.md   ✓ (${count} lineas)`));
            } else {
                lines.push(chalk.dim(`  · USER.md   ✗ (no encontrado)`));
            }
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/iteration', 'Ver o cambiar modo de iteracion', async () => {
            const currentMode = iterationManager.mode;
            const menuItems = [
                ...validModes.map(m => ({
                    label: (m === currentMode ? chalk.green('✓ ') : '  ') + m,
                    value: m,
                })),
                {
                    label: chalk.yellow('  reset-limit') + chalk.dim('  (reiniciar contador sin perder estadisticas)'),
                    value: 'reset-limit',
                },
            ];
            const chosen = await terminal.select(
                `Modo de iteracion actual: ${chalk.cyan(currentMode)}  (cambia en caliente)`,
                menuItems
            );
            if (chosen === 'reset-limit') {
                iterationManager.resetLimit();
                console.log(formatCommandOutput(
                    chalk.green('✓ Contador reiniciado') +
                    chalk.dim('  (tool calls y delegaciones conservados)')
                ));
            } else if (chosen && chosen !== currentMode) {
                iterationManager.setMode(chosen as IterationMode);
                console.log(formatCommandOutput(
                    chalk.green(`✓ Modo cambiado a: ${chosen}`) +
                    (chosen === 'auto' ? chalk.dim('  (sin confirmacion, max ' + iterationManager.maxIterations + ' iteraciones)') : '') +
                    (chosen === 'step-by-step' ? chalk.dim('  (pregunta despues de cada paso)') : '') +
                    (chosen === 'interactive' ? chalk.dim('  (pregunta al alcanzar el limite)') : '')
                ));
            } else if (!chosen) {
                console.log(formatCommandOutput(chalk.dim('Cancelado -- modo sin cambios')));
            }
        });

        cmdRegistry.register('/reflection', 'Ver estado del Reflection Engine', async () => {
            const details = await agent.getReflectionDetails();
            const { stats, promotedPolicies, nearThreshold } = details;
            const DOMAIN_ORDER = ['audit', 'test', 'commit', 'agent', 'bootstrap'] as const;
            const lines: string[] = [
                chalk.bold('\u{1F9E0} Reflection Engine'),
                '',
                `  Incidentes: ${chalk.cyan(String(stats.totalIncidents))} total  ` +
                `${chalk.yellow(String(stats.unresolvedCount))} sin resolver`,
                '',
                chalk.dim('  Dominio       Incidentes  Patrones'),
                chalk.dim('  ' + '─'.repeat(38)),
            ];
            for (const d of DOMAIN_ORDER) {
                const incidents = stats.countsByDomain[d] ?? 0;
                const patterns = stats.patternsByDomain[d] ?? 0;
                const promoted = promotedPolicies.filter(p => p.trigger?.domain === d).length;
                const promotedTag = promoted > 0 ? chalk.green(`  → ${promoted} policy promovida`) : '';
                lines.push(
                    `  ${d.padEnd(12)}  ${String(incidents).padStart(5)}       ${String(patterns).padStart(5)}${promotedTag}`
                );
            }
            if (nearThreshold.length > 0) {
                lines.push('');
                lines.push(chalk.yellow(`  Cerca del umbral (${stats.promotionThreshold - 1}/${stats.promotionThreshold} ocurrencias):`));
                for (const p of nearThreshold) {
                    lines.push(`    ${chalk.dim(p.domain)}  ·  ${p.failureType}  ${chalk.dim('(' + p.count + ')')}`);
                }
            }
            if (promotedPolicies.length > 0) {
                lines.push('');
                lines.push(chalk.bold(`  Policies auto-generadas activas: ${chalk.cyan(String(promotedPolicies.length))}`));
                for (const pol of promotedPolicies) {
                    lines.push(`    ${chalk.dim(pol.id)}  ·  ${pol.trigger?.pattern ?? pol.name}`);
                }
            } else {
                lines.push('');
                lines.push(chalk.dim('  Sin policies auto-generadas aun (se necesitan 3 ocurrencias del mismo patron)'));
            }
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/status', 'Panel de estado del sistema', async () => {
            const contextTokens = agent.getContextTokens();
            const stats = agent.getSessionStats();
            const imStats = iterationManager.stats;
            const modelInfo = DEEPSEEK_MODELS.find(m => m.id === currentModel);
            const maxTokens = modelInfo?.contextWindow ?? 32000;
            const cur = allAgents.find(a => a.id === currentAgentId);
            const contextPct = Math.round((contextTokens / maxTokens) * 100);
            const contextBar = buildBar(contextPct, 20);
            const vaultNameDisplay = vaultPath ? path.basename(vaultPath) : '';
            const lines: string[] = [
                chalk.bold('\u{1F4CA} Estado del sistema'),
                '',
                chalk.dim('Agente:') + '  ' + (cur ? chalk.cyan(cur.icon + ' ' + cur.name + ' (' + currentAgentId + ')') : chalk.cyan(currentAgentId)),
                chalk.dim('Modelo:') + '  ' + chalk.cyan(currentModel) + (modelInfo ? chalk.dim('  ' + modelInfo.badge + ' ' + modelInfo.name) : ''),
                chalk.dim('Vault:') + '  ' + (vaultConnected ? chalk.green('✓ ' + vaultNameDisplay) : chalk.dim('✗ no conectado')),
                chalk.dim('Skills:') + '  ' + chalk.cyan(String(allSkills.length)) + chalk.dim(' instalados'),
                chalk.dim('Agentes:') + '  ' + chalk.cyan(String(allAgents.length)) + chalk.dim(' perfiles'),
                chalk.dim('Streaming:') + '  ' + (useStream ? chalk.green('✓ activo') : chalk.dim('✗ desactivado')),
                chalk.dim('QA:') + '  ' + (options.qa !== false ? chalk.green('✓ activo') : chalk.dim('✗ desactivado')),
                '',
                chalk.bold('\u{1F5C2}️  Iteracion'),
                chalk.dim('Modo:') + '  ' + chalk.cyan(iterationManager.mode),
                chalk.dim('Pasos ejecutados:') + '  ' + chalk.cyan(String(imStats.iterations)),
                chalk.dim('Limite:') + '  ' + chalk.cyan(String(imStats.maxIterations)),
                chalk.dim('Tool calls:') + '  ' + chalk.cyan(String(imStats.toolCalls)),
                chalk.dim('Incrementos:') + '  ' + chalk.cyan(String(imStats.totalIncrements)),
                chalk.dim('Tiempo:') + '  ' + chalk.cyan((imStats.elapsedMs / 1000).toFixed(1) + 's'),
                '',
                chalk.bold('\u{1F5C3}️  Contexto'),
                chalk.dim('Tokens:') + '  ' + chalk.cyan(contextTokens.toLocaleString()) + ' / ' + maxTokens.toLocaleString() + '  ' + contextBar + '  ' + chalk.dim(contextPct + '%'),
                '',
                chalk.bold('\u{1F4C8} Sub-agentes (sesion)'),
                chalk.dim('Llamadas:') + '  ' + chalk.cyan(String(stats.calls)),
                chalk.dim('Tokens entrada:') + '  ' + chalk.cyan(stats.inputTokens.toLocaleString() + ' tk'),
                chalk.dim('Tokens salida:') + '  ' + chalk.cyan(stats.outputTokens.toLocaleString() + ' tk'),
            ];
            if (stats.calls > 0 && modelInfo) {
                const cost = (
                    (stats.inputTokens / 1_000_000) * modelInfo.inputPriceM +
                    (stats.outputTokens / 1_000_000) * modelInfo.outputPriceM
                ).toFixed(6);
                lines.push(chalk.dim('Costo est.:') + '  ' + chalk.cyan('$' + cost + ' USD'));
            }
            if (memoryContext?.activeProject) {
                lines.push('');
                lines.push(chalk.bold('\u{1F9E0} Memoria activa'));
                lines.push(chalk.dim('Proyecto:') + '  ' + chalk.magenta(memoryContext.activeProject));
                lines.push(chalk.dim('Fuente:') + '  ' + chalk.dim('local'));
            }
            console.log(formatCommandOutput(lines.join('\n')));
        });

        cmdRegistry.register('/research', 'Investigar un tema usando el agente de investigacion', async ({ args }) => {
            if (!args) {
                console.log(formatCommandOutput(chalk.yellow('Uso: /research <tema>')));
                return;
            }
            spinner.start(`Investigando: ${args}…`);
            try {
                const result = await runResearch(args, client, config, instructions, vaultPath);
                spinner.stop();
                console.log(formatCommandOutput(result));
            } catch (e: any) {
                spinner.fail(`Error: ${e.message}`);
            }
        });
        // -- End terminal command overrides -----------------------------------

        // -- Terminal --------------------------------------------------
        terminal = new Terminal({
            completions: SLASH_COMMANDS,
            messageBuffer,
            onEscape: interrupt,
            onClose: async () => { await agent.shutdown().catch(() => { }); },
            onLine: async (line: string) => {
                let trimmed = line.trim();
                if (!trimmed) return;

                // -- Slash commands -> return string for |_ display ------
                if (trimmed === 'salir' || trimmed === 'exit') {
                    console.log(chalk.dim('\nHasta luego.'));
                    await agent.shutdown().catch(() => { });
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
                        projectBaseDir,
                        sessionContent: memoryContext?.sessionContent ?? '',
                        injectContext: (msg) => agent.injectContextMessage(msg),
                    });
                    if (handled) return;
                    console.log(formatCommandOutput(chalk.yellow(`Comando desconocido: ${trimmed.split(' ')[0]}`)));
                    return;
                }

                if (trimmed === '@commit' || trimmed === '@test') {
                    if (agent.isBusy()) {
                        console.log(formatCommandOutput(chalk.yellow('Agente ocupado - espera a que termine.')));
                        return;
                    }

                    // Auto-detect: si no hay staged, stagea todo. Si hay staged, respeta la seleccion manual.
                    // Architecture Agent siempre genera el plan inteligente; tests + QA + commit corren via executeCommit.
                    let _stagedFiles = agent.getStagedFiles();
                    let _autoStaged = false;
                    if (_stagedFiles.length === 0) {
                        const { stageAllChanges } = await import('../src/agent/commit/index');
                        const _staged = stageAllChanges();
                        if (!_staged) {
                            console.log(formatCommandOutput(
                                chalk.yellow('No hay cambios para commitear.')
                                + '\n' + chalk.dim('No hay archivos staged ni modificaciones en el working tree.')
                            ));
                            return;
                        }
                        _stagedFiles = agent.getStagedFiles();
                        _autoStaged = true;
                    }

                    if (trimmed === '@test') {
                        console.log(formatCommandOutput(
                            chalk.yellow('@test ahora es un alias de @commit (auto-detect).')
                            + '\n' + chalk.dim('Usa @commit en su lugar: mismo comportamiento.')
                        ));
                    }

                    console.log(formatCommandOutput(
                        chalk.bold('@commit - Architecture Agent') + '\n' +
                        chalk.dim(_autoStaged
                            ? '  Auto-stage activado. Analizando '
                            : '  Analizando ')
                        + chalk.cyan(String(_stagedFiles.length)) + chalk.dim(' archivo(s) staged...')
                    ));

                    // Delegar a Architecture Agent para planificacion del commit
                    const _planPrompt = [
                        'Genera un plan de commit para los siguientes archivos staged.',
                        '',
                        '**Archivos staged:**',
                        ..._stagedFiles.map(function (f) { return '  - `' + f + '`'; }),
                        '',
                        "Ejecuta 'git diff --staged' para ver el diff completo de los cambios.",
                        '',
                        'Produce un CommitPlan con:',
                        '- type: tipo Conventional Commit (feat/fix/refactor/docs/test/chore/style/perf/ci/build)',
                        '- scope: modulo afectado. Detectalo de las rutas de los archivos',
                        '- description: resumen corto en imperativo (< 72 chars)',
                        '- body: detalles del cambio (opcional, string vacio si no hay)',
                        '- breaking: true SOLO si hay cambios en APIs publicas o contratos',
                        '',
                        'Responde UNICAMENTE con este JSON exacto (sin markdown, sin explicacion):',
                        '{"type":"feat","scope":"orchestrator","description":"add commit plan support","body":"","breaking":false}',
                    ].join('\n');

                    trimmed = '@architecture: ' + _planPrompt;
                    pendingCommitRequest = true;
                }
                // -- AI input -------------------------------------------
                // Agregar mensaje del usuario al buffer
                messageBuffer.add({
                    role: 'user',
                    content: trimmed,
                    timestamp: new Date(),
                });

                if (agent.isBusy()) {
                    // Queue instead of dropping -- process when agent finishes
                    pendingInput = trimmed;
                    console.log(formatCommandOutput(chalk.dim('\u23f3 En cola -- se ejecutara al terminar.')));
                    return;
                }
                try {
                    const _commitResponse = await agent.processInput(trimmed) as string;
                    // Si era @commit, ejecutar el commit con el plan generado
                    if (pendingCommitRequest) {
                        pendingCommitRequest = false;
                        try {
                            // Parsear el JSON del plan de commit desde la respuesta del Architecture Agent
                            var _plan = tryParseCommitPlan(_commitResponse);
                            var _commitOpts = undefined;
                            if (_plan && _plan.type) {
                                _commitOpts = {
                                    type: _plan.type as any,
                                    scope: _plan.scope,
                                    message: _plan.description,
                                    body: _plan.body,
                                    breakingChange: _plan.breaking === true,
                                };
                            }
                            var _commitResult = await agent.executeCommit(_commitOpts, true);
                            if (_commitResult.success) {
                                console.log(formatCommandOutput(chalk.green('\u2705 Commit exitoso')));
                            } else if (_commitResult.error) {
                                console.log(formatCommandOutput(chalk.yellow(_commitResult.error)));
                            }
                        } catch (_commitErr: any) {
                            console.log(formatCommandOutput(chalk.red('\u274c Error en commit: ' + _commitErr.message)));
                        }
                    }
                    // Drain queue: process any message the user sent while we were busy
                    while (pendingInput !== null) {
                        const queued = pendingInput;
                        pendingInput = null;
                        console.log(formatCommandOutput(chalk.dim(`\u25b6 Ejecutando mensaje en cola: ${queued.slice(0, 60)}${queued.length > 60 ? '\u2026' : ''}`)));
                        await agent.processInput(queued);
                    }
                } catch (error: any) {
                    spinner.stop();
                    messageBuffer.add({
                        role: 'error',
                        content: error.message,
                        timestamp: new Date(),
                    });
                    console.log(formatCommandOutput(`Error: ${error.message}`));
                }
            },
        });

        // -- Registrar builtin handlers con contexto completo -------------
        registerBuiltinHandlers({
            vaultPath,
            instructions,
            askConfirmation: async (msg: string) => {
                if (allowAll) return true;
                const result = await terminal.confirm(msg);
                if (result === 'all') allowAll = true;
                return result !== 'no';
            },
            projectRoot: process.cwd(),
            memoryContext,
            onMemoryUpdate: (vaultPath || localMemoryDir) ? async () => {
                const fresh = await loadMemoryContext(vaultPath, localMemoryDir, projectName);
                if (fresh) {
                    memoryContext = fresh;
                    agent.reloadMemory(fresh);
                    updateHeaderCallback();
                }
            } : null,
            pathAllowlist: new PathAllowlist({
                allowedPaths: [
                    process.cwd(),
                    vaultPath,
                    (await import('os')).tmpdir(),
                    path.join(process.env.USERPROFILE ?? process.env.HOME ?? '~', '.deepseek-code'),
                ].filter(Boolean),
                allowSubpaths: true,
            }),
        });

        // Inicializar callback de redibujado de header
        updateHeaderCallback = () => {
            const h = formatHeader(buildHeaderInfo());
            const lineCount = h.split('\n').filter(l => l.trim()).length;
            terminal.setHeaderLines(lineCount);
            terminal.setOnRenderHeader(() => process.stdout.write(h));
        };
        updateHeaderCallback();

        // Conectar el spinner al footer del terminal para que las actualizaciones
        // de progreso aparezcan en la linea de estado (encima del ?) sin
        // escribir directamente a stdout y desorganizar el layout.
        spinner.setStatusCallback((text) => terminal.updateStatusLine(text));

        terminal.start();
    });

// -- Helper functions -------------------------------------------------------

function tryParseCommitPlan(response: string): { type?: string; scope?: string; description?: string; body?: string; breaking?: boolean } | null {
    if (!response) return null;
    const trimmed = response.trim();

    // Try direct JSON parse first
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.type) return parsed;
    } catch { }

    // Try to find JSON in code block
    const blockMatch = trimmed.match(/`(?:json)?\s*\n?(\{[\s\S]*?\})\n?\s*`/);
    if (blockMatch) {
        try {
            const parsed = JSON.parse(blockMatch[1]);
            if (parsed && parsed.type) return parsed;
        } catch { }
    }

    // Try to find standalone JSON object
    const jsonMatch = trimmed.match(/\{[\s\S]*?"type"[\s\S]*?"(?:scope|description|body|breaking)[\s\S]*?\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && parsed.type) return parsed;
        } catch { }
    }

    return null;
}
function buildBar(pct: number, width: number): string {
    const filled = Math.round((pct / 100) * width);
    const color = pct > 80 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
    return color('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(width - filled));
}

function buildHelpText(_skills: Skill[]): string {
    const col = (l: string, r: string) => chalk.cyan(l.padEnd(22)) + chalk.dim(r);
    const hr = (title: string) => chalk.dim('\u2500\u2500 ' + title + ' ' + '\u2500'.repeat(Math.max(0, 40 - title.length)));

    const lines: string[] = [
        hr('Comandos'),
        col('/help', 'Muestra este mensaje'),
        col('/clear', 'Limpia la pantalla y muestra el logo'),
        col('/reset-context', 'Reinicia la conversacion (mantiene sistema y memoria)'),
        col('/context', 'Muestra el contexto del proyecto'),
        col('/tokens', 'Uso de tokens en el contexto actual'),
        col('/usage', 'Tokens y costo de sub-agentes en esta sesion'),
        col('/skills', 'Lista los skills cargados'),
        col('/obsidian <ruta>', 'Configurar vault de Obsidian (crea .ai-assistant/ si falta)'),
        col('/memory', 'Ver memoria persistente del proyecto activo'),
        col('/switch [proyecto]', 'Cambiar proyecto de memoria (requiere vault)'),
        col('/proyectos', 'Listar proyectos locales conocidos (~/.deepseek-code/)'),
        col('/checkpoint <nombre>', 'Crear checkpoint | list — listar | load <nombre> — cargar'),
        col('/agent', 'Cambiar agente especializado (security, infra, architect...)'),
        col('/agent reload', 'Releer agentes custom desde disco sin reiniciar'),
        col('/models', 'Ver y cambiar el modelo de IA en uso'),
        col('/reload-files', 'Recarga AGENT.md y USER.md del workspace'),
        col('/iteration', 'Ver y cambiar modo de iteracion en caliente'),
        col('/status', 'Panel de estado del sistema'),
        col('/research <tema>', 'Investiga un tema y guarda en el vault'),
        col('@commit', 'Auto-stage (si vacio) + Architecture Agent genera plan + tests + QA + commit'),
        col('salir / exit', 'Cierra la sesion'),
        hr('Atajos de teclado'),
        col('Tab', 'Autocompletar /comandos'),
        col('\u2191  \u2193', 'Historial de comandos'),
        col('PgUp / PgDn', 'Scroll de historial de conversacion'),
        col('Ctrl+Home / End', 'Ir al inicio / final del historial'),
        col('Esc', 'Interrumpir operacion en curso'),
        col('Ctrl+C', 'Cancelar'),
    ];

    return lines.join('\n');
}

// -- Subcommands ------------------------------------------------------------

program
    .command('init')
    .description('Inicializa .ai-assistant/ y .obsidian-vault/ en el proyecto')
    .option('--vault-path <path>', 'Ruta al vault de Obsidian')
    .action(async (options) => {
        const fs = await import('fs/promises');
        const cwd = process.cwd();
        const spinner = new Spinner();
        spinner.start('Inicializando...');

        await fs.mkdir(path.join(cwd, '.ai-assistant'), { recursive: true });
        await fs.mkdir(path.join(cwd, '.obsidian-vault'), { recursive: true });

        // Local .deepseek-code/ -- solo backups pre-edicion (especifico del repo)
        await fs.mkdir(path.join(cwd, '.deepseek-code', 'backups'), { recursive: true });

        // ~/.deepseek-code/ -- global, compartido entre proyectos
        await fs.mkdir(getGlobalAgentsDir(), { recursive: true });
        await fs.mkdir(getGlobalSkillsDir(), { recursive: true });

        const vaultPath = options.vaultPath || '';
        if (vaultPath) {
            await fs.writeFile(path.join(cwd, '.obsidian-vault', 'link.txt'), vaultPath);
        }

        const configObj: AIAssistantConfig = {
            vault: { path: vaultPath, auto_sync: true, auto_use: true, search_paths: ['04-Recursos'] },
            extraction: { enabled: true, trigger: 'on_feature_complete', patterns: true, snippets: true, configs: true, ask_before_extract: false },
            usage: { enabled: true, priority: 'vault_first', search_before_generate: false },
            notification: { enabled: true, style: 'inline', emojis: true },
        };
        await fs.writeFile(path.join(cwd, '.ai-assistant', 'config.yaml'), yaml.stringify(configObj));
        await fs.writeFile(
            path.join(cwd, '.ai-assistant', 'context.md'),
            `# Contexto del Proyecto\n\n**Nombre:** ${path.basename(cwd)}\n**Fecha:** ${new Date().toISOString().split('T')[0]}\n`
        );
        await fs.writeFile(
            path.join(cwd, '.ai-assistant', 'instructions.md'),
            `# Instrucciones para DeepSeek Code\n\n## Reglas\n1. Leer .ai-assistant/config.yaml\n2. Buscar patrones en vault antes de generar\n\n## Triggers\n| **keyword** | **patron.md** |\n|---|---|\n| ejemplo | ruta/patron.md |\n`
        );

        // Materializar built-ins como archivos editables en ~/.deepseek-code/agents/
        for (const profile of BUILTIN_PROFILES) {
            if (!profile.systemPromptAddition) continue;
            const agentFile = path.join(getGlobalAgentsDir(), `${profile.id}.md`);
            try { await fs.access(agentFile); } catch {
                await fs.writeFile(agentFile, buildAgentFileContent(profile));
            }
        }

        // Crear skill de ejemplo si no existe ninguno
        const exampleSkillFile = path.join(getGlobalSkillsDir(), 'ejemplo.yaml');
        try { await fs.access(exampleSkillFile); } catch {
            const exampleSkill = yaml.stringify({
                name: 'ejemplo',
                version: '1.0',
                description: 'Skill de ejemplo -- renombralo y adapta los triggers',
                triggers: ['ejemplo', 'mi-skill'],
                systemPromptAddition: [
                    '## Especializacion: Mi Skill',
                    '',
                    'Describe aqui las instrucciones especiales para este contexto.',
                    '',
                    '### Convenciones del proyecto',
                    '- Framework: ...',
                    '- Patrones preferidos: ...',
                    '- Convenciones de nombres: ...',
                ].join('\n'),
            });
            await fs.writeFile(exampleSkillFile, exampleSkill);
        }

        spinner.succeed('Proyecto inicializado');
        console.log(chalk.dim('  .deepseek-code/backups/             -- backups pre-edicion (local del repo)'));
        console.log(chalk.dim('  ~/.deepseek-code/agents/            -- agentes built-in materializados y editables'));
        console.log(chalk.dim('  ~/.deepseek-code/skills/ejemplo.yaml -- skill de ejemplo para adaptar'));
        console.log(chalk.dim('  ~/.deepseek-code/projects/          -- memoria y sesiones'));
    });

program
    .command('research <topic>')
    .description('Investiga un tema y guarda el articulo en el vault')
    .option('-k, --api-key <key>', 'API key')
    .option('-m, --model <model>', 'Modelo', 'deepseek-chat')
    .action(async (topic, options) => {
        const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY;
        if (!apiKey) { console.error(chalk.red('\u274c API key requerida')); process.exit(1); }

        const spinner = new Spinner();
        spinner.start(`Investigando: ${topic}...`);

        const detected = await detectProjectFiles();
        const config = detected.exists ? (await loadConfig(detected.configFile)) || getDefaultConfig() : getDefaultConfig();
        const instructions = detected.exists
            ? (await loadInstructions(detected.instructionsFile)) || defaultInstructions()
            : defaultInstructions();
        let vaultPath = '';
        try {
            const fs = await import('fs/promises');
            vaultPath = (await fs.readFile(detected.vaultLinkFile, 'utf-8')).trim();
        } catch { }

        const client = new AgentClient(apiKey, options.model);
        spinner.stop();
        const result = await runResearch(topic, client, config, instructions, vaultPath);
        console.log('\n' + result);
    });

program
    .command('skill <action> [name]')
    .description('Gestiona skills: list')
    .action(async (action) => {
        const skillsDir = path.join(process.cwd(), '.deepseek-code', 'skills');
        if (action === 'list') {
            const skills = await loadSkills(skillsDir);
            console.log(chalk.dim('\n-- Skills --------------------'));
            skills.forEach(s => console.log(`  ${chalk.cyan(s.name)} -- ${s.description}`));
            console.log('');
        } else {
            console.log(chalk.red('Accion no soportada. Usa: list'));
        }
    });


program
    .command('history')
    .description('Carga archivos historicos de auditoria (NO-GO) al Reflection Engine')
    .option('--all', 'Escanea todos los proyectos, no solo el actual')
    .option('--force', 'Recarga registros aunque ya existan')
    .option('--dry-run', 'Solo muestra que se procesaria sin persistir')
    .action(async (opts) => {
        const { ReflectionEngine } = await import('../src/reflection/reflection-engine');
        const { HistoricalLoader } = await import('../src/reflection/historical-loader');

        const engine = new ReflectionEngine({ projectRoot: process.cwd() });
        await engine.initialize();

        const loader = new HistoricalLoader({ engine, projectRoot: process.cwd() });
        const result = await loader.loadAll({
            onlyCurrentProject: !opts.all,
            force: opts.force || false,
        });

        console.log(chalk.bold('\\n=== Historical Loader ==='));
        console.log(chalk.cyan('Proyectos procesados: ') + result.projectsProcessed.join(', '));
        console.log(chalk.gray('Archivos escaneados: ') + result.scannedFiles);
        console.log(chalk.yellow('Archivos NO-GO: ') + result.noGoFiles);
        console.log(chalk.green('Registros cargados: ') + result.loaded);
        console.log(chalk.gray('Registros omitidos (dup): ') + result.skipped);
        console.log(chalk.cyan('Patrones detectados: ') + result.patterns);
        console.log(chalk.magenta('Reglas promovidas: ') + result.promotedRules);

        if (result.errors.length > 0) {
            console.log(chalk.red('\\nErrores:'));
            result.errors.forEach(function (e: string) { console.log(chalk.red('  - ' + e)); });
        }
    });

program.parse();


