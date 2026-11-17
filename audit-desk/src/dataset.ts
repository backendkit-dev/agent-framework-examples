/**
 * The records to audit: synthetic expense reports, deterministic from a seed, with anomalies planted and a list of what was
 * planted (the ground truth), so that the audit can be scored: nothing missed, nothing invented. Workers regenerate the same
 * data from the seed, so no process needs to share state with another.
 */
export type Category = 'travel' | 'meals' | 'software' | 'equipment' | 'training';
export type Kind = 'duplicate' | 'outlier' | 'missing_approval' | 'self_approval' | 'split_purchase';

export interface Rec {
    id: number;
    employee: string;
    dept: string;
    category: Category;
    vendor: string;
    amount: number;
    date: string;
    approvedBy: string | null;
}

/** What a normal expense of each category costs. */
export const NORMS: Record<Category, { min: number; max: number }> = {
    travel: { min: 120, max: 900 }, meals: { min: 15, max: 90 }, software: { min: 20, max: 300 },
    equipment: { min: 80, max: 1200 }, training: { min: 100, max: 800 },
};
/** Policy: above this amount somebody else must have approved it. */
export const APPROVAL_OVER = 500;
/** Policy: items at or below this need no approval, so splitting one purchase into several of them is how it is dodged. */
export const SPLIT_ITEM_MAX = 250;
/** An amount this many times the usual maximum of its category is an outlier. */
export const OUTLIER_FACTOR = 3;

export interface Dataset {
    seed: number;
    records: Rec[];
    /** `kind:id,id` of everything planted that the audit should confirm. */
    truth: string[];
    /** Recurring subscriptions: they look like duplicates (same employee, vendor and amount) but are legitimate. */
    decoys: number;
}

export function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const CATEGORIES = Object.keys(NORMS) as Category[];
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const dayOf = (offset: number): string => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);

export interface GenerateOptions {
    seed: number;
    /** Ordinary records, before the planted ones. */
    records?: number;
    employees?: number;
    vendors?: number;
    /** Counts of what to plant. */
    plant?: Partial<Record<Kind, number>> & { decoys?: number };
}

interface Draft { rec: Omit<Rec, 'id'>; tag?: { kind: Kind; group: string } }

export function generate(o: GenerateOptions): Dataset {
    const rand = prng(o.seed);
    const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    const n = o.records ?? 2400;
    const employees = o.employees ?? 60;
    const vendors = o.vendors ?? 25;
    const plant = { duplicate: 20, outlier: 15, missing_approval: 15, self_approval: 10, split_purchase: 8, decoys: 10, ...(o.plant ?? {}) };
    const emp = (): string => `E${pad(int(0, employees - 1))}`;
    const ven = (): string => `V${pad(int(0, vendors - 1))}`;
    const manager = (e: string): string => `M${Number(e.slice(1)) % 8}`;
    const used = new Set<string>();
    const fp = (e: string, v: string, a: number): string => `${e}|${v}|${a}`;
    const claim = (e: string, v: string, a: number): boolean => { const k = fp(e, v, a); if (used.has(k)) return false; used.add(k); return true; };

    const drafts: Draft[] = [];
    const base: Array<Omit<Rec, 'id'>> = [];
    while (base.length < n) {
        const category = pick(CATEGORIES);
        const e = emp(); const v = ven();
        const amount = int(NORMS[category].min, NORMS[category].max);
        if (!claim(e, v, amount)) continue;
        const rec = { employee: e, dept: `D${Number(e.slice(1)) % 6}`, category, vendor: v, amount, date: dayOf(int(0, 364)), approvedBy: amount > APPROVAL_OVER ? manager(e) : (rand() < 0.3 ? manager(e) : null) };
        base.push(rec);
        drafts.push({ rec });
    }

    let g = 0;
    // Duplicates: the same expense entered twice, same day.
    for (let i = 0; i < plant.duplicate; i++) {
        const src = base[int(0, base.length - 1)];
        const group = `dup${g++}`;
        const first = drafts.find(d => d.rec === src)!;
        if (first.tag) { i--; continue; }
        first.tag = { kind: 'duplicate', group };
        drafts.push({ rec: { ...src }, tag: { kind: 'duplicate', group } });
    }
    // Outliers: far above what the category costs (approved, so that only the amount is wrong).
    for (let i = 0; i < plant.outlier; i++) {
        const category = pick(CATEGORIES); const e = emp(); const v = ven();
        const amount = Math.round(NORMS[category].max * (OUTLIER_FACTOR + 1 + rand() * 4));
        if (!claim(e, v, amount)) { i--; continue; }
        drafts.push({ rec: { employee: e, dept: `D${Number(e.slice(1)) % 6}`, category, vendor: v, amount, date: dayOf(int(0, 364)), approvedBy: manager(e) }, tag: { kind: 'outlier', group: `out${g++}` } });
    }
    // Missing approval: over the threshold and nobody approved.
    for (let i = 0; i < plant.missing_approval; i++) {
        const category = pick(['equipment', 'travel'] as Category[]); const e = emp(); const v = ven();
        const amount = int(APPROVAL_OVER + 100, 1100);
        if (!claim(e, v, amount)) { i--; continue; }
        drafts.push({ rec: { employee: e, dept: `D${Number(e.slice(1)) % 6}`, category, vendor: v, amount, date: dayOf(int(0, 364)), approvedBy: null }, tag: { kind: 'missing_approval', group: `mis${g++}` } });
    }
    // Self approval: approved by the person who spent it.
    for (let i = 0; i < plant.self_approval; i++) {
        const e = emp(); const v = ven();
        const amount = int(APPROVAL_OVER + 50, 880);
        if (!claim(e, v, amount)) { i--; continue; }
        drafts.push({ rec: { employee: e, dept: `D${Number(e.slice(1)) % 6}`, category: 'travel', vendor: v, amount, date: dayOf(int(0, 364)), approvedBy: e }, tag: { kind: 'self_approval', group: `self${g++}` } });
    }
    // Split purchase: three items each under the approval-free limit, same person, vendor and day, that add up to more than the threshold.
    for (let i = 0; i < plant.split_purchase; i++) {
        const e = emp(); const v = ven(); const date = dayOf(int(0, 364)); const group = `split${g++}`;
        const amounts = [int(170, 188), int(189, 207), int(208, 226)];
        if (!amounts.every(a => claim(e, v, a))) { i--; continue; }
        for (const amount of amounts) drafts.push({ rec: { employee: e, dept: `D${Number(e.slice(1)) % 6}`, category: 'equipment', vendor: v, amount, date, approvedBy: null }, tag: { kind: 'split_purchase', group } });
    }
    // Decoys: a monthly subscription. Same employee, vendor and amount three months in a row: it looks like a duplicate and is not.
    for (let i = 0; i < plant.decoys; i++) {
        const e = emp(); const v = ven(); const amount = int(31, 199);
        if (!claim(e, v, amount)) { i--; continue; }
        const month = int(0, 8); const day = int(1, 27);
        for (let m = 0; m < 3; m++) {
            drafts.push({ rec: { employee: e, dept: `D${Number(e.slice(1)) % 6}`, category: 'software', vendor: v, amount, date: new Date(Date.UTC(2026, month + m, day)).toISOString().slice(0, 10), approvedBy: null } });
        }
    }

    // Shuffle (so that the two halves of a duplicate land in different shards), then number.
    for (let i = drafts.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [drafts[i], drafts[j]] = [drafts[j], drafts[i]]; }
    const records: Rec[] = drafts.map((d, i) => ({ id: i + 1, ...d.rec }));
    const groups = new Map<string, { kind: Kind; ids: number[] }>();
    drafts.forEach((d, i) => {
        if (!d.tag) return;
        const cur = groups.get(d.tag.group) ?? { kind: d.tag.kind, ids: [] };
        cur.ids.push(i + 1);
        groups.set(d.tag.group, cur);
    });
    const truth = [...groups.values()].map(x => `${x.kind}:${x.ids.sort((a, b) => a - b).join(',')}`).sort();
    return { seed: o.seed, records, truth, decoys: plant.decoys };
}

export const shardsOf = (records: Rec[], shardSize: number): Rec[][] => {
    const out: Rec[][] = [];
    for (let i = 0; i < records.length; i += shardSize) out.push(records.slice(i, i + shardSize));
    return out;
};
