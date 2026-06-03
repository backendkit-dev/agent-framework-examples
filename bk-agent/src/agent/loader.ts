import * as fs from 'fs/promises';
import * as path from 'path';
import { AgentProfile } from './profiles';

export interface LoadAgentsResult {
    agents: AgentProfile[];
    errors: { file: string; message: string }[];
}

// Parses markdown files with optional YAML frontmatter:
//   ---
//   name: My Agent
//   icon: 
//   description: What this agent does
//   model: deepseek-reasoner
//   ---
//   System prompt body goes here...
function parseAgentFile(filename: string, content: string): { agent?: AgentProfile; error?: string } {
    const id = path.basename(filename, path.extname(filename));
    let name = id;
    let icon = '';
    let description = '(sin descripcion)';
    let model: string | undefined;
    let body = content;

    let triggers: string[] | undefined;

    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (frontmatterMatch) {
        const meta = frontmatterMatch[1];
        body = frontmatterMatch[2].trim();

        const get = (key: string) => meta.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
        name        = get('name')        ?? name;
        icon        = get('icon')        ?? icon;
        description = get('description') ?? description;
        model       = get('model');

        // Parse triggers: supports both inline [a, b, c] and multiline list (- item)
        const inlineTriggersRaw = meta.match(/^triggers:\s*\[(.+?)\]/m)?.[1];
        if (inlineTriggersRaw) {
            triggers = inlineTriggersRaw.split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
        } else {
            const blockMatch = meta.match(/^triggers:\s*\n((?:\s+-\s*.+\n?)*)/m);
            if (blockMatch) {
                triggers = blockMatch[1].match(/^\s+-\s*(.+)$/mg)
                    ?.map(l => l.replace(/^\s+-\s*/, '').trim()) ?? [];
            }
        }
    } else {
        body = body.trim();
    }

    if (!body) return { error: 'cuerpo vacio (sin contenido despues del frontmatter)' };

    return { agent: { id, name, icon, description, model, triggers, systemPromptAddition: '\n' + body } };
}

// Accepts multiple directories: first = local (higher priority), rest = vault/shared.
// An agent ID seen in an earlier directory is skipped in later ones.
export async function loadCustomAgents(...agentsDirs: string[]): Promise<LoadAgentsResult> {
    const result: LoadAgentsResult = { agents: [], errors: [] };
    const seenIds = new Set<string>();

    for (let i = 0; i < agentsDirs.length; i++) {
        const dir = agentsDirs[i];
        if (!dir) continue;
        const isVault = i > 0;
        let files: string[];
        try {
            files = await fs.readdir(dir);
        } catch {
            continue;
        }
        for (const file of files) {
            if (!/\.(md|yaml|yml|txt)$/.test(file)) continue;
            if (file.toLowerCase() === 'readme.md') continue;
            const id = path.basename(file, path.extname(file));
            if (seenIds.has(id)) continue;
            try {
                const content = await fs.readFile(path.join(dir, file), 'utf-8');
                const parsed = parseAgentFile(file, content);
                if (parsed.agent) {
                    if (isVault) parsed.agent.vault = true;
                    result.agents.push(parsed.agent);
                    seenIds.add(id);
                } else if (parsed.error) {
                    result.errors.push({ file, message: parsed.error });
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                result.errors.push({ file, message: msg });
            }
        }
    }
    return result;
}
