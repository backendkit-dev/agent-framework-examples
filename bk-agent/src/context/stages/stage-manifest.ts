/**
 * @description Stage 4: Manifest global de configuracion.
 * Carga manifest.yaml desde ~/.deepseek-code/manifest.yaml.
 * Contiene orquestador, capabilityMatrix, policyRules, agents, skills, projects.
 * Checksum basado en contenido del archivo.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import * as yaml from 'yaml';

export interface ManifestResult {
    /** Contenido raw del manifest.yaml, o null si no existe */
    rawContent: string | null;
    /** Objeto parseado del YAML, o null si no se pudo parsear */
    parsed: Record<string, unknown> | null;
    /** Ruta del archivo cargado */
    filePath: string | null;
    /** Checksum del contenido */
    checksum: string;
}

/**
 * @description Carga el manifest.yaml global desde ~/.deepseek-code/.
 */
export async function runStageManifest(): Promise<{ checksum: string; data: ManifestResult }> {
    const home = os.homedir();
    const filePath = path.join(home, '.deepseek-code', 'manifest.yaml');

    let rawContent: string | null = null;
    let parsed: Record<string, unknown> | null = null;

    try {
        rawContent = await fs.readFile(filePath, 'utf-8');
        parsed = yaml.parse(rawContent) as Record<string, unknown> ?? null;
    } catch {
        // No existe o no se puede parsear
    }

    const checksum = rawContent
        ? createHash('sha256').update(rawContent, 'utf-8').digest('hex').slice(0, 16)
        : '';

    return {
        checksum,
        data: {
            rawContent,
            parsed,
            filePath: rawContent ? filePath : null,
            checksum,
        },
    };
}
