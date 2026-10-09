/**
 * @description Cache LRU con soporte de TTL, sin dependencias externas.
 *
 * Se apoya en que `Map` preserva el orden de insercion: la primera clave es la
 * menos usada recientemente y `get()` reinserta para marcarla como reciente.
 *
 * Revivido desde `legacy/src/vault/lru-cache.ts` (la implementacion ya era
 * correcta pero solo la usaba el modulo de vault inalcanzable) para acotar el
 * cache de lectura de `encoding.ts`, que crecia sin limite.
 */

interface CacheEntry<V> {
    value: V;
    expiresAt: number;
}

export class LRUCache<K, V> {
    private cache = new Map<K, CacheEntry<V>>();
    private hits = 0;
    private misses = 0;
    private expiredEvictions = 0;

    /**
     * @param maxSize Numero maximo de entradas (default: 100). Debe ser >= 1.
     * @param ttlMs Tiempo de vida en milisegundos. 0 = sin expiracion.
     */
    constructor(private readonly maxSize: number = 100, private readonly ttlMs: number = 0) {
        if (maxSize < 1) throw new Error('LRUCache: maxSize debe ser >= 1');
        if (ttlMs < 0) throw new Error('LRUCache: ttlMs debe ser >= 0');
    }

    /** Recupera un valor y lo marca como recien usado. `undefined` si no esta o expiro. */
    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (entry === undefined) {
            this.misses++;
            return undefined;
        }
        if (this.ttlMs > 0 && Date.now() >= entry.expiresAt) {
            this.cache.delete(key);
            this.expiredEvictions++;
            this.misses++;
            return undefined;
        }
        this.hits++;
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    /** Almacena un valor, renovando el TTL y desalojando el LRU si hace falta. */
    set(key: K, value: V): void {
        const expiresAt = this.ttlMs > 0 ? Date.now() + this.ttlMs : Infinity;

        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                const oldEntry = this.cache.get(oldest)!;
                this.cache.delete(oldest);
                if (this.ttlMs > 0 && Date.now() >= oldEntry.expiresAt) this.expiredEvictions++;
            }
        }
        this.cache.set(key, { value, expiresAt });
    }

    /** true si la clave existe y no expiro (no altera el orden LRU mas alla de la limpieza). */
    has(key: K): boolean {
        const entry = this.cache.get(key);
        if (entry === undefined) return false;
        if (this.ttlMs > 0 && Date.now() >= entry.expiresAt) {
            this.cache.delete(key);
            this.expiredEvictions++;
            return false;
        }
        return true;
    }

    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        this.expiredEvictions = 0;
    }

    get size(): number {
        return this.cache.size;
    }

    /** Elimina las entradas que cumplan el predicado. Devuelve cuantas elimino. */
    deleteWhere(predicate: (key: K, value: V) => boolean): number {
        let deleted = 0;
        for (const [key, entry] of [...this.cache]) {
            if (predicate(key, entry.value)) {
                this.cache.delete(key);
                deleted++;
            }
        }
        return deleted;
    }

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
