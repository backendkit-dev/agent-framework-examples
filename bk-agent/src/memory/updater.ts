import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryContext } from '../bootstrap/memory-loader';
import { readFileSafeAsync, writeFileSafeAsync } from '../shared/utils/encoding';
import { createCheckpoint, listCheckpoints, readCheckpoint, compactSession, compactSessionContent, CheckpointSummary } from '@bk/agent-core';
export { createCheckpoint, listCheckpoints, readCheckpoint, compactSession };
export type { CheckpointSummary };

// ── Workspace helpers (previously in @bk/agent-core, now local) ───────────────

export const DEFAULT_WORKSPACE = 'default';

export interface WorkspaceInfo {
    name: string;
    memoryDir: string;
    isDefault: boolean;
}

export function getWorkspaceMemoryDir(projectBaseDir: string, name?: string): string {
    if (!name || name === DEFAULT_WORKSPACE) {
        return path.join(projectBaseDir, 'memory');
    }
    return path.join(projectBaseDir, 'workspaces', name, 'memory');
}

export async function listWorkspaces(projectBaseDir: string): Promise<WorkspaceInfo[]> {
    const result: WorkspaceInfo[] = [{
        name: DEFAULT_WORKSPACE,
        memoryDir: path.join(projectBaseDir, 'memory'),
        isDefault: true,
    }];
    const workspacesDir = path.join(projectBaseDir, 'workspaces');
    try {
        const entries = await fs.readdir(workspacesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            result.push({
                name: entry.name,
                memoryDir: path.join(workspacesDir, entry.name, 'memory'),
                isDefault: false,
            });
        }
    } catch { /* workspaces dir doesn't exist yet */ }
    return result;
}

export async function ensureWorkspace(projectBaseDir: string, name: string): Promise<WorkspaceInfo> {
    const memoryDir = getWorkspaceMemoryDir(projectBaseDir, name);
    await fs.mkdir(path.join(memoryDir, 'checkpoints'), { recursive: true });
    return { name, memoryDir, isDefault: name === DEFAULT_WORKSPACE };
}

export async function readWorkspaceMemory(projectBaseDir: string, name: string): Promise<{ sessionContent: string; projectContext: string }> {
    const memoryDir = getWorkspaceMemoryDir(projectBaseDir, name);
    let sessionContent = '';
    let projectContext = '';
    try { sessionContent = await fs.readFile(path.join(memoryDir, 'sesion-actual.md'), 'utf-8'); } catch { }
    try { projectContext = await fs.readFile(path.join(memoryDir, 'contexto-proyecto.md'), 'utf-8'); } catch { }
    return { sessionContent, projectContext };
}
import { getLocalProjectsBaseDir, getProjectMemoryDir, cwdToProjectKey, listLocalProjects } from '../bootstrap/memory-loader';
import * as os from 'os';

const SESSION_MAX_BYTES = 8192;

// ── Local project management (~/.deepseek-code/projects/{key}/memory/) ──────

/**
 * @description Lista todos los proyectos locales conocidos en
 * ~/.deepseek-code/projects/.
 *
 * NOTA: Este wrapper existe para mantener compatibilidad con cli.ts.
 * La implementación real está en memory-loader.listLocalProjects().
 */
export async function listProjects(_vaultPath?: string): Promise<string[]> {
  const projects = await listLocalProjects();
  return projects.map(p => p.name);
}

/**
 * @description Inicializa o cambia a un proyecto en el directorio de memoria local.
 *
 * El directorio se determina a partir del cwd actual (no del nombre del proyecto).
 * Cada directorio de trabajo tiene su propio espacio aislado de memoria.
 * NO depende del vault de Obsidian.
 *
 * @returns MemoryContext apuntando al directorio de memoria local
 */
export async function switchProject(
    _vaultPath: string,
    _projectName: string,
    _stack = ''
): Promise<MemoryContext> {
    const memoryDir = getProjectMemoryDir();
    const date = new Date().toISOString().split('T')[0];
    const projectName = path.basename(process.cwd());

    // ── Crear estructura de directorios ────────────────────────────────────
    await fs.mkdir(path.join(memoryDir, 'checkpoints'), { recursive: true });

    // ── Sesión ──────────────────────────────────────────────────────────────
    const sesionFile = path.join(memoryDir, 'sesion-actual.md');
    try {
        await fs.access(sesionFile);
    } catch {
        await writeFileSafeAsync(sesionFile, buildSessionTemplate(projectName, date));
    }

    // ── Contexto ────────────────────────────────────────────────────────────
    const ctxFile = path.join(memoryDir, 'contexto-proyecto.md');
    try {
        await fs.access(ctxFile);
    } catch {
        await writeFileSafeAsync(ctxFile, buildProjectContextTemplate(projectName, '', date));
    }

    // ── Log ─────────────────────────────────────────────────────────────────
    const logFile = path.join(memoryDir, 'proyecto-log.md');
    try {
        await fs.access(logFile);
    } catch {
        await writeFileSafeAsync(logFile, buildLogTemplate(projectName, date));
    }

    // ── Leer contenido existente ────────────────────────────────────────────
    let sessionContent = '';
    try { const r = await readFileSafeAsync(sesionFile); sessionContent = r.content; } catch { }

    let projectContext = '';
    try { const r = await readFileSafeAsync(ctxFile); projectContext = r.content; } catch { }

    return {
        activeProject: projectName,
        sessionContent,
        projectContext,
        memoryDir,
        projectDir: memoryDir,
        source: 'local' as const,
    };
}

// Checkpoint functions are provided by @bk/agent-core (re-exported above)

// ── Project context update ────────────────────────────────────────────────────

export interface ProjectContextUpdate {
    stack?:                  string;
    arquitectura?:           string;
    convenciones?:           string;
    proyectos_relacionados?: string[];
    archivos_clave?:         string[];
    notas?:                  string;
}

export async function updateProjectContext(
    projectDir: string,
    updates: ProjectContextUpdate
): Promise<string> {
    const ctxFile = path.join(projectDir, 'contexto-proyecto.md');
    const date = new Date().toISOString().split('T')[0];

    let content: string;
    try {
        const r = await readFileSafeAsync(ctxFile);
        content = r.content;
    } catch {
        const name = path.basename(projectDir);
        content = buildProjectContextTemplate(name, '', date);
    }

    content = content.replace(/^fecha_actualizacion: .+$/m, `fecha_actualizacion: ${date}`);

    const changed: string[] = [];

    if (updates.stack !== undefined) {
        const r = replaceSection(content, 'Stack Técnico', updates.stack);
        content = r.content;
        if (r.changed) changed.push('stack');
    }
    if (updates.arquitectura !== undefined) {
        const r = replaceSection(content, 'Arquitectura', updates.arquitectura);
        content = r.content;
        if (r.changed) changed.push('arquitectura');
    }
    if (updates.convenciones !== undefined) {
        const r = replaceSection(content, 'Convenciones', updates.convenciones);
        content = r.content;
        if (r.changed) changed.push('convenciones');
    }
    if (updates.proyectos_relacionados?.length) {
        const body = updates.proyectos_relacionados.map(p => `- ${p}`).join('\n');
        const r = replaceSection(content, 'Proyectos Relacionados', body);
        content = r.content;
        if (r.changed) changed.push('proyectos relacionados');
    }
    if (updates.archivos_clave?.length) {
        const body = updates.archivos_clave.map(f => `- ${f}`).join('\n');
        const r = replaceSection(content, 'Archivos Clave', body);
        content = r.content;
        if (r.changed) changed.push('archivos clave');
    }
    if (updates.notas?.trim()) {
        if (content.includes('\n## Notas\n')) {
            const r = replaceSection(content, 'Notas', updates.notas);
            content = r.content;
            if (r.changed) changed.push('notas');
        } else {
            content = content.trimEnd() + `\n\n---\n\n## Notas\n${updates.notas}\n`;
            changed.push('notas');
        }
    }

    if (changed.length === 0) return 'OK: memoria ya actualizada (sin cambios necesarios)';

    await writeFileSafeAsync(ctxFile, content);
    return `✅ Contexto del proyecto actualizado: ${changed.join(', ')}`;
}

// ── Engine insights update ─────────────────────────────────────────────────────

export interface EngineInsight {
    failureType: string;
    domain: string;
    severity: string;
    count: number;
    recommendedAction?: string;
}

export async function updateEngineInsights(
    projectDir: string,
    insights: EngineInsight[]
): Promise<string> {
    if (insights.length === 0) return 'OK: sin insights nuevos';

    const sesionFile = path.join(projectDir, 'sesion-actual.md');
    const date = new Date().toISOString().split('T')[0];

    let content: string;
    try {
        const r = await readFileSafeAsync(sesionFile);
        content = r.content;
    } catch {
        return 'Error: sesion-actual.md no encontrada.';
    }

    const body = insights.map(i => {
        const action = i.recommendedAction ? ` — ${i.recommendedAction}` : '';
        return `- **${i.failureType}** (${i.domain}, ${i.severity}, x${i.count})${action}`;
    }).join('\n');

    if (content.includes('\n## Aprendizajes del Engine\n')) {
        const r = replaceSection(content, 'Aprendizajes del Engine', body);
        if (!r.changed) return 'OK: insights ya actualizados';
        content = r.content;
    } else {
        content = content.trimEnd() + `\n\n---\n\n## Aprendizajes del Engine\n${body}\n`;
    }

    content = content.replace(/^fecha_actualizacion: .+$/m, `fecha_actualizacion: ${date}`);
    content = content.replace(
        /\*(?:Creado|Actualizado|Compactada) por DeepSeek Code el .+\*/,
        `*Actualizado por DeepSeek Code el ${date}*`
    );

    if (Buffer.byteLength(content, 'utf-8') > SESSION_MAX_BYTES) {
        content = compactSessionContent(content);
    }

    await writeFileSafeAsync(sesionFile, content);
    return `✅ Insights del engine actualizados: ${insights.length} patrones`;
}

// compactSessionContent is imported from @bk/agent-core above

// ── Session memory update ──────────────────────────────────────────────────────

export interface SessionMemoryUpdate {
    feature?:       string;
    progreso?:      string;
    proximos_pasos?: string[];
    decisiones?:    string[];
    issues?:        string[];
    notas?:         string;
}

export async function updateSessionMemory(
    projectDir: string,
    updates: SessionMemoryUpdate
): Promise<string> {
    const sesionFile = path.join(projectDir, 'sesion-actual.md');
    const date = new Date().toISOString().split('T')[0];

    let content: string;
    try {
        const r = await readFileSafeAsync(sesionFile);
        content = r.content;
    } catch {
        return 'Error: sesion-actual.md no encontrada. Usa /switch para iniciar un proyecto.';
    }

    const changed: string[] = [];

    if (updates.feature !== undefined) {
        const r = patchLine(content, 'Feature en Curso', '**Nombre:**', `- **Nombre:** ${updates.feature}`);
        content = r.content;
        if (r.changed) changed.push('feature en curso');
    }
    if (updates.progreso !== undefined) {
        const r = patchLine(content, 'Feature en Curso', '**Progreso:**', `- **Progreso:** ${updates.progreso}`);
        content = r.content;
        if (r.changed) changed.push('progreso');
    }

    if (updates.proximos_pasos?.length) {
        const body = updates.proximos_pasos.map((s, i) => `${i + 1}. ${s}`).join('\n');
        const r = replaceSection(content, 'Próximos Pasos', body);
        content = r.content;
        if (r.changed) changed.push('próximos pasos');
    }
    if (updates.issues !== undefined) {
        const body = updates.issues.length > 0
            ? updates.issues.map((s, i) => `${i + 1}. ${s}`).join('\n')
            : '1. (Ninguno)';
        const r = replaceSection(content, 'Issues Activos', body);
        content = r.content;
        if (r.changed) changed.push('issues activos');
    }

    if (updates.decisiones?.length) {
        const body = updates.decisiones.map(d => `- ${d}`).join('\n');
        if (content.includes('\n## Decisiones\n')) {
            const r = replaceSection(content, 'Decisiones', body);
            content = r.content;
            if (r.changed) changed.push('decisiones');
        } else {
            content = content.trimEnd() + `\n\n---\n\n## Decisiones\n${body}\n`;
            changed.push('decisiones');
        }
    }
    if (updates.notas?.trim()) {
        if (content.includes('\n## Notas\n')) {
            const r = replaceSection(content, 'Notas', updates.notas);
            content = r.content;
            if (r.changed) changed.push('notas');
        } else {
            content = content.trimEnd() + `\n\n---\n\n## Notas\n${updates.notas}\n`;
            changed.push('notas');
        }
    }

    if (changed.length === 0) return 'OK: memoria ya actualizada (sin cambios necesarios)';

    content = content.replace(/^fecha_actualizacion: .+$/m, `fecha_actualizacion: ${date}`);
    content = content.replace(
        /\*(?:Creado|Actualizado|Compactada) por DeepSeek Code el .+\*/,
        `*Actualizado por DeepSeek Code el ${date}*`
    );

    if (Buffer.byteLength(content, 'utf-8') > SESSION_MAX_BYTES) {
        content = compactSessionContent(content);
    }

    await writeFileSafeAsync(sesionFile, content);
    return `✅ Memoria actualizada: ${changed.join(', ')}`;
}

function patchLine(
    content: string,
    sectionTitle: string,
    marker: string,
    replacement: string
): { content: string; changed: boolean } {
    const escapedSection = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedMarker  = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const sectionRe    = new RegExp(`## ${escapedSection}\\n`);
    const sectionMatch = sectionRe.exec(content);
    if (!sectionMatch) return { content, changed: false };

    const sectionStart   = sectionMatch.index + sectionMatch[0].length;
    const afterSection   = content.slice(sectionStart);
    const endMatch       = /\n---\s*\n|\n## /.exec(afterSection);
    const sectionEnd     = endMatch ? sectionStart + endMatch.index : content.length;
    const sectionContent = content.slice(sectionStart, sectionEnd);

    const lineRe = new RegExp(`^- ${escapedMarker}.+$`, 'm');
    if (!lineRe.test(sectionContent)) return { content, changed: false };

    const newSection = sectionContent.replace(lineRe, replacement);
    return {
        content: content.slice(0, sectionStart) + newSection + content.slice(sectionEnd),
        changed: newSection !== sectionContent,
    };
}

function replaceSection(content: string, title: string, newBody: string): { content: string; changed: boolean } {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(## ${escaped}\\n)([\\s\\S]*?)(?=\\n---\\s*\\n|\\n## |$)`);
    if (!re.test(content)) return { content, changed: false };
    const newContent = content.replace(re, `$1${newBody}\n`);
    return { content: newContent, changed: newContent !== content };
}

// ── Templates ─────────────────────────────────────────────────────────────────

function buildSessionTemplate(projectName: string, date: string): string {
    return [
        '---',
        'tags: [memoria, deepseek-code, sesion-actual]',
        `fecha_actualizacion: ${date}`,
        `proyecto: ${projectName}`,
        '---',
        '',
        `# Sesión Actual — ${projectName}`,
        '',
        '> Estado vivo del proyecto. DeepSeek Code lee esto al iniciar.',
        '',
        '---',
        '',
        '## Feature en Curso',
        '- **Nombre:** (Por definir)',
        '- **Progreso:** 0%',
        '',
        '---',
        '',
        '## Issues Activos',
        '1. (Ninguno)',
        '',
        '---',
        '',
        '## Próximos Pasos',
        '1. (Por definir)',
        '',
        '---',
        '',
        '## Aprendizajes del Engine',
        '*(Sin patrones detectados aun)*',
        '',
        '---',
        '',
        `*Creado por DeepSeek Code el ${date}*`,
    ].join('\n');
}

function buildProjectContextTemplate(projectName: string, _stack: string, date: string): string {
    return [
        '---',
        'tags: [memoria, deepseek-code, contexto-proyecto]',
        `fecha_actualizacion: ${date}`,
        `proyecto: ${projectName}`,
        '---',
        '',
        `# Contexto del Proyecto — ${projectName}`,
        '',
        '> Contexto permanente. No se compacta. Actualiza con update_project_context.',
        '',
        '---',
        '',
        '## Stack Técnico',
        '(por definir)',
        '',
        '---',
        '',
        '## Arquitectura',
        '(por definir)',
        '',
        '---',
        '',
        '## Convenciones',
        '(por definir)',
        '',
        '---',
        '',
        '## Proyectos Relacionados',
        '(ninguno)',
        '',
        '---',
        '',
        '## Archivos Clave',
        '(por definir)',
        '',
        '---',
        '',
        `*Creado por DeepSeek Code el ${date}*`,
    ].join('\n');
}

function buildLogTemplate(projectName: string, date: string): string {
    return [
        '---',
        'tags: [memoria, deepseek-code, historial]',
        `fecha_actualizacion: ${date}`,
        `proyecto: ${projectName}`,
        'total_sesiones: 0',
        '---',
        '',
        `# Proyecto Log — ${projectName}`,
        '',
        '> Historial de sesiones y hitos.',
        '',
        '---',
        '',
        '## Historial de Sesiones',
        '',
        '*(Aún no hay sesiones registradas)*',
        '',
        '---',
        '',
        '## Hitos del Proyecto',
        '',
        '| Fecha | Hito | Tipo |',
        '|---|---|---|',
        '',
        '---',
        '',
        `*Creado por DeepSeek Code el ${date}*`,
    ].join('\n');
}
