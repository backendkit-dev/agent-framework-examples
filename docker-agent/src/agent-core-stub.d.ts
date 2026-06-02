/**
 * Lightweight type stub for @bk/agent-core used only during `npm run typecheck`.
 * Avoids loading the full barrel export (orchestration, MCP, workflow, memory, etc.)
 * which causes TypeScript heap OOM on complex generics.
 *
 * The real types are loaded at runtime via the actual package.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = Record<string, any>;

export interface SessionMemoryData {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface ExecutionContext {
  agentId: string;
  sessionId: string;
  workingDir?: string;
  memory: SessionMemoryData;
  store?: AnyObject;
  blockedCommands?: string[];
  askAgent?(agentId: string, question: string, context?: string): Promise<string>;
  emitCompacting?(phase: string, label?: string): void;
  llmCall?(prompt: string): Promise<string>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: AnyObject;
  execute(args: unknown, ctx: ExecutionContext): Promise<string>;
}

export interface AgentProfile {
  id: string;
  name: string;
  icon?: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  delegatesTo?: string[];
  source?: string;
  provider?: string;
  blockedCommands?: string[];
  language?: string;
}

export interface ModelConfig {
  provider: string;
  id: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface LLMStreamCallbacks {
  onChunk?(delta: string): void;
  onToolCall?(name: string, args: string, id: string): void;
  onDone(message: LLMMessage): void;
  onError(err: Error): void;
  onMetrics?(inputTokens: number, outputTokens: number): void;
  signal?: AbortSignal;
}

export interface LLMProvider {
  chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks): Promise<void>;
}

export declare class ToolRegistry {
  register(tool: ToolDefinition): this;
  get(name: string): ToolDefinition | undefined;
  has(name: string): boolean;
  unregister(name: string): void;
  getForAgent(allowedTools: string[]): ToolDefinition[];
}

export declare class AgentRegistry {
  register(profile: AgentProfile): this;
  upsert(profile: AgentProfile): void;
  get(id: string): AgentProfile | undefined;
  has(id: string): boolean;
  delete(id: string): void;
  getAll(): AgentProfile[];
}

export declare class ProviderRegistry {
  register(id: string, provider: LLMProvider): this;
  resolve(id: string, fallback: string): LLMProvider;
}

export type AgentEvent =
  | { type: 'ready' }
  | { type: 'token'; content: string; agent_id?: string }
  | { type: 'tool_call'; name: string; args_preview?: string }
  | { type: 'tool_result'; name: string; success: boolean; preview?: string }
  | { type: 'block_start'; agent_id?: string; agent_name?: string; agent_icon?: string }
  | { type: 'block_end'; status: 'ok' | 'error'; agent_id?: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'metrics'; input_tokens: number; output_tokens: number }
  | { type: 'system'; level?: string; text?: string }
  | { type: 'compacting'; phase: string; label?: string }
  | { type: 'tool_approval_request'; tool_name: string; agent_id: string; args_preview: string };

export declare class CallbackTransport {
  constructor(callback: (event: AgentEvent) => void);
  emit(event: AgentEvent): void;
}

export interface EngineOptions {
  model: ModelConfig;
  maxIterations?: number;
  maxParallelAgents?: number;
  workingDir?: string;
  projectContext?: string;
  sessionId?: string;
  historyPath?: string;
  maxContextMessages?: number;
  skills?: AnyObject[];
  detectedStack?: string[];
  subAgentContextMessages?: number;
  store?: AnyObject;
  loadSkills?: () => Promise<AnyObject[]>;
}

export type IterationMode = 'interactive' | 'auto' | 'step-by-step';

export interface AgentEngineOptions extends EngineOptions {
  agents: AgentRegistry;
  tools: ToolRegistry;
  providers: ProviderRegistry;
  defaultProvider: string;
  transport: CallbackTransport;
  defaultAgentId: string;
  iterationMode?: IterationMode;
  noQA?: boolean;
  auditLog?: string;
  loadAgents?: () => Promise<AgentProfile[]>;
}

export declare class AgentEngine {
  constructor(opts: AgentEngineOptions);
  run(input: string): Promise<void>;
  abort(): void;
  switchAgent(agentId: string): void;
  clearHistory(): void;
  setIterationMode(mode: IterationMode): void;
  getIterationMode(): IterationMode;
}
