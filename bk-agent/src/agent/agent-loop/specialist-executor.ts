/**
 * @description Ejecuta una delegacion desde General hacia un especialista.
 * Construye contexto completo: orquestacion, historial reciente, archivos relevantes.
 * Maneja el loop de tool calls del especialista y restaura el modelo original al finalizar.
 * Ademas, detecta marcas [memory:*] en la respuesta del especialista y las
 * devuelve como metadata para que el orquestador actualice la memoria de sesion.
 */
import { Message, ToolCall } from '../../api/types';
import { AgentClient } from '../../api/client';
import { AgentProfile } from '../profiles';
import { ToolExecutorOptions } from '../tool-executor';
import { ToolResult } from '../../tools/types';
import { Skill } from '../../skills/loader';
import { DelegationEnforcer } from '../delegation-enforcer';
import { OrchestrationResult } from '../../orchestrator/index';
import { MemoryContextInput } from '../system-prompt';
import { parseMemoryTags, stripMemoryTags } from '../../memory/memory-tag-parser';
import { SessionMemoryUpdate } from '../../memory/updater';
import { ContextSummarizer } from '../../context/summarizer';

// Umbral a partir del cual se genera un resumen del historial previo
const SUMMARY_THRESHOLD = 12;

const MAX_TOOL_RESULT_CHARS = 80_000; // ~20K tokens

export interface AskAgentArgs {
  agent_id: string;
  question: string;
  context?: string;
}

export interface SpecialistResult {
  content: string;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Marcas [memory:*] detectadas en la respuesta del especialista */
  memoryTags?: SessionMemoryUpdate;
}

/**
 * @description Ejecuta una delegacion desde General hacia un especialista.
 * Construye contexto completo: orquestacion, historial reciente, archivos relevantes.
 */
export async function executeAskAgent(
  args: AskAgentArgs,
  context: {
    client: AgentClient;
    allAgents?: AgentProfile[];
    activeSkills?: Skill[];
    basePrompt: string;
    orchestrationResult?: OrchestrationResult;
    messages: Message[];
    combinedTools: import('../../api/types').Tool[];
    enforcer: DelegationEnforcer;
    customToolExecutor?: (toolCall: ToolCall, options: ToolExecutorOptions) => Promise<ToolResult<string>>;
    executeBuiltinTool: (toolCall: ToolCall, opts: ToolExecutorOptions) => Promise<ToolResult<string>>;
    config: any;
    instructions: any;
    vaultPath: string;
    askConfirmation: (message: string) => Promise<boolean>;
    commandTimeoutMs?: number;
    memoryContext: MemoryContextInput | null;
    summarizer?: ContextSummarizer;
    onDelegating?: (fromAgentId: string, toAgent: AgentProfile) => void;
    onSpecialistDone?: (profile: AgentProfile, elapsedMs: number, inputTokens: number, outputTokens: number) => void;
    effectiveAgentId: string;
    abortSignal?: AbortSignal;
  },
): Promise<SpecialistResult> {
  const profile = context.allAgents?.find(a => a.id === args.agent_id);
  if (!profile) {
    const available = context.allAgents?.map(a => a.id).join(', ') ?? 'ninguno';
    return {
      content: `Agente '${args.agent_id}' no encontrado. Disponibles: ${available}`,
      elapsedMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  context.onDelegating?.(context.effectiveAgentId, profile);

  // -- System Prompt: base + perfil + skills + orquestacion --
  const specialistSkills = (context.activeSkills || []).filter(
    s => s.agents?.includes(args.agent_id),
  );
  const skillContent = specialistSkills
    .flatMap(s => [s.systemPromptAddition, s.customInstructions])
    .filter(Boolean)
    .join('\n\n');

  const orchestrationBlock = context.orchestrationResult
    ? buildOrchestrationContextBlockForSpecialist(context.orchestrationResult)
    : '';

  const systemPrompt = context.basePrompt
    + (profile.systemPromptAddition || '')
    + (skillContent ? `\n\n## Skills activos para este agente\n${skillContent}` : '')
    + (orchestrationBlock ? `\n\n${orchestrationBlock}` : '');

  // -- User Message: pregunta estructurada + contexto + historial --
  const recentContext = await buildSpecialistContext(context.messages, 3, context.summarizer);
  const relevantFiles = context.orchestrationResult?.task?.relevantFiles ?? [];

  const userMessageParts: string[] = [
    '## TAREA PRINCIPAL (PRIORIDAD MAXIMA)',
    'Debes enfocarte EXCLUSIVAMENTE en resolver este requerimiento. Si se te hacen preguntas especificas, responde SOLO a esas preguntas, ignorando cualquier checklist o reporte por defecto de tu perfil.\n',
    `${args.question}`,
  ];

  if (args.context) {
    userMessageParts.push(`\n\n## Contexto adicional del General\n${args.context}`);
  }

  if (relevantFiles.length > 0) {
    userMessageParts.push(`\n\n## Archivos relevantes\n${relevantFiles.map(f => `- ${f}`).join('\n')}`);
  }

  if (recentContext) {
    userMessageParts.push(`\n\n## Historial reciente de la conversacion\n${recentContext}`);
  }

  const userMessage = userMessageParts.join('');

  // -- Ejecutar llamada al especialista --
  // Bug #1: usar overrideModel en lugar de mutar el cliente compartido (race condition en paralelo)
  const overrideModel = profile.model || context.client.getModel();

  const startMs = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let finalContent: string;
  let specialistMessages: Message[] = [...messages];
  // Bug #3: cap de iteraciones para evitar loop infinito dentro del especialista
  let specialistIter = 0;
  const MAX_SPECIALIST_ITERS = 50;

  while (true) {
    // Bug #4: respetar abort signal del padre
    if (context.abortSignal?.aborted) {
      finalContent = `[${profile.icon} ${profile.name}]\n(abortado)`;
      break;
    }
    if (specialistIter++ >= MAX_SPECIALIST_ITERS) {
      finalContent = `[${profile.icon} ${profile.name}]\n(limite de ${MAX_SPECIALIST_ITERS} iteraciones alcanzado — respuesta parcial)`;
      break;
    }

    const effectiveTools = context.enforcer.filterToolsForAgent(
      context.combinedTools,
      args.agent_id,
    );

    // Bug #1 + #4: pasar overrideModel y abortSignal sin mutar el cliente
    const response = await context.client.chat(
      specialistMessages,
      effectiveTools,
      profile.temperature ?? 0.2,
      context.abortSignal,
      overrideModel,
    );

    // Bug #5: acumular tokens desde _usage (antes siempre quedaban en 0)
    if (response._usage) {
      inputTokens += response._usage.promptTokens;
      outputTokens += response._usage.completionTokens;
    }

    if (response.tool_calls && response.tool_calls.length > 0) {
      const validToolCalls = response.tool_calls.filter(tc => tc.id && tc.id.trim() !== '');
      if (validToolCalls.length === 0) {
        finalContent = `[${profile.icon} ${profile.name}]\n${response.content ?? '(sin respuesta)'}`;
        break;
      }

      specialistMessages.push({
        role: 'assistant',
        content: response.content ?? null,
        tool_calls: validToolCalls,
      });

      for (const toolCall of validToolCalls) {
        let result: string;
        try {
          const executor = context.customToolExecutor || context.executeBuiltinTool.bind(context);
          const tr = await executor(toolCall, {
            config: context.config,
            instructions: context.instructions,
            vaultPath: context.vaultPath,
            askConfirmation: context.askConfirmation,
            commandTimeoutMs: context.commandTimeoutMs,
            memoryContext: context.memoryContext,
          });
          result = tr.success ? tr.data : tr.error;
        } catch (err: any) {
          result = `Error ejecutando herramienta: ${err?.message ?? String(err)}`;
        }
        if (result.length > MAX_TOOL_RESULT_CHARS) {
          result = result.slice(0, MAX_TOOL_RESULT_CHARS) +
            `\n\n[Salida truncada - ${result.length.toLocaleString()} caracteres totales]`;
        }
        specialistMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
      }
      continue;
    }

    finalContent = `[${profile.icon} ${profile.name}]\n${response.content ?? '(sin respuesta)'}`;
    break;
  }

  // -- Detectar marcas [memory:*] en la respuesta del especialista --
  const parsed = parseMemoryTags(finalContent);
  const cleanContent = parsed.rawTags.length > 0 ? stripMemoryTags(finalContent) : finalContent;

  const elapsedMs = Date.now() - startMs;
  return {
    content: cleanContent,
    elapsedMs,
    inputTokens,
    outputTokens,
    memoryTags: parsed.rawTags.length > 0 ? parsed.update : undefined,
  };
}

/**
 * @description Construye un bloque de contexto de orquestacion para el especialista.
 */
function buildOrchestrationContextBlockForSpecialist(result: OrchestrationResult): string {
  const task = result.task;
  const lines: string[] = [
    '## Contexto de Orquestacion',
    '',
    `- ActionType: ${task.actionType}`,
    `- Dominios: ${task.domains.join(', ') || 'ninguno'}`,
    `- RiskLevel: ${task.riskLevel}`,
    `- Agentes seleccionados: ${result.selectedAgents.map(a => a.agentId).join(', ')}`,
    `- Gates requeridos: ${result.requiredGates.join(', ') || 'ninguno'}`,
    `- Commit permitido: ${result.commitAllowed}`,
  ];

  if (task.rawPrompt) {
    lines.push(`- Requerimiento original: ${task.rawPrompt.slice(0, 500)}`);
  }

  if (task.relevantFiles && task.relevantFiles.length > 0) {
    lines.push('- Archivos relevantes:');
    for (const f of task.relevantFiles) {
      lines.push(`  * ${f}`);
    }
  }

  if (result.agentPipeline && result.agentPipeline.length > 0) {
    lines.push('- Pipeline secuencial:');
    for (const phase of result.agentPipeline) {
      lines.push(`  * [${phase.phase}] ${phase.agentId}: ${phase.purpose}${phase.optional ? ' (opcional)' : ''}`);
    }
  }

  if (result.appliedPolicies.length > 0) {
    lines.push('- Politicas aplicadas:');
    for (const p of result.appliedPolicies) {
      lines.push(`  * ${p.rule}: ${p.reason}`);
    }
  }

  return lines.join('\n');
}

/**
 * @description Construye el contexto de historial para un especialista.
 * Si el historial supera SUMMARY_THRESHOLD mensajes, genera un resumen del
 * historial previo via LLM y lo combina con los intercambios recientes.
 * Si el historial es corto o no hay summarizer, delega en buildRecentContext().
 *
 * @param maxExchanges - Intercambios recientes (user+assistant) a incluir literalmente
 */
export async function buildSpecialistContext(
  messages: Message[],
  maxExchanges = 3,
  summarizer?: ContextSummarizer,
): Promise<string> {
  const nonSystem = messages.filter(m => m.role !== 'system');

  if (!summarizer || nonSystem.length <= SUMMARY_THRESHOLD) {
    return buildRecentContext(messages, maxExchanges);
  }

  // Separar historial antiguo de intercambios recientes
  const recentCount = maxExchanges * 2;
  const toSummarize = nonSystem.slice(0, -recentCount);
  const summary = await summarizer.summarize(toSummarize).catch(() => null);

  const recentRaw = buildRecentContext(messages, maxExchanges);

  if (!summary) return recentRaw;

  return [
    '## Resumen del historial previo',
    summary,
    '',
    '## Intercambios recientes',
    recentRaw,
  ].join('\n');
}

/**
 * @description Construye un resumen de los ultimos intercambios de la
 * conversacion para incluirlo en el contexto del especialista.
 * @param maxExchanges - Numero de intercambios (user+assistant) a incluir
 */
export function buildRecentContext(messages: Message[], maxExchanges = 3): string {
  const nonSystem = messages.filter(m => m.role !== 'system');
  if (nonSystem.length < 2) return '';

  const recent = nonSystem.slice(-(maxExchanges * 2));

  const parts: string[] = [];
  for (const msg of recent) {
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content.slice(0, 300) : '(contenido no textual)';
      parts.push(`[Usuario]: ${content}`);
    } else if (msg.role === 'assistant' && msg.content) {
      const content = msg.content.slice(0, 300);
      parts.push(`[Asistente]: ${content}`);
    } else if (msg.role === 'tool') {
      parts.push('[Herramienta]: (resultado de tool call)');
    }
  }

  return parts.join('\n');
}
