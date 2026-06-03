import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { glob } from 'glob';

export interface SkillToolDefinition {
    name: string; description: string; parameters: any; handler: string;
}
export interface Skill {
    name: string; version: string; description: string;
    triggers: string[];
    agents?: string[];           // IDs de agentes que siempre tienen este skill activo
    systemPromptAddition?: string;
    tools?: SkillToolDefinition[];
    customInstructions?: string;
}

export interface VaultSkill {
    name: string;
    description: string;
    tags: string[];
    filePath: string;
    category: string;
    version?: string;
    body?: string;  // contenido del SKILL.md (sin frontmatter) — se usa como systemPromptAddition al instalar
}

/**
 * @description Carga skills desde archivos YAML en un directorio.
 * Cada skill define triggers de activación, tools y system prompt adicional.
 * El sistema activa automáticamente los skills cuyos triggers coinciden
 * con el input del usuario, extendiendo sus capacidades sin modificar
 * el código base.
 */
export async function loadSkills(dir: string): Promise<Skill[]> {
    try { await fs.access(dir); } catch { return []; }
    const files = await glob(path.join(dir, '*.{yaml,yml}').replace(/\\/g, '/'));
    const skills: Skill[] = [];
    for (const f of files) {
        const raw = yaml.parse(await fs.readFile(f, 'utf-8')) as Skill & { prompt?: string };
        // Allow 'prompt' as alias for 'systemPromptAddition' in user-authored YAMLs
        if (raw.prompt && !raw.systemPromptAddition) {
            raw.systemPromptAddition = raw.prompt;
        }
        skills.push(raw);
    }
    return skills;
}

/**
 * @description Escanea el vault de Obsidian en busca de skills (archivos SKILL.md)
 * dentro de 04-Recursos/Skills/. Cada skill se parsea desde su frontmatter YAML
 * y se clasifica por categoría según su ubicación en el árbol de directorios.
 * El equipo puede agregar skills simplemente creando archivos en el vault.
 */
export async function loadVaultSkills(vaultPath: string): Promise<VaultSkill[]> {
    const skillsBase = path.join(vaultPath, '04-Recursos', 'Skills');
    try { await fs.access(skillsBase); } catch { return []; }
    const files = await glob(path.join(skillsBase, '**/SKILL.md').replace(/\\/g, '/'));
    const skills: VaultSkill[] = [];
    for (const f of files) {
        try {
            const content = await fs.readFile(f, 'utf-8');
            const m = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
            if (!m) continue;
            const meta = yaml.parse(m[1]);
            if (!meta?.name) continue;
            const rel = path.relative(skillsBase, f);
            const category = rel.replace(/\\/g, '/').split('/')[0] || '';
            const body = content.slice(m[0].length).trim();
            skills.push({
                name: meta.name as string,
                description: (meta.description as string) || '',
                tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
                filePath: f,
                category,
                version: meta.version ? String(meta.version) : undefined,
                body: body || undefined,
            });
        } catch { /* skip malformed */ }
    }
    return skills;
}