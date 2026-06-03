/**
 * TASK-08 — Token counter calibrado por tipo de mensaje
 * Verifica que estimateMessagesTokens aplica correctamente:
 * - overhead de tool_calls (JSON * 0.8)
 * - roleMultiplier 1.1 para mensajes system
 * - contenido no-string se serializa antes de medir
 */

import { estimateTokens, estimateMessagesTokens } from '../src/context/token-counter';

describe('estimateTokens', () => {
    it('retorna ceil(length / 4)', () => {
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('a'.repeat(100))).toBe(25);
        expect(estimateTokens('a'.repeat(101))).toBe(26);
        expect(estimateTokens('')).toBe(0);
    });
});

describe('estimateMessagesTokens', () => {
    it('array vacio retorna 0', () => {
        expect(estimateMessagesTokens([])).toBe(0);
    });

    it('mensaje user simple: chars/4 + 4 overhead', () => {
        const msg = { role: 'user' as const, content: 'a'.repeat(400) };
        // 400/4 = 100 + 4 overhead = 104
        expect(estimateMessagesTokens([msg])).toBe(104);
    });

    it('mensaje system aplica multiplicador 1.1', () => {
        const msg = { role: 'system' as const, content: 'a'.repeat(400) };
        // ceil(400 * 1.1 / 4) + 4 — JS FP: 400*1.1 = 440.0000...06 → ceil = 111 + 4 = 115
        const expected = Math.ceil(400 * 1.1 / 4) + 4;
        expect(estimateMessagesTokens([msg])).toBe(expected);
    });

    it('mensaje system es mayor que user con mismo contenido', () => {
        const content = 'hola mundo'.repeat(50);
        const system = { role: 'system' as const, content };
        const user   = { role: 'user'   as const, content };
        expect(estimateMessagesTokens([system])).toBeGreaterThan(
            estimateMessagesTokens([user])
        );
    });

    it('tool_calls agrega overhead sobre el contenido', () => {
        const toolCalls = [
            {
                id: 'call_abc',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"src/index.ts"}' },
            },
        ];
        const withTools: any = {
            role: 'assistant',
            content: 'voy a leer el archivo',
            tool_calls: toolCalls,
        };
        const withoutTools: any = {
            role: 'assistant',
            content: 'voy a leer el archivo',
        };
        expect(estimateMessagesTokens([withTools])).toBeGreaterThan(
            estimateMessagesTokens([withoutTools])
        );
    });

    it('tool_calls pesado aumenta el total significativamente', () => {
        const bigArgs = JSON.stringify({ code: 'x'.repeat(800) });
        const toolCalls = [
            { id: 'call_1', type: 'function', function: { name: 'write_file', arguments: bigArgs } },
        ];
        const msg: any = { role: 'assistant', content: '', tool_calls: toolCalls };
        const result = estimateMessagesTokens([msg]);
        // overhead: JSON.stringify(toolCalls).length * 0.8 / 4 >> 100 tokens
        expect(result).toBeGreaterThan(100);
    });

    it('content null cuenta como 0 chars base', () => {
        const msg: any = { role: 'assistant', content: null };
        // 0 chars, role !== system → 0 + 4 overhead = 4
        expect(estimateMessagesTokens([msg])).toBe(4);
    });

    it('content array (multimodal) se serializa', () => {
        const msg: any = {
            role: 'user',
            content: [{ type: 'text', text: 'describe esta imagen' }],
        };
        const serialized = JSON.stringify(msg.content);
        const expected = Math.ceil(serialized.length / 4) + 4;
        expect(estimateMessagesTokens([msg])).toBe(expected);
    });

    it('acumula correctamente multiples mensajes', () => {
        const msgs: any[] = [
            { role: 'system',    content: 'a'.repeat(400) },
            { role: 'user',      content: 'a'.repeat(400) },
            { role: 'assistant', content: 'a'.repeat(400) },
        ];
        const systemTokens    = Math.ceil(400 * 1.1 / 4) + 4;
        const nonSystemTokens = Math.ceil(400 / 4) + 4;
        expect(estimateMessagesTokens(msgs)).toBe(systemTokens + nonSystemTokens * 2);
    });

    it('sin tool_calls, resultado es identico al overhead fijo anterior para user', () => {
        const content = 'texto de prueba con longitud exacta de cuarenta chars';
        const msg = { role: 'user' as const, content };
        const result = estimateMessagesTokens([msg]);
        // ceil(content.length / 4) + 4
        const expected = Math.ceil(content.length / 4) + 4;
        expect(result).toBe(expected);
    });
});
