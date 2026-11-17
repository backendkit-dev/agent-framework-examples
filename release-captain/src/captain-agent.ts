/**
 * The captain: a model that supervises release checks. It is the engine of `@backendkit-labs/agent-core` with the tools of
 * `captain-host.ts` and a policy that says what it may do alone:
 *
 *  - start, pause, resume, wait, read, describe: yes, alone (that is the job);
 *  - cancel a run: only if a person says so (destructive: the policy asks a human, `confirm`);
 *  - decide an approval: never (denied by the policy, and the tool itself decides as a "service", which a human-only approval refuses).
 */
import {
    createBaseEngine, type AgentProfile, type BaseEngineOptions, type LLMProvider, type Principal, type RunResult, type ToolPolicy,
} from '@backendkit-labs/agent-core';
import { mockTransport } from '@backendkit-labs/agent-testkit';
import type { CaptainHost } from './captain-host';

export const CAPTAIN_PROMPT = `You are the release captain of one or more npm monorepos. You answer "is this ready to publish?" with evidence, by running the release checks the host offers as flows. You publish nothing and you never decide an approval: a person does.

How you work:
- flow_list shows the checks (one flow per monorepo, and "<name>+tests" to run every package's tests too). monorepo_info is a cheap look at a monorepo's packages and range problems, without building.
- To check several monorepos, START ALL OF THEM FIRST (flow_start for each), then wait. They run at the same time and share the machine's caps; do not wait for one before starting the next.
- Wait with flow_wait (it blocks up to 60 s per call; call it again if timedOut is true). Never poll flow_status in a loop.
- When a run stops, read it with run_report: the verdict, its problems, the plan, the error of each failed step. Explain WHAT is wrong and WHAT to do, in the words of the report; do not invent causes.
- A run ends "awaiting_approval" when the plan is sound: it needs a person. Tell the person the run id and the approval id (approval_list / approval_get show what they would approve) and stop there. You cannot approve it, so do not try. After a person says they approved it, flow_resume the run and report the result.
- If a run failed because of something the person fixes (a build error), say so; once they fixed it, flow_resume the same run: only what was left is built again.
- flow_cancel only when the person asks for it.
Be brief: the answer first (ready / blocked / failed), then the reasons, then what to do next.`;

export const CAPTAIN_TOOLS = [
    'flow_list', 'flow_start', 'flow_status', 'flow_wait', 'flow_pause', 'flow_resume', 'flow_cancel',
    'approval_list', 'approval_get', 'approval_decide', 'monorepo_info', 'run_report',
];

export const captainProfile: AgentProfile = {
    id: 'captain', name: 'Release captain', description: 'Supervises release checks of npm monorepos',
    systemPrompt: CAPTAIN_PROMPT, allowedTools: CAPTAIN_TOOLS,
} as AgentProfile;

/** What the captain does alone, what a person must allow and what is never allowed. */
export const captainPolicy: ToolPolicy = {
    decide(_principal: Principal, call) {
        const name = call.tool.name;
        if (name === 'approval_decide') return { effect: 'deny', reason: 'only a person decides an approval' };
        if (name === 'flow_cancel') return { effect: 'ask', reason: 'cancelling a run cannot be undone', accepts: ['human'] };
        return { effect: 'allow' };
    },
};

export interface CaptainOptions {
    host: CaptainHost;
    provider: LLMProvider;
    /** Asked when the captain wants to cancel a run. Default: no. */
    confirm?: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
    maxIterations?: number;
    /** Tool calls of one turn that run at the same time (read-only ones: flow_wait of several runs). Default 6. */
    maxParallelTools?: number;
    workingDir?: string;
}

export function createCaptain(o: CaptainOptions) {
    const { transport } = mockTransport();
    const confirm = o.confirm ?? (async () => false);
    const engine = createBaseEngine({
        providers: { main: o.provider }, defaultProvider: 'main',
        agents: [captainProfile], defaultAgent: 'captain', tools: o.host.tools, transport,
        workingDir: o.workingDir ?? process.cwd(), iterationMode: 'auto', maxIterations: o.maxIterations ?? 24,
        maxParallelTools: o.maxParallelTools ?? 6,
        policy: captainPolicy,
        approver: {
            ref: { kind: 'human', id: 'operator' },
            request: async req => {
                const call = req.subject.kind === 'tool_call' ? (req.subject as { call: { tool: { name: string }; args: Record<string, unknown> } }).call : undefined;
                const ok = call ? await confirm(call.tool.name, call.args) : false;
                return { decision: ok ? 'approve' : 'reject', by: { kind: 'human', id: 'operator' }, reason: ok ? 'confirmed by the operator' : 'not confirmed', at: new Date().toISOString() };
            },
        },
    } as BaseEngineOptions);
    return {
        engine,
        ask: (question: string): Promise<RunResult> => engine.run(question),
    };
}
