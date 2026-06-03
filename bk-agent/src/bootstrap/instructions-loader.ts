import * as fs from 'fs/promises';
import { Instructions, Trigger } from '../types/config';

export async function loadInstructions(file: string): Promise<Instructions | null> {
    try { return parseInstructions(await fs.readFile(file, 'utf-8')); } catch { return null; }
}

function parseInstructions(content: string): Instructions {
    const triggers: Trigger[] = [];
    const regex = /\|\s*\*\*(.+?)\*\*\s*\|\s*\*\*(.+?)\*\*\s*\|/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
        triggers.push({
            keywords: m[1].split(',').map(k => k.trim().toLowerCase()),
            patterns: [m[2].replace(/\*\*/g, '').trim()],
        });
    }
    return {
        role: 'asistente',
        rules: ['Leer configuracion', 'Buscar en vault antes de generar', 'Notificar origen'],
        triggers,
        format: {
            vaultCode: '📚 Codigo del vault',
            newExtract: '🆕 Nuevo para extraer',
            businessSpecific: '⚠️ Especifico del negocio',
            extractionSuggestion: '🔄 Sugerencia de extraccion',
        },
    };
}