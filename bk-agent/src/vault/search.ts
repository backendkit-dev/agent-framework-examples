import { glob } from 'glob';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PatternMatch } from '../types/vault';
import { Instructions, Trigger, AIAssistantConfig } from '../types/config';
import { LRUCache } from './lru-cache';
import { VaultProvider, FileSystemVaultProvider } from './vault-provider';

const STOPWORDS = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'en',
    'con', 'por', 'para', 'que', 'es', 'son', 'ser', 'the', 'a', 'an', 'of', 'in',
    'is', 'are', 'to', 'for', 'and', 'or', 'me', 'mi', 'se', 'si', 'yo', 'tu',
    'como', 'como', 'que', 'que', 'crea', 'crear', 'dame', 'muestra', 'genera',
]);

/**
 * Cache LRU con TTL de 5 minutos para resultados de busqueda en vault.
 * Tamano 50 entradas - cada entrada es un Array de PatternMatch.
 * La clave es "keywords_hash|vaultPath" para distinguir entre vaults.
 * TTL: 300,000ms = 5 minutos. Resultados antiguos se invalidan automaticamente.
 */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const vaultSearchCache = new LRUCache<string, PatternMatch[]>(50, CACHE_TTL_MS);

const MAX_BYTES_PER_ENTRY = 10_000;

function truncateContent(content: string, maxBytes: number): string {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    if (bytes.length <= maxBytes) return content;
    const truncated = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, maxBytes));
    return truncated;
}

function extractKeywords(prompt: string): string[] {
    return prompt
        .toLowerCase()
        .split(/[\s,.:;()\[\]{}"']+/)
        .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

function matchTriggers(keywords: string[], triggers: Trigger[]) {
    const res: { trigger: string; patterns: string[] }[] = [];
    for (const t of triggers) {
        if (t.keywords.some(k => keywords.includes(k))) {
            res.push({ trigger: t.keywords[0], patterns: t.patterns });
        }
    }
    return res;
}

function calcRelevance(content: string, keywords: string[]): number {
    let score = 0;
    for (const k of keywords) score += (content.match(new RegExp(k, 'gi')) || []).length;
    return score;
}

/**
 * @description Genera una clave unica de cache para una busqueda.
 * Usa las keywords ordenadas + vaultPath para que queries equivalentes
 * (ej: "crear repositorio" vs "repositorio crear") compartan cache.
 */
function buildCacheKey(keywords: string[], vaultPath: string): string {
    const sorted = [...keywords].sort().join(',');
    return `${sorted}|${vaultPath}`;
}

/**
 * @description Busca patrones relevantes en el vault para reutilizar
 * conocimiento existente antes de generar codigo nuevo.
 * Usa cache LRU (50 entradas, TTL 5 min) para evitar lecturas repetidas.
 *
 * Acepta un VaultProvider opcional. Si no se provee, crea un
 * FileSystemVaultProvider con vaultPath como raiz (compatibilidad hacia atras).
 *
 * R2: Si hay triggers configurados pero ninguno matcheo, retorna [] sin hacer glob.
 * R3: Cachea tambien resultados vacios con TTL de 60s.
 * R4: Limita bytes por entrada a MAX_BYTES_PER_ENTRY.
 */
export async function searchVaultPatterns(
    userPrompt: string,
    instructions: Instructions,
    vaultPath: string,
    config?: AIAssistantConfig,
    vaultProvider?: VaultProvider,
): Promise<PatternMatch[]> {
    if (!vaultPath) return [];

    const keywords = extractKeywords(userPrompt);
    if (!keywords.length) return [];

    // Cache lookup
    const cacheKey = buildCacheKey(keywords, vaultPath);
    const cached = vaultSearchCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const searchPaths: string[] = config?.vault?.search_paths?.length
        ? config.vault.search_paths
        : ['04-Recursos'];

    const matched = matchTriggers(keywords, instructions.triggers);

    // R2: triggers configurados pero sin match -> skip glob
    if (instructions.triggers.length > 0 && matched.length === 0) {
        vaultSearchCache.set(cacheKey, []);
        return [];
    }

    // Usar provider inyectado o crear uno por defecto (filesystem)
    const provider = vaultProvider ?? new FileSystemVaultProvider(vaultPath);

    const results: PatternMatch[] = [];
    const MAX_RESULTS = 5;

    if (matched.length > 0) {
        for (const { patterns: triggerPatterns, trigger } of matched) {
            const entries = await provider.search(triggerPatterns, searchPaths);
            for (const entry of entries) {
                const relevance = calcRelevance(entry.content, keywords);
                results.push({ path: entry.path, content: entry.content, relevance, trigger });
                if (results.length >= MAX_RESULTS) break;
            }
            if (results.length >= MAX_RESULTS) break;
        }
    } else {
        // No triggers configured - full-text keyword search across vault search paths
        const entries = await provider.search(['**/*.md'], searchPaths);
        for (const entry of entries) {
            const relevance = calcRelevance(entry.content, keywords);
            if (relevance > 0) {
                results.push({ path: entry.path, content: entry.content, relevance, trigger: 'keyword' });
                if (results.length >= MAX_RESULTS) break;
            }
        }
    }

    const sorted = results.sort((a, b) => b.relevance - a.relevance).slice(0, 5);

    // R4: truncar contenido antes de cachear
    const cachedResults = sorted.map((r) => ({
        ...r,
        content: truncateContent(r.content, MAX_BYTES_PER_ENTRY),
    }));

    // R3: cachear siempre, incluso si vacio
    vaultSearchCache.set(cacheKey, cachedResults);

    return cachedResults;
}
