import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LRUCache } from '../src/shared/utils/lru-cache';
import { readFileSafe, clearReadCache, readFileSafeAsync } from '../src/shared/utils/encoding';

describe('LRUCache', () => {
    it('rechaza tamanos invalidos', () => {
        expect(() => new LRUCache(0)).toThrow(/maxSize/);
        expect(() => new LRUCache(1, -1)).toThrow(/ttlMs/);
    });

    it('devuelve undefined para claves ausentes y cuenta el miss', () => {
        const cache = new LRUCache<string, number>(2);
        expect(cache.get('a')).toBeUndefined();
        expect(cache.stats().misses).toBe(1);
    });

    it('desaloja la entrada menos usada al superar maxSize', () => {
        const cache = new LRUCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        expect(cache.get('a')).toBe(1); // 'a' pasa a ser la mas reciente
        cache.set('c', 3);              // desaloja 'b'
        expect(cache.has('b')).toBe(false);
        expect(cache.get('a')).toBe(1);
        expect(cache.get('c')).toBe(3);
        expect(cache.size).toBe(2);
    });

    it('expira por TTL', async () => {
        const cache = new LRUCache<string, number>(4, 10);
        cache.set('a', 1);
        expect(cache.get('a')).toBe(1);
        await new Promise((r) => setTimeout(r, 25));
        expect(cache.get('a')).toBeUndefined();
        expect(cache.stats().expiredEvictions).toBeGreaterThan(0);
    });

    it('deleteWhere elimina por predicado', () => {
        const cache = new LRUCache<string, number>(4);
        cache.set('file::a', 1);
        cache.set('file::b', 2);
        cache.set('otro::c', 3);
        expect(cache.deleteWhere((k) => k.startsWith('file::'))).toBe(2);
        expect(cache.size).toBe(1);
    });

    it('clear reinicia el cache y las estadisticas', () => {
        const cache = new LRUCache<string, number>(4);
        cache.set('a', 1);
        cache.get('a');
        cache.clear();
        expect(cache.size).toBe(0);
        expect(cache.stats()).toMatchObject({ hits: 0, misses: 0, size: 0, maxSize: 4 });
    });
});

describe('cache de lectura de encoding', () => {
    let dir: string;

    beforeEach(() => {
        clearReadCache();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-encoding-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('no crece sin limite: el cache esta acotado a 200 entradas', () => {
        // 250 archivos distintos: si el cache no estuviera acotado, los 250 quedarian en memoria.
        for (let i = 0; i < 250; i++) {
            const file = path.join(dir, `f${i}.txt`);
            fs.writeFileSync(file, `contenido ${i}`, 'utf-8');
            expect(readFileSafe(file).content).toBe(`contenido ${i}`);
        }
        // Se puede volver a leer todo (los primeros se desalojaron, pero el archivo sigue en disco)
        for (const i of [0, 100, 249]) {
            expect(readFileSafe(path.join(dir, `f${i}.txt`)).content).toBe(`contenido ${i}`);
        }
    });

    it('sirve del cache cuando el archivo no cambio', () => {
        const file = path.join(dir, 'cache.txt');
        fs.writeFileSync(file, 'v1', 'utf-8');
        const first = readFileSafe(file);
        const second = readFileSafe(file);
        expect(second.content).toBe('v1');
        expect(second).not.toBe(first); // ReadResult es un objeto nuevo en cada decodificacion
    });
});

describe('decodificacion UTF-16', () => {
    let dir: string;

    beforeEach(() => {
        clearReadCache();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-utf16-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('lee UTF-16LE con BOM sin NUL intercalados', () => {
        const file = path.join(dir, 'le-bom.txt');
        fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hola mundo', 'utf16le')]));
        const result = readFileSafe(file);
        expect(result.content).toBe('Hola mundo');
        expect(result.content).not.toContain('\u0000');
        expect(result.hadBOM).toBe(true);
    });

    it('lee UTF-16LE sin BOM', () => {
        const file = path.join(dir, 'le.txt');
        fs.writeFileSync(file, Buffer.from('Configuración', 'utf16le'));
        expect(readFileSafe(file).content).toBe('Configuración');
    });

    it('lee UTF-16BE con BOM', () => {
        const file = path.join(dir, 'be.txt');
        const le = Buffer.from('Hola', 'utf16le');
        const be = Buffer.from(le); be.swap16();
        fs.writeFileSync(file, Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
        const result = readFileSafe(file);
        expect(result.content).toBe('Hola');
        expect(result.content).not.toContain('\u0000');
    });

    it('lee UTF-16LE de forma asincrona', async () => {
        const file = path.join(dir, 'le-async.txt');
        fs.writeFileSync(file, Buffer.from('Asíncrono', 'utf16le'));
        const result = await readFileSafeAsync(file);
        expect(result.content).toBe('Asíncrono');
    });
});
