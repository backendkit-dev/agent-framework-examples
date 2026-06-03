import { QAService, QAServiceOptions } from '../src/agent/qa/index';
import { AgentClient } from '../src/api/client';

jest.mock('../src/agent/commit/index', () => ({
    getGitDiff: jest.fn(() => null),
}));

import * as commitModule from '../src/agent/commit/index';
const mockGetGitDiff = commitModule.getGitDiff as jest.Mock;

function makeMockClient(content: string): AgentClient {
    return {
        chat: jest.fn().mockResolvedValue({ content, tool_calls: null }),
        chatStream: jest.fn(),
        getModel: jest.fn(() => 'deepseek-chat'),
        setModel: jest.fn(),
    } as unknown as AgentClient;
}

function makeOpts(overrides: Partial<QAServiceOptions> = {}): QAServiceOptions {
    return {
        client: makeMockClient('APROBADO — el código se ve bien'),
        basePrompt: () => 'System prompt base',
        effectiveAgentId: () => 'general',
        allAgents: [
            { id: 'qa-engineer', name: 'QA Engineer', systemPromptAddition: '\n\nEres QA.', model: undefined },
        ],
        noQA: false,
        ...overrides,
    };
}

describe('QAService — countCodeLines', () => {
    const svc = new QAService(makeOpts());

    it('returns 0 for plain text', () => {
        expect(svc.countCodeLines('hello world')).toBe(0);
    });

    it('counts non-empty lines inside code blocks', () => {
        const text = '```ts\nconst a = 1;\nconst b = 2;\n```';
        expect(svc.countCodeLines(text)).toBe(2);
    });

    it('ignores empty lines inside blocks', () => {
        const text = '```ts\n\nconst a = 1;\n\n```';
        expect(svc.countCodeLines(text)).toBe(1);
    });

    it('accumulates across multiple code blocks', () => {
        const text = '```ts\nline1\nline2\n```\n```ts\nline3\n```';
        expect(svc.countCodeLines(text)).toBe(3);
    });
});

describe('QAService — evaluateReview', () => {
    const svc = new QAService(makeOpts());

    it('returns true for clear approval', () => {
        expect(svc.evaluateReview('APROBADO — todo bien')).toBe(true);
        expect(svc.evaluateReview('lgtm')).toBe(true);
        expect(svc.evaluateReview('listo para commit')).toBe(true);
    });

    it('returns false for clear rejection', () => {
        expect(svc.evaluateReview('RECHAZADO — hay problemas')).toBe(false);
        expect(svc.evaluateReview('necesita cambios en el código')).toBe(false);
        expect(svc.evaluateReview('faltan tests para edge cases')).toBe(false);
    });

    it('uses line majority when mixed signals', () => {
        const mixed = 'se ve bien\nse ve bien\nse ve bien\nhay un problema menor';
        expect(svc.evaluateReview(mixed)).toBe(true);
    });
});

describe('QAService — extractFindings', () => {
    const svc = new QAService(makeOpts());

    it('returns empty array when no problems detected', () => {
        expect(svc.extractFindings('APROBADO — todo bien, sin observaciones')).toHaveLength(0);
    });

    it('extracts bullet-point findings', () => {
        const review = 'Hay problemas:\n- Error en el manejo de errores\n- Falta cobertura de edge cases';
        const findings = svc.extractFindings(review);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings[0].dimension).toBe('Code Review');
        expect(findings[0].agenteResponsable).toBe('qa-engineer');
    });

    it('creates generic finding when problems found but no structured bullets', () => {
        const review = 'El código tiene un error grave sin detalles específicos';
        const findings = svc.extractFindings(review);
        expect(findings).toHaveLength(1);
        expect(findings[0].hallazgo).toContain('senalo problemas');
    });

    it('assigns Crítica severity for critical keywords', () => {
        const review = 'Hay problemas:\n- Bloqueante: falla crítica en producción';
        const findings = svc.extractFindings(review);
        const critical = findings.find(f => f.severidad === 'critical');
        expect(critical).toBeDefined();
    });
});

describe('QAService — reviewResponse', () => {
    it('returns null when noQA=true', async () => {
        const svc = new QAService(makeOpts({ noQA: true }));
        const result = await svc.reviewResponse('```ts\n' + 'const x = 1;\n'.repeat(10) + '```');
        expect(result).toBeNull();
    });

    it('returns null when effectiveAgentId is qa-engineer', async () => {
        const svc = new QAService(makeOpts({ effectiveAgentId: () => 'qa-engineer' }));
        const result = await svc.reviewResponse('```ts\n' + 'const x = 1;\n'.repeat(10) + '```');
        expect(result).toBeNull();
    });

    it('returns null when code lines < 8', async () => {
        const svc = new QAService(makeOpts());
        const result = await svc.reviewResponse('```ts\nconst x = 1;\n```');
        expect(result).toBeNull();
    });

    it('returns null when no qa-engineer profile found', async () => {
        const svc = new QAService(makeOpts({ allAgents: [] }));
        const content = '```ts\n' + 'const x = 1;\n'.repeat(10) + '```';
        const result = await svc.reviewResponse(content);
        expect(result).toBeNull();
    });

    it('calls LLM and returns content when conditions met', async () => {
        const client = makeMockClient('Todo bien, aprobado');
        const svc = new QAService(makeOpts({ client }));
        const content = '```ts\n' + 'const x = 1;\n'.repeat(10) + '```';
        const result = await svc.reviewResponse(content);
        expect(result).toBe('Todo bien, aprobado');
        expect(client.chat).toHaveBeenCalledTimes(1);
    });
});

describe('QAService — reviewPreCommit', () => {
    beforeEach(() => mockGetGitDiff.mockReturnValue(null));

    it('returns approved=true when noQA=true', async () => {
        const svc = new QAService(makeOpts({ noQA: true }));
        const result = await svc.reviewPreCommit([]);
        expect(result.approved).toBe(true);
    });

    it('returns approved=true when no git diff', async () => {
        mockGetGitDiff.mockReturnValue(null);
        const svc = new QAService(makeOpts());
        const result = await svc.reviewPreCommit([]);
        expect(result.approved).toBe(true);
    });

    it('calls onOutcome with approval result when diff exists', async () => {
        mockGetGitDiff.mockReturnValue('diff --git a/foo.ts b/foo.ts\n+const x = 1;');
        const client = makeMockClient('APROBADO — code is good');
        const onOutcome = jest.fn();
        const svc = new QAService(makeOpts({ client, onOutcome }));

        const result = await svc.reviewPreCommit(['foo.ts']);
        expect(result.approved).toBe(true);
        expect(onOutcome).toHaveBeenCalledWith('qa-engineer', true);
    });

    it('does NOT call onOutcome when LLM throws', async () => {
        mockGetGitDiff.mockReturnValue('diff...');
        const client = { ...makeMockClient(''), chat: jest.fn().mockRejectedValue(new Error('network')) } as unknown as AgentClient;
        const onOutcome = jest.fn();
        const svc = new QAService(makeOpts({ client, onOutcome }));

        const result = await svc.reviewPreCommit([]);
        expect(result.approved).toBe(true);
        expect(onOutcome).not.toHaveBeenCalled();
    });
});

describe('QAService — diagnoseTestFailure', () => {
    it('calls onQAReview with diagnosis header', async () => {
        const client = makeMockClient('Error en línea 42');
        const onQAReview = jest.fn();
        const svc = new QAService(makeOpts({ client, onQAReview }));

        const result = await svc.diagnoseTestFailure('FAIL src/foo.test.ts');
        expect(result).toBe('Error en línea 42');
        expect(onQAReview).toHaveBeenCalledWith(expect.stringContaining('Tests Fallidos'));
    });

    it('returns fallback message when LLM throws', async () => {
        const client = { ...makeMockClient(''), chat: jest.fn().mockRejectedValue(new Error('timeout')) } as unknown as AgentClient;
        const svc = new QAService(makeOpts({ client }));
        const result = await svc.diagnoseTestFailure('test output');
        expect(result).toContain('QA no disponible');
    });
});
