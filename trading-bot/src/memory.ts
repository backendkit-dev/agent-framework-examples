/**
 * The three kinds of memory of the framework, each with its own job in the bot:
 *  - episodic: what happened, trade by trade;
 *  - semantic: what the bot knows (its playbook);
 *  - procedural: which entries worked (trigger, action, outcome). Deprecated in favor of the learning module, and kept here
 *    on purpose: the bench shows how the two overlap.
 */
import { join } from 'node:path';
import { createMemorySystem, type MemorySystem } from '@backendkit-labs/agent-core';
import type { ClosedTrade } from './broker';

export function createTradingMemory(dir: string): MemorySystem {
    return createMemorySystem({
        episodic: { provider: 'json', path: join(dir, 'episodes.json') },
        semantic: { provider: 'json', path: join(dir, 'knowledge.json') },
        procedural: { provider: 'json', path: join(dir, 'patterns.json') },
        retention: { maxEpisodes: 200 },
    });
}

export async function seedPlaybook(memory: MemorySystem): Promise<void> {
    await memory.semantic.index('Position sizing: risk a small part of the equity on each trade and never concentrate.', { topic: 'risk' });
    await memory.semantic.index('A stop is placed in ATRs below the entry so that it adapts to how much the market moves.', { topic: 'risk' });
    await memory.semantic.index('A breakout is a close above the highest high of the previous 20 bars.', { topic: 'breakout' });
}

export function rememberTrade(memory: MemorySystem, trade: ClosedTrade): void {
    const outcome = trade.pnl > 0 ? 'win' : 'loss';
    memory.episodic.remember(
        `Bar ${trade.exitBar}: ${trade.setup} entry in ${trade.symbol} while ${trade.context.trend}, ${outcome} ${trade.pnlPct.toFixed(1)}% after ${trade.barsHeld} bars (${trade.exitReason}).`,
        [trade.setup, trade.context.trend, outcome],
    );
    memory.procedural.learnPattern(`${trade.setup} entry while ${trade.context.trend}`, 'buy', trade.pnl > 0 ? 'success' : 'failure');
}
