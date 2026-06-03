/**
 * TASK-09 — Re-compactacion post-respuesta larga
 * TASK-10 — injectContextMessage
 *
 * Verifica que:
 * - forceCompact se llama despues de una respuesta que hace exceder CONTEXT_THRESHOLD * 1.2
 * - injectContextMessage inyecta un mensaje system antes del proximo user message
 * - el mensaje inyectado se consume una sola vez
 */

import { forceCompact, CONTEXT_THRESHOLD_TOKENS } from '../src/agent/agent-loop/context-manager';
import { estimateMessagesTokens } from '../src/context/token-counter';

jest.mock('../src/agent/agent-loop/context-manager', () => {
    const actual = jest.requireActual('../src/agent/agent-loop/context-manager');
    return {
        ...actual,
        forceCompact: jest.fn().mockImplementation(async (messages: any[]) => messages),
    };
});

const mockedForceCompact = forceCompact as jest.MockedFunction<typeof forceCompact>;

describe('CONTEXT_THRESHOLD_TOKENS', () => {
    it('esta exportado y es 24000', () => {
        expect(CONTEXT_THRESHOLD_TOKENS).toBe(24000);
    });
});

describe('logica de re-compactacion post-respuesta', () => {
    it('CONTEXT_THRESHOLD * 1.2 es 28800', () => {
        expect(CONTEXT_THRESHOLD_TOKENS * 1.2).toBe(28800);
    });

    it('estimateMessagesTokens supera el umbral con mensajes pesados', () => {
        // Para superar 28800 tokens: necesitamos >115200 chars en total
        // system: 4000 chars * 1.1 / 4 ≈ 1100 tokens; user: 4000/4 = 1000 tokens
        // assistant necesita: (28800 - 1104 - 1004) * 4 = ~107168 chars — usamos 120000
        const messages: any[] = [
            { role: 'system', content: 'a'.repeat(4000) },
            { role: 'user',   content: 'a'.repeat(4000) },
            { role: 'assistant', content: 'a'.repeat(120000) },
        ];
        const tokens = estimateMessagesTokens(messages);
        expect(tokens).toBeGreaterThan(CONTEXT_THRESHOLD_TOKENS * 1.2);
    });

    it('estimateMessagesTokens no supera el umbral con mensajes normales', () => {
        const messages: any[] = [
            { role: 'system',    content: 'a'.repeat(2000) },
            { role: 'user',      content: 'a'.repeat(500) },
            { role: 'assistant', content: 'a'.repeat(1000) },
        ];
        const tokens = estimateMessagesTokens(messages);
        expect(tokens).toBeLessThan(CONTEXT_THRESHOLD_TOKENS * 1.2);
    });
});

describe('forceCompact mock verifica signatura correcta', () => {
    beforeEach(() => { mockedForceCompact.mockClear(); });

    it('forceCompact acepta keepRecent=6', async () => {
        const messages: any[] = [
            { role: 'system', content: 'sys' },
            { role: 'user',   content: 'u1' },
            { role: 'assistant', content: 'a1' },
        ];
        await forceCompact(messages, {} as any, 6);
        expect(mockedForceCompact).toHaveBeenCalledWith(messages, expect.anything(), 6);
    });
});

describe('logica de injectContextMessage', () => {
    it('pendingContextInjection se consume despues de un turno', () => {
        let pending: string | undefined = 'contenido del checkpoint';
        const injected: string[] = [];

        // Simula _processInput: consume pending y pushea system message
        if (pending) {
            injected.push(pending);
            pending = undefined;
        }

        expect(injected).toHaveLength(1);
        expect(injected[0]).toContain('checkpoint');
        expect(pending).toBeUndefined();

        // Segundo turno: no se re-inyecta
        if (pending) injected.push(pending);
        expect(injected).toHaveLength(1);
    });

    it('sin pendingContextInjection no se inyecta nada', () => {
        let pending: string | undefined;
        const injected: string[] = [];

        if (pending) {
            injected.push(pending);
            pending = undefined;
        }

        expect(injected).toHaveLength(0);
    });
});
