import * as readline from 'readline';
import * as path from 'path';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
    createCodingEngineFromConfig,
    ConfigLoader,
    AgentLoader,
    InitWorkflow,
    CODING_AGENTS,
} from '@bk/agent-coding';
import type { AgentProfile } from '@bk/agent-core';
import {
    CallbackTransport,
    SlashCommandRegistry,
    registerBuiltinCommands,
    getProjectDir,
    type MCPServerConfig,
    type ToolApprovalDecision,
} from '@bk/agent-core';
import { renderEvent } from './display';

interface InteractiveCtx {
    appName:       string;
    cwd:           string;
    agentId:       string;
    model?:        string;
    iterationMode: 'auto' | 'interactive' | 'step-by-step';
    maxIterations: number;
}

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
    red: '\x1b[31m', gray: '\x1b[90m', white: '\x1b[97m',
};
const col  = (clr: string, s: string) => `${clr}${s}${c.reset}`;
const ANSI = /\x1b\[[0-9;]*m/g;
const vlen = (s: string) => s.replace(ANSI, '').length;
const padR = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - vlen(s)));
const hr   = (n: number) => col(c.gray, '─'.repeat(n));

const DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-sonnet-4-6',
    deepseek:  'deepseek-chat',
    openai:    'gpt-4o',
};

function printBanner(ctx: InteractiveCtx, config: ReturnType<ConfigLoader['load']>): void {
    const W   = Math.min(Math.max(process.stdout.columns ?? 100, 88), 120);
    const DIV = Math.floor(W * 0.44);
    const LW  = DIV - 3;
    const RW  = W - DIV - 4;

    const allAgents = AgentLoader.load({ appName: ctx.appName, cwd: ctx.cwd, builtins: CODING_AGENTS });
    const dirs      = AgentLoader.dirs(ctx.appName, ctx.cwd);
    const provider  = config.defaultProvider ?? 'unknown';
    const model     = ctx.model ?? config.providers?.[provider]?.model ?? DEFAULT_MODELS[provider] ?? provider;
    const home      = process.env.USERPROFILE ?? process.env.HOME ?? '';
    const tilde     = (s: string) => s.startsWith(home) ? '~' + s.slice(home.length) : s;

    const L: string[] = [''];
    L.push(col(c.bold + c.cyan, '  ◆  bk-agent'));
    L.push(col(c.gray,          '     v0.1.0  (powered by @bk/agent-framework)'));
    L.push('');
    L.push(col(c.gray, '  provider   ') + col(c.white, provider));
    L.push(col(c.gray, '  model      ') + col(c.white, model));
    L.push(col(c.gray, '  agent      ') + col(c.cyan,  '◈ ' + ctx.agentId));
    L.push(col(c.gray, '  cwd        ') + col(c.dim,   tilde(ctx.cwd).slice(0, LW - 14)));
    L.push(col(c.gray, '  iteration  ') + col(c.white, ctx.iterationMode));
    L.push('');

    const shown = allAgents.slice(0, 6);
    const extra = allAgents.length - shown.length;
    const fmtAgent = (a: AgentProfile) => {
        const ic = a.source === 'project' ? col(c.yellow, a.icon)
            : a.source === 'global'  ? col(c.green, a.icon) : col(c.cyan, a.icon);
        return `${ic} ${a.id}`;
    };
    const row1     = shown.slice(0, 3).map(fmtAgent).join('  ');
    const row2rest = shown.slice(3).map(fmtAgent);
    if (extra > 0) row2rest.push(col(c.gray, `+${extra} more`));

    L.push(col(c.gray, `  ${allAgents.length} agents`));
    L.push('  ' + row1);
    if (row2rest.length) L.push('  ' + row2rest.join('  '));
    L.push('');
    L.push(col(c.gray, `  [+] ${tilde(dirs.global).slice(0, LW - 7)}`));
    L.push(col(c.gray, `  [*] ${tilde(dirs.project).slice(0, LW - 7)}`));
    L.push('');

    const R: string[] = [''];
    R.push(col(c.bold, '  Commands'));
    R.push('  ' + hr(RW - 2));
    const cmds: Array<[string, string]> = [
        ['/init',          'analyze & document the project'],
        ['/agent',         'list · switch · create agents'],
        ['/skills',        'view loaded skills'],
        ['/status',        'current agent & model'],
        ['/checkpoint',    'save & restore session'],
        ['/workspace',     'multi-project context'],
        ['/mcp',           'MCP servers  /mcp tools'],
        ['/help',          'AI guidance'],
        ['/cwd <path>',    'change working directory'],
        ['/clear  /quit',  ''],
    ];
    for (const [cmd, desc] of cmds) {
        R.push(col(c.white, `  ${cmd.padEnd(14)}`) + col(c.gray, desc));
    }
    R.push('');
    R.push(col(c.bold, '  Features'));
    R.push('  ' + hr(RW - 2));
    R.push('  ' + col(c.green, '✓') + col(c.gray, ' Orchestrator + QA auto-review'));
    R.push('  ' + col(c.green, '✓') + col(c.gray, ' Reflection Engine'));
    R.push('  ' + col(c.green, '✓') + col(c.gray, ' Skills · Memory · MCP'));
    R.push('  ' + col(c.green, '✓') + col(c.gray, ' Headless mode (--headless)'));
    R.push('');

    const title  = 'bk-agent';
    const topFill = `─── ${title} `;
    const topL   = topFill + '─'.repeat(Math.max(0, LW + 2 - topFill.length));
    const topR   = '─'.repeat(RW + 2);
    const rows   = Math.max(L.length, R.length);
    const lines: string[] = [];
    lines.push('╭' + topL + '┬' + topR + '╮');
    for (let i = 0; i < rows; i++) {
        lines.push(`│ ${padR(L[i] ?? '', LW)} │ ${padR(R[i] ?? '', RW)} │`);
    }
    lines.push('╰' + '─'.repeat(LW + 2) + '┴' + '─'.repeat(RW + 2) + '╯');
    console.log('\n' + lines.join('\n'));
}

export async function runInteractive(ctx: InteractiveCtx): Promise<void> {
    const { appName } = ctx;
    const loader = new ConfigLoader(appName);
    const config = loader.load();

    if (!config.defaultProvider) {
        console.error('\n  Error: no provider configured.');
        console.error('  Set ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY');
        process.exit(1);
    }

    let iterationMode = ctx.iterationMode;
    let currentAgent  = ctx.agentId;
    let currentCwd    = ctx.cwd;

    function makeEngine(agentId: string, cwd: string, mcpServers?: MCPServerConfig[]) {
        const transport = new CallbackTransport(renderEvent);
        return createCodingEngineFromConfig({
            appName,
            defaultAgent:  agentId,
            workingDir:    cwd,
            transport,
            maxIterations: ctx.maxIterations,
            ...(mcpServers?.length ? { mcpServers } : {}),
            orchestration: { enableQA: true, reflection: true },

            onToolApproval: async (toolName, agentId, argsPreview) => {
                if (iterationMode !== 'interactive') return 'approve';
                return new Promise<ToolApprovalDecision>(resolve => {
                    const preview = argsPreview.length > 120 ? argsPreview.slice(0, 120) + '…' : argsPreview;
                    process.stdout.write(
                        `\n  ${col(c.yellow, '⚠')} ${col(c.white, agentId)} → ${col(c.cyan, toolName)}\n` +
                        `  ${col(c.gray, preview)}\n` +
                        `  ${col(c.green, '[a]')} aprobar  ${col(c.yellow, '[t]')} aprobar todo  ${col(c.red, '[r]')} rechazar  > `
                    );
                    const onKey = (_str: string, key: { name?: string; sequence?: string }) => {
                        const k = key?.name ?? key?.sequence ?? '';
                        if (k === 'a' || k === 'return') {
                            process.stdout.write('\n');
                            process.stdin.removeListener('keypress', onKey);
                            resolve('approve');
                        } else if (k === 't') {
                            process.stdout.write('\n');
                            process.stdin.removeListener('keypress', onKey);
                            resolve('approve_all');
                        } else if (k === 'r' || k === 'escape') {
                            process.stdout.write('\n');
                            process.stdin.removeListener('keypress', onKey);
                            resolve('reject');
                        }
                    };
                    process.stdin.on('keypress', onKey);
                });
            },
        });
    }

    const mcpServers = config.mcpServers ?? [];
    let engine = makeEngine(currentAgent, currentCwd, mcpServers);

    printBanner(ctx, config);

    const registry = new SlashCommandRegistry();
    registerBuiltinCommands(registry);

    function buildCtx(emit: (s: string) => void) {
        const projectDir = getProjectDir(appName, currentCwd);
        let sessionContent = '';
        try { sessionContent = readFileSync(join(projectDir, 'memory', 'session.md'), 'utf-8'); } catch {}
        const agents = AgentLoader.load({ appName, cwd: currentCwd, builtins: CODING_AGENTS })
            .map(a => ({ id: a.id, name: a.name, description: a.description ?? '' }));
        const provider = config.defaultProvider!;
        const model    = ctx.model ?? config.providers?.[provider]?.model ?? DEFAULT_MODELS[provider] ?? provider;

        return {
            emit,
            appName,
            projectDir,
            sessionContent,
            effectiveAgentId: currentAgent,
            model,
            agents,
            injectContext: (msg: string) => emit(col(c.gray, `  [ctx] ${msg}`)),
            onCwdChange: (newCwd: string) => {
                currentCwd = newCwd;
                engine = makeEngine(currentAgent, newCwd, mcpServers);
                emit(col(c.gray, `  cwd → ${newCwd}`));
            },
            runEngine: async (p: string) => { await engine.run(p); },
            mcpList: async () => {
                const mgr  = engine.getMCPManager?.();
                const info = mgr?.getServerInfo() ?? [];
                return (config.mcpServers ?? []).map(s => {
                    const live = info.find(i => i.name === s.name);
                    return { name: s.name, url: s.url, connected: !!live, toolCount: live?.toolCount ?? 0 };
                });
            },
            mcpAdd: async (cfg: unknown) => {
                const config = cfg as MCPServerConfig;
                const cur = loader.load();
                const srvs = cur.mcpServers ?? [];
                if (!srvs.find(s => s.name === config.name)) {
                    loader.save({ ...cur, mcpServers: [...srvs, config] });
                    emit(col(c.gray, `  Restart to connect "${config.name}".`));
                }
            },
            mcpRemove: async (name: string) => {
                const cur = loader.load();
                loader.save({ ...cur, mcpServers: (cur.mcpServers ?? []).filter(s => s.name !== name) });
                engine.unregisterMCPServer?.(name);
                emit(col(c.green, `  Removed "${name}".`));
            },
            getIterationMode: () => iterationMode as 'auto' | 'interactive' | 'step-by-step',
            setIterationMode: (mode: 'auto' | 'interactive' | 'step-by-step') => { iterationMode = mode; },
        };
    }

    let running = false;
    const emit = (s: string) => console.log(s);

    const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
        prompt: col(c.green, '❯') + ' ',
    });

    let multiBuffer: string[] = [];
    let multiMode = false;
    const flushMulti = (): string => {
        const full = multiBuffer.join('\n').trimEnd();
        multiBuffer = [];
        multiMode   = false;
        rl.setPrompt(col(c.green, '❯') + ' ');
        return full;
    };

    process.on('SIGINT', () => {
        if (running) {
            engine.abort();
            process.stdout.write(col(c.yellow, '\n  ⚠ Abortando… (Ctrl+C de nuevo para salir)\n'));
            running = false;
            multiBuffer = [];
            multiMode   = false;
            rl.setPrompt(col(c.green, '❯') + ' ');
            rl.resume();
            rl.prompt();
        } else {
            process.stdout.write(col(c.gray, '  bye\n'));
            rl.close();
            process.exit(0);
        }
    });

    rl.prompt();

    const PASTE_MS   = 40;
    let pasteBuffer: string[] = [];
    let pasteTimer:  ReturnType<typeof setTimeout> | null = null;

    rl.on('line', async (line) => {
        if (multiMode) {
            if (line === '') {
                const input = flushMulti();
                if (!input) { rl.prompt(); return; }
                await handleInput(input);
            } else {
                multiBuffer.push(line);
                rl.setPrompt(col(c.gray, '... '));
                rl.prompt();
            }
            return;
        }

        pasteBuffer.push(line.trimEnd());
        if (pasteTimer) clearTimeout(pasteTimer);
        pasteTimer = setTimeout(async () => {
            const lines  = pasteBuffer.splice(0);
            const joined = lines.join('\n').trim();
            if (!joined) { rl.prompt(); return; }
            if (lines.length === 1 && (joined.endsWith(':') || joined.endsWith('```'))) {
                multiMode = true;
                multiBuffer = [joined];
                rl.setPrompt(col(c.gray, '... '));
                rl.prompt();
                return;
            }
            await handleInput(joined);
        }, PASTE_MS);
    });

    rl.on('close', () => process.exit(0));

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

    async function handleInput(input: string): Promise<void> {
        if (input === '/init' || input.startsWith('/init ')) {
            const mode = InitWorkflow.detectMode(currentCwd);
            emit(col(c.gray, `\n  /init — detectado: ${{ new: 'nuevo proyecto', existing: 'proyecto existente', hybrid: 'híbrido' }[mode]}`));
            if (mode === 'new' && !existsSync(join(currentCwd, 'prompt.md'))) {
                emit(col(c.yellow, '  No se encontró prompt.md. Créalo describiendo qué construir, luego ejecuta /init de nuevo.'));
                rl.prompt();
                return;
            }
            const initEng = makeEngine('project-manager', currentCwd, mcpServers);
            running = true;
            rl.pause();
            try { await initEng.run(InitWorkflow.buildPrompt(currentCwd, mode)); }
            catch (err) { emit(`\n  ${col(c.red, 'Error:')} ${(err as Error).message}\n`); }
            finally { running = false; rl.resume(); rl.prompt(); }
            return;
        }

        if (input === '/mcp' || input.startsWith('/mcp ')) {
            const parts = input.split(/\s+/);
            const sub   = parts[1] ?? 'list';

            if (sub === 'list' || sub === '') {
                const cfg = loader.load();
                const all = cfg.mcpServers ?? [];
                if (all.length === 0) {
                    emit(col(c.gray, '\n  No hay servidores MCP configurados.'));
                    emit(col(c.gray, '  Usa: /mcp add <nombre> <url> [--mode tools|agent] [--assign a1,a2]\n'));
                } else {
                    emit(col(c.bold, '\n  MCP Servers'));
                    emit('  ' + col(c.gray, '─'.repeat(60)));
                    const mgr     = engine.getMCPManager?.();
                    const info    = mgr?.getServerInfo() ?? [];
                    const infoMap = new Map(info.map(i => [i.name, i]));
                    for (const s of all) {
                        const connected = infoMap.get(s.name);
                        const target    = s.url ?? [s.command, ...(s.args ?? [])].join(' ');
                        const status    = connected
                            ? col(c.green, `${connected.transportUsed}  ${connected.toolCount} tools`)
                            : col(c.gray, s.url ? 'remote (offline)' : 'stdio (offline)');
                        const mode = s.mode === 'tools'
                            ? col(c.yellow, `tools→[${(s.assignTo ?? ['all']).join(',')}]`)
                            : s.mode === 'agent' ? col(c.cyan, 'agent') : '';
                        emit(`  ${col(c.cyan, '◈')} ${col(c.white, s.name.padEnd(16))} ${col(c.gray, (target ?? '').slice(0, 38).padEnd(40))} ${status}  ${mode}`);
                    }
                    emit('');
                }

            } else if (sub === 'tools') {
                const mgr = engine.getMCPManager?.();
                if (!mgr) {
                    emit(col(c.gray, '\n  No hay MCP manager (ningún servidor configurado).\n'));
                } else {
                    emit(col(c.gray, '\n  Inicializando conexiones MCP…'));
                    try {
                        await mgr.initialize();
                        const tools = mgr.getTools();
                        if (tools.length === 0) {
                            emit(col(c.yellow, '  No se encontraron tools en los servidores MCP.\n'));
                        } else {
                            emit(col(c.bold, `\n  MCP Tools (${tools.length})`));
                            emit('  ' + col(c.gray, '─'.repeat(60)));
                            for (const t of tools) {
                                const [, srv, name] = t.name.split('__');
                                emit(`  ${col(c.cyan, '◌')} ${col(c.white, (name ?? t.name).padEnd(28))}${col(c.gray, `[${srv}]`)}`);
                                if (t.description) {
                                    const desc = t.description.replace(/^\[MCP:[^\]]+\]\s*/, '');
                                    emit(col(c.gray, `    ${desc.slice(0, 70)}`));
                                }
                            }
                            emit('');
                        }
                    } catch (err) {
                        emit(`  ${col(c.red, '✗')} MCP init falló: ${(err as Error).message}\n`);
                    }
                }

            } else if (sub === 'add') {
                const name   = parts[2];
                const target = parts[3];
                if (!name || !target) {
                    emit(col(c.gray, '  Uso: /mcp add <nombre> <url|comando> [--mode tools|agent] [--assign a,b] [--stdio]'));
                } else {
                    const isStdio   = parts.includes('--stdio');
                    const modeIdx   = parts.indexOf('--mode');
                    const mode      = modeIdx   !== -1 ? (parts[modeIdx + 1] as 'tools' | 'agent') : undefined;
                    const assignIdx = parts.indexOf('--assign');
                    const assignTo  = assignIdx !== -1 ? parts[assignIdx + 1]?.split(',') : undefined;
                    const blocksIdx = parts.indexOf('--blocks');
                    const blocksCommands = blocksIdx !== -1 ? parts[blocksIdx + 1]?.split(',') : undefined;

                    const cfg: MCPServerConfig = isStdio
                        ? { name, command: target, args: parts.slice(4).filter(p => !p.startsWith('--') && p !== mode && p !== parts[assignIdx + 1] && p !== parts[blocksIdx + 1]) }
                        : { name, url: target };

                    if (mode)           cfg.mode           = mode;
                    if (assignTo)       cfg.assignTo       = assignTo;
                    if (blocksCommands) cfg.blocksCommands = blocksCommands;

                    const current  = loader.load();
                    const existing = (current.mcpServers ?? []).findIndex(s => s.name === name);
                    const servers  = [...(current.mcpServers ?? [])];
                    if (existing !== -1) { servers[existing] = cfg; emit(col(c.yellow, `  Updated "${name}" — reinicia para reconectar.`)); }
                    else                 { servers.push(cfg);       emit(col(c.green,  `  Added "${name}" — reinicia para conectar.`)); }
                    loader.save({ ...current, mcpServers: servers });
                }

            } else if (sub === 'remove' || sub === 'rm') {
                const name = parts[2];
                if (!name) {
                    emit(col(c.gray, '  Uso: /mcp remove <nombre>'));
                } else {
                    const current = loader.load();
                    const before  = (current.mcpServers ?? []).length;
                    const servers = (current.mcpServers ?? []).filter(s => s.name !== name);
                    if (servers.length === before) { emit(col(c.yellow, `  Servidor "${name}" no encontrado.`)); }
                    else {
                        loader.save({ ...current, mcpServers: servers });
                        engine.unregisterMCPServer?.(name);
                        emit(col(c.green, `  Removido "${name}".`));
                    }
                }

            } else {
                emit(col(c.gray, '  Uso: /mcp [list|tools|add|remove]'));
            }

            rl.prompt(); return;
        }

        if (input.startsWith('/agent')) {
            const [, sub, ...rest] = input.split(/\s+/);
            if (!sub || sub === 'list') {
                const all = AgentLoader.load({ appName, cwd: currentCwd, builtins: CODING_AGENTS });
                const grp: Record<string, AgentProfile[]> = { project: [], global: [], builtin: [] };
                for (const a of all) grp[a.source ?? 'builtin'].push(a);
                for (const [src, list] of Object.entries(grp)) {
                    if (list.length) {
                        emit(col(c.bold, `\n  ${src}`));
                        list.forEach(a => emit(`  ${a.icon}  ${a.id.padEnd(20)} ${col(c.gray, (a.description ?? '').slice(0, 44))}`));
                    }
                }
                emit('');
            } else if (sub === 'new') {
                const id       = rest.find(s => !s.startsWith('--'));
                const isGlobal = rest.includes('--global');
                if (!id) { emit('  Uso: /agent new <id> [--global]'); }
                else {
                    AgentLoader.scaffold(id, { appName, cwd: currentCwd, scope: isGlobal ? 'global' : 'project' });
                    const dirs = AgentLoader.dirs(appName, currentCwd);
                    emit(col(c.gray, `  creado ${isGlobal ? dirs.global : dirs.project}/${id}.json`));
                }
            } else {
                const all = AgentLoader.load({ appName, cwd: currentCwd, builtins: CODING_AGENTS });
                if (!all.find(a => a.id === sub)) emit(`  Agente "${sub}" no encontrado. Usa /agent list.`);
                else {
                    currentAgent = sub;
                    engine = makeEngine(currentAgent, currentCwd, mcpServers);
                    emit(col(c.gray, `  agente → ${sub}`));
                }
            }
            rl.prompt(); return;
        }

        if (input.startsWith('/cwd')) {
            const arg = input.slice(4).trim();
            if (!arg) emit(`  ${currentCwd}`);
            else {
                currentCwd = path.resolve(arg);
                engine = makeEngine(currentAgent, currentCwd, mcpServers);
                emit(col(c.gray, `  cwd → ${currentCwd}`));
            }
            rl.prompt(); return;
        }

        if (input === '/clear') {
            engine = makeEngine(currentAgent, currentCwd, mcpServers);
            console.clear();
            printBanner(ctx, config);
            rl.prompt(); return;
        }

        if (input === '/quit' || input === '/exit' || input === '/q') {
            emit(col(c.gray, '  bye\n'));
            rl.close();
            process.exit(0);
        }

        if (input.startsWith('/')) {
            const handled = await registry.dispatch(input, buildCtx(emit));
            if (!handled) emit(col(c.gray, '  Comando desconocido. Usa /help.'));
            rl.prompt(); return;
        }

        if (running) { emit(col(c.gray, '  (ocupado — espera a que termine la tarea actual)')); return; }

        running = true;
        rl.pause();
        try { await engine.run(expandCommand(input)); }
        catch (err) { emit(`\n  ${col(c.red, 'Error:')} ${(err as Error).message}\n`); }
        finally { running = false; rl.resume(); rl.prompt(); }
    }
}
