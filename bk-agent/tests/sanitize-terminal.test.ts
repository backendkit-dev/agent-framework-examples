import { stripTerminalEscapes, sanitizeSingleLine } from '../src/shared/utils/sanitize-terminal';

describe('stripTerminalEscapes', () => {
    it('elimina OSC 52 (escritura del portapapeles)', () => {
        const payload = 'texto\x1b]52;c;cGF5bG9hZA==\x07resto';
        expect(stripTerminalEscapes(payload)).toBe('textoresto');
    });

    it('elimina OSC terminado con ST (ESC \\)', () => {
        expect(stripTerminalEscapes('a\x1b]0;titulo\x1b\\b')).toBe('ab');
    });

    it('elimina CSI de borrado de pantalla y de cursor', () => {
        expect(stripTerminalEscapes('a\x1b[2Jb')).toBe('ab');
        expect(stripTerminalEscapes('a\x1b[?25lb')).toBe('ab');
        expect(stripTerminalEscapes('a\x1b[31mrojo\x1b[0mb')).toBe('arojob');
    });

    it('elimina escapes cortos y de juego de caracteres', () => {
        expect(stripTerminalEscapes('a\x1bcb')).toBe('ab');
        expect(stripTerminalEscapes('a\x1b(Bb')).toBe('ab');
    });

    it('elimina DCS y secuencias APC', () => {
        expect(stripTerminalEscapes('a\x1bP1;2;3qdatos\x1b\\b')).toBe('ab');
        expect(stripTerminalEscapes('a\x1b_G data\x1b\\b')).toBe('ab');
    });

    it('elimina controles C0/C1 y DEL pero preserva \\n y \\t', () => {
        expect(stripTerminalEscapes('linea1\nlinea2\ttab')).toBe('linea1\nlinea2\ttab');
        expect(stripTerminalEscapes('a\x00\x07\x08b')).toBe('ab');
        expect(stripTerminalEscapes('a\x9bb')).toBe('ab');
    });

    it('corta una OSC sin terminador (buffer a medias)', () => {
        expect(stripTerminalEscapes('texto\x1b]52;c;datos')).toBe('texto');
    });

    it('deja intacto el texto normal con acentos y emojis', () => {
        const normal = 'Configuración lista ✅ — 100%';
        expect(stripTerminalEscapes(normal)).toBe(normal);
    });

    it('maneja cadena vacia', () => {
        expect(stripTerminalEscapes('')).toBe('');
    });
});

describe('sanitizeSingleLine', () => {
    it('colapsa saltos de linea y devuelve una sola linea', () => {
        expect(sanitizeSingleLine('linea1\nlinea2\r\nlinea3')).toBe('linea1 linea2 linea3');
    });

    it('elimina escapes ademas de colapsar', () => {
        expect(sanitizeSingleLine('\x1b[2JGenerando\x1b]0;t\x07\nresto')).toBe('Generando resto');
    });

    it('recorta espacios sobrantes', () => {
        expect(sanitizeSingleLine('   hola   ')).toBe('hola');
    });
});
