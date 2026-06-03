/**
 * @description Stage 1: Instrucciones del proyecto y desarrollador.
 * Carga AGENT.md (instrucciones del equipo) y USER.md (preferencias del dev).
 * USER.md se busca: ~/.deepseek-code/USER.md (global) + override local.
 * El checksum es un hash SHA-256 del contenido concatenado.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

export interface InstructionsResult {
    /** Contenido de AGENT.md, o null si no existe */
    agentMd: string | null;
    /** Contenido de USER.md, o null si no existe */
    userMd: string | null;
    /** Ruta del AGENT.md cargado */
    agentMdPath: string | null;
    /** Ruta del USER.md cargado */
    userMdPath: string | null;
    /** Checksum del contenido combinado */
    checksum: string;
}

/**
 * @description Carga AGENT.md y USER.md para el proyecto.
 * USER.md sigue prioridad: local (override) > global (~/.deepseek-code/USER.md).
 */
export async function runStageInstructions(cwd: string): Promise<{ checksum: string; data: InstructionsResult }> {
    const home = os.homedir();
    const deepseekDir = path.join(home, '.deepseek-code');

    // AGENT.md: solo en el directorio del proyecto
    const agentMdPath = path.join(cwd, 'AGENT.md');
    let agentMd: string | null = null;
    try {
        agentMd = await fs.readFile(agentMdPath, 'utf-8');
    } catch {
        // No existe -- no es error
    }

    // USER.md: prioridad local > global
    const userMdLocal = path.join(cwd, 'USER.md');
    const userMdGlobal = path.join(deepseekDir, 'USER.md');
    let userMd: string | null = null;
    let userMdPath: string | null = null;

    try {
        userMd = await fs.readFile(userMdLocal, 'utf-8');
        userMdPath = userMdLocal;
    } catch {
        try {
            userMd = await fs.readFile(userMdGlobal, 'utf-8');
            userMdPath = userMdGlobal;
        } catch {
            // No existe global ni local
        }
    }

    // Checksum del contenido combinado
    const combined = (agentMd ?? '') + '|' + (userMd ?? '');
    const checksum = createHash('sha256').update(combined, 'utf-8').digest('hex').slice(0, 16);

    return {
        checksum,
        data: {
            agentMd,
            userMd,
            agentMdPath: agentMd ? agentMdPath : null,
            userMdPath,
            checksum,
        },
    };
}
