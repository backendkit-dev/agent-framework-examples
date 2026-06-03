/**
 * @description Gestiona el contexto de la conversacion: validacion de mensajes,
 * compactacion cuando se excede el limite de tokens, y reseteo del historial.
 */
import { Message } from '../../api/types';
import { ContextSummarizer } from '../../context/summarizer';
import { estimateMessagesTokens } from '../../context/token-counter';

export const CONTEXT_THRESHOLD_TOKENS = 24000;

/**
 * @description Valida y limpia los mensajes, removiendo tool calls huerfanas
 * (assistant con tool_calls sin sus correspondientes tool responses).
 */
export function validateMessages(messages: Message[]): Message[] {
  const clean: Message[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i] as any;

    if (msg.role === 'assistant' && msg.tool_calls?.length > 0) {
      const pending = new Set<string>(msg.tool_calls.map((tc: any) => tc.id as string));
      const responses: Message[] = [];

      let j = i + 1;
      while (j < messages.length && (messages[j] as any).role === 'tool') {
        const t = messages[j] as any;
        pending.delete(t.tool_call_id);
        responses.push(messages[j]);
        j++;
      }

      if (pending.size > 0) {
        break;
      }

      clean.push(msg);
      for (const r of responses) clean.push(r);
      i = j - 1;
    } else if (msg.role === 'tool') {
      const prev = clean[clean.length - 1] as any;
      if (!prev || prev.role !== 'assistant' || !prev.tool_calls?.length) continue;
      clean.push(msg);
    } else {
      clean.push(msg);
    }
  }

  return clean;
}

/**
 * @description Compacta el historial si se excede el umbral de tokens.
 */
export async function compactIfNeeded(
  messages: Message[],
  summarizer: ContextSummarizer,
): Promise<Message[]> {
  if (estimateMessagesTokens(messages) <= CONTEXT_THRESHOLD_TOKENS) return messages;
  return forceCompact(messages, summarizer);
}

/**
 * @description Fuerza la compactacion del historial, resumiendo los mensajes
 * antiguos y manteniendo los recientes.
 * @param keepRecent - Numero de mensajes recientes a conservar sin resumir
 */
export async function forceCompact(
  messages: Message[],
  summarizer: ContextSummarizer,
  keepRecent = 8,
): Promise<Message[]> {
  const system = messages[0];

  let cutIndex = Math.max(1, messages.length - keepRecent);
  while (cutIndex < messages.length - 1 && (messages[cutIndex] as any).role !== 'user') {
    cutIndex++;
  }

  const toSummarize = messages.slice(1, cutIndex);
  if (toSummarize.length < 4) return messages;

  const recent = messages.slice(cutIndex);
  const summary = await summarizer.summarize(toSummarize);
  return [
    system,
    { role: 'system', content: `Resumen de conversacion anterior:\n${summary}` },
    ...recent,
  ];
}
