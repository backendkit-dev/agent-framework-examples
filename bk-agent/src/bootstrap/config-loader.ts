import * as fs from 'fs/promises';
import * as yaml from 'yaml';
import * as path from 'path';
import { AIAssistantConfig } from '../types/config';
import { BootstrapHook } from '../reflection/hooks/bootstrap-hook';

export interface ConfigLoaderOptions {
    /** Hook opcional para reportar incidentes al Reflection Engine */
    hook?: BootstrapHook;
}

export async function loadConfig(
    file: string,
    options?: ConfigLoaderOptions
): Promise<AIAssistantConfig | null> {
    try {
        const raw = yaml.parse(await fs.readFile(file, 'utf-8')) as AIAssistantConfig | null;
        if (!raw || typeof raw !== 'object') {
            console.warn(`[ConfigLoader] ${file}: vacío o no es un objeto YAML válido`);
            return null;
        }
        const config = validateAIAssistantConfig(raw);
        if (!config.cwd) config.cwd = process.cwd();
        return config;
    } catch (err) {
        // Reportar config ausente o corrupta al Reflection Engine
        if (options?.hook) {
            const error = err as Error;
            if (error?.message?.includes('ENOENT')) {
                await options.hook.reportMissingConfig(file).catch(() => {});
            } else {
                await options.hook.reportManifestCorrupt(error?.message ?? 'Unknown error', file).catch(() => {});
            }
        }
        return null;
    }
}

function validateAIAssistantConfig(raw: any): AIAssistantConfig {
    const defaults = getDefaultConfig();

    if (raw.vault && typeof raw.vault === 'object') {
        if (typeof raw.vault.path !== 'string') {
            console.warn('[ConfigLoader] vault.path debe ser string — usando ""');
            raw.vault.path = defaults.vault.path;
        }
        if (typeof raw.vault.auto_sync !== 'boolean') raw.vault.auto_sync = defaults.vault.auto_sync;
        if (typeof raw.vault.auto_use !== 'boolean') raw.vault.auto_use = defaults.vault.auto_use;
        if (!Array.isArray(raw.vault.search_paths)) raw.vault.search_paths = defaults.vault.search_paths;
    } else {
        if (raw.vault !== undefined) console.warn('[ConfigLoader] vault debe ser un objeto — usando default');
        raw.vault = defaults.vault;
    }

    if (raw.extraction && typeof raw.extraction === 'object') {
        if (typeof raw.extraction.enabled !== 'boolean') raw.extraction.enabled = defaults.extraction.enabled;
    } else {
        raw.extraction = defaults.extraction;
    }

    if (raw.usage && typeof raw.usage === 'object') {
        const validPriorities = ['vault_first', 'generate_first', 'vault_only'];
        if (!validPriorities.includes(raw.usage.priority)) {
            console.warn(`[ConfigLoader] usage.priority inválido: "${raw.usage.priority}" — usando "vault_first"`);
            raw.usage.priority = 'vault_first';
        }
    } else {
        raw.usage = defaults.usage;
    }

    if (raw.notification && typeof raw.notification !== 'object') {
        raw.notification = defaults.notification;
    }

    return raw as AIAssistantConfig;
}

export function getDefaultConfig(): AIAssistantConfig {
    return {
        vault: { path: '', auto_sync: true, auto_use: true, search_paths: ['04-Recursos'] },
        extraction: { enabled: true, trigger: 'on_feature_complete', patterns: true, snippets: true, configs: true, ask_before_extract: false },
        usage: { enabled: true, priority: 'vault_first', search_before_generate: false },
        notification: { enabled: true, style: 'inline', emojis: true },
        cwd: process.cwd(),
    };
}
