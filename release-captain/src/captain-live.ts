/**
 * The captain with a real model (DeepSeek), over two small monorepos on disk: `alpha` is sound and `beta` has a package whose build fails.
 * A spend cap stops the run and the key is read from DEEPSEEK_API_KEY and never printed.
 *
 *   npm run agent:live
 *   npm run agent:live -- "Is alpha ready? Do not touch beta."          # your own question
 *   npm run agent:live -- --repo ../../agent-framework "Can I publish?"  # a real monorepo (builds with npm: minutes)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';
import type { LLMMessage, LLMProvider, LLMStreamCallbacks } from '@backendkit-labs/agent-core';
import { createCaptain } from './captain-agent';
import { createCaptainHost, type Monorepo } from './captain-host';
import { fastCommands, makeFixture, type Fixture } from './fixture';

const MAX_USD = 0.1;
const PRICE = { input: 0.3, output: 1.2 }; // per million tokens

function capped(inner: LLMProvider, spend: { usd: number; calls: number }): LLMProvider {
    return {
        ...inner,
        chat: async (messages: LLMMessage[], tools, cb: LLMStreamCallbacks, ...rest) => {
            if (spend.usd >= MAX_USD) throw new Error(`spend cap of ${MAX_USD} USD reached`);
            spend.calls++;
            return (inner.chat as (...a: unknown[]) => Promise<void>)(messages, tools, {
                ...cb,
                onMetrics: (i: number, o: number) => { spend.usd += (i * PRICE.input + o * PRICE.output) / 1e6; cb.onMetrics?.(i, o); },
            }, ...rest);
        },
    } as LLMProvider;
}

async function main(): Promise<void> {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) { console.error('Set DEEPSEEK_API_KEY to run this (it is not needed for `npm run agent:smoke`).'); process.exit(2); }
    const args = process.argv.slice(2);
    const repoAt = args.indexOf('--repo');
    const repo = repoAt >= 0 ? args[repoAt + 1] : undefined;
    const question = args.filter((a, i) => !(i === repoAt || i === repoAt + 1)).join(' ')
        || 'Check alpha and beta and tell me which of them can be published, and what to fix in the other.';

    const fixtures: Fixture[] = [];
    const monorepos: Record<string, Monorepo> = {};
    if (repo) monorepos.framework = { root: resolve(repo), extraFolders: ['packages/templates/base', 'packages/create-bk-agent/templates/base'] };
    else {
        const alpha = makeFixture(); const beta = makeFixture(); fixtures.push(alpha, beta);
        for (const f of fixtures) for (const id of ['core', 'solo', 'util']) f.delay(id, 400);
        beta.fail('util');
        monorepos.alpha = { root: alpha.root, registry: async () => false, commands: fastCommands };
        monorepos.beta = { root: beta.root, registry: async () => false, commands: fastCommands };
    }

    const stateDir = mkdtempSync(join(tmpdir(), 'captain-live-'));
    const host = createCaptainHost({ monorepos, stateDir, jobs: 3 });
    const spend = { usd: 0, calls: 0 };
    const { ask } = createCaptain({
        host, provider: capped(new DeepSeekProvider({ apiKey: key }), spend),
        confirm: async tool => { console.log(`  (the captain asked to ${tool}: not confirmed in this script)`); return false; },
    });

    console.log(`Question: ${question}\n(DeepSeek, cap ${MAX_USD} USD)\n`);
    const t0 = Date.now();
    const r = await ask(question).catch(e => { console.error(String((e as Error).message ?? e).replace(/sk-[A-Za-z0-9]+/g, 'sk-***')); return undefined; });
    if (r) {
        console.log('Tools, in order:');
        r.toolCalls.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c.name}${c.success ? '' : '  (refused/failed)'}`));
        console.log(`\n${r.text}\n`);
        for (const run of await host.journal.list()) console.log(`run ${run.runId}: ${run.flow} ${run.status}`);
    }
    console.log(`\n${spend.calls} model calls, ~${spend.usd.toFixed(4)} USD, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await host.close();
    for (const f of fixtures) f.cleanup();
    rmSync(stateDir, { recursive: true, force: true });
    process.exit(r ? 0 : 1);
}

main().catch(e => { console.error(String((e as Error).message ?? e).replace(/sk-[A-Za-z0-9]+/g, 'sk-***')); process.exit(1); });
