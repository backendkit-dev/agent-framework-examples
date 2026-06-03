/**
 * @description Interfaz VaultProvider para desacoplar la fuente del vault
 * de la logica de busqueda. Permite cambiar entre filesystem, git, S3, API
 * o un mock en memoria sin modificar el codigo de busqueda.
 *
 * Fase 2 del plan de refactorizacion: desacoplar searchVaultPatterns
 * de glob + fs.readFile sobre estructura fija 04-Recursos/**\/*.md.
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { glob } from 'glob';

/**
 * @description Resultado de una busqueda en el vault.
 * path es la ruta relativa o identificador del recurso encontrado.
 * content es el contenido completo del archivo.
 */
export interface VaultEntry {
  path: string;
  content: string;
}

/**
 * @description Interfaz abstracta para acceso al vault.
 * Implementaciones concretas: FileSystemVaultProvider, MockVaultProvider.
 *
 * Metodos:
 * - search(patterns, searchPaths): busca archivos por patrones glob
 * - read(filePath): lee el contenido completo de un archivo
 * - exists(filePath): verifica si un archivo existe
 */
export interface VaultProvider {
  /**
   * @description Busca archivos en el vault que matcheen los patrones glob.
   * @param patterns - Patrones glob a buscar (ej: ['**\/*.md', 'Backend\/**\/*.ts'])
   * @param searchPaths - Directorios base donde buscar (relativos al vault root)
   * @returns Lista de entradas encontradas con ruta y contenido
   */
  search(patterns: string[], searchPaths: string[]): Promise<VaultEntry[]>;

  /**
   * @description Lee el contenido completo de un archivo del vault.
   * @param filePath - Ruta absoluta o relativa al vault
   * @returns Contenido del archivo, o null si no existe o hay error
   */
  read(filePath: string): Promise<string | null>;

  /**
   * @description Verifica si un archivo existe en el vault.
   * @param filePath - Ruta absoluta o relativa al vault
   */
  exists(filePath: string): Promise<boolean>;
}

/**
 * @description Implementacion concreta de VaultProvider que accede al
 * filesystem local usando glob + fs.readFile. Encapsula la logica actual
 * de searchVaultPatterns.
 *
 * No lanza excepciones: los metodos devuelven null o arrays vacios
 * siguiendo la convencion de modulos de carga silenciosos.
 */
export class FileSystemVaultProvider implements VaultProvider {
  private vaultRoot: string;

  constructor(vaultRoot: string) {
    this.vaultRoot = vaultRoot;
  }

  /**
   * @description Busca archivos en el vault usando patrones glob.
   * Itera sobre searchPaths combinados con cada pattern.
   * Retorna hasta 20 resultados para evitar sobrecarga.
   */
  async search(patterns: string[], searchPaths: string[]): Promise<VaultEntry[]> {
    if (!this.vaultRoot) return [];
    const results: VaultEntry[] = [];
    const MAX_RESULTS = 20;

    for (const sp of searchPaths) {
      for (const pattern of patterns) {
        if (results.length >= MAX_RESULTS) break;
        const searchPattern = path.join(this.vaultRoot, sp, pattern).replace(/\\/g, '/');
        try {
          const files = await glob(searchPattern, { nodir: true });
          for (const file of files) {
            if (results.length >= MAX_RESULTS) break;
            const content = await this.read(file);
            if (content !== null) {
              results.push({ path: file, content });
            }
          }
        } catch {
          // Fallo silencioso: patron invalido o directorio no existe
        }
      }
      if (results.length >= MAX_RESULTS) break;
    }

    return results;
  }

  /**
   * @description Lee un archivo del vault. Retorna null si no existe
   * o hay error de lectura (encoding, permisos).
   */
  async read(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * @description Verifica si un archivo existe en el vault.
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * @description Implementacion de VaultProvider para tests.
 * Almacena los archivos en un Map en memoria.
 * No toca disco real.
 *
 * @example
 * ```ts
 * const mock = new MockVaultProvider();
 * mock.addEntry('04-Recursos/Backend/nestjs-pattern.md', '# NestJS Module...');
 * const results = await mock.search(['**\/*.md'], ['04-Recursos']);
 * ```
 */
export class MockVaultProvider implements VaultProvider {
  private entries: Map<string, string> = new Map();

  /**
   * @description Agrega una entrada al vault en memoria.
   * @param filePath - Ruta relativa del archivo (ej: '04-Recursos/Backend/patron.md')
   * @param content - Contenido del archivo
   */
  addEntry(filePath: string, content: string): void {
    this.entries.set(filePath, content);
  }

  /**
   * @description Elimina una entrada del vault en memoria.
   */
  removeEntry(filePath: string): void {
    this.entries.delete(filePath);
  }

  /**
   * @description Limpia todas las entradas del vault en memoria.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * @description Busca archivos en memoria que matcheen los patrones glob.
   * Usa minimatch para comparar patrones contra las rutas almacenadas.
   */
  async search(patterns: string[], searchPaths: string[]): Promise<VaultEntry[]> {
    const results: VaultEntry[] = [];
    const { minimatch } = await import('minimatch');

    for (const [filePath, content] of this.entries) {
      const matchesSearchPath = searchPaths.length === 0 ||
        searchPaths.some(sp => filePath.startsWith(sp + '/') || filePath.startsWith(sp + '\\'));

      if (!matchesSearchPath) continue;

      const matchesPattern = patterns.length === 0 ||
        patterns.some(p => minimatch(filePath, p));

      if (matchesPattern) {
        results.push({ path: filePath, content });
      }
    }

    return results;
  }

  /**
   * @description Lee una entrada del vault en memoria.
   * @returns Contenido o null si no existe
   */
  async read(filePath: string): Promise<string | null> {
    return this.entries.get(filePath) ?? null;
  }

  /**
   * @description Verifica si una entrada existe en el vault en memoria.
   */
  async exists(filePath: string): Promise<boolean> {
    return this.entries.has(filePath);
  }
}
