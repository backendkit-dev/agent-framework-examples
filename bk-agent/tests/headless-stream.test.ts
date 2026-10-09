import { HeadlessStreamFilter, HeadlessEmission } from '../src/ui/headless-stream';

/** Junta las emisiones en un texto para aserciones legibles. */
function textOf(emissions: HeadlessEmission[]): string {
    return emissions.map((e) => (e.type === 'token' ? e.content : `[RECAP:${e.text}]`)).join('');
}

function feed(filter: HeadlessStreamFilter, chunks: string[]): HeadlessEmission[] {
    return chunks.flatMap((c) => filter.push(c));
}

describe('HeadlessStreamFilter', () => {
    it('emite el texto normal reteniendo los ultimos caracteres', () => {
        const filter = new HeadlessStreamFilter();
        const out = feed(filter, ['Hola mundo']);
        // se retienen los ultimos 8 caracteres ("la mundo") hasta el flush
        expect(textOf(out)).toBe('Ho');
        expect(textOf(filter.flush())).toBe('la mundo');
    });

    it('separa el bloque recap del texto previo', () => {
        const filter = new HeadlessStreamFilter();
        const out = feed(filter, ['Listo el cambio.<recap>Hice X. Sigue Y.</recap>']);
        // al encontrar el marcador se emite TODO el texto previo (no se retiene)
        expect(out).toEqual([
            { type: 'token', content: 'Listo el cambio.' },
            { type: 'recap', text: 'Hice X. Sigue Y.' },
        ]);
    });

    it('detecta el marcador partido entre chunks (caso critico del holdback)', () => {
        const filter = new HeadlessStreamFilter();
        // "<rec" + "ap>" en dos chunks: nunca debe filtrarse el marcador al frontend
        const out = feed(filter, ['Texto previo que termina en <rec', 'ap>resumen</recap>']);
        const joined = textOf(out);
        expect(joined).not.toContain('<recap>');
        expect(joined).not.toContain('<rec');
        expect(out[out.length - 1]).toEqual({ type: 'recap', text: 'resumen' });
    });

    it('acumula un recap que llega en varios chunks', () => {
        const filter = new HeadlessStreamFilter();
        const out = feed(filter, ['ok<recap>parte 1 ', 'parte 2</recap>']);
        const recaps = out.filter((e) => e.type === 'recap');
        expect(recaps).toEqual([{ type: 'recap', text: 'parte 1 parte 2' }]);
    });

    it('devuelve el texto posterior a </recap> al stream', () => {
        const filter = new HeadlessStreamFilter();
        const out = feed(filter, ['a<recap>r</recap>texto final']);
        expect(textOf(out)).toBe('a[RECAP:r]');
        // "texto final" se emite en el flush (retenido por el holdback)
        expect(textOf(filter.flush())).toContain('texto final');
    });

    it('no emite recap vacio', () => {
        const filter = new HeadlessStreamFilter();
        const out = feed(filter, ['a<recap></recap>b']);
        expect(out.filter((e) => e.type === 'recap')).toHaveLength(0);
        expect(textOf(out)).toBe('a');
    });

    it('en flush emite el recap abierto sin cerrar', () => {
        const filter = new HeadlessStreamFilter();
        feed(filter, ['a<recap>sin cerrar']);
        expect(filter.flush()).toEqual([{ type: 'recap', text: 'sin cerrar' }]);
    });

    it('no pierde texto cuando el stream termina a mitad de un marcador', () => {
        const filter = new HeadlessStreamFilter();
        const out = feed(filter, ['texto <rec']);
        // "texto <rec" son 10 caracteres: se emiten 2 ("te") y se retienen los 8 finales
        expect(textOf(out)).toBe('te');
        expect(textOf(filter.flush())).toBe('xto <rec');
    });

    it('maneja muchos chunks sin reordenar el contenido', () => {
        const filter = new HeadlessStreamFilter();
        const chunks = Array.from({ length: 200 }, (_, i) => `c${i} `);
        const out = feed(filter, chunks);
        const total = textOf(out) + textOf(filter.flush());
        expect(total).toBe(chunks.join(''));
    });

    it('es reutilizable tras un flush', () => {
        const filter = new HeadlessStreamFilter();
        feed(filter, ['primero']);
        filter.flush();
        const second = feed(filter, ['segundo<recap>r2</recap>']);
        expect(textOf(second)).toContain('[RECAP:r2]');
    });
});
