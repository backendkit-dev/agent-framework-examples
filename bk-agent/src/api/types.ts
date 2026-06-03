import OpenAI from 'openai';

export interface AgentResponse {
    message: OpenAI.ChatCompletionMessage;
    usage?: OpenAI.CompletionUsage;
}

export type Message = OpenAI.ChatCompletionMessageParam;
export type Tool = OpenAI.ChatCompletionTool;
export type ToolCall = OpenAI.ChatCompletionMessageToolCall;