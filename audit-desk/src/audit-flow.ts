/**
 * The audit as a flow. The number of shards depends on the data, so the definition is built, not typed: it is still a plain
 * `FlowDefinition` that `validateFlow` checks and that could as well have been written in YAML.
 */
import { FlowDefinitionSchema, validateFlow, type FlowDefinition } from '@backendkit-labs/agent-core';

export const AGENTS = ['scanner', 'consolidator', 'verifier', 'writer'] as const;
export const shardId = (i: number): string => `shard-${String(i).padStart(3, '0')}`;

export function auditFlow(shards: number, name = 'expense-audit'): FlowDefinition {
    const ids = Array.from({ length: shards }, (_, i) => shardId(i));
    const def = FlowDefinitionSchema.parse({
        flow: name, version: 1, trigger: { type: 'manual' },
        steps: [
            // No `after`: every shard is scanned at the same time, as far as the workers allow.
            ...ids.map(id => ({ id, agent: 'scanner', prompt: `Scan ${id} of the audit {{payload.audit}}.`, timeoutMs: 120_000 })),
            { id: 'merge', agent: 'consolidator', prompt: 'Look for what only shows across shards.', after: ids },
            // The one that checks is not the one that found: it reads the records again.
            { id: 'verify', agent: 'verifier', prompt: 'Confirm or clear every candidate against the records.', after: ['merge'] },
            // Only when something was confirmed; and a person reads it before it goes out.
            {
                id: 'report', agent: 'writer', prompt: 'Write the audit report.', after: ['verify'],
                when: { step: 'verify', matches: '^VERIFY: [1-9]\\d* CONFIRMED' },
                gate: { approval: 'human' },
            },
        ],
    });
    const issues = validateFlow(def);
    if (issues.length) throw new Error(`the audit flow is not valid: ${issues.join('; ')}`);
    return def;
}
