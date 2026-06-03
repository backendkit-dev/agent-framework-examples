import { AgentClient } from '../../api/client';
import { AgentProfile } from '../profiles';
import { getGitDiff } from '../commit/index';
import { AuditFinding } from '../../orchestrator';

export interface QAServiceOptions {
    client: AgentClient;
    /** Lazy getter — always returns the current base prompt. */
    basePrompt: () => string;
    /** Lazy getter — returns the current effective agent id. */
    effectiveAgentId?: () => string;
    allAgents?: AgentProfile[];
    noQA?: boolean;
    onQAReview?: (review: string) => void;
    /** Called after each QA evaluation so the caller can record routing outcomes. */
    onOutcome?: (agentId: string, approved: boolean) => void;
}

export interface QAReviewResult {
    approved: boolean;
    review: string;
}

const APPROVAL_PATTERNS = [
    'visto bueno', 'aprobado', 'approved', 'aprueba', 'ok',
    'se ve bien', 'correcto', 'bien', 'buen trabajo',
    'no hay problemas', 'sin problemas', 'todo bien',
    'puede continuar', 'procede', 'listo para commit',
    'lgtm', 'looks good', 'good to go', ':+1:',
];

const REJECTION_PATTERNS = [
    'problema', 'error', 'falta', 'incorrecto', 'mal',
    'debe corregir', 'necesita cambios', 'no apruebo',
    'rechazado', 'rework', 'issues encontrados',
    'no esta bien', 'incompleto', 'faltan tests',
    'edge cases', 'casos borde', 'mejorable',
];

export class QAService {
    private opts: QAServiceOptions;

    constructor(opts: QAServiceOptions) {
        this.opts = opts;
    }

    countCodeLines(content: string): number {
        const blocks = content.match(/```[\s\S]*?```/g) ?? [];
        return blocks.reduce((total, block) => {
            const inner = block.split('\n').slice(1, -1);
            return total + inner.filter(l => l.trim()).length;
        }, 0);
    }

    async reviewResponse(workContent: string): Promise<string | null> {
        if (this.opts.noQA) return null;
        if (this.opts.effectiveAgentId?.() === 'qa-engineer') return null;
        if (this.countCodeLines(workContent) < 8) return null;

        const qaProfile = this.opts.allAgents?.find(a => a.id === 'qa-engineer');
        if (!qaProfile) return null;

        const systemPrompt = this.opts.basePrompt() + qaProfile.systemPromptAddition;
        try {
            const response = await this.opts.client.chat(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Revisa el siguiente trabajo y da el visto bueno, o senala problemas de calidad, testing faltante o edge cases importantes:\n\n${workContent}` },
                ],
                undefined,
                0.2
            );
            return response.content ?? null;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const fallback = `(QA review no disponible: ${msg}. El codigo se acepta sin revision de QA.)`;
            this.opts.onQAReview?.(fallback);
            return null;
        }
    }

    async reviewPreCommit(stagedFiles: string[]): Promise<QAReviewResult> {
        if (this.opts.noQA) return { approved: true, review: '' };

        const gitDiff = getGitDiff();
        if (!gitDiff) return { approved: true, review: '' };

        const qaProfile = this.opts.allAgents?.find(a => a.id === 'qa-engineer');
        const systemPrompt = qaProfile?.systemPromptAddition
            ? this.opts.basePrompt() + qaProfile.systemPromptAddition
            : this.opts.basePrompt() + '\n\nEres un ingeniero de QA experto. Revisas cambios de codigo antes de commitear.';

        const contextParts: string[] = [
            '## Cambios a commitear (git diff staged)',
            '',
            '```diff',
            gitDiff.slice(0, 8000),
            gitDiff.length > 8000 ? '\n... (diff truncado)' : '',
            '```',
        ];

        if (stagedFiles.length > 0) {
            contextParts.push(
                '',
                '## Archivos modificados',
                '',
                stagedFiles.map(f => `- ${f}`).join('\n'),
            );
        }

        const userMessage = [
            'Se va a realizar un commit con los siguientes cambios. Revisa el codigo y determina si es apto para commit.',
            '',
            'Debes:',
            '1. Verificar que el codigo sea correcto y sigue buenas practicas',
            '2. Detectar problemas de calidad, seguridad o rendimiento',
            '3. Senalar edge cases no cubiertos o testing faltante',
            '',
            'Responde con APROBADO si el codigo es apto para commit, o RECHAZADO si hay problemas que corregir.',
            'Si hay problemas, indica exactamente que archivos y lineas necesitan cambios.',
            '',
            ...contextParts,
        ].join('\n');

        try {
            const response = await this.opts.client.chat(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                undefined,
                0.2
            );

            const review = response.content ?? '(QA no pudo generar revision)';
            const approved = this.evaluateReview(review);
            this.opts.onOutcome?.('qa-engineer', approved);
            return { approved, review };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                approved: true,
                review: `(QA no disponible: ${msg}. Commit sin revision de QA.)`,
            };
        }
    }

    async diagnoseTestFailure(testOutput: string): Promise<string> {
        const gitDiff = getGitDiff();
        const qaProfile = this.opts.allAgents?.find(a => a.id === 'qa-engineer');
        const systemPrompt = qaProfile?.systemPromptAddition
            ? this.opts.basePrompt() + qaProfile.systemPromptAddition
            : this.opts.basePrompt() + '\n\nEres un ingeniero de QA experto. Diagnosticas tests fallidos y propones soluciones.';

        const contextParts: string[] = [
            '## Tests Fallidos',
            '',
            testOutput.slice(0, 4000),
            testOutput.length > 4000 ? '\n... (salida truncada)' : '',
        ];

        if (gitDiff) {
            contextParts.push(
                '',
                '## Diff del codigo a commitear',
                '',
                '```diff',
                gitDiff.slice(0, 6000),
                gitDiff.length > 6000 ? '\n... (diff truncado)' : '',
                '```',
            );
        }

        const userMessage = [
            'Los tests del proyecto fallaron al intentar hacer commit. Analiza el output de los tests y el diff del codigo para:',
            '',
            '1. Identificar la causa raiz de cada fallo',
            '2. Senalar exactamente que archivos y lineas causan los problemas',
            '3. Sugerir correcciones especificas (con codigo si aplica)',
            '4. Indicar si es un error en el codigo o en los tests mismos',
            '',
            ...contextParts,
        ].join('\n');

        try {
            const response = await this.opts.client.chat(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                undefined,
                0.2
            );

            const diagnosis = response.content ?? '(QA no pudo generar diagnostico)';

            if (this.opts.onQAReview) {
                this.opts.onQAReview(`QA Diagnosis - Tests Fallidos\n\n${diagnosis}`);
            }

            return diagnosis;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return `(QA no disponible: ${msg}. Corrige los errores manualmente.)`;
        }
    }

    evaluateReview(review: string): boolean {
        const lower = review.toLowerCase();

        const hasApproval = APPROVAL_PATTERNS.some(p => lower.includes(p));
        const hasRejection = REJECTION_PATTERNS.some(p => lower.includes(p));

        if (hasApproval && !hasRejection) return true;
        if (hasRejection && !hasApproval) return false;

        const positiveLines = review.split('\n').filter(l =>
            APPROVAL_PATTERNS.some(p => l.toLowerCase().includes(p))
        ).length;
        const negativeLines = review.split('\n').filter(l =>
            REJECTION_PATTERNS.some(p => l.toLowerCase().includes(p))
        ).length;

        return positiveLines > negativeLines;
    }

    extractFindings(review: string): AuditFinding[] {
        const hallazgos: AuditFinding[] = [];
        const lines = review.split('\n');
        const lower = review.toLowerCase();

        const hasProblems = /(problema|error|falta|incorrecto|edge.case|caso.borde|testing.faltante|bloqueante|critico|mejorable|debe.corregir|necesita.cambios|issues.encontrados)/i.test(lower);
        if (!hasProblems) return hallazgos;

        let idx = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (
                (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+[\.\)]\s/.test(trimmed)) &&
                /(problema|error|falta|incorrecto|edge.case|testing|issue|bloqueante|critico|mejorable|cubrir|corregir|necesita|debe|mal|borde)/i.test(trimmed) &&
                trimmed.length > 10
            ) {
                const severidad: 'critical' | 'high' | 'medium' | 'low' =
                    /(bloqueante|critico|grave|security|critical)/i.test(trimmed) ? 'critical' :
                        /(alto|alta|importante|major)/i.test(trimmed) ? 'high' :
                            /(bajo|baja|minor|mejorable)/i.test(trimmed) ? 'low' :
                                'medium';

                hallazgos.push({
                    id: `QA-${Date.now().toString(36)}-${idx++}`,
                    dimension: 'Code Review',
                    hallazgo: trimmed.slice(0, 200),
                    severidad,
                    evidencia: `Linea de revision QA: "${trimmed.slice(0, 150)}"`,
                    recomendacion: 'Revisar y corregir el problema senalado en la revision QA',
                    agenteResponsable: 'qa-engineer',
                });
            }
        }

        if (hallazgos.length === 0 && hasProblems) {
            hallazgos.push({
                id: `QA-${Date.now().toString(36)}-0`,
                dimension: 'Code Review',
                hallazgo: 'La revision QA senalo problemas en el codigo',
                severidad: 'medium',
                evidencia: `Texto de la revision: "${review.slice(0, 300)}"`,
                recomendacion: 'Revisar el feedback completo de QA y realizar los cambios necesarios',
                agenteResponsable: 'qa-engineer',
            });
        }

        return hallazgos;
    }
}
