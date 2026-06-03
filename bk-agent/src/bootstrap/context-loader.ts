import * as fs from 'fs/promises';
export async function loadContext(file: string): Promise<string | null> {
    try { return await fs.readFile(file, 'utf-8'); } catch { return null; }
}