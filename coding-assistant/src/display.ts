import type { AgentEvent } from '@bk/agent-core';

// ── ANSI ──────────────────────────────────────────────────────────────────────
const c = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    green:   '\x1b[32m',
    cyan:    '\x1b[36m',
    yellow:  '\x1b[33m',
    red:     '\x1b[31m',
    magenta: '\x1b[35m',
    gray:    '\x1b[90m',
    white:   '\x1b[97m',
};
const col = (clr: string, s: string) => `${clr}${s}${c.reset}`;

// ── InlineSpinner ─────────────────────────────────────────────────────────────
// Uses \r to overwrite the current line — no cursor manipulation, safe with readline.
// Rule: always call stop() before any console.log / process.stdout.write(\n).
const FRAMES = {
    thinking: ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'],   // braille — AI thinking
    tool:     ['◐','◓','◑','◒'],                                 // circle — processing
    route:    ['·  ','·· ','···','→  '],                         // dots → arrow — routing
};

class InlineSpinner {
    private timer: ReturnType<typeof setInterval> | null = null;
    private frame = 0;
    private frames: string[] = [];
    private line  = '';

    start(type: keyof typeof FRAMES, text: string, color = c.gray): void {
        this.stop();
        this.frames = FRAMES[type];
        this.frame  = 0;
        this.line   = text;
        const clr   = color;
        this.timer  = setInterval(() => {
            const f = this.frames[this.frame % this.frames.length];
            this.frame++;
            process.stdout.write(`\r  ${clr}${f}${c.reset} ${col(c.dim, this.line)}`);
        }, type === 'route' ? 120 : 80);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            process.stdout.write('\r\x1b[K');   // clear line
        }
    }

    get active(): boolean { return this.timer !== null; }
}

const spinner = new InlineSpinner();

// ── State ─────────────────────────────────────────────────────────────────────
let isStreaming  = false;
let streamBuffer = '';
let blockStart   = 0;
let runInput     = 0;
let runOutput    = 0;
let runCost      = 0;

// Orchestrator routing suppression
let orchestratorMode = false;
let orchHeader       = '';
let orchTokenBuffer  = '';
let didDelegate      = false;

function flushStream(): void {
    spinner.stop();
    if (streamBuffer) {
        process.stdout.write('\n');
        streamBuffer = '';
    }
    isStreaming = false;
}

function print(line: string): void {
    spinner.stop();
    console.log(line);
}

// ── Event renderer ────────────────────────────────────────────────────────────
export function renderEvent(event: AgentEvent, orchestratorId = 'general'): void {
    switch (event.type) {

        case 'ready':
            runInput = runOutput = runCost = 0;
            break;

        case 'block_start':
            flushStream();
            blockStart = Date.now();

            if (event.agent_id === orchestratorId) {
                orchestratorMode = true;
                didDelegate      = false;
                orchTokenBuffer  = '';
                orchHeader       =
                    `\n${col(c.bold + c.cyan, `  ${event.agent_icon ?? '◆'}  ${event.agent_name ?? event.agent_id}`)}` +
                    `\n${col(c.gray, '  ' + '─'.repeat(50))}`;
                spinner.start('thinking', 'thinking…');
            } else {
                orchestratorMode = false;
                print(`\n${col(c.bold + c.cyan, `  ${event.agent_icon ?? '◆'}  ${event.agent_name ?? event.agent_id}`)}`);
                print(col(c.gray, '  ' + '─'.repeat(50)));
            }
            break;

        case 'block_end': {
            flushStream();
            const elapsed = blockStart ? ` ${((Date.now() - blockStart) / 1000).toFixed(1)}s` : '';

            if (orchestratorMode && !didDelegate) {
                print(orchHeader);
                if (orchTokenBuffer.trim()) process.stdout.write('  ' + orchTokenBuffer + '\n');
            }

            orchestratorMode = false;
            didDelegate      = false;
            orchTokenBuffer  = '';

            print(col(c.gray, '  ' + '─'.repeat(50) + elapsed));
            break;
        }

        case 'token':
            if (orchestratorMode) {
                orchTokenBuffer += event.content;
            } else {
                if (!isStreaming) {
                    spinner.stop();
                    process.stdout.write('  ');
                    isStreaming = true;
                }
                streamBuffer += event.content;
                process.stdout.write(event.content);
            }
            break;

        case 'tool_call':
            flushStream();
            if (event.name === 'ask_agent') break;
            spinner.start('tool', event.name, c.cyan);
            break;

        case 'tool_result': {
            if (event.name === 'ask_agent') break;
            spinner.stop();
            const preview = event.preview ? col(c.gray, `  ${event.preview.slice(0, 80)}`) : '';
            print(
                `  ${event.success ? col(c.green, '◈') : col(c.red, '✗')} ${col(c.dim, event.name)}${preview}`,
            );
            break;
        }

        case 'agent_switch': {
            flushStream();
            didDelegate = true;
            const label = `${orchestratorId}  →  ${event.to_icon ?? '◆'} ${event.to_name ?? event.to}`;
            spinner.start('route', label, c.cyan);
            // After route animation completes one cycle, print the static arrow
            setTimeout(() => {
                spinner.stop();
                const arrow   = col(c.gray, '→');
                const tgtIcon = col(c.cyan, event.to_icon ?? '◆');
                const tgtName = col(c.white, event.to_name ?? event.to);
                process.stdout.write(`\n  ${col(c.dim, '◆')} ${col(c.dim, orchestratorId)}  ${arrow}  ${tgtIcon} ${tgtName}\n`);
            }, FRAMES.route.length * 120 + 40);
            break;
        }

        case 'metrics':
            runInput  += event.input_tokens;
            runOutput += event.output_tokens;
            if (event.cost_usd) runCost += event.cost_usd;
            break;

        case 'done':
            flushStream();
            if (runInput + runOutput > 0) {
                const costStr = runCost > 0 ? `  $${runCost.toFixed(4)}` : '';
                print(col(c.gray, `  ↑${runInput.toLocaleString()} ↓${runOutput.toLocaleString()} tokens${costStr}`));
            }
            print(col(c.green, '\n  ✓ done\n'));
            break;

        case 'error':
            flushStream();
            print(`\n  ${col(c.red, '✗')} ${event.message}\n`);
            break;

        case 'system':
            flushStream();
            if (event.level === 'info') break;
            print(`  ${event.level === 'error' ? col(c.red, '✗') : col(c.yellow, '⚠')} ${col(c.gray, event.text)}`);
            break;

        case 'thinking':
            print(`  ${col(c.gray, `… ${event.label}`)}`);
            break;

        // ── Workflow events ───────────────────────────────────────────────────

        case 'workflow_start':
            flushStream();
            print(`\n  ${col(c.bold + c.magenta, '⬡')} ${col(c.bold, `workflow: ${event.name}`)}`);
            print(col(c.gray, '  ' + '─'.repeat(50)));
            break;

        case 'workflow_step_start':
            flushStream();
            print(`  ${col(c.magenta, '→')} ${col(c.dim, `${event.step}  (${event.agent})`)}`);
            break;

        case 'workflow_step_complete':
            flushStream();
            print(`  ${event.success ? col(c.green, '✓') : col(c.red, '✗')} ${col(c.dim, event.step)}`);
            break;

        case 'workflow_approval_required':
            flushStream();
            print(`\n  ${col(c.yellow, '⏸')} ${col(c.bold, `approval required: ${event.step}`)}`);
            break;

        case 'workflow_complete':
            flushStream();
            print(
                `\n  ${event.status === 'completed' ? col(c.green, '✓') : col(c.red, '✗')}` +
                ` ${col(c.bold, `workflow ${event.name}: ${event.status}`)}\n`,
            );
            break;
    }
}
