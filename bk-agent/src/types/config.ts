export interface VaultConfig {
    path: string;
    auto_sync: boolean;
    auto_use: boolean;
    search_paths: string[];
}

export interface ExtractionConfig {
    enabled: boolean;
    trigger: string;
    patterns: boolean;
    snippets: boolean;
    configs: boolean;
    ask_before_extract: boolean;
}

export interface UsageConfig {
    enabled: boolean;
    priority: 'vault_first' | 'generate_first';
    search_before_generate: boolean;
}

export interface NotificationConfig {
    enabled: boolean;
    style: 'inline' | 'summary';
    emojis: boolean;
}

export interface CommandClassifierConfig {
    /** Regex strings adicionales para comandos de larga duración (ej: 'bun\\s+install') */
    additionalLongRunning?: string[];
    /** Regex strings adicionales para servidores de desarrollo */
    additionalServer?: string[];
    /** Regex strings adicionales para comandos peligrosos */
    additionalDangerous?: string[];
}

export interface AIAssistantConfig {
    vault: VaultConfig;
    extraction: ExtractionConfig;
    usage: UsageConfig;
    notification: NotificationConfig;
    /** Directorio de trabajo actual, usado por el evaluador para verificar referencias de archivos */
    cwd?: string;
    /** Patrones adicionales para clasificación de comandos — opcional, no breaking */
    command_classifier?: CommandClassifierConfig;
}

export interface Trigger {
    keywords: string[];
    /** Patron de glob unico (legacy). Usar patterns[] para multiples rutas. */
    pattern?: string;
    /** Patrones de glob especificos. Si esta vacio, usa patron comodin. */
    patterns: string[];
}

export interface Instructions {
    role: string;
    rules: string[];
    triggers: Trigger[];
    format: {
        vaultCode: string;
        newExtract: string;
        businessSpecific: string;
        extractionSuggestion: string;
    };
}

export function defaultInstructions(): Instructions {
    return {
        role: 'asistente',
        rules: [],
        triggers: [],
        format: {
            vaultCode: '📚',
            newExtract: '🆕',
            businessSpecific: '⚠️',
            extractionSuggestion: '🔄',
        },
    };
}
