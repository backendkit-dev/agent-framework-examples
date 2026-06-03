/**
 * @description Cache LRU simple con soporte de TTL para resultados de busqueda en vault.
 * Implementacion manual sin dependencias externas usando Map,
 * que preserva orden de insercion en JS.
 *
 * Valor: evita releer archivos del vault cuando la busqueda ya se hizo,
 * reduciendo latencia en busquedas repetitivas (misma query -> mismo resultado).
 * El TTL asegura que resultados antiguos no se sirvan indefinidamente.
 */

interface CacheEntry<V> {
    value: V;
    expiresAt: number;
}

export class LRUCache<K, V> {
    private cache: Map<K, CacheEntry<V>>;
    private maxSize: number;
    private ttlMs: number;
    private hits = 0;
    private misses = 0;
    private expiredEvictions = 0;

    /**
     * @param maxSize Numero maximo de entradas en el cache (default: 100)
     * @param ttlMs Tiempo de vida en milisegundos. 0 = sin expiracion (default: 0)
     */
    constructor(maxSize: number = 100, ttlMs: number = 0) {
        if (maxSize < 1) throw new Error('LRUCache: maxSize debe ser >= 1');
        if (ttlMs < 0) throw new Error('LRUCache: ttlMs debe ser >= 0');
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    /**
     * @description Recupera un valor del cache y lo marca como recien usado.
     * Si la entrada expiro, la elimina y retorna undefined (cache miss).
     * @returns El valor o undefined si no existe o expiro
     */
    get(key: K): V | undefined {
        if (!this.cache.has(key)) {
            this.misses++;
            return undefined;
        }

        const entry = this.cache.get(key)!;

        // TTL check: si expiro, eliminar y tratar como miss
        if (this.ttlMs > 0 && Date.now() >= entry.expiresAt) {
            this.cache.delete(key);
            this.expiredEvictions++;
            this.misses++;
            return undefined;
        }

        this.hits++;
        // Mover al final = mas reciente
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    /**
     * @description Almacena un valor en el cache con el TTL configurado.
     * Si la clave ya existe, la renueva. Si el cache esta lleno,
     * elimina el elemento menos recientemente usado (LRU).
     */
    set(key: K, value: V): void {
        const expiresAt = this.ttlMs > 0 ? Date.now() + this.ttlMs : Infinity;

        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // El primer elemento del Map es LRU
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                const firstEntry = this.cache.get(firstKey)!;
                this.cache.delete(firstKey);
                // Si el LRU estaba expirado, contarlo
                if (this.ttlMs > 0 && Date.now() >= firstEntry.expiresAt) {
                    this.expiredEvictions++;
                }
            }
        }
        this.cache.set(key, { value, expiresAt });
    }

    /**
     * @description Verifica si una clave existe y no ha expirado,
     * sin alterar el orden LRU.
     */
    has(key: K): boolean {
        if (!this.cache.has(key)) return false;
        if (this.ttlMs > 0) {
            const entry = this.cache.get(key)!;
            if (Date.now() >= entry.expiresAt) {
                this.cache.delete(key);
                this.expiredEvictions++;
                return false;
            }
        }
        return true;
    }

    /**
     * @description Vacia completamente el cache.
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        this.expiredEvictions = 0;
    }

    get size(): number {
        return this.cache.size;
    }

    /**
     * @description Elimina entradas que cumplan un predicado.
     * @returns Numero de entradas eliminadas
     */
    deleteWhere(predicate: (key: K, value: V) => boolean): number {
        let deleted = 0;
        for (const [key, entry] of this.cache) {
            if (predicate(key, entry.value)) {
                this.cache.delete(key);
                deleted++;
            }
        }
        return deleted;
    }

    /**
     * @description Estadisticas de rendimiento del cache.
     */
    stats(): { hits: number; misses: number; hitRate: number; size: number; maxSize: number; expiredEvictions: number } {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
            size: this.cache.size,
            maxSize: this.maxSize,
            expiredEvictions: this.expiredEvictions,
        };
    }
}
