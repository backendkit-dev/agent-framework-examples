/**
 * What each agent of the audit does. The scanning is deterministic computation, not a model: an exhaustive audit reads every
 * record, and that is not what a language model is for. A model would come in where judgment and prose are needed (the verifier's
 * doubtful cases, the report); the flow does not care which one an agent is.
 */
import { APPROVAL_OVER, NORMS, OUTLIER_FACTOR, SPLIT_ITEM_MAX, type Kind, type Rec } from './dataset';

export interface Candidate { kind: Kind; ids: number[]; amount: number; evidence: string }
/** The compact row a shard hands to the consolidation: everything it needs to see across shards, nothing else. */
export type IndexRow = [id: number, employee: string, vendor: string, amount: number, date: string];
export interface ShardOut { shard: number; count: number; local: Candidate[]; index: IndexRow[] }

export const keyOf = (c: { kind: string; ids: number[] }): string => `${c.kind}:${[...c.ids].sort((a, b) => a - b).join(',')}`;

// ── scanner: one shard, every record ─────────────────────────────────────────

export function scanShard(shard: number, records: Rec[]): ShardOut {
    const local: Candidate[] = [];
    for (const r of records) {
        if (r.amount > OUTLIER_FACTOR * NORMS[r.category].max) {
            local.push({ kind: 'outlier', ids: [r.id], amount: r.amount, evidence: `${r.amount} for ${r.category}, usual maximum ${NORMS[r.category].max}` });
        }
        if (r.amount > APPROVAL_OVER && !r.approvedBy) {
            local.push({ kind: 'missing_approval', ids: [r.id], amount: r.amount, evidence: `${r.amount} without an approver` });
        }
        if (r.approvedBy === r.employee && r.amount > APPROVAL_OVER) {
            local.push({ kind: 'self_approval', ids: [r.id], amount: r.amount, evidence: `${r.employee} approved their own ${r.amount}` });
        }
    }
    return { shard, count: records.length, local, index: records.map(r => [r.id, r.employee, r.vendor, r.amount, r.date] as IndexRow) };
}

// ── consolidator: what only shows across shards ──────────────────────────────

export function consolidate(outs: ShardOut[]): Candidate[] {
    const out: Candidate[] = outs.flatMap(o => o.local);
    const rows = outs.flatMap(o => o.index);
    // Same employee, vendor and amount more than once: a possible duplicate (the verifier tells it from a subscription).
    const byFp = new Map<string, IndexRow[]>();
    for (const r of rows) { const k = `${r[1]}|${r[2]}|${r[3]}`; byFp.set(k, [...(byFp.get(k) ?? []), r]); }
    for (const g of byFp.values()) {
        if (g.length > 1) out.push({ kind: 'duplicate', ids: g.map(r => r[0]).sort((a, b) => a - b), amount: g[0][3], evidence: `${g.length} entries of ${g[0][3]} by ${g[0][1]} at ${g[0][2]}` });
    }
    // Several small items, same employee, vendor and day, that add up to more than the approval threshold.
    const byDay = new Map<string, IndexRow[]>();
    for (const r of rows) {
        if (r[3] > SPLIT_ITEM_MAX) continue;
        const k = `${r[1]}|${r[2]}|${r[4]}`; byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
    for (const g of byDay.values()) {
        const sum = g.reduce((a, r) => a + r[3], 0);
        if (g.length > 1 && sum > APPROVAL_OVER) out.push({ kind: 'split_purchase', ids: g.map(r => r[0]).sort((a, b) => a - b), amount: sum, evidence: `${g.length} items of up to ${SPLIT_ITEM_MAX} adding ${sum} on ${g[0][4]}` });
    }
    return out.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

// ── verifier: does not trust the scanner, reads the records again ────────────

const days = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export interface Verdict { confirmed: Candidate[]; cleared: Array<{ candidate: Candidate; reason: string }> }

export function verify(candidates: Candidate[], fetch: (ids: number[]) => Rec[]): Verdict {
    const confirmed: Candidate[] = []; const cleared: Verdict['cleared'] = [];
    for (const c of candidates) {
        const recs = fetch(c.ids);
        let ok = false; let reason = '';
        switch (c.kind) {
            case 'outlier': ok = recs.length === 1 && recs[0].amount > OUTLIER_FACTOR * NORMS[recs[0].category].max; reason = 'within the usual range'; break;
            case 'missing_approval': ok = recs.length === 1 && recs[0].amount > APPROVAL_OVER && !recs[0].approvedBy; reason = 'it has an approver'; break;
            case 'self_approval': ok = recs.length === 1 && recs[0].approvedBy === recs[0].employee; reason = 'approved by someone else'; break;
            case 'split_purchase': ok = recs.length > 1 && recs.every(r => r.amount <= SPLIT_ITEM_MAX && r.employee === recs[0].employee && r.vendor === recs[0].vendor && r.date === recs[0].date) && recs.reduce((a, r) => a + r.amount, 0) > APPROVAL_OVER; reason = 'the items do not add up to more than the threshold'; break;
            case 'duplicate': {
                const dates = recs.map(r => r.date).sort();
                if (dates.every(d => d === dates[0])) ok = true;
                else {
                    const gaps = dates.slice(1).map((d, i) => days(dates[i], d));
                    reason = gaps.every(g => g >= 27 && g <= 32) ? 'a monthly recurring charge' : 'different dates';
                }
                break;
            }
        }
        if (ok) confirmed.push(c); else cleared.push({ candidate: c, reason });
    }
    return { confirmed, cleared };
}

/** The text a step hands on. The header is what a condition reads. */
export const verifyText = (v: Verdict): string => `VERIFY: ${v.confirmed.length} CONFIRMED, ${v.cleared.length} CLEARED\n${JSON.stringify(v)}`;
export const parseVerify = (text: string): Verdict => JSON.parse(text.slice(text.indexOf('\n') + 1)) as Verdict;

// ── writer ───────────────────────────────────────────────────────────────────

export function report(v: Verdict): string {
    const byKind = new Map<string, Candidate[]>();
    for (const c of v.confirmed) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
    const exposure = v.confirmed.reduce((a, c) => a + c.amount, 0);
    const lines = ['# Audit report', '', `${v.confirmed.length} findings confirmed, ${v.cleared.length} candidates cleared. Amount involved: ${exposure}.`, ''];
    for (const [kind, list] of [...byKind].sort()) {
        lines.push(`## ${kind} (${list.length})`);
        for (const c of [...list].sort((a, b) => b.amount - a.amount).slice(0, 3)) lines.push(`- records ${c.ids.join(', ')}: ${c.evidence}`);
        if (list.length > 3) lines.push(`- ... and ${list.length - 3} more`);
        lines.push('');
    }
    const reasons = new Map<string, number>();
    for (const x of v.cleared) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1);
    if (reasons.size) lines.push('Cleared: ' + [...reasons].map(([r, n]) => `${n} (${r})`).join(', '));
    return lines.join('\n');
}
