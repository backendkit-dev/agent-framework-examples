/**
 * @description Lector del indice de patrones del vault con soporte
 * de cross-references entre patrones relacionados, incluyendo
 * parsing de [[wikilinks]] de Obsidian en el cuerpo de los archivos.
 *
 * Valor: permite navegar entre patrones conectados (ej: que skills usan
 * un patron, que patrones extienden a otro) sin busqueda manual.
 * Los wikilinks [[patron]] se resuelven como referencias adicionales
 * a las declaradas en frontmatter related:/sources:.
 */

import * as path from 'path';
import * as fs from 'fs/promises';

export interface PatternEntry {
    /** Ruta relativa desde el vault (ej: 04-Recursos/Backend/Patrones/repository.md) */
    path: string;
    /** Nombre del patron */
    name: string;
    /** Categoria a la que pertenece */
    category: string;
    /** Tags del frontmatter */
    tags: string[];
    /** Patrones relacionados (del campo related: en frontmatter) */
    related: string[];
    /** Fuentes de informacion (del campo sources: en frontmatter) */
    sources: string[];
    /** Wikilinks encontrados en el cuerpo del archivo [[patron]] */
    wikilinks: string[];
    /** Skills que referencian este patron (se calcula en buildCrossReferences) */
    referencedBy: string[];
    /** Ultima fecha de modificacion */
    date?: string;
}

export interface VaultIndex {
    /** Categorias con sus patrones */
    categories: CategoryGroup[];
    /** Mapa de cross-references: path -> patrones que lo referencian */
    crossReferences: Map<string, PatternEntry[]>;
    /** Fecha de ultima actualizacion */
    lastUpdated: string;
    /** Total de patrones indexados */
    totalPatterns: number;
}

export interface CategoryGroup {
    name: string;
    patterns: PatternEntry[];
}

/**
 * @description Lee el indice de patrones del vault y construye
 * cross-references entre ellos.
 *
 * Escanea `related:`, `sources:`, `tags:` del frontmatter de cada
 * archivo .md dentro de 04-Recursos, y ademas parsea [[wikilinks]]
 * en el cuerpo de los archivos para construir un grafo de
 * relaciones mas completo.
 */
export async function readVaultIndex(vaultPath: string): Promise<VaultIndex | null> {
    try {
        const recursosDir = path.join(vaultPath, '04-Recursos');
        const allFiles = await walkMdFiles(recursosDir);
        if (allFiles.length === 0) return null;

        // Categorizar por directorio inmediato
        const categoryMap = new Map<string, PatternEntry[]>();

        for (const filePath of allFiles) {
            const content = await fs.readFile(filePath, 'utf-8');
            const relative = path.relative(recursosDir, filePath).replace(/\\/g, '/');
            const category = path.dirname(relative);
            const tags = extractFrontmatterArray(content, 'tags');
            const related = extractFrontmatterArray(content, 'related');
            const sources = extractFrontmatterArray(content, 'sources');
            const wikilinks = extractWikilinks(content);
            const date = extractFrontmatterField(content, 'date') ||
                extractFrontmatterField(content, 'updated') ||
                extractFrontmatterField(content, 'fecha_actualizacion');
            const name = extractFrontmatterField(content, 'title') ||
                extractFrontmatterField(content, 'name') ||
                path.basename(filePath, '.md');

            const entry: PatternEntry = {
                path: relative,
                name,
                category,
                tags,
                related,
                sources,
                wikilinks,
                referencedBy: [],
                date,
            };

            const existing = categoryMap.get(category) ?? [];
            existing.push(entry);
            categoryMap.set(category, existing);
        }

        // Construir cross-references (frontmatter + wikilinks)
        const crossReferences = new Map<string, PatternEntry[]>();
        const allEntries = Array.from(categoryMap.values()).flat();

        for (const entry of allEntries) {
            // Referencias desde frontmatter: related + sources
            const allRefs = [...entry.related, ...entry.sources];
            for (const ref of allRefs) {
                const target = findPattern(allEntries, ref);
                if (target) {
                    addCrossReference(crossReferences, target.path, entry);
                    if (!target.referencedBy.includes(entry.path)) {
                        target.referencedBy.push(entry.path);
                    }
                }
            }

            // Referencias desde wikilinks [[patron]] en el cuerpo
            for (const wikiRef of entry.wikilinks) {
                const target = findPattern(allEntries, wikiRef);
                if (target) {
                    addCrossReference(crossReferences, target.path, entry);
                    if (!target.referencedBy.includes(entry.path)) {
                        target.referencedBy.push(entry.path);
                    }
                }
            }
        }

        // Construir categorias ordenadas
        const categories: CategoryGroup[] = Array.from(categoryMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, patterns]) => ({
                name,
                patterns: patterns.sort((a, b) => a.name.localeCompare(b.name)),
            }));

        return {
            categories,
            crossReferences,
            lastUpdated: new Date().toISOString().split('T')[0],
            totalPatterns: allEntries.length,
        };
    } catch {
        return null;
    }
}

/**
 * @description Agrega una entrada al mapa de cross-references.
 * Si la clave ya existe, agrega la referencia si no esta duplicada.
 */
function addCrossReference(
    map: Map<string, PatternEntry[]>,
    targetPath: string,
    source: PatternEntry
): void {
    const existing = map.get(targetPath) ?? [];
    if (!existing.some(e => e.path === source.path)) {
        existing.push(source);
        map.set(targetPath, existing);
    }
}

/**
 * @description Busca un patron por nombre o fragmento de ruta
 * dentro de una lista de entradas. Prioriza coincidencias exactas
 * de nombre sobre fragmentos de ruta.
 */
function findPattern(entries: PatternEntry[], ref: string): PatternEntry | undefined {
    const lowerRef = ref.toLowerCase().trim();

    // 1. Coincidencia exacta de nombre
    const exact = entries.find(e => e.name.toLowerCase() === lowerRef);
    if (exact) return exact;

    // 2. Coincidencia por nombre del archivo sin extension
    const byFile = entries.find(e => {
        const baseName = path.basename(e.path, '.md').toLowerCase();
        return baseName === lowerRef || baseName.includes(lowerRef);
    });
    if (byFile) return byFile;

    // 3. Coincidencia parcial en nombre
    return entries.find(e =>
        e.name.toLowerCase().includes(lowerRef) ||
        lowerRef.includes(e.name.toLowerCase())
    );
}

/**
 * @description Extrae todos los [[wikilinks]] del cuerpo de un archivo .md.
 * Ignora wikilinks que aparecen dentro del frontmatter YAML.
 * Soporta formato [[nombre]] y [[nombre|alias]].
 *
 * @param content - Contenido completo del archivo
 * @returns Lista de nombres de wikilinks (sin alias)
 */
function extractWikilinks(content: string): string[] {
    // Separar frontmatter del cuerpo
    const body = extractBodyAfterFrontmatter(content);
    if (!body) return [];

    const wikilinks: string[] = [];
    // Patron: [[nombre]] o [[nombre|alias]]
    const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;

    while ((match = regex.exec(body)) !== null) {
        const name = match[1].trim();
        if (name.length > 0) {
            wikilinks.push(name);
        }
    }

    // Eliminar duplicados preservando orden
    return [...new Set(wikilinks)];
}

/**
 * @description Extrae el cuerpo del archivo, ignorando el frontmatter YAML
 * (todo lo que esta entre los primeros --- y los segundos ---).
 */
function extractBodyAfterFrontmatter(content: string): string {
    // Buscar el cierre del frontmatter
    const lines = content.split('\n');
    if (lines.length < 2) return content;

    // Si la primera linea no es ---, no hay frontmatter
    if (!lines[0].trim().startsWith('---')) return content;

    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim().startsWith('---')) {
            endIdx = i;
            break;
        }
    }

    if (endIdx === -1) return content;
    return lines.slice(endIdx + 1).join('\n');
}

/**
 * @description Camina recursivamente un directorio y devuelve
 * todas las rutas de archivos .md, excluyendo node_modules,
 * .git y carpetas ocultas.
 */
async function walkMdFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue; // skip hidden
            if (entry.name === 'node_modules') continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const sub = await walkMdFiles(fullPath);
                results.push(...sub);
            } else if (entry.name.endsWith('.md')) {
                results.push(fullPath);
            }
        }
    } catch {
        // Directorio no existe o no accesible
    }
    return results;
}

/**
 * @description Extrae un campo del frontmatter YAML como string simple.
 */
function extractFrontmatterField(content: string, field: string): string | undefined {
    const match = content.match(new RegExp(`^${field}\\s*:\\s*['"]?(.+?)['"]?\\s*$`, 'm'));
    if (!match) return undefined;
    return match[1].trim().replace(/^['"]|['"]$/g, '');
}

/**
 * @description Extrae un campo del frontmatter YAML como array.
 * Soporta formato inline (tags: [a, b]) y multilinea (tags:\n  - a\n  - b).
 */
function extractFrontmatterArray(content: string, field: string): string[] {
    const results: string[] = [];

    // Formato inline: field: [a, b, c]
    const inlineMatch = content.match(new RegExp(`^${field}\\s*:\\s*\\[([^\\]]+)\\]`, 'm'));
    if (inlineMatch) {
        const items = inlineMatch[1].split(',').map(i => i.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        results.push(...items);
        return results;
    }

    // Formato multilinea: field:\n  - a\n  - b
    const multiRegex = new RegExp(`^${field}\\s*:\\n((?:\\s+-\\s+.+\\n?)+)`, 'm');
    const multiMatch = content.match(multiRegex);
    if (multiMatch) {
        const items = multiMatch[1]
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('-'))
            .map(line => line.slice(1).trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
        results.push(...items);
    }

    // Formato simple: field: value (un solo valor como string)
    if (results.length === 0) {
        const simple = extractFrontmatterField(content, field);
        if (simple) results.push(simple);
    }

    return results;
}
