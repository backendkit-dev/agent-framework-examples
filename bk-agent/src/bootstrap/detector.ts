import * as path from 'path';
import * as fs from 'fs/promises';
import { BootstrapHook } from '../reflection/hooks/bootstrap-hook';

export interface DetectedFiles {
    aiAssistantDir: string;
    vaultLinkFile: string;
    configFile: string;
    contextFile: string;
    instructionsFile: string;
    exists: boolean;
}

export interface DetectorOptions {
    /** Hook opcional para reportar incidentes al Reflection Engine */
    hook?: BootstrapHook;
}

export async function detectProjectFiles(
    cwd = process.cwd(),
    options?: DetectorOptions
): Promise<DetectedFiles> {
    const ai = path.join(cwd, '.ai-assistant');
    const vaultLink = path.join(cwd, '.obsidian-vault', 'link.txt');
    const exists = await fs.access(ai).then(() => true).catch(() => false);

    // Reportar al Reflection Engine si no existe el directorio .ai-assistant
    if (!exists && options?.hook) {
        await options.hook.reportMissingConfig(ai).catch((err: any) => {
            console.warn('[detector] Error reporting to Reflection Engine:', err?.message);
        });
    }

    return {
        aiAssistantDir: ai,
        vaultLinkFile: vaultLink,
        configFile: path.join(ai, 'config.yaml'),
        contextFile: path.join(ai, 'context.md'),
        instructionsFile: path.join(ai, 'instructions.md'),
        exists,
    };
}
