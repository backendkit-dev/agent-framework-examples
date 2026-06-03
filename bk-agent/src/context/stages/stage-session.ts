/**
 * @description Stage 3: Estado de sesion actual.
 * Carga sesion-actual.md desde ~/.deepseek-code/projects/{key}/memory/.
 * Contiene feature en curso, progreso, issues activos, proximos pasos.
 * Checksum basado en mtime + contenido.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

export interface SessionResult {
    /** Contenido completo de sesion-actual.md, o null si no existe */
    content: string | null;
    /** Ruta del archivo cargado */
    filePath: string | null;
    /** Checksum del contenido */
    checksum: string;
    /** Nombre del feature en curso (extraido del frontmatter o seccion) */
    currentFeature: string | null;
    /** Progreso del feature actual */
    progress: string | null;
}

function cwdToProjectKey(cwd: string): string {
    return cwd
        .replace(/[/\\]$/, '')
        .replace(`:[/\\]`, '--')
        .replace(/[^a-zA-Z0-9-]/g, '-');
}

function getProjectMemoryDir(cwd: string): string {
    const home = os.homedir();
    return path.join(home, '.deepseek-code', 'projects', cwdToProjectKey(cwd), 'memory');
}

function extractFeatureName(content: string): string | null {
    const match = content.match(/\*\*Nombre:\*\*\s*(.+?)(?:\n|$)/);
    return match ? match[1].trim() : null;
}

function extractProgress(content: string): string | null {
    const match = content.match(/\*\*Progreso:\*\*\s*(.+?)(?:\n|$)/);
    return match ? match[1].trim() : null;
}

/**
 * @description Carga el estado de sesion actual desde la memoria persistente.
 */
export async function runStageSession(cwd: string): Promise<{ checksum: string; data: SessionResult }> {
    const memoryDir = getProjectMemoryDir(cwd);
    const filePath = path.join(memoryDir, 'sesion-actual.md');

    let content: string | null = null;
    try {
        content = await fs.readFile(filePath, 'utf-8');
    } catch {
        // No existe -- sesion nueva
    }

    const checksum = content
        ? createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)
        : '';

    return {
        checksum,
        data: {
            content,
            filePath: content ? filePath : null,
            checksum,
            currentFeature: content ? extractFeatureName(content) : null,
            progress: content ? extractProgress(content) : null,
        },
    };
}
