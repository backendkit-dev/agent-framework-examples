/**
 * TASK-04 — buildSpecialistContext
 * Verifica que el especialista reciba resumen del historial previo
 * cuando el historial supera SUMMARY_THRESHOLD (12) mensajes.
 */

import { buildSpecialistContext, buildRecentContext } from '../src/agent/agent-loop/specialist-executor';
import { Message } from '../src/api/types';
import { ContextSummarizer } from '../src/context/summarizer';

function makeMessages(count: number): Message[] {
    const msgs: Message[] = [{ role: 'system', content: 'system prompt' }];
    for (let i = 0; i < count; i++) {
        msgs.push({ role: 'user',      content: `user message ${i}` });
        msgs.push({ role: 'assistant', content: `assistant reply ${i}` });
    }
    return msgs;
}

function makeSummarizer(summary = 'resumen generado'): ContextSummarizer {
    return { summarize: jest.fn().mockResolvedValue(summary) } as unknown as ContextSummarizer;
}

describe('buildSpecialistContext', () => {
    describe('historial corto (<= 12 mensajes no-system)', () => {
        it('sin summarizer devuelve buildRecentContext', async () => {
            const msgs = makeMessages(4); // 8 non-system
            const result = await buildSpecialistContext(msgs, 3, undefined);
            expect(result).toBe(buildRecentContext(msgs, 3));
        });

        it('con summarizer no llama a summarize cuando el historial es corto', async () => {
            const msgs = makeMessages(4); // 8 non-system <= 12
            const summarizer = makeSummarizer();
            await buildSpecialistContext(msgs, 3, summarizer);
            expect(summarizer.summarize).not.toHaveBeenCalled();
        });

        it('exactamente en el umbral (12 non-system) no llama a summarize', async () => {
            const msgs = makeMessages(6); // 12 non-system == 12
            const summarizer = makeSummarizer();
            await buildSpecialistContext(msgs, 3, summarizer);
            expect(summarizer.summarize).not.toHaveBeenCalled();
        });
    });

    describe('historial largo (> 12 mensajes no-system)', () => {
        it('llama a summarize con los mensajes antiguos', async () => {
            const msgs = makeMessages(8); // 16 non-system > 12
            const summarizer = makeSummarizer('mi resumen');
            await buildSpecialistContext(msgs, 3, summarizer);
            expect(summarizer.summarize).toHaveBeenCalledTimes(1);
            // Se pasan los mensajes antiguos (todo menos los ultimos 6)
            const passedMsgs = (summarizer.summarize as jest.Mock).mock.calls[0][0] as Message[];
            expect(passedMsgs.length).toBe(16 - 6); // 10
        });

        it('incluye el resumen y los intercambios recientes en la respuesta', async () => {
            const msgs = makeMessages(8); // 16 non-system
            const summarizer = makeSummarizer('resumen del historial previo');
            const result = await buildSpecialistContext(msgs, 3, summarizer);
            expect(result).toContain('## Resumen del historial previo');
            expect(result).toContain('resumen del historial previo');
            expect(result).toContain('## Intercambios recientes');
        });

        it('si summarize falla devuelve solo los recientes (degradacion silenciosa)', async () => {
            const msgs = makeMessages(8);
            const summarizer = {
                summarize: jest.fn().mockRejectedValue(new Error('LLM timeout')),
            } as unknown as ContextSummarizer;
            const result = await buildSpecialistContext(msgs, 3, summarizer);
            // No debe lanzar; debe devolver al menos los mensajes recientes
            expect(result).toBeTruthy();
            expect(result).not.toContain('## Resumen del historial previo');
        });

        it('los intercambios recientes contienen los ultimos maxExchanges pares', async () => {
            const msgs = makeMessages(8); // mensajes 0..7
            const summarizer = makeSummarizer('resumen');
            const result = await buildSpecialistContext(msgs, 3, summarizer);
            // El ultimo mensaje de usuario es "user message 7"
            expect(result).toContain('user message 7');
        });
    });
});
