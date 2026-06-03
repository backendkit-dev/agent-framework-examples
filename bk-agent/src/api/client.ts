import OpenAI from 'openai';
import { Message, Tool } from './types';

export type ChatMessage = OpenAI.ChatCompletionMessage & {
    _usage?: { promptTokens: number; completionTokens: number };
};

export interface StreamCallbacks {
    onChunk: (delta: string) => void;
    onStreamStart?: () => void;
    onUsage?: (inputTokens: number, completionTokens: number) => void;
    onToolCallChunk?: (name: string, argsDelta: string) => void;
    /** Callback para fragmentos de razonamiento (reasoning_content de DeepSeek R1) */
    onReasoningChunk?: (delta: string) => void;
    signal?: AbortSignal;
}

/**
 * @description Cliente HTTP para la API de DeepSeek (compatible con OpenAI).
 * Encapsula autenticación, reintentos automáticos (2), timeout de 60s y
 * soporte para streaming con métricas de uso. El equipo evita tener que
 * manejar raw fetch o configurar OpenAI SDK en cada punto de entrada.
 */
export class AgentClient {
    private client: OpenAI;
    private model: string;

    constructor(apiKey: string, model = 'deepseek-chat', baseURL?: string) {
        this.client = new OpenAI({
            apiKey,
            baseURL: baseURL || 'https://api.deepseek.com',
            timeout: 60_000, // 60s timeout para evitar DoS por API lenta
            maxRetries: 2,
        });
        this.model = model;
    }

    /**
     * @description Devuelve el modelo activo actual (ej: deepseek-chat, deepseek-reasoner).
     * Permite a otros componentes saber qué modelo se está usando sin acoplamiento.
     */
    getModel(): string { return this.model; }
    /**
     * @description Cambia el modelo activo en tiempo de ejecución.
     * Útil para routing entre agentes que requieren modelos distintos
     * (ej: deepseek-reasoner para análisis profundo, deepseek-chat para tareas rápidas).
     */
    setModel(model: string): void { this.model = model; }

    /**
     * @description Envía un mensaje a la API de DeepSeek y espera la respuesta completa.
     * Soporta tool_calls automáticos cuando se pasan herramientas. El sistema se
     * beneficia de reintentos automáticos (2) y timeout de 60s para evitar
     * bloqueos por API lenta.
     */
    async chat(messages: Message[], tools?: Tool[], temperature = 0.2, signal?: AbortSignal, overrideModel?: string): Promise<ChatMessage> {
        const resp = await this.client.chat.completions.create(
            { model: overrideModel ?? this.model, messages, tools, tool_choice: tools ? 'auto' : undefined, temperature },
            { signal }
        );
        const msg = resp.choices[0]?.message;
        if (!msg) throw new Error('No message');
        const result = msg as ChatMessage;
        if (resp.usage) {
            result._usage = {
                promptTokens: resp.usage.prompt_tokens,
                completionTokens: resp.usage.completion_tokens,
            };
        }
        return result;
    }

    /**
     * @description Envía un mensaje con streaming de la respuesta.
     * Cada fragmento (delta) se entrega via callback onChunk para mostrar
     * la respuesta en tiempo real. Al finalizar, reporta el uso de tokens
     * via onUsage. El usuario ve la respuesta mientras se genera, mejorando
     * la experiencia en respuestas largas.
     */
    async chatStream(
        messages: Message[],
        tools: Tool[] | undefined,
        { onChunk, onStreamStart, onUsage, onToolCallChunk, onReasoningChunk, signal }: StreamCallbacks,
        temperature = 0.2
    ): Promise<OpenAI.ChatCompletionMessage> {
        const stream = await this.client.chat.completions.create(
            { model: this.model, messages, tools, tool_choice: tools ? 'auto' : undefined, temperature, stream: true, stream_options: { include_usage: true } },
            { signal }
        ) as unknown as AsyncIterable<OpenAI.ChatCompletionChunk>;

        let contentAccum = '';
        let streamStarted = false;
        const toolCallsMap = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>();
        let usageData: { prompt_tokens: number; completion_tokens: number } | null = null;

        for await (const chunk of stream) {
            const typedChunk = chunk as OpenAI.ChatCompletionChunk;
            if (typedChunk.usage) usageData = typedChunk.usage;
            const delta = typedChunk.choices[0]?.delta;
            // reasoning_content de DeepSeek R1
            if ((delta as any)?.reasoning_content) {
                onReasoningChunk?.((delta as any).reasoning_content);
            }
            if (delta?.content) {
                if (!streamStarted) { onStreamStart?.(); streamStarted = true; }
                contentAccum += delta.content;
                onChunk(delta.content);
            }
            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index;
                    if (!toolCallsMap.has(idx)) {
                        toolCallsMap.set(idx, {
                            id: tc.id ?? '',
                            type: 'function',
                            function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
                        });
                    } else {
                        const ex = toolCallsMap.get(idx)!;
                        if (tc.id) ex.id = tc.id;
                        if (tc.function?.name) ex.function.name = tc.function.name;
                        if (tc.function?.arguments) ex.function.arguments += tc.function.arguments;
                    }
                    // Disparar después de actualizar para que el nombre ya esté en el mapa
                    if (onToolCallChunk && tc.function?.arguments) {
                        const name = toolCallsMap.get(idx)?.function.name ?? '';
                        onToolCallChunk(name, tc.function.arguments);
                    }
                }
            }
        }

        if (usageData) {
            onUsage?.(usageData.prompt_tokens, usageData.completion_tokens);
        }

        const toolCalls = toolCallsMap.size > 0
            ? Array.from(toolCallsMap.entries())
                .sort(([a], [b]) => a - b)
                .map(([, v]) => v)
            : undefined;

        // ✅ Validar que todos los tool_calls tengan id antes de devolverlos
        if (toolCalls) {
            for (const tc of toolCalls) {
                if (!tc.id) {
                    throw new Error('Tool call sin ID - el modelo no asignó un identificador único');
                }
            }
        }

        return {
            role: 'assistant',
            content: contentAccum || null,
            tool_calls: toolCalls,
            refusal: null,
        } as OpenAI.ChatCompletionMessage;
    }
}
