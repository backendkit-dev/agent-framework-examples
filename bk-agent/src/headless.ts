/**
 * Headless mode — JSON-Lines protocol over stdin/stdout.
 *
 * Stdin (from host, e.g. Electron):
 *   { "type": "user_input",          "text": "..." }
 *   { "type": "interrupt" }
 *   { "type": "approval_response",   "decision": "approve"|"reject"|"approve_all" }
 *   { "type": "iteration_response",  "continue": true|false }
 *
 * Stdout (engine events as JSON-Lines):
 *   Every AgentEvent from the framework plus:
 *   { "type": "tool_approval_request", "tool_name", "agent_id", "args_preview" }
 *   { "type": "iteration_pause",       "reason", "iterations", "toolCalls" }
 *   { "type": "config",                "agents", "models", "commands", ... }
 */
import * as readline from 'readline';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    createCodingEngineFromConfig,
    ConfigLoader,
    AgentLoader,
    CODING_AGENTS,
} from '@bk/agent-coding';
import {
    CallbackTransport,
    SlashCommandRegistry,
    registerBuiltinCommands,
    getProjectDir,
    type ToolApprovalDecision,
    type MCPServerConfig,
} from '@bk/agent-core';

function expandCommand(text: string): string {
    const m = text.match(/^\/prompt\s+(.+)$/s);
    if (!m) return text;
    const description = m[1].trim();
    return `Genera un archivo \`prompt.md\` en el directorio raiz del proyecto actual con la siguiente descripcion inicial: "${description}".

El archivo debe estar bien estructurado con estas secciones (adapta el contenido al tipo de proyecto):
- Titulo (# nombre del proyecto)
- ## Purpose / Objetivo — descripcion clara del problema que resuelve
- ## Core Features — lista de funcionalidades principales
- ## Out of Scope (v1) — que NO entra en la primera version
- ## Tech Stack — tecnologias recomendadas segun el tipo de proyecto
- ## Users & Roles — actores del sistema y sus permisos (si aplica)
- ## Key Flows — flujos principales paso a paso
- ## Definition of Done — criterios de exito medibles

Escribe el archivo directamente con la herramienta de escritura de archivos. No preguntes, genera el contenido completo de una vez.`;
}

interface HeadlessCtx {
    appName:       string;
    cwd:           string;
    agentId:       string;
    model?:        string;
    iterationMode: 'auto' | 'interactive' | 'step-by-step';
    maxIterations: number;
}

function emit(event: object): void {
    process.stdout.write(JSON.stringify(event) + '\n');
}

export async function runHeadless(ctx: HeadlessCtx): Promise<void> {
    const { appName, agentId, iterationMode, maxIterations } = ctx;
    let currentCwd = ctx.cwd;

    const loader = new ConfigLoader(appName);
    const config = loader.load();

    // ── Pending promise resolvers (set during engine await, resolved from stdin) ─
    let pendingApproval:   ((d: ToolApprovalDecision) => void) | null = null;
    let pendingIteration:  ((cont: boolean) => void) | null = null;
    let currentRunPromise: Promise<void> | null = null;

    // ── Transport: every engine event → stdout as JSON-Line ──────────────────────
    const transport = new CallbackTransport((event) => emit(event));

    // ── Engine factory ────────────────────────────────────────────────────────────
    function makeEngine(agentId: string, cwd: string, mcpServers?: MCPServerConfig[]) {
        return createCodingEngineFromConfig({
            appName,
            defaultAgent:  agentId,
            workingDir:    cwd,
            transport,
            maxIterations,
            ...(mcpServers?.length ? { mcpServers } : {}),
            orchestration: { enableQA: true, reflection: true },

            onToolApproval: async (toolName, agentId, argsPreview) => {
                if (iterationMode === 'auto') return 'approve';
                emit({ type: 'tool_approval_request', tool_name: toolName, agent_id: agentId, args_preview: argsPreview });
                return new Promise<ToolApprovalDecision>(resolve => { pendingApproval = resolve; });
            },
        });
    }

    const mcpServers = config.mcpServers ?? [];
    let engine = makeEngine(agentId, currentCwd, mcpServers);

    // ── Slash command registry ────────────────────────────────────────────────────
    const registry = new SlashCommandRegistry();
    registerBuiltinCommands(registry);

    function buildCtx(cwd: string, agentId: string) {
        const projectDir = getProjectDir(appName, cwd);
        let sessionContent = '';
        try { sessionContent = readFileSync(join(projectDir, 'memory', 'session.md'), 'utf-8'); } catch {}
        const agents = AgentLoader.load({ appName, cwd, builtins: CODING_AGENTS })
            .map(a => ({ id: a.id, name: a.name, description: a.description ?? '' }));
        return {
            emit: (text: string) => emit({ type: 'system', level: 'info', text }),
            appName,
            projectDir,
            sessionContent,
            effectiveAgentId: agentId,
            model: ctx.model,
            agents,
            injectContext: (msg: string) => emit({ type: 'system', level: 'info', text: msg }),
            onCwdChange: (newCwd: string) => {
                currentCwd = newCwd;
                engine = makeEngine(agentId, newCwd, mcpServers);
                emitConfig(agentId, newCwd);
            },
            runEngine: async (prompt: string) => { await engine.run(prompt); },
            mcpList: async () => {
                const mgr = engine.getMCPManager?.();
                const info = mgr?.getServerInfo() ?? [];
                return (config.mcpServers ?? []).map(s => {
                    const live = info.find(i => i.name === s.name);
                    return { name: s.name, url: s.url, connected: !!live, toolCount: live?.toolCount ?? 0 };
                });
            },
            mcpAdd: async () => {},
            mcpRemove: async () => {},
            getIterationMode: () => iterationMode as 'auto' | 'interactive' | 'step-by-step',
        };
    }

    function emitConfig(agentId: string, cwd: string) {
        const allAgents = AgentLoader.load({ appName, cwd, builtins: CODING_AGENTS });
        emit({
            type: 'config',
            agents: allAgents.map(a => ({ id: a.id, name: a.name, icon: a.icon, description: a.description ?? '' })),
            models: [{ id: ctx.model ?? 'default', name: ctx.model ?? 'default' }],
            commands: registry.getAll().map(c => ({ name: c.name, description: c.description })),
            currentAgent: agentId,
            currentModel: ctx.model ?? 'default',
            skillsCount: 0,
        });
    }

    // ── Emit ready + config ───────────────────────────────────────────────────────
    emit({ type: 'ready' });
    emitConfig(agentId, currentCwd);

    // ── Stdin reader ──────────────────────────────────────────────────────────────
    const rl = readline.createInterface({ input: process.stdin, terminal: false });

    rl.on('line', async (raw) => {
        const line = raw.trim();
        if (!line) return;

        let msg: { type: string; [k: string]: unknown };
        try { msg = JSON.parse(line); } catch { return; }

        switch (msg.type) {
            case 'user_input': {
                const text = String(msg.text ?? '').trim();
                if (!text) return;

                emit({ type: 'user_message', text });

                // Slash command?
                if (text.startsWith('/') && !text.startsWith('/prompt')) {
                    const handled = await registry.dispatch(text, buildCtx(currentCwd, agentId));
                    if (!handled) emit({ type: 'system', level: 'warn', text: `Unknown command: ${text}` });
                    return;
                }

                currentRunPromise = engine.run(expandCommand(text))
                    .catch(err => { emit({ type: 'error', message: (err as Error).message }); })
                    .finally(() => { currentRunPromise = null; });
                break;
            }

            case 'interrupt':
                pendingApproval?.('reject');
                pendingApproval = null;
                pendingIteration?.(false);
                pendingIteration = null;
                engine.abort();
                break;

            case 'approval_response':
                pendingApproval?.(msg.decision as ToolApprovalDecision);
                pendingApproval = null;
                break;

            case 'iteration_response':
                pendingIteration?.(Boolean(msg.continue));
                pendingIteration = null;
                break;

            case 'switch_agent': {
                const newAgent = String(msg.agent_id ?? '');
                if (newAgent) {
                    engine = makeEngine(newAgent, currentCwd, mcpServers);
                    emitConfig(newAgent, currentCwd);
                }
                break;
            }

            case 'switch_cwd': {
                const newCwd = String(msg.cwd ?? '');
                if (newCwd) {
                    currentCwd = newCwd;
                    engine = makeEngine(agentId, newCwd, mcpServers);
                    emitConfig(agentId, newCwd);
                }
                break;
            }
        }
    });

    rl.on('close', async () => {
        if (currentRunPromise) await currentRunPromise;
        process.exit(0);
    });

    // Keep process alive
    await new Promise<void>(() => {});
}
