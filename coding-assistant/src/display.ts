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
};
const col = (clr: string, s: string) => `${clr}${s}${c.reset}`;

// ── State ─────────────────────────────────────────────────────────────────────
let isStreaming    = false;
let streamBuffer   = '';
let blockStart     = 0;
let runInput       = 0;
let runOutput      = 0;
let runCost        = 0;

function flushStream(): void {
    if (streamBuffer) {
        process.stdout.write('\n');
        streamBuffer = '';
    }
    isStreaming = false;
}

// ── Event renderer ────────────────────────────────────────────────────────────
export function renderEvent(event: AgentEvent): void {
    switch (event.type) {

        case 'ready':
            runInput = runOutput = runCost = 0;
            break;

        case 'block_start':
            flushStream();
            blockStart = Date.now();
            console.log(`\n${col(c.bold + c.cyan, `  ${event.agent_icon ?? '◆'}  ${event.agent_name ?? event.agent_id}`)}`);
            console.log(col(c.gray, '  ' + '─'.repeat(50)));
            break;

        case 'block_end': {
            flushStream();
            const elapsed = blockStart ? ` ${((Date.now() - blockStart) / 1000).toFixed(1)}s` : '';
            console.log(col(c.gray, '  ' + '─'.repeat(50) + elapsed));
            break;
        }

        case 'token':
            if (!isStreaming) {
                process.stdout.write('  ');
                isStreaming = true;
            }
            streamBuffer += event.content;
            process.stdout.write(event.content);
            break;

        case 'tool_call':
            flushStream();
            console.log(
                `  ${col(c.yellow, '◌')} ${col(c.dim, event.name)}` +
                (event.args_preview ? col(c.gray, `  ${event.args_preview.slice(0, 64)}`) : ''),
            );
            break;

        case 'tool_result':
            console.log(
                `  ${event.success ? col(c.green, '◈') : col(c.red, '✗')} ${col(c.dim, event.name)}` +
                (event.preview ? col(c.gray, `  ${event.preview.slice(0, 80)}`) : ''),
            );
            break;

        case 'metrics':
            runInput  += event.input_tokens;
            runOutput += event.output_tokens;
            if (event.cost_usd) runCost += event.cost_usd;
            break;

        case 'done':
            flushStream();
            if (runInput + runOutput > 0) {
                const costStr = runCost > 0 ? `  $${runCost.toFixed(4)}` : '';
                console.log(col(c.gray, `  ↑${runInput.toLocaleString()} ↓${runOutput.toLocaleString()} tokens${costStr}`));
            }
            console.log(col(c.green, '\n  ✓ done\n'));
            break;

        case 'error':
            flushStream();
            console.log(`\n  ${col(c.red, '✗')} ${event.message}\n`);
            break;

        case 'system':
            flushStream();
            if (event.level === 'info') break;
            console.log(`  ${event.level === 'error' ? col(c.red, '✗') : col(c.yellow, '⚠')} ${col(c.gray, event.text)}`);
            break;

        case 'thinking':
            console.log(`  ${col(c.gray, `… ${event.label}`)}`);
            break;

        // ── Workflow events ───────────────────────────────────────────────────

        case 'workflow_start':
            flushStream();
            console.log(`\n  ${col(c.bold + c.magenta, '⬡')} ${col(c.bold, `workflow: ${event.name}`)}`);
            console.log(col(c.gray, '  ' + '─'.repeat(50)));
            break;

        case 'workflow_step_start':
            flushStream();
            console.log(`  ${col(c.magenta, '→')} ${col(c.dim, `${event.step}  (${event.agent})`)}`);
            break;

        case 'workflow_step_complete':
            flushStream();
            console.log(`  ${event.success ? col(c.green, '✓') : col(c.red, '✗')} ${col(c.dim, event.step)}`);
            break;

        case 'workflow_approval_required':
            flushStream();
            console.log(`\n  ${col(c.yellow, '⏸')} ${col(c.bold, `approval required: ${event.step}`)}\n`);
            break;

        case 'workflow_complete':
            flushStream();
            console.log(
                `\n  ${event.status === 'completed' ? col(c.green, '✓') : col(c.red, '✗')}` +
                ` ${col(c.bold, `workflow ${event.name}: ${event.status}`)}\n`,
            );
            break;
    }
}
