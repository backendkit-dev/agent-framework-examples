/**
 * @description Fachada principal del AgentLoop. Orquesta la interaccion
 * entre el LLM, las herramientas, los agentes especialistas y los gates
 * de calidad. Delega la logica especifica en modulos cohesivos dentro
 * de agent-loop/.
 */
import { AgentClient } from '../api/client';
import { Message, Tool, ToolCall } from '../api/types';
import { executeToolCall, ToolExecutorOptions } from './tool-executor';
import { ToolResult } from '../tools/types';
import { buildSystemPrompt, MemoryContextInput, ContextFilesInput } from './system-prompt';
import { loadContextFiles } from '../bootstrap/context-files-loader';
import { AIAssistantConfig, Instructions } from '../types/config';
import { Skill } from '../skills/loader';
import { AgentProfile } from './profiles';
import { ContextSummarizer } from '../context/summarizer';
import { estimateMessagesTokens } from '../context/token-counter';
import { loadMemoryContext } from '../bootstrap/memory-loader';
import { ResponseEvaluator, EvaluationIssue } from './evaluation/index';
import { Orchestrator, OrchestrationResult } from '../orchestrator/index';
import type { AuditFinding } from '../orchestrator/audit';
import { TaskStatus, TaskContext } from '../types/task-context';
import { runCommitWorkflow, runPreCommitTests, detectCommitWorkflow, getStagedFiles, checkGitConfig, CommitWorkflowOptions, CommitWorkflowResult } from './commit/index';
import { AgentRouter, RoutingMethod } from './routing/index';
import { extractDeveloperProfile } from '../bootstrap/context-loader-v2';
import { DELEGATION_PROMPT } from './delegation-prompt';
import { DelegationEnforcer } from './delegation-enforcer';
import { IterationManager, DEFAULT_MAX_ITERATIONS } from './iteration-manager';
import { ReflectionEngine } from '../reflection/reflection-engine';
import { CommitHook } from '../reflection/hooks/commit-hook';
import { TestHook } from '../reflection/hooks/test-hook';
import { AgentHook } from '../reflection/hooks/agent-hook';
import { QAService } from './qa/index';
import { VaultProvider } from '../vault/vault-provider';

// Modulos extraidos (Fase 1: loop.ts -> 8 modulos cohesivos)
import {
  detectDirectionChange,
  detectUserCorrection,
  runOrchestrator,
  resolveAgentAndInput,
  evaluateResponse,
  extractRecap,
  buildCorrectiveContext,
  advanceRequiredGates,
  activateQaEngineerIfNeeded,
  processQaEngineerResponse,
  processInlineQaReview,
  executeAskAgent,
  checkCommitGate,
  getCriticalPath,
  mapActionTypeToCommitType,
  detectScope,
  executeCommit,
  autoCommitAfterQaApproval,
  validateMessages,
  compactIfNeeded,
  forceCompact,
  CONTEXT_THRESHOLD_TOKENS,
} from './agent-loop/index';
import { updateSessionMemory } from '../memory/updater';
import { parseMemoryTags } from '../memory/memory-tag-parser';

// ── Helper: validacion post-ejecucion de actualizacion de memoria ────────────
// H-003: Verifica el resultado de updateSessionMemory() y reporta fallos
// silenciosos al Reflection Engine y al log.
async function applyMemoryUpdate(
    projectDir: string,
    updates: Parameters<typeof updateSessionMemory>[1],
    agentId: string,
    reflectionEngine: ReflectionEngine,
): Promise<void> {
    try {
        const result = await updateSessionMemory(projectDir, updates);
        if (result.startsWith('✅')) {
            console.warn(`[memory] Auto-update desde ${agentId}: ${result}`);
        } else if (result.startsWith('Error:')) {
            console.warn(`[memory] Fallo en auto-update desde ${agentId}: ${result}`);
            await reflectionEngine.reportIncident({
                failureType: 'memory_update_failed',
                domain: 'agent',
                severity: 'medium',
                dimension: 'infraestructura',
                gate: 'agent',
                agenteResponsable: agentId,
                hallazgo: `updateSessionMemory() fallo para agente ${agentId}: ${result}`,
                recomendacion: 'Verificar que sesion-actual.md exista y el directorio del proyecto sea accesible.',
                archivos: [],
                fecha: new Date().toISOString(),
            }).catch((e: unknown) => {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn('[memory] Error al reportar incidente de memoria:', msg);
            });
        }
        // Si es "OK: memoria ya actualizada (sin cambios necesarios)" -> no hacer nada
    } catch (memErr: unknown) {
        const memMsg = memErr instanceof Error ? memErr.message : String(memErr);
        console.warn(`[memory] Excepcion en auto-update desde ${agentId}: ${memMsg}`);
        await reflectionEngine.reportIncident({
            failureType: 'memory_update_exception',
            domain: 'agent',
            severity: 'medium',
            dimension: 'infraestructura',
            gate: 'agent',
            agenteResponsable: agentId,
            hallazgo: `updateSessionMemory() lanzó excepcion para agente ${agentId}: ${memMsg}`,
            recomendacion: 'Revisar permisos de escritura y que el directorio del proyecto exista.',
            archivos: [],
            fecha: new Date().toISOString(),
        }).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[memory] Error al reportar incidente de memoria:', msg);
        });
    }
}

function sanitizeToolName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
const MAX_TOOL_RESULT_CHARS = 80000;

export interface AgentLoopOptions {
    client: AgentClient;
    config: AIAssistantConfig;
    instructions: Instructions;
    vaultPath: string;
    localMemoryDir?: string;
    localProjectName?: string;
    contextMarkdown: string;
    tools: Tool[];
    activeSkills?: Skill[];
    maxIterations?: number;
    commandTimeoutMs?: number;
    memoryContext?: MemoryContextInput | null;
    askConfirmation: (message: string) => Promise<boolean>;
    onIterationLimit?: (count: number) => Promise<boolean>;
    iterationManager?: IterationManager;
    onThinking?: () => void;
    onStreamStart?: () => void;
    onChunk?: (delta: string) => void;
    onReasoningChunk?: (delta: string) => void;
    onUsage?: (inputTokens: number, outputTokens: number) => void;
    onToolCallChunk?: (name: string, argsDelta: string) => void;
    onToolCall?: (name: string, argsStr: string, toolId?: string) => void;
    onToolResult?: (name: string, result: string, toolId?: string) => void;
    onToolDone?: () => void;
    onResponse?: (content: string) => void;
    onMemoryRefreshed?: (ctx: MemoryContextInput | null) => void;
    allAgents?: AgentProfile[];
    onAgentAutoSwitch?: (profile: AgentProfile) => void;
    onAgentRouting?: (profile: AgentProfile, method: 'override' | 'textual' | 'llm') => void;
    onDelegating?: (fromAgentId: string, toAgent: AgentProfile) => void;
    onSpecialistStreamStart?: (profile: AgentProfile) => void;
    onSpecialistChunk?: (delta: string) => void;
    onSpecialistDone?: (profile: AgentProfile, elapsedMs: number, inputTokens: number, outputTokens: number) => void;
    onQAReview?: (review: string) => void;
    onRecap?: (recap: string) => void;
    noQA?: boolean;
    orchestrator?: Orchestrator;
    onOrchestration?: (result: OrchestrationResult) => void;
    onAutoCommitStatus?: (status: string, message: string) => void;
    noDelegation?: boolean;
    contextFiles?: ContextFilesInput;
    lessonsMemo?: string | null;
    vaultProvider?: VaultProvider;
}

export class AgentLoop {
    private messages: Message[];
    private options: AgentLoopOptions;
    private combinedTools: Tool[];
    private summarizer: ContextSummarizer;
    private abortController: AbortController | null = null;
    private customToolExecutor?: (toolCall: ToolCall, options: ToolExecutorOptions) => Promise<ToolResult<string>>;
    private basePrompt: string;
    private currentProfileAddition = '';
    private busy = false;
    private abortRequested = false;
    private currentMemoryContext: MemoryContextInput | null;
    private effectiveAgentId = 'general';
    private effectiveTemperature = 0.2;
    private sessionStats = { calls: 0, inputTokens: 0, outputTokens: 0 };
    private router: AgentRouter;
    private evaluator: ResponseEvaluator;
    private iterationManager: IterationManager;
    private orchestrationResult?: OrchestrationResult;
    private previousTaskContext?: TaskContext;
    private contextFiles: ContextFilesInput = { agentMd: null, userMd: null };
    private lessonsMemo: string | null = null;
    private developerProfile: string | null = null;
    private _autoCommitLock = false;
    private qaService!: QAService;
    private reflectionEngine: ReflectionEngine;
    private commitHook!: CommitHook;
    private testHook!: TestHook;
    private agentHook!: AgentHook;
    private enforcer!: DelegationEnforcer;
    private pendingContextInjection?: string;

    constructor(options: AgentLoopOptions) {
        this.evaluator = new ResponseEvaluator(options.client, {
            approvalThreshold: 60,
        });
        this.router = new AgentRouter(options.client, options.allAgents ?? []);
        this.qaService = new QAService({
            client: options.client,
            basePrompt: () => this.basePrompt,
            effectiveAgentId: () => this.effectiveAgentId,
            allAgents: options.allAgents,
            noQA: options.noQA,
            onQAReview: options.onQAReview,
            onOutcome: (agentId, approved) => {
                if (approved) this.router.recordSuccess(agentId);
                else this.router.recordFailure(agentId);
            },
        });

        this.reflectionEngine = new ReflectionEngine();
        this.reflectionEngine.initialize().catch((err) => { console.warn('[ReflectionEngine] Initialize failed:', err); });
        if (options.memoryContext?.projectDir) {
            this.reflectionEngine.connectMemory(options.memoryContext.projectDir);
        }
        this.evaluator.connectReflectionEngine(this.reflectionEngine);
        this.commitHook = new CommitHook(this.reflectionEngine);
        this.testHook = new TestHook(this.reflectionEngine);
        this.agentHook = new AgentHook(this.reflectionEngine);
        this.enforcer = new DelegationEnforcer();

        this.options = options;
        this.iterationManager = options.iterationManager ?? new IterationManager({
            maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
            onLimitReached: options.onIterationLimit
                ? async (stats) => {
                    const cont = await options.onIterationLimit!(stats.iterations);
                    return cont;
                }
                : undefined,
            onGlobalLimitReached: async () => {
                try {
                    this.messages = await forceCompact(this.messages, this.summarizer, 4);
                } catch {
                    // Fail silencioso
                }
            },
        });
        this.currentMemoryContext = options.memoryContext ?? null;
        this.summarizer = new ContextSummarizer(options.client);

        this.combinedTools = [...options.tools];
        if (options.activeSkills) {
            for (const skill of options.activeSkills) {
                if (skill.tools) {
                    const skillTools: Tool[] = skill.tools.map(t => ({
                        type: 'function' as const,
                        function: { name: sanitizeToolName(t.name), description: t.description, parameters: t.parameters },
                    }));
                    this.combinedTools = this.combinedTools.concat(skillTools);
                }
            }
        }

        this.contextFiles = options.contextFiles ?? { agentMd: null, userMd: null };
        this.lessonsMemo = options.lessonsMemo ?? null;

        if (this.contextFiles.agentMd) {
            this.router.seedFromAgentMd(this.contextFiles.agentMd);
        }
        if (this.contextFiles.userMd) {
            this.developerProfile = extractDeveloperProfile(this.contextFiles.userMd);
        }

        this.basePrompt = buildSystemPrompt(
            options.config,
            options.contextMarkdown,
            options.instructions,
            options.vaultPath,
            options.memoryContext,
            options.activeSkills,
            this.contextFiles,
            this.lessonsMemo,
        );
        this.messages = [{ role: 'system', content: this.buildAgentSystemPrompt() }];
        this.summarizer = new ContextSummarizer(options.client);
    }

    // -- API publica --------------------------------------------------------

    getOrchestrationResult(): OrchestrationResult | undefined {
        return this.orchestrationResult;
    }

    setToolExecutor(fn: (toolCall: ToolCall, options: ToolExecutorOptions) => Promise<ToolResult<string>>) {
        this.customToolExecutor = fn;
    }

    executeBuiltinTool(toolCall: ToolCall, opts: ToolExecutorOptions): Promise<ToolResult<string>> {
        return executeToolCall(toolCall, opts);
    }

    abort(): void {
        this.abortRequested = true;
        this.abortController?.abort();
        this.abortController = null;
        this.busy = false;
    }

    isBusy(): boolean {
        return this.busy;
    }

    setVaultPath(vaultPath: string): void {
        this.options.vaultPath = vaultPath;
    }

    setCurrentAgent(id: string, addition: string, resetHistory = false, temperature?: number): void {
        this.effectiveAgentId = id;
        this.effectiveTemperature = temperature ?? 0.2;
        this.setAgentProfile(addition, resetHistory);
    }

    async reloadContextFiles(): Promise<{ agentMd: string | null; userMd: string | null }> {
        const files = await loadContextFiles(process.cwd());
        this.contextFiles = { agentMd: files.agentMd, userMd: files.userMd };
        this.rebuildBasePrompt();
        this.messages[0] = { role: 'system', content: this.buildAgentSystemPrompt() };
        return { ...this.contextFiles };
    }

    setAgentProfile(addition: string, resetHistory = false): void {
        this.currentProfileAddition = addition;
        const newPrompt = this.buildAgentSystemPrompt();
        if (resetHistory) {
            this.messages = [{ role: 'system', content: newPrompt }];
        } else {
            this.messages[0] = { role: 'system', content: newPrompt };
        }
    }

    setActiveSkills(skills: Skill[]): void {
        this.options.activeSkills = skills;
        this.combinedTools = [...this.options.tools];
        for (const skill of skills) {
            if (skill.tools) {
                const skillTools: Tool[] = skill.tools.map(t => ({
                    type: 'function' as const,
                    function: { name: sanitizeToolName(t.name), description: t.description, parameters: t.parameters },
                }));
                this.combinedTools = this.combinedTools.concat(skillTools);
            }
        }
        this.rebuildBasePrompt();
        this.messages[0] = { role: 'system', content: this.buildAgentSystemPrompt() };
    }

    reloadMemory(context: MemoryContextInput | null): void {
        this.currentMemoryContext = context;
        if (context?.projectDir) {
            this.reflectionEngine.connectMemory(context.projectDir);
        }
        this.rebuildBasePrompt();
        this.messages[0] = { role: 'system', content: this.buildAgentSystemPrompt() };
        this.options.onMemoryRefreshed?.(context);
    }

    async forceCompact(keepRecent = 8): Promise<void> {
        this.messages = await forceCompact(this.messages, this.summarizer, keepRecent);
    }

    injectContextMessage(content: string): void {
        this.pendingContextInjection = content;
    }

    resetHistory(): void {
        this.messages = [this.messages[0]];
    }

    async checkCommitGate(): Promise<{ allowed: boolean; criticalPath: string[]; error?: string }> {
        return checkCommitGate(this.orchestrationResult, this.options.orchestrator);
    }

    getCriticalPath(): TaskStatus[] {
        return getCriticalPath(this.orchestrationResult, this.options.orchestrator);
    }

    getStagedFiles(): string[] {
        return getStagedFiles();
    }

    async executeCommit(options?: Partial<CommitWorkflowOptions>, skipGateCheck = false): Promise<CommitWorkflowResult> {
        return executeCommit(
            {
                orchestrationResult: this.orchestrationResult,
                orchestrator: this.options.orchestrator,
                router: this.router,
                testHook: this.testHook,
                commitHook: this.commitHook,
                qaService: this.qaService,
                effectiveAgentId: this.effectiveAgentId,
                onQAReview: this.options.onQAReview,
                onAutoCommitStatus: this.options.onAutoCommitStatus,
            },
            options,
            skipGateCheck,
        );
    }

    recordRoutingSuccess(agentId: string): void {
        this.router.recordSuccess(agentId);
    }

    recordRoutingFailure(agentId: string): void {
        this.router.recordFailure(agentId);
    }

    async shutdown(): Promise<void> {
        await this.reflectionEngine.flushReflections().catch((err) => {
            console.warn('[ReflectionEngine] flushReflections failed on shutdown:', err);
        });
    }

    getRoutingWeight(agentId: string): number {
        return this.router.getWeight(agentId);
    }

    async getReflectionDetails() {
        const stats = await this.reflectionEngine.getStats();
        const promotedPolicies = await this.reflectionEngine.getPromoter().getExistingRules();
        const DOMAINS = ['audit', 'test', 'commit', 'agent', 'bootstrap'] as const;
        const nearThreshold: Array<{ domain: string; failureType: string; count: number }> = [];
        for (const domain of DOMAINS) {
            const patterns = await this.reflectionEngine.getDetector().scanByDomain(domain);
            for (const p of patterns) {
                if (p.count === stats.promotionThreshold - 1 && !p.promotedToPolicy) {
                    nearThreshold.push({ domain: p.domain, failureType: p.failureType, count: p.count });
                }
            }
        }
        return { stats, promotedPolicies, nearThreshold };
    }

    getSessionStats() {
        return this.sessionStats;
    }

    getContextTokens(): number {
        return estimateMessagesTokens(this.messages);
    }

    async processInput(userInput: string): Promise<string> {
        if (this.busy) {
            throw new Error('Agente ocupado. Espera a que termine o presiona Esc para abortar.');
        }
        this.busy = true;
        try {
            return await this._processInput(userInput);
        } finally {
            this.busy = false;
        }
    }

    // -- Privados -----------------------------------------------------------

    private buildAgentSystemPrompt(): string {
        let base = this.currentProfileAddition
            ? this.basePrompt + this.currentProfileAddition
            : this.basePrompt;

        if (this.effectiveAgentId === 'general') {
            base += DELEGATION_PROMPT;
        }

        const agentSkills = (this.options.activeSkills || []).filter(
            s => s.agents?.includes(this.effectiveAgentId),
        );
        if (agentSkills.length === 0) return base;

        const skillContent = agentSkills
            .flatMap(s => [s.systemPromptAddition, s.customInstructions])
            .filter(Boolean)
            .join('\n\n');
        return skillContent
            ? base + `\n\n## Skills activos para este agente\n${skillContent}`
            : base;
    }

    private rebuildBasePrompt(): void {
        this.basePrompt = buildSystemPrompt(
            this.options.config,
            this.options.contextMarkdown,
            this.options.instructions,
            this.options.vaultPath,
            this.currentMemoryContext,
            this.options.activeSkills,
            this.contextFiles,
            this.lessonsMemo,
        );
    }

    private getActiveSkillsForInput(input: string): Skill[] {
        const lower = input.toLowerCase();
        return (this.options.activeSkills || []).filter(skill =>
            skill.triggers.some(t => lower.includes(t.toLowerCase())),
        );
    }

    private async _processInput(userInput: string): Promise<string> {
        this.abortRequested = false;
        this.messages = validateMessages(this.messages);

        // Detectar correcciones explicitas del usuario
        const correction = detectUserCorrection(userInput);
        if (correction) {
            this.agentHook.reportAgentFailure(
                `Correccion del usuario al agente "${this.effectiveAgentId}": ${correction}`,
                this.effectiveAgentId,
                [],
                'agent_hallucination',
            ).catch((err) => { console.warn('[AgentHook] Error:', err); });
            this.router.recordFailure(this.effectiveAgentId);
        }

        // Detectar cambio de direccion y ejecutar orquestador si es necesario
        const directionChange = detectDirectionChange(userInput, this.previousTaskContext);
        if (directionChange.changed) {
            console.warn(`[orchestrator] Cambio de direccion detectado: ${directionChange.reason}`);
            this.orchestrationResult = await runOrchestrator(
                userInput,
                this.options.orchestrator,
                this.reflectionEngine,
                this.messages,
                this.options.onOrchestration,
            );
        } else if (!this.orchestrationResult) {
            this.orchestrationResult = await runOrchestrator(
                userInput,
                this.options.orchestrator,
                this.reflectionEngine,
                this.messages,
                this.options.onOrchestration,
            );
        }

        if (this.orchestrationResult) {
            this.previousTaskContext = { ...this.orchestrationResult.task };
        }

        // Resolver agente
        const resolution = await resolveAgentAndInput(
            userInput,
            this.effectiveAgentId,
            this.router,
            this.options.allAgents,
            this.orchestrationResult,
            this.developerProfile,
            (profile, method) => {
                const previousAgentId = this.effectiveAgentId;
                this.effectiveAgentId = profile.id;
                this.effectiveTemperature = profile.temperature ?? 0.2;
                this.setAgentProfile(profile.systemPromptAddition);
                this.options.onAgentRouting?.(profile, method as 'override' | 'textual' | 'llm');
                this.options.onAgentAutoSwitch?.(profile);
                // TASK-04: detectar wrong_agent_selected cuando el router bypasea la recomendacion del orquestador
                if (method !== 'override' && profile.id !== previousAgentId) {
                    const preferred = this.orchestrationResult?.selectedAgents?.map(a => a.agentId) ?? [];
                    if (preferred.length > 0 && !preferred.includes(profile.id)) {
                        this.agentHook.reportWrongAgentSelection(
                            profile.id,
                            preferred.join(', '),
                        ).catch((err) => { console.warn('[AgentHook] Error:', err); });
                    }
                }
            },
        );
        this.effectiveAgentId = resolution.agentId;
        this.effectiveTemperature = resolution.temperature;

        // Compactar si es necesario
        this.messages = await compactIfNeeded(this.messages, this.summarizer);

        // Skills activos
        const relevantSkills = this.getActiveSkillsForInput(resolution.cleanInput);
        if (relevantSkills.length > 0) {
            const skillCtx = relevantSkills
                .flatMap(s => [s.systemPromptAddition, s.customInstructions])
                .filter(Boolean)
                .join('\n\n');
            if (skillCtx.trim()) {
                this.messages.push({ role: 'system', content: `[Skill context]\n${skillCtx}` });
            }
        }

        // TASK-10: inyectar contexto de checkpoint antes del user message
        if (this.pendingContextInjection) {
            this.messages.push({ role: 'system', content: this.pendingContextInjection });
            this.pendingContextInjection = undefined;
        }

        this.messages.push({ role: 'user', content: resolution.cleanInput });

        const tools = this.combinedTools.length > 0 ? this.combinedTools : undefined;
        this.iterationManager.reset();
        let correctionRounds = 0;
        // Bug #6: rastrear tool calls repetidos para detectar loops de herramientas
        let toolCallCounts = new Map<string, number>();

        while (true) {
            if (this.abortRequested) return '';

            const shouldContinue = await this.iterationManager.advance();
            if (!shouldContinue) {
                const stats = this.iterationManager.stats;
                const limitLabel = stats.iterations >= stats.globalLimit
                    ? stats.globalLimit
                    : stats.maxIterations;
                this.messages = await forceCompact(this.messages, this.summarizer, 4).catch(() => this.messages);
                const lastMsg = this.messages[this.messages.length - 1];
                const hasPendingTools = lastMsg && lastMsg.role === 'tool';
                if (hasPendingTools) {
                    this.messages.push({
                        role: 'system',
                        content: `Limite de ${limitLabel} iteraciones alcanzado. Resumi lo logrado hasta ahora sin mas tool calls.`,
                    });
                    continue;
                }
                const lastAssistant = [...this.messages].reverse().find(m => m.role === 'assistant' && m.content);
                const summary = lastAssistant?.content?.slice(0, 200) ?? '';
                return `\u23f8\ufe0f Limite de ${limitLabel} iteraciones alcanzado.\n` +
                    `Tool calls: ${stats.toolCalls} \u00b7 Delegaciones: ${stats.delegations}\n` +
                    (summary ? `\nUltima respuesta parcial:\n${summary}` : '') +
                    `\nPodes continuar con el siguiente mensaje.`;
            }

            this.abortController = new AbortController();
            const signal = this.abortController.signal;

            this.options.onThinking?.();
            this.messages = validateMessages(this.messages);

            const effectiveTools = tools
                ? this.enforcer.filterToolsForAgent(tools, this.effectiveAgentId)
                : undefined;

            let message;

            try {
                if (this.options.onChunk) {
                    message = await this.options.client.chatStream(
                        this.messages,
                        effectiveTools,
                        {
                            onChunk: this.options.onChunk,
                            onReasoningChunk: this.options.onReasoningChunk,
                            onStreamStart: this.options.onStreamStart,
                            onUsage: this.options.onUsage,
                            onToolCallChunk: this.options.onToolCallChunk,
                            signal,
                        },
                        this.effectiveTemperature,
                    );
                } else {
                    message = await this.options.client.chat(this.messages, effectiveTools, this.effectiveTemperature, signal);
                }
            } catch (err: unknown) {
                if (this.abortRequested || (err instanceof Error && (err.name === 'AbortError' || err.message?.includes('abort')))) {
                    return '';
                }
                if (err instanceof Error && (err.message?.includes('maximum context length') || err.message?.includes('context_length_exceeded'))) {
                    try {
                        this.messages = await forceCompact(this.messages, this.summarizer, 4);
                        continue;
                    } catch {
                        throw new Error(
                            'El historial es demasiado largo incluso tras compactar.\n' +
                            'Escribe /reset-context para reiniciar la conversacion sin perder el sistema.',
                        );
                    }
                }
                if (err instanceof Error && (err.message?.includes('tool_calls') || err.message?.includes('tool messages'))) {
                    this.messages = validateMessages(this.messages);
                    continue;
                }
                throw err;
            }

            this.abortController = null;
            if (this.abortRequested) return '';

            if (message.tool_calls && message.tool_calls.length > 0) {
                // Bug #4: abort controller dedicado a la fase de tool execution
                const toolPhaseAbortCtrl = new AbortController();
                this.abortController = toolPhaseAbortCtrl;
                const validToolCalls = message.tool_calls.filter((tc: any) => tc.id && tc.id.trim() !== '');
                if (validToolCalls.length === 0) {
                    if (message.content) {
                        this.messages.push({ role: 'assistant', content: message.content });
                        this.options.onResponse?.(message.content);
                        return message.content;
                    }
                    throw new Error('El modelo devolvio tool_calls sin IDs validos');
                }

                const assistantMsg: Message = { role: 'assistant', content: message.content ?? null, tool_calls: validToolCalls };
                this.messages.push(assistantMsg);

                // ─── Separar ask_agent del resto ───────────────────────────────────────
                const askAgentCalls = validToolCalls.filter(tc => tc.function.name === 'ask_agent');
                const otherCalls    = validToolCalls.filter(tc => tc.function.name !== 'ask_agent');

                // ─── ask_agent: paralelo si hay 2+ y delegacion activa ──────────────
                if (askAgentCalls.length >= 2 && !this.options.noDelegation && !this.abortRequested) {
                    for (const tc of askAgentCalls) {
                        this.iterationManager.recordToolCall();
                        this.options.onToolCall?.(tc.function.name, tc.function.arguments, tc.id);
                    }
                    const askCtx = {
                        client: this.options.client,
                        allAgents: this.options.allAgents,
                        activeSkills: this.options.activeSkills,
                        basePrompt: this.basePrompt,
                        orchestrationResult: this.orchestrationResult,
                        messages: this.messages,
                        combinedTools: this.combinedTools,
                        enforcer: this.enforcer,
                        customToolExecutor: this.customToolExecutor,
                        executeBuiltinTool: this.executeBuiltinTool.bind(this),
                        config: this.options.config,
                        instructions: this.options.instructions,
                        vaultPath: this.options.vaultPath,
                        askConfirmation: this.options.askConfirmation,
                        commandTimeoutMs: this.options.commandTimeoutMs,
                        memoryContext: this.currentMemoryContext,
                        summarizer: this.summarizer,
                        onDelegating: this.options.onDelegating,
                        onSpecialistDone: this.options.onSpecialistDone,
                        effectiveAgentId: this.effectiveAgentId,
                        // Bug #4: propagar abort signal a los specialists
                        abortSignal: toolPhaseAbortCtrl.signal,
                    };
                    const parallelResults = await Promise.all(
                        // Bug #2: JSON.parse dentro del try para que un JSON malformado no derribe todo el Promise.all
                        askAgentCalls.map(async (toolCall) => {
                            let agentArgs: any = {};
                            try {
                                agentArgs = JSON.parse(toolCall.function.arguments);
                                const askResult = await executeAskAgent(agentArgs, askCtx);
                                return { toolCall, agentArgs, askResult, error: null as unknown };
                            } catch (err) {
                                return { toolCall, agentArgs, askResult: null, error: err as unknown };
                            }
                        })
                    );
                    // Collect results serially — memory writes no son thread-safe
                    for (const { toolCall, agentArgs, askResult, error } of parallelResults) {
                        this.iterationManager.recordDelegation();
                        let result: string;
                        let streamed = false;
                        if (!askResult || error) {
                            result = `Error en agente paralelo: ${error instanceof Error ? (error as Error).message : String(error)}`;
                        } else {
                            result = askResult.content;
                            streamed = true;
                            this.sessionStats.calls++;
                            this.sessionStats.inputTokens += askResult.inputTokens;
                            this.sessionStats.outputTokens += askResult.outputTokens;
                            const profile = this.options.allAgents?.find(a => a.id === agentArgs.agent_id);
                            if (profile) this.options.onSpecialistDone?.(profile, askResult.elapsedMs, askResult.inputTokens, askResult.outputTokens);
                            if (askResult.memoryTags && this.currentMemoryContext?.projectDir) {
                                await applyMemoryUpdate(
                                    this.currentMemoryContext.projectDir,
                                    askResult.memoryTags,
                                    agentArgs.agent_id,
                                    this.reflectionEngine,
                                );
                            }
                        }
                        if (result.length > MAX_TOOL_RESULT_CHARS) {
                            result = result.slice(0, MAX_TOOL_RESULT_CHARS) +
                                `\n\n[Salida truncada - ${result.length.toLocaleString()} caracteres totales]`;
                        }
                        if (!streamed) this.options.onToolResult?.(toolCall.function.name, result, toolCall.id);
                        this.options.onToolDone?.();
                        this.messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
                    }
                } else {
                    // ask_agent serial: 0/1 llamadas o delegacion desactivada
                    for (const toolCall of askAgentCalls) {
                        if (this.abortRequested) {
                            this.messages.push({ role: 'tool', tool_call_id: toolCall.id, content: '(abortado)' });
                            continue;
                        }
                        this.iterationManager.recordToolCall();
                        this.options.onToolCall?.(toolCall.function.name, toolCall.function.arguments, toolCall.id);
                        let result = '';
                        let askAgentStreamed = false;
                        try {
                            const agentArgs = JSON.parse(toolCall.function.arguments);
                            if (this.options.noDelegation) {
                                result = 'Delegacion desactivada. Responde directamente sin delegar a otro agente.';
                            } else {
                                const askResult = await executeAskAgent(agentArgs, {
                                    client: this.options.client,
                                    allAgents: this.options.allAgents,
                                    activeSkills: this.options.activeSkills,
                                    basePrompt: this.basePrompt,
                                    orchestrationResult: this.orchestrationResult,
                                    messages: this.messages,
                                    combinedTools: this.combinedTools,
                                    enforcer: this.enforcer,
                                    customToolExecutor: this.customToolExecutor,
                                    executeBuiltinTool: this.executeBuiltinTool.bind(this),
                                    config: this.options.config,
                                    instructions: this.options.instructions,
                                    vaultPath: this.options.vaultPath,
                                    askConfirmation: this.options.askConfirmation,
                                    commandTimeoutMs: this.options.commandTimeoutMs,
                                    memoryContext: this.currentMemoryContext,
                                    summarizer: this.summarizer,
                                    onDelegating: this.options.onDelegating,
                                    onSpecialistDone: this.options.onSpecialistDone,
                                    effectiveAgentId: this.effectiveAgentId,
                                    abortSignal: toolPhaseAbortCtrl.signal,
                                });
                                this.iterationManager.recordDelegation();
                                result = askResult.content;
                                this.sessionStats.calls++;
                                this.sessionStats.inputTokens += askResult.inputTokens;
                                this.sessionStats.outputTokens += askResult.outputTokens;
                                const delegateProfile = this.options.allAgents?.find(a => a.id === agentArgs.agent_id);
                                if (delegateProfile) {
                                    this.options.onSpecialistDone?.(delegateProfile, askResult.elapsedMs, askResult.inputTokens, askResult.outputTokens);
                                }
                                askAgentStreamed = true;
                                if (askResult.memoryTags && this.currentMemoryContext?.projectDir) {
                                    await applyMemoryUpdate(
                                        this.currentMemoryContext.projectDir,
                                        askResult.memoryTags,
                                        agentArgs.agent_id,
                                        this.reflectionEngine,
                                    );
                                }
                            }
                        } catch (err: unknown) {
                            result = `Error ejecutando herramienta: ${err instanceof Error ? err.message : String(err)}`;
                            askAgentStreamed = false;
                        }
                        if (result.length > MAX_TOOL_RESULT_CHARS) {
                            result = result.slice(0, MAX_TOOL_RESULT_CHARS) +
                                `\n\n[Salida truncada - ${result.length.toLocaleString()} caracteres totales]`;
                        }
                        if (!askAgentStreamed) {
                            this.options.onToolResult?.(toolCall.function.name, result, toolCall.id);
                        }
                        this.options.onToolDone?.();
                        this.messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
                    }
                }

                // ─── Resto de herramientas: serial ─────────────────────────────────────
                for (const toolCall of otherCalls) {
                    if (this.abortRequested) {
                        this.messages.push({ role: 'tool', tool_call_id: toolCall.id, content: '(abortado)' });
                        continue;
                    }
                    this.iterationManager.recordToolCall();
                    this.options.onToolCall?.(toolCall.function.name, toolCall.function.arguments, toolCall.id);
                    let result = '';
                    // Bug #6: detectar tool calls identicas repetidas (loop de herramientas)
                    const toolSig = `${toolCall.function.name}:${toolCall.function.arguments}`;
                    const repeatCount = (toolCallCounts.get(toolSig) ?? 0) + 1;
                    toolCallCounts.set(toolSig, repeatCount);
                    if (repeatCount >= 3) {
                        result = `[Loop detectado] La herramienta "${toolCall.function.name}" ya fue llamada ${repeatCount - 1} veces con los mismos argumentos y obtuvo el mismo resultado. No la repitas. Usa la informacion que ya tienes o prueba un enfoque diferente.`;
                        this.options.onToolResult?.(toolCall.function.name, result, toolCall.id);
                        this.options.onToolDone?.();
                        this.messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
                        continue;
                    }
                    try {
                        const intercepted = this.enforcer.interceptToolCall(toolCall, this.effectiveAgentId);
                        if (intercepted) {
                            result = intercepted.message;
                            this.agentHook.reportAgentFailure(
                                `DelegationEnforcer: General intento "${toolCall.function.name}" en dominio "${intercepted.violation.domain}" sin delegar a ${intercepted.violation.specialistAgentId}`,
                                this.effectiveAgentId,
                                [intercepted.violation.filePath],
                                'delegation_failed',
                            ).catch((err) => { console.warn('[AgentHook] Error:', err); });
                        } else {
                            const executor = this.customToolExecutor || this.executeBuiltinTool.bind(this);
                            const tr = await executor(toolCall, {
                                config: this.options.config,
                                instructions: this.options.instructions,
                                vaultPath: this.options.vaultPath,
                                askConfirmation: this.options.askConfirmation,
                                commandTimeoutMs: this.options.commandTimeoutMs,
                                memoryContext: this.currentMemoryContext,
                                onMemoryUpdate: (this.options.vaultPath || this.options.localMemoryDir) ? async () => {
                                    const fresh = await loadMemoryContext(
                                        this.options.vaultPath,
                                        this.options.localMemoryDir,
                                        this.options.localProjectName,
                                    );
                                    this.reloadMemory(fresh);
                                } : undefined,
                            });
                            result = tr.success ? tr.data : tr.error;
                        }
                    } catch (err: unknown) {
                        result = `Error ejecutando herramienta: ${err instanceof Error ? err.message : String(err)}`;
                    }
                    if (result.length > MAX_TOOL_RESULT_CHARS) {
                        result = result.slice(0, MAX_TOOL_RESULT_CHARS) +
                            `\n\n[Salida truncada - ${result.length.toLocaleString()} caracteres totales]`;
                    }
                    this.options.onToolResult?.(toolCall.function.name, result, toolCall.id);
                    this.options.onToolDone?.();
                    this.messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
                }

                if (this.abortRequested) return '';
                this.abortController = null;
                correctionRounds = 0;
                continue;
            }

            if (message.content) {
                // Bug #6: resetear contador de tool calls al recibir una respuesta real
                toolCallCounts = new Map();
                const evalResult = await evaluateResponse(message.content, this.evaluator, this.effectiveAgentId);
                const { clean, recap } = extractRecap(evalResult.cleanContent);

                this.messages.push({ role: 'assistant', content: clean });
                this.options.onResponse?.(clean);
                if (recap) this.options.onRecap?.(recap);

                // TASK-09: Re-compactar si la respuesta larga hizo exceder el umbral
                if (estimateMessagesTokens(this.messages) > CONTEXT_THRESHOLD_TOKENS * 1.2) {
                    this.messages = await forceCompact(this.messages, this.summarizer, 6).catch(() => this.messages);
                }

                // TASK-03: Reportar rechazos del evaluador al Reflection Engine
                if (evalResult.shouldCorrect && evalResult.issues.length > 0) {
                    const criticalSummary = evalResult.issues
                        .filter(i => i.severity === 'critical' || i.severity === 'high')
                        .map(i => i.description)
                        .join('; ');
                    if (criticalSummary) {
                        this.agentHook.reportAgentFailure(
                            `Evaluador rechazo respuesta de "${this.effectiveAgentId}": ${criticalSummary}`,
                            this.effectiveAgentId,
                            [],
                            'response_rejected_by_evaluator',
                        ).catch((err) => { console.warn('[AgentHook] Error:', err); });
                    }
                    for (const issue of evalResult.issues.filter(i => i.type === 'hallucination')) {
                        this.agentHook.reportHallucination(
                            this.effectiveAgentId,
                            clean,
                            issue.description,
                        ).catch((err) => { console.warn('[AgentHook] Error:', err); });
                    }
                }

                // Hard enforcement: detectar si General incluyo codigo de dominios especializados
                if (this.effectiveAgentId === 'general' && !this.abortRequested && correctionRounds < 3) {
                    const textViolations = this.enforcer.auditResponse(clean);
                    if (textViolations.length > 0) {
                        correctionRounds++;
                        const summary = textViolations
                            .map(v => `"${v.filePath}" -> delegar a ${v.specialistAgentId}`)
                            .join('; ');
                        this.messages.push({
                            role: 'system',
                            content: `[DelegationEnforcer] Implementaste codigo en dominios especializados directamente: ${summary}. Debes usar ask_agent para delegar al especialista correspondiente. No codifiques en dominios con especialistas asignados.`,
                        });
                        textViolations.forEach(v => {
                            this.agentHook.reportAgentFailure(
                                `General incluyo codigo de dominio "${v.domain}" en respuesta sin delegar a ${v.specialistAgentId}`,
                                this.effectiveAgentId,
                                [v.filePath],
                                'delegation_failed',
                            ).catch((err) => { console.warn('[AgentHook] Error:', err); });
                        });
                        continue;
                    }
                }

                if (!this.abortRequested && evalResult.shouldCorrect && correctionRounds < 3) {
                    correctionRounds++;
                    const correctiveCtx = buildCorrectiveContext(evalResult.issues);
                    this.messages.push({
                        role: 'system',
                        content: `[Auto-correccion] El evaluador detecto problemas. Corrigelos:\n\n${correctiveCtx}`,
                    });
                    continue;
                }

                if (!this.abortRequested && this.options.orchestrator && this.orchestrationResult) {
                    const qaCtx = {
                        clean,
                        orchestrationResult: this.orchestrationResult,
                        orchestrator: this.options.orchestrator,
                        qaService: this.qaService,
                        router: this.router,
                        agentHook: this.agentHook,
                        allAgents: this.options.allAgents,
                        noQA: this.options.noQA,
                        onQAReview: this.options.onQAReview,
                        onAgentRouting: this.options.onAgentRouting,
                        onAgentAutoSwitch: this.options.onAgentAutoSwitch,
                        messages: this.messages,
                        effectiveAgentId: this.effectiveAgentId,
                        setAgentProfile: this.setAgentProfile.bind(this),
                        setEffectiveAgent: (agentId: string, temperature: number, profileAddition: string) => {
                            this.effectiveAgentId = agentId;
                            this.effectiveTemperature = temperature;
                            this.setAgentProfile(profileAddition);
                        },
                        autoCommitAfterQaApproval: async () => {
                            if (this._autoCommitLock) return;
                            this._autoCommitLock = true;
                            try {
                                await autoCommitAfterQaApproval(
                                    {
                                        orchestrationResult: this.orchestrationResult,
                                        router: this.router,
                                        testHook: this.testHook,
                                        qaService: this.qaService,
                                        effectiveAgentId: this.effectiveAgentId,
                                        onAutoCommitStatus: this.options.onAutoCommitStatus,
                                    },
                                    { locked: false },
                                );
                            } finally {
                                this._autoCommitLock = false;
                            }
                        },
                    };

                    // Avanzar por gates requeridos
                    await advanceRequiredGates(qaCtx);

                    // Activar qa-engineer si es necesario
                    if (activateQaEngineerIfNeeded(qaCtx)) {
                        continue;
                    }

                    // Procesar respuesta del qa-engineer
                    let qaEngineerProcessed = false;
                    if (this.effectiveAgentId === 'qa-engineer' && !this.options.noQA) {
                        await processQaEngineerResponse(qaCtx);
                        qaEngineerProcessed = true;
                        // Resetear al General
                        this.effectiveAgentId = 'general';
                        this.effectiveTemperature = 0.2;
                        this.setAgentProfile('');
                        // Notificar al CLI para que actualice currentAgentId
                        const generalProfile = this.options.allAgents?.find(a => a.id === 'general');
                        if (generalProfile) {
                            this.options.onAgentAutoSwitch?.(generalProfile);
                        }
                    }

                    // QA inline post-respuesta (solo si NO paso por qa-engineer dedicado)
                    if (!qaEngineerProcessed && this.effectiveAgentId !== 'qa-engineer') {
                        await processInlineQaReview(qaCtx);
                    }
                }

                // QA post-respuesta sin orquestador
                if (!this.abortRequested && !this.options.orchestrator && this.options.onQAReview) {
                    const review = await this.qaService.reviewResponse(clean);
                    if (review) {
                        this.options.onQAReview(review);
                        if (this.qaService.evaluateReview(review)) {
                            this.router.recordSuccess(this.effectiveAgentId);
                        } else {
                            this.router.recordFailure(this.effectiveAgentId);
                            this.agentHook.reportAgentFailure(
                                `QA post-respuesta rechazo al agente "${this.effectiveAgentId}"`,
                                this.effectiveAgentId,
                                [],
                                'response_rejected_by_evaluator',
                            ).catch((err) => { console.warn('[AgentHook] Error:', err); });
                        }
                    }
                }

                // H-002 + H-003: Auto-actualizar memoria si el agente incluyo marcas [memory:*]
                // en su respuesta directa, con validacion post-ejecucion
                if (!this.abortRequested && this.currentMemoryContext?.projectDir) {
                    const parsed = parseMemoryTags(clean);
                    if (parsed.rawTags.length > 0) {
                        await applyMemoryUpdate(
                            this.currentMemoryContext.projectDir,
                            parsed.update,
                            this.effectiveAgentId,
                            this.reflectionEngine,
                        );
                    }
                }

                return clean;
            }
            break;
        }
        return '';
    }
}
