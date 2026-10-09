import {
    parseDesignState,
    findPhase,
    allPhasesComplete,
    nextPendingPhase,
    phaseIcon,
    renderRoadmapLines,
    parseQaVerdict,
    buildQaRunPrompt,
    DesignState,
} from '../src/spec/design-state';

const estado: DesignState = {
    project: 'todo-api',
    currentPhase: 2,
    phases: [
        { number: 1, name: 'Setup', status: 'complete' },
        { number: 2, name: 'API', status: 'in_progress', stage: 'IMPLEMENT', criteria: ['GET /todos', 'POST /todos'] },
        { number: 3, name: 'Auth', status: 'pending' },
    ],
};

describe('parseDesignState', () => {
    it('acepta un estado valido y normaliza los campos', () => {
        const parsed = parseDesignState(JSON.parse(JSON.stringify(estado)));
        expect(parsed).toEqual(estado);
    });

    it('rechaza lo que no tiene la forma esperada (antes rompia con TypeError)', () => {
        expect(parseDesignState(null)).toBeNull();
        expect(parseDesignState({})).toBeNull();
        expect(parseDesignState({ phases: 'no-es-array' })).toBeNull();
        expect(parseDesignState({ phases: [{}] })).toBeNull();
        expect(parseDesignState({ phases: [{ number: 'uno' }] })).toBeNull();
        expect(parseDesignState({ phases: [null] })).toBeNull();
    });

    it('genera un nombre por defecto y filtra criterios no textuales', () => {
        const parsed = parseDesignState({ phases: [{ number: 7, criteria: ['ok', 42, null] }] });
        expect(parsed?.phases[0].name).toBe('Fase 7');
        expect(parsed?.phases[0].criteria).toEqual(['ok']);
    });

    it('acepta un roadmap vacio', () => {
        expect(parseDesignState({ phases: [] })?.phases).toEqual([]);
    });
});

describe('consultas del estado', () => {
    it('encuentra la fase actual', () => {
        expect(findPhase(estado)?.name).toBe('API');
    });

    it('encuentra una fase por numero', () => {
        expect(findPhase(estado, 3)?.name).toBe('Auth');
        expect(findPhase(estado, 99)).toBeUndefined();
    });

    it('sin currentPhase no hay fase', () => {
        expect(findPhase({ phases: [{ number: 1, name: 'A' }] })).toBeUndefined();
    });

    it('detecta cuando todo esta completo', () => {
        expect(allPhasesComplete(estado)).toBe(false);
        expect(allPhasesComplete({ phases: [{ number: 1, name: 'A', status: 'complete' }] })).toBe(true);
        expect(allPhasesComplete({ phases: [] })).toBe(false);
    });

    it('elige la primera fase pendiente por numero, no por orden del array', () => {
        const desordenado: DesignState = {
            phases: [
                { number: 3, name: 'C', status: 'pending' },
                { number: 1, name: 'A', status: 'complete' },
                { number: 2, name: 'B', status: 'blocked' },
            ],
        };
        expect(nextPendingPhase(desordenado)?.number).toBe(2);
    });
});

describe('render del roadmap', () => {
    it('asigna un icono por estado', () => {
        expect(phaseIcon('complete')).toBe('✓');
        expect(phaseIcon('in_progress')).toBe('◉');
        expect(phaseIcon('blocked')).toBe('✗');
        expect(phaseIcon('pending')).toBe('○');
        expect(phaseIcon(undefined)).toBe('○');
    });

    it('cuenta las fases completas y ordena por numero', () => {
        const lines = renderRoadmapLines({
            project: 'x',
            phases: [
                { number: 2, name: 'B', status: 'complete' },
                { number: 1, name: 'A', status: 'pending' },
            ],
        });
        expect(lines[0]).toContain('[1/2 fases]');
        expect(lines[2]).toContain('1. A');
        expect(lines[3]).toContain('2. B');
    });
});

describe('parseQaVerdict', () => {
    it('detecta NO-GO antes que GO (la cadena contiene "GO")', () => {
        expect(parseQaVerdict('VEREDICTO: NO-GO — falta auth')).toBe('NO-GO');
        expect(parseQaVerdict('VEREDICTO: GO')).toBe('GO');
    });

    it('es insensible a mayusculas y espacios', () => {
        expect(parseQaVerdict('veredicto:   no-go')).toBe('NO-GO');
        expect(parseQaVerdict('Veredicto: Go')).toBe('GO');
    });

    it('devuelve unknown sin veredicto o sin contenido', () => {
        expect(parseQaVerdict('reporte sin conclusion')).toBe('unknown');
        expect(parseQaVerdict('')).toBe('unknown');
        expect(parseQaVerdict(null)).toBe('unknown');
        expect(parseQaVerdict(undefined)).toBe('unknown');
    });
});

describe('buildQaRunPrompt', () => {
    it('incluye fase, criterios numerados y el archivo de salida', () => {
        const prompt = buildQaRunPrompt('/proj', estado.phases[1]);
        expect(prompt).toContain('Fase 2 "API"');
        expect(prompt).toContain('1. GET /todos');
        expect(prompt).toContain('2. POST /todos');
        expect(prompt).toContain('/proj/qa-phase2.md');
        expect(prompt).toContain('VEREDICTO: GO');
    });

    it('usa un criterio por defecto si la fase no define ninguno', () => {
        const prompt = buildQaRunPrompt('/proj', { number: 3, name: 'Auth' });
        expect(prompt).toContain('1. ver specification.md');
    });
});
