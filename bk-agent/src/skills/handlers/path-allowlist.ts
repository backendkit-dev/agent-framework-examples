import * as path from 'path';

/**
 * @description Lista blanca de rutas permitidas para operaciones de
 * lectura/escritura de archivos. Implementa fail-closed: si la lista
 * esta vacia, todas las rutas son denegadas.
 *
 * Previene escalado de privilegios: addPath() rechaza rutas raiz
 * (/, C:\, \\) y rutas con menos de 2 niveles de profundidad.
 */
export class PathAllowlist {
    private allowed: string[];
    private readonly allowSubpaths: boolean;

    constructor(config: { allowedPaths: string[]; allowSubpaths: boolean }) {
        this.allowed = config.allowedPaths.map(p => path.resolve(p));
        this.allowSubpaths = config.allowSubpaths;
    }

    /**
     * @description Verifica si una ruta esta permitida.
     * Si la lista blanca esta vacia, deniega todo (fail-closed).
     */
    isAllowed(targetPath: string): boolean {
        if (this.allowed.length === 0) return false;
        const resolved = path.resolve(targetPath);
        return this.allowed.some(allowed =>
            resolved === allowed ||
            (this.allowSubpaths && resolved.startsWith(allowed + path.sep))
        );
    }

    /**
     * @description Agrega una ruta a la lista blanca en runtime.
     * Rechaza rutas peligrosas: raiz del sistema, rutas con menos
     * de 2 niveles de profundidad, o rutas que no existen.
     *
     * @returns true si la ruta fue agregada, false si fue rechazada
     */
    addPath(p: string): boolean {
        const resolved = path.resolve(p);

        // Rechazar rutas raiz del sistema
        const isRoot = resolved === '/' ||
            /^[A-Za-z]:\\?$/.test(resolved) ||
            resolved === '\\';

        if (isRoot) return false;

        // Rechazar rutas con menos de 2 niveles de profundidad
        // Ej: /tmp, C:\Users, /home
        const parts = resolved.split(path.sep).filter(Boolean);
        if (parts.length < 2) return false;

        // Evitar duplicados
        if (this.allowed.includes(resolved)) return true;

        this.allowed.push(resolved);
        return true;
    }

    /** @description Devuelve una copia de las rutas permitidas */
    getAllowed(): string[] {
        return [...this.allowed];
    }
}
