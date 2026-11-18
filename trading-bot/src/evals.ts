/**
 * The bench evaluated with the evaluation harness of agent-testkit (SPEC-0021 F5): does learning from a refusal change what the bot does?
 *
 * The harness runs one `engine.run` per run of a case. A simulation is a whole episode: one engine over many bars, in a world that
 * moves. So each run here is one simulation (one seed), wrapped as an engine whose `run` plays the episode and returns what happened as
 * a `RunResult`. The suite only needs `run`, so this takes no change in the harness, but it shows what is missing (see FINDINGS).
 *
 * Run: `npm run evals`. Offline: the mock trader, no model, no network.
 */
import type { AgentEngine, RunResult, RunToolCall } from '@backendkit-labs/agent-core';
import { evalSuite, compare, formatReport, formatComparison, grader, type EvalCase } from '@backendkit-labs/agent-testkit';
import { runSimulation, modes, type SimReport } from './sim';

const BARS = 180;

/** What a simulation did, as the result of one run: every tool call of every session, a refused order marked with its code. */
function asRunResult(r: SimReport): RunResult {
    const toolCalls: RunToolCall[] = r.sessions.flatMap(s => s.tools.map((t): RunToolCall => {
        const refused = /\(refused(?: (\w+))?\)/.exec(t);
        return { name: t.split(' ')[0], success: !refused, ...(refused?.[1] ? { errorCode: refused[1] } : {}) };
    }));
    return { text: `equity ${r.finalEquity.toFixed(0)}, ${r.trades.length} trades`, toolCalls, errors: [], aborted: false, budgetExceeded: false, systemPrompts: [] };
}

interface Config { learning: boolean; memory: boolean; approve: boolean }

/** An engine that plays one simulation per `run` and reports it. The suite hands the seed to `build`: the market is simulated, so it is the seed. */
const episodeEngine = (config: Config, seed: number): AgentEngine => ({
    run: async (): Promise<RunResult> => asRunResult(await runSimulation({ seed, bars: BARS, provider: modes.oversized(), ...config })),
}) as unknown as AgentEngine;

const refusals = (r: RunResult) => r.toolCalls.filter(t => t.name === 'place_order' && !t.success);

const cases: EvalCase[] = [
    {
        id: 'an oversized bot learns the limit', input: 'trade the simulated market',
        expect: [
            grader('at most 3 refused orders in the run', r => ({ pass: refusals(r).length <= 3, note: `${refusals(r).length} refused` })),
            grader('no refused order in the last third of the run', r => {
                const orders = r.toolCalls.filter(t => t.name === 'place_order');
                const late = orders.slice(Math.floor((orders.length * 2) / 3)).filter(t => !t.success);
                return { pass: late.length === 0, note: `${late.length} refused late` };
            }),
        ],
    },
];

async function main(): Promise<void> {
    const run = (name: string, config: Config) => evalSuite({ name, cases, repeat: 4, seed: 1, build: (_c, info) => episodeEngine(config, info.seed) });
    console.log(`${BARS} bars per run, 4 seeds per configuration, offline mock trader that asks for 40% of the equity\n`);
    const without = await run('no learning', { learning: false, memory: false, approve: false });
    console.log(formatReport(without), '\n');
    const withLearning = await run('learning + approval', { learning: true, memory: true, approve: true });
    console.log(formatReport(withLearning), '\n');
    console.log(formatComparison(compare(without, withLearning)));
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
