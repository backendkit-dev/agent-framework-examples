/**
 * @description Stage 2: Contexto del proyecto.
 * Carga contexto-proyecto.md desde ~/.deepseek-code/projects/{key}/memory/.
 * Contiene stack, arquitectura, convenciones, archivos clave, etc.
 * Checksum basado en mtime + tamanio del archivo.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

export interface ProjectResult {
    /** Contenido completo de contexto-proyecto.md, o null si no existe */
    content: string | null;
    /** Ruta del archivo cargado */
    filePath: string | null;
    /** Checksum del contenido */
    checksum: string;
}

/**
 * @description Convierte una ruta absoluta en una clave unica de proyecto.
 * Ref: src/bootstrap/memory-loader.ts -> cwdToProjectKey()
 */
function cwdToProjectKey(cwd: string): string {
    return cwd
        .replace(/[/\\]$/, '')
        .replace(/:[/\\]/g, '--')
        .replace(/[^a-zA-Z0-9-]/g, '-');
}

function getProjectMemoryDir(cwd: string): string {
    const home = os.homedir();
    return path.join(home, '.deepseek-code', 'projects', cwdToProjectKey(cwd), 'memory');
}

/**
 * @description Carga el contexto del proyecto desde la memoria persistente.
 */
export async function runStageProject(cwd: string): Promise<{ checksum: string; data: ProjectResult }> {
    const memoryDir = getProjectMemoryDir(cwd);
    const filePath = path.join(memoryDir, 'contexto-proyecto.md');

    let content: string | null = null;
    try {
        content = await fs.readFile(filePath, 'utf-8');
    } catch {
        // No existe -- proyecto nuevo o sin contexto
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
        },
    };
}
