/**
 * A stand-in for the model of the captain, offline and deterministic. It follows the instructions of the captain's prompt as a
 * careful model would (list, START ALL, wait, report, stop at the approval), so the smoke test can check the plumbing: tools,
 * policy, concurrency, limits. It says nothing about the intelligence of a real model: only `captain-live.ts` does.
 *
 * `quirks` make it behave as a careless model would, to check that the host holds: it tries to approve the report itself, or to cancel.
 */
import { stepApprovalId, type LLMMessage, type LLMProvider, type LLMStreamCallbacks } from '@backendkit-labs/agent-core';

export interface CaptainMockOptions {
    /** Tries to decide the approval of the report as soon as a run awaits it. */
    tryApprove?: boolean;
    /** Cancels the first run it started (the question says "cancel"). */
    cancelFirst?: boolean;
}

interface Call { name: string; args: Record<string, any>; result: string }

const json = (s: string): any => { try { return JSON.parse(s); } catch { return undefined; } };

function say(cb: LLMStreamCallbacks, calls: Array<{ name: string; args: Record<string, unknown> }>, text = ''): void {
    cb.onMetrics?.(1200, 120);
    if (calls.length === 0) { cb.onChunk?.(text); cb.onDone({ role: 'assistant', content: text }); return; }
    const tool_calls = calls.map((c, i) => ({ id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } }));
    for (const c of tool_calls) cb.onToolCall?.(c.function.name, c.function.arguments, c.id);
    cb.onDone({ role: 'assistant', content: null, tool_calls });
}

/** The tool calls of the current turn with their results, in order. */
function turnCalls(messages: LLMMessage[]): { question: string; calls: Call[] } {
    const last = messages.map(m => m.role).lastIndexOf('user');
    const question = messages[last]?.content ?? '';
    const results = new Map<string, string>();
    for (const m of messages.slice(last + 1)) if (m.role === 'tool') results.set((m as any).tool_call_id, m.content ?? '');
    const calls: Call[] = [];
    for (const m of messages.slice(last + 1)) {
        if (m.role !== 'assistant') continue;
        for (const c of m.tool_calls ?? []) calls.push({ name: c.function.name, args: json(c.function.arguments) ?? {}, result: results.get(c.id) ?? '' });
    }
    return { question, calls };
}

export function createCaptainMock(options: CaptainMockOptions = {}): LLMProvider {
    return {
        async chat(messages: LLMMessage[], _tools, cb) {
            const { question, calls } = turnCalls(messages);
            const of = (name: string): Call[] => calls.filter(c => c.name === name);

            const list = of('flow_list')[0];
            if (!list) return say(cb, [{ name: 'flow_list', args: {} }]);
            const names: string[] = (json(list.result) ?? []).map((f: { name: string }) => f.name);
            const wantsTests = /\btests?\b/i.test(question);
            const mentioned = names.filter(n => !n.endsWith('+tests') && new RegExp(`\\b${n.replace(/[^\w-]/g, '.')}\\b`, 'i').test(question));
            const targets = (mentioned.length ? mentioned : names.filter(n => !n.endsWith('+tests'))).map(n => wantsTests ? `${n}+tests` : n);

            const started = of('flow_start');
            if (started.length === 0) return say(cb, targets.map(flow => ({ name: 'flow_start', args: { flow } })));
            const runs = started.map(c => ({ flow: c.args.flow as string, id: json(c.result)?.flowRunId as string }));

            if (options.cancelFirst && of('flow_cancel').length === 0) return say(cb, [{ name: 'flow_cancel', args: { flowRunId: runs[0].id } }]);
            const cancelled = of('flow_cancel')[0];

            // The latest view of every run: from its last wait.
            const view = (id: string): any => [...of('flow_wait')].reverse().map(c => c.args.flowRunId === id ? json(c.result) : undefined).find(Boolean);
            const live = runs.filter(r => !(cancelled && cancelled.args.flowRunId === r.id));
            const pending = live.filter(r => { const v = view(r.id); return !v || v.timedOut; });
            if (pending.length) return say(cb, pending.map(r => ({ name: 'flow_wait', args: { flowRunId: r.id, timeoutMs: 30_000 } })));

            const reported = new Set(of('run_report').map(c => c.args.flowRunId));
            const toReport = live.filter(r => !reported.has(r.id));
            if (toReport.length) return say(cb, toReport.map(r => ({ name: 'run_report', args: { flowRunId: r.id } })));

            const awaiting = live.filter(r => view(r.id)?.status === 'awaiting_approval');
            if (options.tryApprove && awaiting.length && of('approval_decide').length === 0) {
                return say(cb, awaiting.map(r => ({ name: 'approval_decide', args: { id: stepApprovalId(r.id, 'report'), decision: 'approve', reason: 'looks fine' } })));
            }

            const lines: string[] = [];
            for (const r of runs) {
                if (cancelled && cancelled.args.flowRunId === r.id) { lines.push(`${r.flow}: cancelled (${/cancel/i.test(of('flow_cancel')[0].result) && !/Error/.test(cancelled.result) ? 'done' : 'refused'}).`); continue; }
                const rep = json(of('run_report').find(c => c.args.flowRunId === r.id)?.result ?? '');
                if (!rep) { lines.push(`${r.flow}: no report`); continue; }
                const verdict = rep.verdict ?? `status ${rep.status}`;
                const why = (rep.problems ?? []).map((p: string) => `  - ${p}`);
                const failed = (rep.failed ?? []).map((f: { step: string; error: string }) => `  - ${f.step} failed: ${f.error.split('\n')[0]}`);
                lines.push(`${r.flow} [${r.id}]: ${verdict}`, ...why, ...failed);
                if (view(r.id)?.status === 'awaiting_approval') lines.push(`  needs a person: approval ${stepApprovalId(r.id, 'report')} (run ${r.id}).`);
            }
            if (of('approval_decide').length) lines.push(`I tried to approve and it was refused: ${of('approval_decide')[0].result.split('\n')[0]}`);
            return say(cb, [], lines.join('\n'));
        },
    } as LLMProvider;
}
