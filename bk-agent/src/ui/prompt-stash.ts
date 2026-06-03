import fs from 'fs';
import path from 'path';

const STASH_FILE = path.join(process.cwd(), '.deepseek-stash.json');
const MAX_STASH = 20;

export interface StashEntry { text: string; savedAt: string; preview: string; }

export function saveToStash(text: string): void {
    const entries = loadStash();
    const filtered = entries.filter(e => e.text !== text); // no duplicados
    const preview = text.replace(/\n/g, ' ').slice(0, 60);
    filtered.unshift({ text, savedAt: new Date().toISOString(), preview });
    fs.writeFileSync(STASH_FILE, JSON.stringify(filtered.slice(0, MAX_STASH), null, 2));
}

export function loadStash(): StashEntry[] {
    try { return JSON.parse(fs.readFileSync(STASH_FILE, 'utf8')); }
    catch { return []; }
}
