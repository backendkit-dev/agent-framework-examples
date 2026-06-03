import * as path from 'path';
import * as fs from 'fs/promises';

const MAX_CONTENT_CHARS = 2000;

export async function saveToVault(title: string, content: string, category: string, tags: string, vaultPath: string) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const full = path.join(vaultPath, '04-Recursos', category, slug + '.md');
    await fs.mkdir(path.dirname(full), { recursive: true });

    const truncated = content.length > MAX_CONTENT_CHARS
        ? content.substring(0, MAX_CONTENT_CHARS) + '\n\n... (truncado, ver fuente original)'
        : content;

    const frontmatter = [
        '---',
        'tags: [' + tags + ']',
        'date: ' + new Date().toISOString().split('T')[0],
        'source: bk-agent-research',
        '---',
        '',
    ].join('\n');

    const body = [
        '# ' + title,
        '',
        '> Articulo generado por investigacion autonoma.',
        '',
        '## Contenido',
        '',
        truncated,
        '',
        '## Reglas',
        '',
        '1. Verificar datos antes de usar en produccion',
        '2. Adaptar al contexto especifico del proyecto',
        '3. Preferir implementacion existente en el vault antes que crear nueva',
        '',
        '## Relacionados',
        '',
        '- [[00-INDEX-PATRONES]]',
        '',
    ].join('\n');

    await fs.writeFile(full, frontmatter + body, 'utf-8');

    const indexPath = path.join(vaultPath, '04-Recursos', '00-INDEX-PATRONES.md');
    try {
        let idx = await fs.readFile(indexPath, 'utf-8');
        const entry = '- [[' + slug + ']] - ' + title + '\n';
        if (!idx.includes(entry.trim())) {
            idx += entry;
            await fs.writeFile(indexPath, idx, 'utf-8');
        }
    } catch { }

    return 'Guardado en ' + path.relative(vaultPath, full);
}