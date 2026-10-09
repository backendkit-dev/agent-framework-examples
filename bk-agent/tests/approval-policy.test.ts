import {
    decideApproval,
    decisionFromUserAnswer,
    isMutatingTool,
    requiresAlwaysAsk,
    ApprovalPolicyInput,
} from '../src/agent/approval-policy';

const base: ApprovalPolicyInput = {
    headless: false,
    autoApprove: false,
    toolName: 'read_file',
    argsPreview: '{"file_path":"src/index.ts"}',
    allowAll: false,
};

describe('decideApproval', () => {
    describe('modo headless (fail-closed)', () => {
        it('deniega escrituras y comandos sin --auto-approve', () => {
            for (const toolName of ['write_file', 'edit_file', 'run_command']) {
                expect(decideApproval({ ...base, headless: true, toolName })).toBe('reject');
            }
        });

        it('permite herramientas de solo lectura', () => {
            expect(decideApproval({ ...base, headless: true, toolName: 'read_file' })).toBe('approve');
            expect(decideApproval({ ...base, headless: true, toolName: 'search_files' })).toBe('approve');
        });

        it('permite mutaciones solo con autoApprove explicito', () => {
            expect(decideApproval({ ...base, headless: true, autoApprove: true, toolName: 'write_file' })).toBe('approve');
            expect(decideApproval({ ...base, headless: true, autoApprove: true, toolName: 'run_command' })).toBe('approve');
        });

        it('no depende de allowAll (que en headless no existe)', () => {
            expect(decideApproval({ ...base, headless: true, allowAll: true, toolName: 'run_command' })).toBe('reject');
        });
    });

    describe('modo interactivo', () => {
        it('pregunta para herramientas que mutan', () => {
            expect(decideApproval({ ...base, toolName: 'write_file' })).toBe('ask');
            expect(decideApproval({ ...base, toolName: 'run_command' })).toBe('ask');
        });

        it('no pregunta por herramientas de solo lectura', () => {
            expect(decideApproval({ ...base, toolName: 'read_file' })).toBe('approve');
            expect(decideApproval({ ...base, toolName: 'list_directory' })).toBe('approve');
        });

        it('respeta allowAll para operaciones normales', () => {
            expect(decideApproval({ ...base, allowAll: true, toolName: 'write_file' })).toBe('approve_all');
        });

        it('allowAll NO cubre instalar paquetes (se pregunta siempre)', () => {
            const install = { ...base, allowAll: true, toolName: 'run_command', argsPreview: '{"command":"npm install lodash"}' };
            expect(decideApproval(install)).toBe('ask');
        });
    });
});

describe('decisionFromUserAnswer', () => {
    it('"no" rechaza', () => {
        expect(decisionFromUserAnswer('no', false)).toEqual({ decision: 'reject', allowAll: false });
    });

    it('"yes" aprueba esta operacion sin activar el permiso global', () => {
        expect(decisionFromUserAnswer('yes', false)).toEqual({ decision: 'approve', allowAll: false });
    });

    it('"all" activa el permiso global en operaciones normales', () => {
        expect(decisionFromUserAnswer('all', false)).toEqual({ decision: 'approve_all', allowAll: true });
    });

    it('"all" NO activa el permiso global en operaciones irreversibles', () => {
        expect(decisionFromUserAnswer('all', true)).toEqual({ decision: 'approve', allowAll: false });
    });
});

describe('requiresAlwaysAsk', () => {
    it('detecta instalaciones de paquetes en el JSON de argumentos', () => {
        expect(requiresAlwaysAsk('run_command', '{"command":"npm install lodash"}')).toBe(true);
        expect(requiresAlwaysAsk('run_command', '{"command":"pip install requests"}')).toBe(true);
        expect(requiresAlwaysAsk('run_command', '{"command":"npm uninstall lodash"}')).toBe(true);
        expect(requiresAlwaysAsk('run_command', '{"command":"yarn add react"}')).toBe(true);
    });

    it('no marca comandos normales', () => {
        expect(requiresAlwaysAsk('run_command', '{"command":"npm test"}')).toBe(false);
        expect(requiresAlwaysAsk('run_command', '{"command":"npm ci"}')).toBe(false);
        expect(requiresAlwaysAsk('run_command', '{"command":"git status"}')).toBe(false);
    });

    it('tolera previews truncados o no-JSON', () => {
        expect(requiresAlwaysAsk('run_command', '{"command":"npm install lod')).toBe(false);
        expect(requiresAlwaysAsk('run_command', 'npm install lodash')).toBe(true);
    });

    it('solo aplica a run_command', () => {
        expect(requiresAlwaysAsk('write_file', '{"command":"npm install lodash"}')).toBe(false);
    });
});

describe('isMutatingTool', () => {
    it('clasifica escritura y ejecucion como mutantes', () => {
        expect(isMutatingTool('write_file')).toBe(true);
        expect(isMutatingTool('edit_file')).toBe(true);
        expect(isMutatingTool('run_command')).toBe(true);
    });

    it('no clasifica lectura como mutante', () => {
        expect(isMutatingTool('read_file')).toBe(false);
        expect(isMutatingTool('search_files')).toBe(false);
        expect(isMutatingTool('list_directory')).toBe(false);
    });
});
