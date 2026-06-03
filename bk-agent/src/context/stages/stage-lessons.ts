/**
 * @description Stage 5: Lecciones aprendidas del sistema.
 * Carga desde dos fuentes complementarias:
 * 1. lessons-fingerprints.json (global, ~/.deepseek-code/) - huellas de errores previos
 * 2. lecciones-aprendidas.md (por proyecto, ~/.deepseek-code/projects/{key}/audits/) - memo
 * Ambos se combinan en un unico resultado.
 * Checksum basado en contenido de ambos archivos.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

export interface LessonsResult {
    /** Memo de lecciones aprendidas del proyecto (lecciones-aprendidas.md) */
    memo: string | null;
    /** Huellas digitales de errores (lessons-fingerprints.json) */
    fingerprints: Record<string, unknown> | null;
    /** Cantidad de fingerprints cargados */
    fingerprintCount: number;
    /** Ruta del memo cargado */
    memoPath: string | null;
    /** Ruta de fingerprints cargados */
    fingerprintsPath: string | null;
    /** Checksum combinado de ambos */
    checksum: string;
}

function cwdToProjectKey(cwd: string): string {
    return cwd
        .replace(/[/\\]$/, '')
        .replace(/:[/\\]/g, '--')
        .replace(/[^a-zA-Z0-9-]/g, '-');
}

function getProjectAuditsDir(cwd: string): string {
    const home = os.homedir();
    return path.join(home, '.deepseek-code', 'projects', cwdToProjectKey(cwd), 'audits');
}

function getGlobalLessonsDir(): string {
    return path.join(os.homedir(), '.deepseek-code');
}

/**
 * @description Carga el memo de lecciones aprendidas (lecciones-aprendidas.md).
 * El memo esta en ~/.deepseek-code/projects/{key}/audits/lecciones-aprendidas.md
 * y es generado por el AuditReporter.
 */
async function loadLessonsMemo(cwd: string): Promise<string | null> {
    const filePath = path.join(getProjectAuditsDir(cwd), 'lecciones-aprendidas.md');
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        // Extraer solo el cuerpo util (entre la segunda --- y el proximo ## o fin)
        const sections = content.split('---');
        if (sections.length >= 3) {
            return sections[2]?.trim() ?? null;
        }
        return content.trim() || null;
    } catch {
        return null;
    }
}

/**
 * @description Carga las huellas digitales de errores (lessons-fingerprints.json).
 * Este archivo contiene errores previos registrados por los hooks del sistema.
 */
async function loadLessonsFingerprints(): Promise<Record<string, unknown> | null> {
    const filePath = path.join(getGlobalLessonsDir(), 'lessons-fingerprints.json');
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * @description Stage 5: Carga lecciones aprendidas y fingerprints.
 */
export async function runStageLessons(cwd: string): Promise<{ checksum: string; data: LessonsResult }> {
    const [memo, fingerprints] = await Promise.all([
        loadLessonsMemo(cwd),
        loadLessonsFingerprints(),
    ]);

    // Calcular checksum combinado
    const rawForHash = (memo ?? '') + '|' + JSON.stringify(fingerprints ?? {});
    const checksum = createHash('sha256').update(rawForHash, 'utf-8').digest('hex').slice(0, 16);

    const fingerprintCount = fingerprints
        ? Object.keys(fingerprints).length
        : 0;

    return {
        checksum,
        data: {
            memo,
            fingerprints,
            fingerprintCount,
            memoPath: memo ? path.join(getProjectAuditsDir(cwd), 'lecciones-aprendidas.md') : null,
            fingerprintsPath: fingerprints ? path.join(getGlobalLessonsDir(), 'lessons-fingerprints.json') : null,
            checksum,
        },
    };
}
