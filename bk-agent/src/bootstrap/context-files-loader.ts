/**
 * @description Carga archivos de contexto AGENT.md y USER.md desde el workspace.
 * Estos archivos permiten que el proyecto declare instrucciones específicas para
 * la IA (AGENT.md) y preferencias del usuario (USER.md) sin depender del vault.
 * 
 * AGENT.md → Instrucciones del mantenedor del proyecto sobre cómo debe comportarse
 *             la IA: convenciones, patrones preferidos, stack, advertencias.
 * USER.md  → Preferencias personales del desarrollador: estilo de código, nivel
 *             de detalle, frameworks preferidos, restricciones personales.
 * 
 * Ambos siguen el estándar de Cursor/Claude Code para portabilidad entre asistentes.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface ContextFiles {
    /** Contenido de AGENT.md, o null si no existe */
    agentMd: string | null;
    /** Contenido de USER.md, o null si no existe */
    userMd: string | null;
    /** Directorio donde se buscaron */
    sourceDir: string;
}

/** Ruta al memo de lecciones aprendidas dentro de las auditorías del proyecto */
function getLessonsMemoPath(): string {
  const cwd = process.cwd();
  const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
  const projectKey = cwd
    .replace(/[/\\]$/, '')
    .replace(/:[/\\]/g, '--')
    .replace(/[^a-zA-Z0-9-]/g, '-');
  return path.join(home, '.deepseek-code', 'projects', projectKey, 'audits', 'lecciones-aprendidas.md');
}

/**
 * @description Carga el memo de lecciones aprendidas desde las auditorías.
 * Si existe, lo inyecta en el system prompt para que el agente aprenda
 * de errores pasados automáticamente.
 * 
 * @returns Contenido formateado del memo, o null si no existe
 */
export async function loadLessonsMemo(): Promise<string | null> {
  try {
    const content = await fs.readFile(getLessonsMemoPath(), 'utf-8');
    // Extraer solo las lecciones (entre la segunda --- y el ## Detalle)
    const sections = content.split('---');
    if (sections.length >= 3) {
      return sections[2]?.trim() ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @description Busca USER.md en el directorio global (~/.deepseek-code/USER.md) primero,
 * luego cae al directorio del proyecto como fallback para compatibilidad.
 *
 * El archivo global aplica a todos los proyectos sin necesidad de crearlo en cada repo
 * ni agregarlo al .gitignore. El local sobreescribe si existe (útil para overrides por proyecto).
 */
async function loadUserMd(cwd: string): Promise<string | null> {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    const globalPath = path.join(home, '.deepseek-code', 'USER.md');
    const localPath  = path.join(cwd, 'USER.md');

    // Prioridad: local (por proyecto) > global (por desarrollador)
    // El local permite overrides específicos por proyecto sin tocar las preferencias globales.
    try {
        return await fs.readFile(localPath, 'utf-8');
    } catch { /* no existe local */ }

    try {
        return await fs.readFile(globalPath, 'utf-8');
    } catch { /* no existe global */ }

    return null;
}

/**
 * @description Busca y carga AGENT.md y USER.md.
 * - AGENT.md: solo en el directorio del proyecto (es del equipo, va al repo).
 * - USER.md: primero en el proyecto (override local), luego en ~/.deepseek-code/USER.md (global).
 *
 * @param cwd Directorio donde buscar (default: process.cwd())
 * @returns Objeto con los contenidos encontrados
 */
export async function loadContextFiles(cwd: string = process.cwd()): Promise<ContextFiles> {
    let agentMd: string | null = null;

    try {
        agentMd = await fs.readFile(path.join(cwd, 'AGENT.md'), 'utf-8');
    } catch {
        // No existe — no es un error
    }

    const userMd = await loadUserMd(cwd);

    return { agentMd, userMd, sourceDir: cwd };
}

/**
 * @description Convierte el contenido de AGENT.md/USER.md en una sección formateada
 * para inyectar en el system prompt.
 * 
 * @param title Título de la sección (ej: "Instrucciones del Proyecto (AGENT.md)")
 * @param content Contenido del archivo
 * @returns Texto formateado para el system prompt, o string vacío si no hay contenido
 */
export function formatContextFileSection(title: string, content: string | null): string {
    if (!content || !content.trim()) return '';
    return `\n## 📄 ${title}\n> Cargado desde el workspace\n\n${content.trim()}`;
}
