import * as path from 'path';
import * as fs from 'fs/promises';
import { AIAssistantConfig, ExtractionConfig } from '../types/config';
import { writeFileSafeResult } from '../shared/utils/encoding';
import { Result, ok, fail } from '../shared/result';

/**
 * @description Candidato a extraccion detectado automaticamente.
 */
export interface VaultExtractionCandidate {
    /** Ruta relativa sugerida dentro del vault (ej: 04-Recursos/Backend/Patrones/mi-patron.md) */
    suggestedPath: string;
    /** Nombre del patron */
    name: string;
    /** Confianza de que es un patron generico reutilizable (0-1) */
    confidence: number;
    /** Codigo o contenido a extraer */
    content: string;
    /** Tags sugeridos para el frontmatter */
    tags: string[];
    /** Descripcion corta */
    description: string;
}

/**
 * @description Detecta si un fragmento de codigo es un patron generico
 * reutilizable (vs. codigo especifico del negocio).
 *
 * Criterios de patron generico:
 * - Define una clase abstracta, interfaz o type con nombre generico
 * - Contiene configuraciones reutilizables (Dockerfile, CI/CD, tsconfig)
 * - Implementa un patron conocido (factory, builder, strategy, middleware)
 * - Es independiente del dominio del negocio
 *
 * @param content - Codigo o contenido a analizar
 * @returns Candidatos de extraccion detectados, o array vacio si no hay
 */
export function detectGenericPatterns(content: string): VaultExtractionCandidate[] {
    const candidates: VaultExtractionCandidate[] = [];
    const lines = content.split('\n');

    // Detectar clases abstractas
    const abstractClassMatch = content.match(/export\s+abstract\s+class\s+(\w+)/);
    if (abstractClassMatch) {
        const name = abstractClassMatch[1];
        const isDomainSpecific = isBusinessSpecific(name, content);
        if (!isDomainSpecific) {
            candidates.push({
                suggestedPath: `04-Recursos/Backend/Patrones/${toKebabCase(name)}.md`,
                name,
                confidence: 0.8,
                content: extractRelevantBlock(content, abstractClassMatch.index ?? 0),
                tags: ['backend', 'typescript', 'patron', toKebabCase(name)],
                description: `Patron abstracto ${name} detectado en el codigo generado`,
            });
        }
    }

    // Detectar interfaces genericas
    const interfaceMatches = content.matchAll(/export\s+interface\s+(\w+)\s*{/g);
    for (const match of interfaceMatches) {
        const name = match[1];
        if (isGenericInterfaceName(name) && !isBusinessSpecific(name, content)) {
            candidates.push({
                suggestedPath: `04-Recursos/Backend/Patrones/${toKebabCase(name)}.md`,
                name,
                confidence: 0.7,
                content: extractInterfaceBlock(content, match.index ?? 0),
                tags: ['backend', 'typescript', 'interfaz', toKebabCase(name)],
                description: `Interfaz generica ${name} detectada`,
            });
        }
    }

    // Detectar configuraciones reutilizables
    if (content.includes('tsconfig') || content.includes('"compilerOptions"')) {
        candidates.push({
            suggestedPath: '04-Recursos/Backend/TypeScript/tsconfig-strict.md',
            name: 'tsconfig-strict',
            confidence: 0.6,
            content: content,
            tags: ['backend', 'typescript', 'configuracion', 'tsconfig'],
            description: 'Configuracion estricta de TypeScript detectada',
        });
    }

    if (content.includes('Dockerfile') || content.includes('docker-compose')) {
        candidates.push({
            suggestedPath: '04-Recursos/DevOps/Docker/docker-config-template.md',
            name: 'docker-config-template',
            confidence: 0.6,
            content: content,
            tags: ['devops', 'docker', 'configuracion'],
            description: 'Configuracion de Docker detectada',
        });
    }

    // Detectar value objects (patron DDD)
    if (content.includes('private constructor') && content.includes('static create')) {
        const voMatch = content.match(/class\s+(\w+)\s*\{/);
        if (voMatch) {
            const name = voMatch[1];
            if (!isBusinessSpecific(name, content)) {
                candidates.push({
                    suggestedPath: `04-Recursos/Backend/Patrones/ValueObjects/${toKebabCase(name)}.md`,
                    name,
                    confidence: 0.75,
                    content: extractRelevantBlock(content, voMatch.index ?? 0),
                    tags: ['backend', 'typescript', 'ddd', 'value-object', toKebabCase(name)],
                    description: `Value Object ${name} con patron factory (static create)`,
                });
            }
        }
    }

    // Limitar a maximo 3 candidatos para no abrumar al usuario
    return candidates.slice(0, 3);
}

/**
 * @description Extrae un bloque de codigo relevante desde una posicion dada.
 * Toma desde esa linea hasta el cierre del bloque (} al mismo nivel).
 */
function extractRelevantBlock(content: string, startIndex: number): string {
    const fromStart = content.slice(startIndex);
    const lines = fromStart.split('\n');

    let braceCount = 0;
    let started = true;
    const block: string[] = [];

    for (const line of lines) {
        block.push(line);
        for (const ch of line) {
            if (ch === '{') { braceCount++; started = true; }
            if (ch === '}') { braceCount--; }
        }
        if (started && braceCount <= 0 && block.length > 1) {
            break;
        }
    }

    return block.join('\n');
}

/**
 * @description Extrae el bloque de una interfaz (hasta }).
 */
function extractInterfaceBlock(content: string, startIndex: number): string {
    return extractRelevantBlock(content, startIndex);
}

/**
 * @description Determina si un nombre o contenido es especifico del negocio
 * (y por lo tanto NO debe extraerse como patron generico).
 */
function isBusinessSpecific(name: string, content: string): boolean {
    const businessPatterns = [
        // Nombres que suenan a dominio del negocio
        /\b(Incident|Appointment|Locker|Corner|Customer|Technician|Schedule|Slot|Company)\w*\b/,
        // Referencia a tablas o entidades de negocio
        /\b(users|products|orders|invoices|payments|customers|appointments|incidents)\b/i,
        // URLs o endpoints de negocio
        /\/api\/v\d+\//,
        // Nombres de metodos muy especificos
        /\b(getBy|findAll|create|update|delete)\w*By\w+/,
    ];

    for (const pattern of businessPatterns) {
        if (pattern.test(name) || pattern.test(content)) return true;
    }

    return false;
}

/**
 * @description Nombres de interfaz que suenan genericos (reutilizables).
 */
function isGenericInterfaceName(name: string): boolean {
    const genericPrefixes = [
        'I', 'Abstract', 'Base', 'Generic', 'Config', 'Options',
        'Result', 'Response', 'Request', 'Handler', 'Middleware',
        'Factory', 'Builder', 'Strategy', 'Repository', 'Service',
    ];

    return genericPrefixes.some(p => name.startsWith(p) || name.endsWith(p.replace(/^I/, '')));
}

/**
 * @description Convierte PascalCase a kebab-case.
 */
function toKebabCase(str: string): string {
    return str
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
}

/**
 * @description Error de extraccion al vault.
 * code indica la causa: PATH_TRAVERSAL | WRITE_ERROR | MKDIR_ERROR
 */
export interface ExtractionError {
  code: 'PATH_TRAVERSAL' | 'WRITE_ERROR' | 'MKDIR_ERROR';
  message: string;
  suggestedPath: string;
}

/**
 * @description Extrae un candidato de patron al vault con frontmatter completo.
 * No lanza excepciones: retorna Result con el error si algo falla.
 *
 * @param code - Codigo o contenido a extraer
 * @param suggestedPath - Ruta relativa dentro del vault
 * @param config - Configuracion del AI Assistant (vault, extraction)
 * @returns Ruta absoluta del archivo escrito, o ExtractionError
 */
export async function extractToVault(
    code: string,
    suggestedPath: string,
    config: AIAssistantConfig
): Promise<Result<string, ExtractionError>> {
    const full = path.resolve(config.vault.path, suggestedPath);

    // Validar que la ruta este dentro del vault
    const vaultRoot = path.resolve(config.vault.path);
    if (!full.startsWith(vaultRoot + path.sep) && full !== vaultRoot) {
      return fail({
        code: 'PATH_TRAVERSAL',
        message: `La ruta ${suggestedPath} esta fuera del vault.`,
        suggestedPath,
      });
    }

    const today = new Date().toISOString().split('T')[0];
    const name = path.basename(suggestedPath, '.md');
    const dir = path.dirname(suggestedPath);

    const tags = dir.split('/').filter(Boolean).map(t => t.toLowerCase());
    tags.push(name);
    tags.push('bk-agent-extract');

    const frontmatter = [
        '---',
        `title: "${name}"`,
        `description: "Patron extraido por DeepSeek Code"`,
        `date: ${today}`,
        `source: bk-agent-extract`,
        'tags:',
        ...tags.map(t => `  - ${t}`),
        '---',
    ].join('\n');

    const fileContent = `${frontmatter}\n\n# ${name}\n\n${code}\n`;

    try {
      await fs.mkdir(path.dirname(full), { recursive: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail({
        code: 'MKDIR_ERROR',
        message: `No se pudo crear el directorio: ${msg}`,
        suggestedPath,
      });
    }

    const writeResult = await writeFileSafeResult(full, fileContent);
    if (!writeResult.success) {
      return fail({
        code: 'WRITE_ERROR',
        message: `No se pudo escribir el archivo: ${writeResult.error.message}`,
        suggestedPath,
      });
    }

    return ok(full);
}

/**
 * @description Intenta extraer patrones genericos de una respuesta.
 * Analiza el contenido, detecta patrones reutilizables y,
 * si la configuracion lo permite, pregunta al usuario.
 *
 * @param responseContent - Contenido de la respuesta del agente
 * @param config - Configuracion del vault y extraccion
 * @param askConfirmation - Funcion de confirmacion del usuario
 * @returns Lista de rutas donde se extrajeron patrones (vacio si ninguno)
 */
export async function tryAutoExtract(
    responseContent: string,
    config: AIAssistantConfig,
    askConfirmation: (msg: string) => Promise<boolean>,
): Promise<string[]> {
    if (!config.extraction?.enabled) return [];
    if (!config.vault?.path) return [];

    const candidates = detectGenericPatterns(responseContent);
    if (candidates.length === 0) return [];

    const extracted: string[] = [];

    for (const candidate of candidates) {
        const shouldAsk = config.extraction.ask_before_extract ?? true;

        let proceed = true;
        if (shouldAsk) {
            const msg = [
                `Se detecto un posible patron reutilizable:`,
                ``,
                `  Nombre: ${candidate.name}`,
                `  Confianza: ${Math.round(candidate.confidence * 100)}%`,
                `  Ruta: ${candidate.suggestedPath}`,
                `  Descripcion: ${candidate.description}`,
                ``,
                `Extraer al vault?`,
            ].join('\n');
            proceed = await askConfirmation(msg);
        }

        if (proceed) {
            const result = await extractToVault(
                candidate.content,
                candidate.suggestedPath,
                config
            );
            if (result.success) {
                extracted.push(result.value);
            } else {
                console.error(`[extractor] Error extrayendo ${candidate.name}: ${result.error.message}`);
            }
        }
    }

    return extracted;
}
