import {
    applyExtraApprovals,
    isMcpTool,
    isReadOnlyTool,
    needsExtraApproval,
    EngineWithGate,
    GateDecision,
    ToolCallLike,
} from '../src/security/apply-extra-approvals';

/** Gate falso que registra lo que le llega y devuelve 'run'. */
function fakeEngine(opts: {
    mcpTools?: Array<{ name: string; annotations?: { readOnlyHint?: boolean } | null }>;
    disabled?: boolean;
    noGate?: boolean;
    noManager?: boolean;
} = {}): { engine: EngineWithGate; originalCalls: ToolCallLike[] } {
    const originalCalls: ToolCallLike[] = [];
    const engine: EngineWithGate = {
        ...(opts.noGate
            ? {}
            : {
                  approvalGate: {
                      disabled: opts.disabled ?? false,
                      async check(call: ToolCallLike): Promise<GateDecision> {
                          originalCalls.push(call);
                          return call.name === 'write_file' ? 'rejected' : 'run';
                      },
                  },
              }),
        ...(opts.noManager ? {} : { getMCPManager: () => ({ getTools: () => opts.mcpTools ?? [] }) }),
    };
    return { engine, originalCalls };
}

const mcpTools = [
    { name: 'design_init' },
    { name: 'docker_ps', annotations: { readOnlyHint: true } },
    { name: 'slack_post', annotations: { readOnlyHint: false } },
];

describe('isMcpTool / isReadOnlyTool', () => {
    it('identifica las tools de servidores MCP', () => {
        const manager = { getTools: () => mcpTools };
        expect(isMcpTool(manager, 'design_init')).toBe(true);
        expect(isMcpTool(manager, 'read_file')).toBe(false);
        expect(isMcpTool(undefined, 'design_init')).toBe(false);
    });

    it('detecta las marcadas como solo lectura', () => {
        const manager = { getTools: () => mcpTools };
        expect(isReadOnlyTool(manager, 'docker_ps')).toBe(true);
        expect(isReadOnlyTool(manager, 'slack_post')).toBe(false);
        expect(isReadOnlyTool(manager, 'design_init')).toBe(false);
    });
});

describe('needsExtraApproval', () => {
    const manager = { getTools: () => mcpTools };

    it('marca las tools de estado y las MCP mutantes', () => {
        expect(needsExtraApproval(manager, 'save_context')).toEqual({ needed: true, reason: 'state-write' });
        expect(needsExtraApproval(manager, 'slack_post')).toEqual({ needed: true, reason: 'mcp' });
    });

    it('no marca lectura MCP, tools de archivo ni desconocidas', () => {
        expect(needsExtraApproval(manager, 'docker_ps').needed).toBe(false);
        expect(needsExtraApproval(manager, 'read_file').needed).toBe(false);
        expect(needsExtraApproval(manager, 'list_audits').needed).toBe(false);
        expect(needsExtraApproval(undefined, 'slack_post').needed).toBe(false);
    });
});

describe('applyExtraApprovals', () => {
    it('pide aprobacion para una tool MCP y ejecuta si se aprueba', async () => {
        const { engine, originalCalls } = fakeEngine({ mcpTools });
        const asked: string[] = [];
        const result = applyExtraApprovals(engine, {
            onApproval: async (name) => { asked.push(name); return true; },
        });
        expect(result.applied).toBe(true);

        const decision = await engine.approvalGate!.check({ name: 'slack_post', args: '{"text":"hola"}' }, 'general');
        expect(asked).toEqual(['slack_post']);
        expect(decision).toBe('run');
        expect(originalCalls).toHaveLength(0); // no delega cuando decide el guard
    });

    it('rechaza la tool MCP cuando no se aprueba', async () => {
        const { engine } = fakeEngine({ mcpTools });
        applyExtraApprovals(engine, { onApproval: async () => false });
        expect(await engine.approvalGate!.check({ name: 'design_init', args: '{}' }, 'general')).toBe('rejected');
    });

    it('no pregunta por tools MCP marcadas como solo lectura', async () => {
        const { engine, originalCalls } = fakeEngine({ mcpTools });
        let asked = 0;
        applyExtraApprovals(engine, { onApproval: async () => { asked++; return false; } });
        const decision = await engine.approvalGate!.check({ name: 'docker_ps', args: '{}' }, 'general');
        expect(asked).toBe(0);
        expect(decision).toBe('run');
        expect(originalCalls.map((c) => c.name)).toEqual(['docker_ps']);
    });

    it('delega en el gate original para las tools que no son MCP', async () => {
        const { engine, originalCalls } = fakeEngine({ mcpTools });
        let asked = 0;
        applyExtraApprovals(engine, { onApproval: async () => { asked++; return true; } });
        expect(await engine.approvalGate!.check({ name: 'write_file', args: '{}' }, 'general')).toBe('rejected');
        expect(await engine.approvalGate!.check({ name: 'read_file', args: '{}' }, 'general')).toBe('run');
        expect(asked).toBe(0);        expect(originalCalls.map((c) => c.name)).toEqual(['write_file', 'read_file']);
    });

    it('respeta el modo auto (gate desactivado): no pregunta por MCP', async () => {
        const { engine, originalCalls } = fakeEngine({ mcpTools, disabled: true });
        let asked = 0;
        applyExtraApprovals(engine, { onApproval: async () => { asked++; return false; } });
        expect(await engine.approvalGate!.check({ name: 'slack_post', args: '{}' }, 'general')).toBe('run');
        expect(asked).toBe(0);
        expect(originalCalls).toHaveLength(1);
    });

    it('trunca el preview de argumentos a 200 caracteres', async () => {
        const { engine } = fakeEngine({ mcpTools });
        let preview = '';
        applyExtraApprovals(engine, { onApproval: async (_n, args) => { preview = args; return true; } });
        await engine.approvalGate!.check({ name: 'slack_post', args: 'x'.repeat(500) }, 'general');
        expect(preview).toHaveLength(200);
    });

    it('informa cuando no puede aplicarse (sin gate o sin manager)', () => {
        const sinGate = applyExtraApprovals(fakeEngine({ noGate: true }).engine, { onApproval: async () => true });
        expect(sinGate.applied).toBe(false);
        expect(sinGate.reason).toMatch(/approvalGate/);

        const sinManager = applyExtraApprovals(fakeEngine({ noManager: true }).engine, { onApproval: async () => true });
        expect(sinManager.applied).toBe(false);
        expect(sinManager.reason).toMatch(/getMCPManager/);
    });

    it('ante un error del guard delega en el gate original (no rompe el turno)', async () => {
        const engine: EngineWithGate = {
            approvalGate: {
                disabled: false,
                async check(): Promise<GateDecision> { return 'run'; },
            },
            getMCPManager: () => {
                throw new Error('manager roto');
            },
        };
        const logs: string[] = [];
        applyExtraApprovals(engine, { onApproval: async () => false, log: (m) => logs.push(m) });
        expect(await engine.approvalGate!.check({ name: 'slack_post', args: '{}' }, 'general')).toBe('run');
        expect(logs.some((l) => l.includes('manager roto'))).toBe(true);
    });

    describe('tools de estado del framework (M-7)', () => {
        it('pide aprobacion para las tools que escriben estado persistente', async () => {
            const { engine } = fakeEngine();
            const asked: string[] = [];
            applyExtraApprovals(engine, { onApproval: async (n) => { asked.push(n); return true; } });
            for (const name of ['save_context', 'save_learning', 'save_audit', 'save_user_preference', 'update_session']) {
                expect(await engine.approvalGate!.check({ name, args: '{}' }, 'general')).toBe('run');
            }
            expect(asked).toEqual(['save_context', 'save_learning', 'save_audit', 'save_user_preference', 'update_session']);
        });

        it('las rechaza cuando el usuario no aprueba', async () => {
            const { engine } = fakeEngine();
            applyExtraApprovals(engine, { onApproval: async () => false });
            expect(await engine.approvalGate!.check({ name: 'update_session', args: '{}' }, 'general')).toBe('rejected');
        });

        it('no pide aprobacion para las tools de lectura de auditoria', async () => {
            const { engine, originalCalls } = fakeEngine();
            let asked = 0;
            applyExtraApprovals(engine, { onApproval: async () => { asked++; return false; } });
            await engine.approvalGate!.check({ name: 'list_audits', args: '{}' }, 'general');
            await engine.approvalGate!.check({ name: 'get_latest_audit', args: '{}' }, 'general');
            expect(asked).toBe(0);
            expect(originalCalls.map((c) => c.name)).toEqual(['list_audits', 'get_latest_audit']);
        });

        it('en modo auto (gate desactivado) no pregunta por las tools de estado', async () => {
            const { engine, originalCalls } = fakeEngine({ disabled: true });
            let asked = 0;
            applyExtraApprovals(engine, { onApproval: async () => { asked++; return false; } });
            expect(await engine.approvalGate!.check({ name: 'save_context', args: '{}' }, 'general')).toBe('run');
            expect(asked).toBe(0);
            expect(originalCalls).toHaveLength(1);
        });
    });
});
