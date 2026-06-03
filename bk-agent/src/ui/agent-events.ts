export type AgentEvent =
    | { type: 'ready' }
    | { type: 'token'; content: string }
    | { type: 'tool_call'; name: string; args_preview?: string }
    | { type: 'tool_result'; name: string; success: boolean; preview?: string }
    | { type: 'agent_switch'; from: string; to: string; to_name?: string; to_icon?: string; method?: string }
    | { type: 'system'; level: 'info' | 'warn' | 'error'; text: string }
    | { type: 'metrics'; input_tokens: number; output_tokens: number; cost_usd?: number }
    | { type: 'block_start'; agent_id: string; agent_name?: string; agent_icon?: string }
    | { type: 'block_end'; status: 'ok' | 'error'; agent_id?: string }
    | { type: 'recap'; text: string }
    | { type: 'qa_review'; content: string }
    | { type: 'thinking'; label: string }
    | { type: 'user_message'; text: string }
    | { type: 'done' }
    | { type: 'error'; message: string }
    | { type: 'clear' }
    | { type: 'config'; agents: Array<{ id: string; name: string; icon: string; description: string }>; models: Array<{ id: string; name: string; badge: string; note: string }>; commands: Array<{ name: string; description: string }>; currentAgent: string; currentModel: string; skillsCount: number; activeWorkspace?: string; workspaces?: string[] };

class AgentEventBus {
    private headless = false;

    init(headless: boolean): void {
        this.headless = headless;
    }

    isHeadless(): boolean {
        return this.headless;
    }

    emit(event: AgentEvent): void {
        if (!this.headless) return;
        process.stdout.write(JSON.stringify(event) + '\n');
    }
}

export const agentEvents = new AgentEventBus();
