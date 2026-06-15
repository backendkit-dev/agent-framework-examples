// Parses the text output from orchestrator MCP tools into structured JSON.

export interface GateHit {
    status:  'waiting_gate';
    run_id:  string;
    gate: {
        step:     string;
        agent:    string;
        output:   string;
        criteria: string[];
    };
}

export interface FlowComplete {
    status: 'completed';
    ok:     number;
    errors: number;
    steps:  Array<{ id: string; agent: string; success: boolean; output: string }>;
}

export interface StepFailed {
    status:      'waiting_retry';
    run_id:      string;
    failed_step: string;
    error:       string;
}

export type FlowResult = GateHit | FlowComplete | StepFailed;

export function parseFlowResult(text: string): FlowResult {
    // ── Gate hit ──────────────────────────────────────────────────────────────
    const gateM = text.match(/Gate reached at step "([^"]+)" \(agent: ([^)]+)\)/);
    if (gateM) {
        const run_id   = text.match(/Run ID:\s*([a-f0-9-]{36})/i)?.[1] ?? '';
        const outputM  = text.match(/Agent output:\n([\s\S]*?)(?:\n\nCriteria:|$)/);
        const critM    = text.match(/Criteria:\n([\s\S]*?)(?:\n\nApprove:|$)/);
        const criteria = (critM?.[1] ?? '')
            .split('\n')
            .map(l => l.replace(/^\s*[•\-]\s*/, '').trim())
            .filter(Boolean);
        return {
            status: 'waiting_gate',
            run_id,
            gate: { step: gateM[1], agent: gateM[2], output: outputM?.[1]?.trim() ?? '', criteria },
        };
    }

    // ── Step failed / waiting retry ───────────────────────────────────────────
    const failM = text.match(/Step '([^']+)'.*?failed/i);
    if (failM) {
        const run_id = text.match(/Run ID:\s*([a-f0-9-]{36})/i)?.[1] ?? '';
        const errM   = text.match(/Error:\s*(.+)/);
        return { status: 'waiting_retry', run_id, failed_step: failM[1], error: errM?.[1] ?? text };
    }

    // ── Flow complete ─────────────────────────────────────────────────────────
    const summaryM = text.match(/Flow complete — (\d+) ok, (\d+) errors?/);
    const steps: FlowComplete['steps'] = [];
    // Split at each step line so multiline outputs (markdown) are preserved
    const parts = text.split(/\n(?=\[(?:✓|✗)\] )/);
    for (const part of parts) {
        const m = part.match(/^\[(✓|✗)\] (\S+) \(([^)]+)\): ([\s\S]*)/);
        if (m) steps.push({ id: m[2], agent: m[3], success: m[1] === '✓', output: m[4].trim() });
    }
    return {
        status: 'completed',
        ok:     parseInt(summaryM?.[1] ?? '0', 10),
        errors: parseInt(summaryM?.[2] ?? '0', 10),
        steps,
    };
}
