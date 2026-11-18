/** How much a journal costs per run: the same desk with the memory journal and with the ndjson file journal. */
import { NdjsonRunJournal, MemoryRunJournal } from '@backendkit-labs/agent-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDesk } from './desk-sim';

async function main(): Promise<void> {
    const bars = Number(process.argv[2] ?? 120);
    const symbols = ['AAA-SIM', 'BBB-SIM', 'CCC-SIM'];
    const mem = await runDesk({ seed: 7, bars, symbols, journal: new MemoryRunJournal() });
    console.log(`memory journal: ${mem.results.length} flows, wall ${mem.wallMs} ms, ${(mem.wallMs / mem.results.length).toFixed(1)} ms per flow`);
    const dir = mkdtempSync(join(tmpdir(), "desk-bench-"));
    const file = await runDesk({ seed: 7, bars, symbols, journal: new NdjsonRunJournal(dir) });
    rmSync(dir, { recursive: true, force: true });
    console.log(`ndjson journal: ${file.results.length} flows, wall ${file.wallMs} ms, ${(file.wallMs / file.results.length).toFixed(1)} ms per flow`);
}

main().catch(e => { console.error(e); process.exit(1); });
