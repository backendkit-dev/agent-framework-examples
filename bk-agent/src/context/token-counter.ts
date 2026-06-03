import { Message } from '../api/types';

// ~4 chars per token is a good approximation for Spanish/English mixed text
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Message[]): number {
    return messages.reduce((total, msg) => {
        const m = msg as any;

        const baseChars = typeof m.content === 'string'
            ? m.content.length
            : m.content != null ? JSON.stringify(m.content).length : 0;

        // tool_calls JSON is denser than prose (~0.8 chars/token ratio)
        const toolOverhead = m.tool_calls
            ? JSON.stringify(m.tool_calls).length * 0.8
            : 0;

        // system messages tend to be higher density (structured instructions)
        const roleMultiplier = m.role === 'system' ? 1.1 : 1.0;

        return total + Math.ceil((baseChars + toolOverhead) * roleMultiplier / 4) + 4;
    }, 0);
}
