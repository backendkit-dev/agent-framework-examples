import type { AgentEvent } from '@bk/agent-core';
import { AnimationManager, AnimationType, Presets } from '@backendkit-labs/console-animations';

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

const mgr = new AnimationManager();

// ── Animation helpers ─────────────────────────────────────────────────────────
function toolAnimation(name: string) {
    if (name.startsWith('mcp__')) {
        return mgr.start({ type: AnimationType.DOTS,  text: name, color: 'cyan'  });
    }
    if (name === 'run_command') {
        return mgr.start(Presets.stream(name));
    }
    return mgr.start({ type: AnimationType.DOTS, text: name, color: 'gray' });
}

// ── State ─────────────────────────────────────────────────────────────────────
let isStreaming    = false;
let streamBuffer   = '';
let blockStart     = 0;
let runInput       = 0;
let runOutput      = 0;
let runCost        = 0;

// Orchestrator routing suppression
let orchestratorMode = false;
let orchHeader       = '';
let orchTokenBuffer  = '';
let didDelegate      = false;
let thinkingAnimId: string | null = null;

// Active tool animation (most recent tool_call waiting for its tool_result)
let activeToolAnimId: string | null = null;

function flushStream(): void {
    if (streamBuffer) {
        process.stdout.write('\n');
        streamBuffer = '';
    }
    isStreaming = false;
}

function stopThinking() {
    if (thinkingAnimId) {
        mgr.stop(thinkingAnimId);
        thinkingAnimId = null;
    }
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

                // Pulse while the orchestrator decides what to do
                thinkingAnimId = mgr.start({
                    type:  AnimationType.PULSE,
                    text:  'thinking',
                    color: 'gray',
                }).id;
            } else {
                orchestratorMode = false;
                console.log(`\n${col(c.bold + c.cyan, `  ${event.agent_icon ?? '◆'}  ${event.agent_name ?? event.agent_id}`)}`);
                console.log(col(c.gray, '  ' + '─'.repeat(50)));
            }
            break;

        case 'block_end': {
            flushStream();
            stopThinking();
            const elapsed = blockStart ? ` ${((Date.now() - blockStart) / 1000).toFixed(1)}s` : '';

            if (orchestratorMode && !didDelegate) {
                console.log(orchHeader);
                if (orchTokenBuffer.trim()) {
                    process.stdout.write('  ' + orchTokenBuffer + '\n');
                }
            }

            orchestratorMode = false;
            didDelegate      = false;
            orchTokenBuffer  = '';

            console.log(col(c.gray, '  ' + '─'.repeat(50) + elapsed));
            break;
        }

        case 'token':
            if (orchestratorMode) {
                orchTokenBuffer += event.content;
            } else {
                if (!isStreaming) {
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
            stopThinking();
            activeToolAnimId = toolAnimation(event.name).id;
            break;

        case 'tool_result':
            if (event.name === 'ask_agent') break;
            if (activeToolAnimId) {
                event.success
                    ? mgr.succeed(activeToolAnimId, event.preview?.slice(0, 80) ?? event.name)
                    : mgr.fail(activeToolAnimId,    event.preview?.slice(0, 80) ?? event.name);
                activeToolAnimId = null;
            }
            break;

        case 'agent_switch': {
            flushStream();
            stopThinking();
            didDelegate = true;

            // Brief worm animation to convey routing movement
            const worm = mgr.start({
                type:  AnimationType.WORM,
                text:  `${orchestratorId} → ${event.to_name ?? event.to}`,
                color: 'cyan',
                speed: 60,
            });
            setTimeout(() => {
                mgr.stop(worm.id);
                const arrow   = col(c.gray, '→');
                const srcIcon = col(c.dim, '◆');
                const tgtIcon = col(c.cyan, event.to_icon ?? '◆');
                const tgtName = col(c.white, event.to_name ?? event.to);
                console.log(`\n  ${srcIcon} ${col(c.dim, orchestratorId)}  ${arrow}  ${tgtIcon} ${tgtName}`);
            }, 600);
            break;
        }

        case 'metrics':
            runInput  += event.input_tokens;
            runOutput += event.output_tokens;
            if (event.cost_usd) runCost += event.cost_usd;
            break;

        case 'done':
            flushStream();
            stopThinking();
            if (runInput + runOutput > 0) {
                const costStr = runCost > 0 ? `  $${runCost.toFixed(4)}` : '';
                console.log(col(c.gray, `  ↑${runInput.toLocaleString()} ↓${runOutput.toLocaleString()} tokens${costStr}`));
            }
            console.log(col(c.green, '\n  ✓ done\n'));
            break;

        case 'error':
            flushStream();
            stopThinking();
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
            console.log(`\n  ${col(c.yellow, '⏸')} ${col(c.bold, `approval required: ${event.step}`)}`);
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
