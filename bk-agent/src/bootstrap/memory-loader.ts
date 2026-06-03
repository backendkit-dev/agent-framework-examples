import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MemoryContextInput } from '../agent/system-prompt';
import { BootstrapHook } from '../reflection/hooks/bootstrap-hook';

export interface MemoryContext extends MemoryContextInput {
    activeProject: string;
    sessionContent: string;
    projectContext: string;
    memoryDir: string;
    projectDir: string;
    source: 'local';
}

export interface MemoryLoaderOptions {
    /** Hook opcional para reportar incidentes al Reflection Engine */
    hook?: BootstrapHook;
}

const SESSION_FILE     = 'sesion-actual.md';
const CONTEXT_FILE     = 'contexto-proyecto.md';

// ── Global project directory (mirrors ~/.claude/projects/{cwd-hashed}/) ───────

/**
 * @description Convierte una ruta absoluta en una clave unica para usarla
 * como nombre de directorio de proyecto.
 *
 * Ejemplo: `C:\Users\foo\dev\mi-proyecto` -> `C--Users-foo-dev-mi-proyecto`
 *
 * Util para almacenar archivos por proyecto en ~/.deepseek-code/projects/{key}/.
 */
export function cwdToProjectKey(cwd: string): string {
    return cwd
        .replace(/[/\\]$/, '')          // strip trailing slash
        .replace(/:[/\\]/g, '--')       // C:\ or C:/ -> C--  (drive separator)
        .replace(/[^a-zA-Z0-9-]/g, '-'); // everything else non-alphanumeric -> -
}

export function getProjectMemoryDir(cwd: string = process.cwd()): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    return path.join(home, '.deepseek-code', 'projects', cwdToProjectKey(cwd), 'memory');
}

export function getProjectAuditsDir(cwd: string = process.cwd()): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    return path.join(home, '.deepseek-code', 'projects', cwdToProjectKey(cwd), 'audits');
}

export function getLocalProjectsBaseDir(): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    return path.join(home, '.deepseek-code', 'projects');
}

export function getGlobalAgentsDir(): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    return path.join(home, '.bk-agent', 'agents');
}

export function getGlobalSkillsDir(): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    return path.join(home, '.bk-agent', 'skills');
}

export interface LocalProjectInfo {
    key: string;       // raw directory name, e.g. C--Users-foo-dev-project
    name: string;      // last segment, e.g. "project"
    memoryDir: string;
    isCurrent: boolean;
}

export async function listLocalProjects(currentCwd: string = process.cwd()): Promise<LocalProjectInfo[]> {
    const base = getLocalProjectsBaseDir();
    const currentKey = cwdToProjectKey(currentCwd);
    try {
        const entries = await fs.readdir(base, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory())
            .map(e => {
                const segments = e.name.split('-').filter(Boolean);
                const name = segments[segments.length - 1] ?? e.name;
                return {
                    key: e.name,
                    name,
                    memoryDir: path.join(base, e.name, 'memory'),
                    isCurrent: e.name === currentKey,
                };
            })
            .sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0));
    } catch {
        return [];
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────
// Tries vault first; falls back to local .deepseek-code/memory/ when no vault.

export async function loadMemoryContext(
    vaultPath: string,
    localDir?: string,
    projectName?: string,
    options?: MemoryLoaderOptions
): Promise<MemoryContext | null> {
    // La memoria siempre se lee desde ~/.deepseek-code/projects/{key}/memory/
    // El vault de Obsidian NO almacena memoria de sesion ni contexto de proyecto.
    if (localDir && projectName) {
        return loadLocalMemoryContext(localDir, projectName, options);
    }
    return null;
}

// ── Local memory (.deepseek-code/memory/) ─────────────────────────────────────

export async function loadLocalMemoryContext(
    localDir: string,
    projectName: string,
    options?: MemoryLoaderOptions
): Promise<MemoryContext> {
    await initLocalMemoryFiles(localDir, projectName);

    let sessionContent = '';
    let projectContext = '';
    try {
        sessionContent = await fs.readFile(path.join(localDir, SESSION_FILE), 'utf-8');
    } catch {
        // Reportar fallo de carga de memoria de sesion
        if (options?.hook) {
            await options.hook.reportMemoryLoadFailure(
                path.join(localDir, SESSION_FILE),
                'No se pudo leer el archivo de sesion'
            ).catch((err: any) => {
                console.warn('[memory-loader] Error reporting to Reflection Engine:', err?.message);
            });
        }
    }
    try {
        projectContext = await fs.readFile(path.join(localDir, CONTEXT_FILE), 'utf-8');
    } catch {
        // Reportar fallo de carga de contexto de proyecto
        if (options?.hook) {
            await options.hook.reportMemoryLoadFailure(
                path.join(localDir, CONTEXT_FILE),
                'No se pudo leer el archivo de contexto del proyecto'
            ).catch((err: any) => {
                console.warn('[memory-loader] Error reporting to Reflection Engine:', err?.message);
            });
        }
    }

    return {
        activeProject: projectName,
        sessionContent,
        projectContext,
        memoryDir: localDir,
        projectDir: localDir,
        source: 'local',
    };
}

async function initLocalMemoryFiles(localDir: string, projectName: string): Promise<void> {
    const date = new Date().toISOString().split('T')[0];

    await fs.mkdir(path.join(localDir, 'checkpoints'), { recursive: true });
    // Asegurar que exista el directorio de auditorias (compartido con AuditReporter)
    await fs.mkdir(path.join(localDir, '..', 'audits'), { recursive: true });

    const sesionFile = path.join(localDir, SESSION_FILE);
    try { await fs.access(sesionFile); }
    catch { await fs.writeFile(sesionFile, buildLocalSessionTemplate(projectName, date), 'utf-8'); }

    const ctxFile = path.join(localDir, CONTEXT_FILE);
    try { await fs.access(ctxFile); }
    catch { await fs.writeFile(ctxFile, buildLocalContextTemplate(projectName, date), 'utf-8'); }
}

function buildLocalSessionTemplate(projectName: string, date: string): string {
    return [
        '---',
        'tags: [memoria, deepseek-code, sesion-actual]',
        `fecha_actualizacion: ${date}`,
        `proyecto: ${projectName}`,
        'fuente: local',
        '---',
        '',
        `# Sesion Actual — ${projectName}`,
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
        '## Proximos Pasos',
        '1. (Por definir)',
        '',
        '---',
        '',
        `*Creado por DeepSeek Code el ${date}*`,
    ].join('\n');
}

function buildLocalContextTemplate(projectName: string, date: string): string {
    return [
        '---',
        'tags: [memoria, deepseek-code, contexto-proyecto]',
        `fecha_actualizacion: ${date}`,
        `proyecto: ${projectName}`,
        'fuente: local',
        '---',
        '',
        `# Contexto del Proyecto — ${projectName}`,
        '',
        '> Contexto permanente. Actualiza con update_project_context.',
        '',
        '---',
        '',
        '## Stack Tecnico',
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
        `*Creado por DeepSeek Code el ${date}*`,
    ].join('\n');
}
