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
} from '@bk/agent-core';
import { renderEvent } from './display';

// ── Config ────────────────────────────────────────────────────────────────────
const APP_NAME    = process.env.AGENT_APP_NAME ?? 'coding-assistant';
const AGENT_ID    = process.env.AGENT_ID       ?? 'general';
const WORKING_DIR = process.env.WORKING_DIR ?? process.cwd();

const loader = new ConfigLoader(APP_NAME);
const config = loader.load();

if (!config.defaultProvider) {
    console.error('\n  Error: no provider configured.');
    console.error(`  Set ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY`);
    console.error(`  or edit ${loader.configPath}\n`);
    process.exit(1);
}

const DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-sonnet-4-6',
    deepseek:  'deepseek-chat',
    openai:    'gpt-4o',
    kimi:      'moonshot-v1-8k',
    grok:      'grok-3',
};

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

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner(): void {
    const W   = Math.min(Math.max(process.stdout.columns ?? 100, 88), 120);
    const DIV = Math.floor(W * 0.44);
    // Body: │ LW │ RW │  → 2 + LW + 3 + RW + 2 = W  → LW + RW = W - 7
    const LW  = DIV - 3;
    const RW  = W - DIV - 4;

    const allAgents = AgentLoader.load({ appName: APP_NAME, cwd: WORKING_DIR, builtins: CODING_AGENTS });
    const dirs      = AgentLoader.dirs(APP_NAME, WORKING_DIR);
    const provider  = config.defaultProvider!;
    const model     = config.providers?.[provider]?.model ?? DEFAULT_MODELS[provider] ?? provider;
    const home      = process.env.USERPROFILE ?? process.env.HOME ?? '';
    const tilde     = (s: string) => s.startsWith(home) ? '~' + s.slice(home.length) : s;

    // ── Left panel ────────────────────────────────────────────────────────────
    const L: string[] = [''];
    L.push(col(c.bold + c.cyan, '  ◆  Coding Assistant'));
    L.push(col(c.gray,          '     v0.7.0'));
    L.push('');
    L.push(col(c.gray, '  provider   ') + col(c.white, provider));
    L.push(col(c.gray, '  model      ') + col(c.white, model));
    L.push(col(c.gray, '  agent      ') + col(c.cyan,  '◈ ' + AGENT_ID));
    L.push(col(c.gray, '  cwd        ') + col(c.dim,   tilde(WORKING_DIR).slice(0, LW - 14)));
    L.push('');

    const shown = allAgents.slice(0, 6);
    const extra = allAgents.length - shown.length;
    const fmtAgent = (a: AgentProfile) => {
        const ic = a.source === 'project'
            ? col(c.yellow, a.icon)
            : a.source === 'global' ? col(c.green, a.icon) : col(c.cyan, a.icon);
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

    const mcpCfg = config.mcpServers ?? [];
    if (mcpCfg.length > 0) {
        L.push('');
        const mcpLabels = mcpCfg.map(s => {
            const dot = s.mode === 'tools' ? col(c.yellow, '◇') : col(c.cyan, '◈');
            return `${dot}${s.name}`;
        });
        L.push(col(c.gray, '  MCP  ') + mcpLabels.join('  '));
    }
    L.push('');

    // ── Right panel ───────────────────────────────────────────────────────────
    const R: string[] = [''];
    R.push(col(c.bold, '  Commands'));
    R.push('  ' + hr(RW - 2));

    const cmds: Array<[string, string]> = [
        ['/init',         'analyze & document the project'],
        ['/agent',        'list · switch · create agents'],
        ['/mcp',          'list servers  /mcp tools'],
        ['/skills',       'view loaded skills'],
        ['/status',       'current agent & model'],
        ['/checkpoint',   'save & restore session state'],
        ['/workspace',    'multi-project context'],
        ['/help',         'AI guidance on what I can do'],
        ['/cwd <path>',   'change working directory'],
        ['/clear  /quit', ''],
    ];
    for (const [cmd, desc] of cmds) {
        R.push(col(c.white, `  ${cmd.padEnd(14)}`) + col(c.gray, desc));
    }
    R.push('');
    R.push(col(c.bold, '  Features'));
    R.push('  ' + hr(RW - 2));
    R.push('  ' + col(c.green, '✓') + col(c.gray, ' Orchestrator + QA auto-review'));
    R.push('  ' + col(c.green, '✓') + col(c.gray, ' Reflection Engine (cross-sprint)'));
    R.push('  ' + col(c.green, '✓') + col(c.gray, ' 33 builtin skills'));
    R.push('');

    // ── Box render ────────────────────────────────────────────────────────────
    // Top:  ╭─── agent-framework ──...──┬──...──╮
    // Body: │ content                   │ content │
    // Bot:  ╰──...──┴──...──╯
    const title   = 'agent-framework';
    const topFill = `─── ${title} `;
    const topL    = topFill + '─'.repeat(Math.max(0, LW + 2 - topFill.length));
    const topR    = '─'.repeat(RW + 2);
    const botL    = '─'.repeat(LW + 2);
    const botR    = '─'.repeat(RW + 2);

    const rows = Math.max(L.length, R.length);
    const lines: string[] = [];
    lines.push('╭' + topL + '┬' + topR + '╮');
    for (let i = 0; i < rows; i++) {
        lines.push(`│ ${padR(L[i] ?? '', LW)} │ ${padR(R[i] ?? '', RW)} │`);
    }
    lines.push('╰' + botL + '┴' + botR + '╯');
    console.log('\n' + lines.join('\n'));
}

// ── Iteration mode ────────────────────────────────────────────────────────────
let iterationMode: 'auto' | 'manual' = 'auto';

// ── Engine factory ────────────────────────────────────────────────────────────
function makeEngine(agentId: string, cwd: string, mcpServers?: MCPServerConfig[]) {
    const transport = new CallbackTransport(renderEvent);
    const engine = createCodingEngineFromConfig({
        appName:      APP_NAME,
        defaultAgent: agentId,
        workingDir:   cwd,
        transport,
        ...(mcpServers?.length ? { mcpServers } : {}),
        orchestration: {
            enableQA:   true,
            reflection: true,
        },
        onToolApproval: async (toolName, agentId, argsPreview) => {
            if (iterationMode !== 'manual') return 'approve';

            return new Promise<import('@bk/agent-core').ToolApprovalDecision>(resolve => {
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
    return { engine, transport };
}

// ── Slash command registry ────────────────────────────────────────────────────
const registry = new SlashCommandRegistry();
registerBuiltinCommands(registry);

function buildCtx(
    emit:      (s: string) => void,
    cwd:       string,
    agentId:   string,
    runFn:     (p: string) => Promise<void>,
    cwdChange: (newCwd: string) => void,
    engineRef?: { current: ReturnType<typeof makeEngine>['engine'] },
) {
    const projectDir = getProjectDir(APP_NAME, cwd);
    let sessionContent = '';
    try { sessionContent = readFileSync(join(projectDir, 'memory', 'session.md'), 'utf-8'); } catch {}

    const provider = config.defaultProvider!;
    const model    = config.providers?.[provider]?.model ?? DEFAULT_MODELS[provider] ?? provider;
    const agents   = AgentLoader.load({ appName: APP_NAME, cwd, builtins: CODING_AGENTS })
        .map(a => ({ id: a.id, name: a.name, description: a.description }));

    return {
        emit,
        appName:          APP_NAME,
        projectDir,
        sessionContent,
        effectiveAgentId: agentId,
        model,
        agents,
        injectContext:    (msg: string) => emit(col(c.gray, `  [ctx] ${msg}`)),
        onCwdChange:      cwdChange,
        runEngine:        runFn,
        mcpList: async () => {
            const mgr  = engineRef?.current?.getMCPManager?.();
            const info = mgr?.getServerInfo() ?? [];
            return (config.mcpServers ?? []).map(s => {
                const live = info.find(i => i.name === s.name);
                return { name: s.name, url: s.url, connected: !!live, toolCount: live?.toolCount ?? 0 };
            });
        },
        mcpAdd: async (cfg: import('@bk/agent-core').MCPServerConfig) => {
            const current = loader.load();
            const servers = current.mcpServers ?? [];
            if (!servers.find(s => s.name === cfg.name)) {
                loader.save({ ...current, mcpServers: [...servers, cfg] });
                emit(col(c.gray, `  Restart to connect "${cfg.name}".`));
            }
        },
        mcpRemove: async (name: string) => {
            const current = loader.load();
            loader.save({ ...current, mcpServers: (current.mcpServers ?? []).filter(s => s.name !== name) });
            emit(col(c.gray, `  Restart to disconnect "${name}".`));
        },
        getIterationMode: () => iterationMode,
        setIterationMode: (mode: 'auto' | 'manual') => { iterationMode = mode; },
    };
}

// ── REPL ──────────────────────────────────────────────────────────────────────

/**
 * Warn when the working directory looks like a framework/monorepo root.
 * Agents working from a monorepo root have write access to all packages,
 * which is rarely what you want when assisting on a specific project.
 * Set WORKING_DIR env var or use /cwd <path> to scope to a specific project.
 */
function warnIfMonorepoRoot(cwd: string): void {
    const { existsSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const looksLikeMonorepo =
        existsSync(join(cwd, 'packages')) &&
        existsSync(join(cwd, 'package.json'));
    if (!looksLikeMonorepo) return;
    console.warn(
        `\n  ${col(c.yellow, '⚠')}  Working directory is a monorepo root: ${col(c.dim, cwd)}` +
        `\n     Agents can write to ALL packages from here.` +
        `\n     Set ${col(c.white, 'WORKING_DIR=/your/project')} or use ${col(c.white, '/cwd <path>')} to scope to a specific project.\n`
    );
}

async function main(): Promise<void> {
    printBanner();
    warnIfMonorepoRoot(WORKING_DIR);

    const mcpServers = config.mcpServers ?? [];

    let currentAgent = AGENT_ID;
    let currentCwd   = WORKING_DIR;
    let { engine }   = makeEngine(currentAgent, currentCwd, mcpServers);
    let running      = false;

    const emit = (s: string) => console.log(s);

    const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
        prompt: col(c.green, '❯') + ' ',
    });

    // ── Multi-line buffer ─────────────────────────────────────────────────────
    // Activated when input ends with ':' or '```'. Accumulates lines until an
    // empty line is received, then sends the full block as a single message.
    let multiBuffer: string[] = [];
    let multiMode = false;

    const flushMulti = (): string => {
        const full = multiBuffer.join('\n').trimEnd();
        multiBuffer = [];
        multiMode   = false;
        rl.setPrompt(col(c.green, '❯') + ' ');
        return full;
    };

    // ── Ctrl+C — abort current run, keep REPL alive ─────────────────────────
    // Must use process.on('SIGINT') instead of rl.on('SIGINT') because
    // rl.pause() is called while the engine runs, which stops readline from
    // processing keyboard events — including its own SIGINT handler.
    process.on('SIGINT', () => {
        if (running) {
            engine.abort();
            process.stdout.write(col(c.yellow, '\n  ⚠ Abortando… (Ctrl+C de nuevo para salir)\n'));
            running = false;
            multiBuffer = [];
            multiMode = false;
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

    // ── Paste detection ───────────────────────────────────────────────────────
    // When multiple lines arrive within PASTE_WINDOW_MS of each other, it's a
    // paste event. Buffer all lines and process them as a single message when
    // the burst stops. This prevents a pasted multi-line prompt from firing
    // separate engine.run() calls for each line.
    const PASTE_WINDOW_MS = 40;
    let pasteBuffer: string[] = [];
    let pasteTimer: ReturnType<typeof setTimeout> | null = null;

    const flushPaste = async () => {
        pasteTimer = null;
        const lines = pasteBuffer.splice(0);
        if (!lines.length) return;
        const joined = lines.join('\n').trim();
        if (!joined) { rl.prompt(); return; }
        await handleInput(joined);
    };

    rl.on('line', async (line) => {
        // ── Manual multi-line mode (ends with ':' or '```', empty line to send)
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

        // ── Paste detection: buffer lines arriving in quick succession ─────────
        pasteBuffer.push(line.trimEnd());
        if (pasteTimer) clearTimeout(pasteTimer);

        pasteTimer = setTimeout(async () => {
            const lines = pasteBuffer.splice(0);
            const joined = lines.join('\n').trim();
            if (!joined) { rl.prompt(); return; }

            // Single-line: enter manual multi-line mode when it ends with ':' or '```'
            if (lines.length === 1 && (joined.endsWith(':') || joined.endsWith('```'))) {
                multiMode = true;
                multiBuffer = [joined];
                rl.setPrompt(col(c.gray, '... '));
                rl.prompt();
                return;
            }

            await handleInput(joined);
        }, PASTE_WINDOW_MS);
    });

    rl.on('close', () => process.exit(0));

    async function handleInput(input: string): Promise<void> {
        // ── /init ─────────────────────────────────────────────────────────────
        if (input === '/init' || input.startsWith('/init ')) {
            const mode = InitWorkflow.detectMode(currentCwd);
            emit(col(c.gray, `\n  /init — detected: ${{ new: 'new project', existing: 'existing project', hybrid: 'hybrid' }[mode]}`));
            if (mode === 'new' && !existsSync(join(currentCwd, 'prompt.md'))) {
                emit(col(c.yellow, '  No prompt.md found. Create one describing what to build, then run /init again.'));
                rl.prompt();
                return;
            }
            const { engine: initEng } = makeEngine('project-manager', currentCwd, mcpServers);
            running = true;
            rl.pause();
            try {
                await initEng.run(InitWorkflow.buildPrompt(currentCwd, mode));
            } catch (err) {
                emit(`\n  ${col(c.red, 'Init error:')} ${(err as Error).message}\n`);
            } finally {
                running = false;
                rl.resume();
                rl.prompt();
            }
            return;
        }

        // ── /mcp ──────────────────────────────────────────────────────────────
        if (input === '/mcp' || input.startsWith('/mcp ')) {
            const parts = input.split(/\s+/);
            const sub   = parts[1] ?? 'list';

            // ── /mcp list ─────────────────────────────────────────────────────
            if (sub === 'list' || sub === '') {
                const cfg = loader.load();
                const all = cfg.mcpServers ?? [];
                if (all.length === 0) {
                    emit(col(c.gray, '\n  No MCP servers configured.'));
                    emit(col(c.gray, `  Use: /mcp add <name> <url> [--mode tools|agent] [--assign agent1,agent2]\n`));
                } else {
                    emit(col(c.bold, '\n  MCP Servers'));
                    emit('  ' + col(c.gray, '─'.repeat(60)));
                    const mgr     = engine.getMCPManager();
                    const info    = mgr?.getServerInfo() ?? [];
                    const infoMap = new Map(info.map(i => [i.name, i]));
                    for (const s of all) {
                        const connected = infoMap.get(s.name);
                        const target    = s.url ?? [s.command, ...(s.args ?? [])].join(' ');
                        const status    = connected
                            ? col(c.green, `${connected.transportUsed}  ${connected.toolCount} tools`)
                            : col(c.gray, s.url ? 'remote (offline)' : 'stdio (offline)');
                        const mode      = s.mode === 'tools'
                            ? col(c.yellow, `tools→[${(s.assignTo ?? ['all']).join(',')}]`)
                            : s.mode === 'agent' ? col(c.cyan, 'agent') : '';
                        emit(`  ${col(c.cyan, '◈')} ${col(c.white, s.name.padEnd(16))} ${col(c.gray, target.slice(0, 38).padEnd(40))} ${status}  ${mode}`);
                    }
                    emit('');
                }

            // ── /mcp tools ────────────────────────────────────────────────────
            } else if (sub === 'tools') {
                const mgr = engine.getMCPManager();
                if (!mgr) {
                    emit(col(c.gray, '\n  No MCP manager (no servers configured).\n'));
                } else {
                    emit(col(c.gray, '\n  Initializing MCP connections…'));
                    try {
                        await mgr.initialize();
                        const tools = mgr.getTools();
                        if (tools.length === 0) {
                            emit(col(c.yellow, '  No tools discovered from MCP servers.\n'));
                        } else {
                            emit(col(c.bold, `\n  MCP Tools (${tools.length})`));
                            emit('  ' + col(c.gray, '─'.repeat(60)));
                            for (const t of tools) {
                                const [, srv, name] = t.name.split('__');
                                emit(
                                    `  ${col(c.cyan, '◌')} ${col(c.white, (name ?? t.name).padEnd(28))}` +
                                    col(c.gray, `[${srv}]`),
                                );
                                if (t.description) {
                                    const desc = t.description.replace(/^\[MCP:[^\]]+\]\s*/, '');
                                    emit(col(c.gray, `    ${desc.slice(0, 70)}`));
                                }
                            }
                            emit('');
                        }
                    } catch (err) {
                        emit(`  ${col(c.red, '✗')} MCP init failed: ${(err as Error).message}\n`);
                    }
                }

            // ── /mcp add <name> <url|command> [flags] ─────────────────────────
            // flags: --mode tools|agent   --assign a,b   --blocks cmd1,cmd2   --stdio
            } else if (sub === 'add') {
                const name = parts[2];
                const target = parts[3];
                if (!name || !target) {
                    emit(col(c.gray, '  Usage: /mcp add <name> <url|command> [--mode tools|agent] [--assign a,b] [--blocks cmd1,cmd2] [--stdio]'));
                    emit(col(c.gray, '  Examples:'));
                    emit(col(c.gray, '    /mcp add pg-dev http://127.0.0.1:3012/mcp --mode tools --assign backend,data --blocks docker,docker-compose'));
                    emit(col(c.gray, '    /mcp add github npx @modelcontextprotocol/server-github --stdio --mode tools --assign backend'));
                } else {
                    const isStdio   = parts.includes('--stdio');
                    const modeIdx   = parts.indexOf('--mode');
                    const mode      = modeIdx   !== -1 ? (parts[modeIdx   + 1] as 'tools' | 'agent') : undefined;
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

                    const current = loader.load();
                    const existing = (current.mcpServers ?? []).findIndex(s => s.name === name);
                    const servers  = [...(current.mcpServers ?? [])];
                    if (existing !== -1) {
                        servers[existing] = cfg;
                        emit(col(c.yellow, `  Updated "${name}" — restart to reconnect.`));
                    } else {
                        servers.push(cfg);
                        emit(col(c.green, `  Added "${name}" — restart to connect.`));
                    }
                    loader.save({ ...current, mcpServers: servers });

                    const modeLabel   = mode           ? `  mode: ${mode}` : '';
                    const assignLabel = assignTo        ? `  assign→[${assignTo.join(',')}]` : '';
                    const blocksLabel = blocksCommands  ? `  blocks→[${blocksCommands.join(',')}]` : '';
                    emit(col(c.gray, `  ${isStdio ? 'stdio' : target}${modeLabel}${assignLabel}${blocksLabel}`));
                }

            // ── /mcp remove <name> ────────────────────────────────────────────
            } else if (sub === 'remove' || sub === 'rm') {
                const name = parts[2];
                if (!name) {
                    emit(col(c.gray, '  Usage: /mcp remove <name>'));
                } else {
                    const current = loader.load();
                    const before  = (current.mcpServers ?? []).length;
                    const servers = (current.mcpServers ?? []).filter(s => s.name !== name);
                    if (servers.length === before) {
                        emit(col(c.yellow, `  Server "${name}" not found.`));
                    } else {
                        loader.save({ ...current, mcpServers: servers });
                        // Unregister at runtime — no restart needed
                        engine.unregisterMCPServer(name);
                        emit(col(c.green, `  Removed "${name}" — tools and command blocks reverted.`));
                    }
                }

            } else {
                emit(col(c.gray, '  Usage: /mcp [list|tools|add|remove]'));
                emit(col(c.gray, '    /mcp add <name> <url> [--mode tools|agent] [--assign agent1,agent2]'));
                emit(col(c.gray, '    /mcp remove <name>'));
            }

            rl.prompt();
            return;
        }

        // ── /agent ────────────────────────────────────────────────────────────
        if (input.startsWith('/agent')) {
            const [, sub, ...rest] = input.split(/\s+/);

            if (!sub || sub === 'list') {
                const all = AgentLoader.load({ appName: APP_NAME, cwd: currentCwd, builtins: CODING_AGENTS });
                const grp: Record<string, AgentProfile[]> = { project: [], global: [], builtin: [] };
                for (const a of all) grp[a.source ?? 'builtin'].push(a);
                const fmt = (a: AgentProfile) =>
                    `  ${a.icon}  ${a.id.padEnd(20)} ${col(c.gray, (a.description ?? '').slice(0, 44))}`;
                for (const [src, list] of Object.entries(grp)) {
                    if (list.length) { emit(col(c.bold, `\n  ${src}`)); list.forEach(a => emit(fmt(a))); }
                }
                emit('');
            } else if (sub === 'new') {
                const id       = rest.find(s => !s.startsWith('--'));
                const isGlobal = rest.includes('--global');
                if (!id) { emit('  Usage: /agent new <id> [--global]'); }
                else {
                    AgentLoader.scaffold(id, { appName: APP_NAME, cwd: currentCwd, scope: isGlobal ? 'global' : 'project' });
                    const dirs = AgentLoader.dirs(APP_NAME, currentCwd);
                    const dir  = isGlobal ? dirs.global : dirs.project;
                    emit(col(c.gray, `  created ${dir}/${id}.json\n          ${dir}/${id}.md`));
                    emit(col(c.gray, '  edit the .md to write the system prompt — restart to load'));
                }
            } else {
                const all = AgentLoader.load({ appName: APP_NAME, cwd: currentCwd, builtins: CODING_AGENTS });
                if (!all.find(a => a.id === sub)) emit(`  Unknown agent "${sub}". Run /agent list.`);
                else {
                    currentAgent = sub;
                    ({ engine } = makeEngine(currentAgent, currentCwd, mcpServers));
                    emit(col(c.gray, `  switched to ${sub}`));
                }
            }
            rl.prompt();
            return;
        }

        // ── /cwd ──────────────────────────────────────────────────────────────
        if (input.startsWith('/cwd')) {
            const arg = input.slice(4).trim();
            if (!arg) emit(`  ${currentCwd}`);
            else {
                currentCwd = path.resolve(arg);
                ({ engine } = makeEngine(currentAgent, currentCwd, mcpServers));
                emit(col(c.gray, `  cwd: ${currentCwd}`));
            }
            rl.prompt();
            return;
        }

        // ── /clear ────────────────────────────────────────────────────────────
        if (input === '/clear') {
            ({ engine } = makeEngine(currentAgent, currentCwd, mcpServers));
            console.clear();
            printBanner();
            rl.prompt();
            return;
        }

        // ── /quit /exit /q ────────────────────────────────────────────────────
        if (input === '/quit' || input === '/exit' || input === '/q') {
            const mgr = engine.getMCPManager();
            if (mgr) await mgr.disconnect().catch(() => {});
            emit(col(c.gray, '  bye\n'));
            rl.close();
            process.exit(0);
        }

        // ── Built-in registry: /help /skills /status /checkpoint /workspace ───
        if (input.startsWith('/')) {
            const ctx = buildCtx(emit, currentCwd, currentAgent,
                (p) => engine.run(p),
                (newCwd) => {
                    currentCwd = newCwd;
                    ({ engine } = makeEngine(currentAgent, currentCwd, mcpServers));
                },
                { current: engine },
            );
            const handled = await registry.dispatch(input, ctx);
            if (!handled) emit(col(c.gray, `  Unknown command. Type /help to see all commands.`));
            rl.prompt();
            return;
        }

        // ── Run agent ─────────────────────────────────────────────────────────
        if (running) {
            emit(col(c.gray, '  (busy — wait for current task to finish)'));
            return;
        }

        running = true;
        rl.pause();
        try {
            await engine.run(input);
        } catch (err) {
            emit(`\n  ${col(c.red, 'Error:')} ${(err as Error).message}\n`);
        } finally {
            running = false;
            rl.resume();
            rl.prompt();
        }
    }
}

main().catch(err => { console.error(err); process.exit(1); });
