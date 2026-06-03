/**
 * @description Tests unitarios para el ResponseEvaluator.
 * Cubre todas las heuristicas: referencias a archivos, imports,
 * APIs inventadas, coherencia, calidad de codigo y scoring.
 */

import { ResponseEvaluator, EvaluationIssue } from '../src/agent/evaluation';
import { AgentClient } from '../src/api/client';
import * as path from 'path';

// -- Helpers ------------------------------------------------------------------

function makeMockClient(responses?: any[]): AgentClient {
    let call = 0;
    return {
        chat: jest.fn(async () => responses?.[Math.min(call++, responses.length - 1)] ?? { content: '[]', tool_calls: null }),
        chatStream: jest.fn(),
        getModel: jest.fn(() => 'deepseek-chat'),
        setModel: jest.fn(),
    } as unknown as AgentClient;
}

function makeEvaluator(client?: AgentClient, threshold?: number): ResponseEvaluator {
    return new ResponseEvaluator(client ?? makeMockClient(), {
        approvalThreshold: threshold ?? 70,
    });
}

// -- Tests --------------------------------------------------------------------

describe('ResponseEvaluator', () => {
    describe('checkFileReferences', () => {
        it('detecta referencias a archivos que no existen en el proyecto', async () => {
            const evaluator = makeEvaluator();
            const projectRoot = path.resolve(__dirname, '..');

            const response = `
\`\`\`typescript
import { something } from './archivo-que-no-existe';
import { other } from '../src/no-existe.ts';
\`\`\`
            `;

            const result = await evaluator.evaluate(response, { projectRoot });
            const fileIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('no existe'));
            expect(fileIssues.length).toBeGreaterThanOrEqual(1);
        });

        it('no reporta falsos positivos para archivos que si existen', async () => {
            const evaluator = makeEvaluator();
            const projectRoot = path.resolve(__dirname, '..');

            // Usar un archivo que sabemos que existe: el propio heuristics.ts
            const response = `
\`\`\`typescript
import { checkFileReferences } from './src/agent/evaluation/heuristics.ts';
\`\`\`
            `;

            const result = await evaluator.evaluate(response, { projectRoot });
            const fileIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('no existe'));
            expect(fileIssues.length).toBe(0);
        });
    });

    describe('checkImports', () => {
        it('detecta paquetes npm sospechosos (no en whitelist)', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
import { foo } from 'paquete-inventado-muy-raro';
import { bar } from 'otro-invento';
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const importIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('paquete npm inventado'));
            expect(importIssues.length).toBeGreaterThanOrEqual(1);
        });

        it('no reporta paquetes npm conocidos', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
import { z } from 'zod';
import { v4 } from 'uuid';
import express from 'express';
import { NestFactory } from '@nestjs/core';
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const importIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('paquete npm inventado'));
            expect(importIssues.length).toBe(0);
        });

        it('no reporta paquetes con scope @', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
import { S3Client } from '@aws-sdk/client-s3';
import { PubSub } from '@google-cloud/pubsub';
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const importIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('paquete npm inventado'));
            expect(importIssues.length).toBe(0);
        });

        it('no reporta paths relativos locales', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
import { helper } from './utils/helper';
import { config } from '../config';
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const importIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('paquete npm inventado'));
            expect(importIssues.length).toBe(0);
        });
    });

    describe('checkInventedApis', () => {
        it('detecta metodos con nombres inusualmente largos (>25 chars)', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
const result = this.service.esteMetodoTieneUnNombreDemasiadoLargoParaSerReal();
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const apiIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('método inventado'));
            expect(apiIssues.length).toBeGreaterThanOrEqual(1);
        });

        it('no reporta metodos conocidos de objetos comunes', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
const users = await this.service.findAll();
const config = this.config.get('database');
this.logger.info('Server started');
const data = await this.repository.findOne({ where: { id } });
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const apiIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('método inventado'));
            expect(apiIssues.length).toBe(0);
        });
    });

    describe('checkCodeQuality', () => {
        it('detecta bloques de codigo vacios', async () => {
            const evaluator = makeEvaluator();

            const response = '```typescript\n\n```';

            const result = await evaluator.evaluate(response);
            const qualityIssues = result.issues.filter(i => i.type === 'quality' && i.description.includes('vacío'));
            expect(qualityIssues.length).toBeGreaterThanOrEqual(1);
        });

        it('detecta bloques de codigo que son solo comentarios', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
// TODO: implementar esto
// FIXME: esto esta roto
// HACK: solucion temporal
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const qualityIssues = result.issues.filter(i => i.type === 'quality');
            // Deberia detectar solo comentarios Y los TODOs/FIXMEs
            expect(qualityIssues.length).toBeGreaterThanOrEqual(1);
        });

        it('detecta console.log en codigo TypeScript', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
function handler(req: Request, res: Response) {
    console.log('Request received');
    console.log('Processing...');
    res.send('ok');
}
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const consoleIssues = result.issues.filter(i => i.type === 'quality' && i.description.includes('console.log'));
            expect(consoleIssues.length).toBeGreaterThanOrEqual(1);
        });

        it('detecta uso de any en TypeScript', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
function process(data: any): any {
    return data;
}
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const anyIssues = result.issues.filter(i => i.type === 'quality' && i.description.includes('any'));
            expect(anyIssues.length).toBeGreaterThanOrEqual(1);
        });

        it('detecta TODOs y FIXMEs en el codigo', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
function calculate() {
    // TODO: implementar validacion
    // FIXME: esto falla con valores negativos
    return 42;
}
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const todoIssues = result.issues.filter(i => i.type === 'quality' && i.description.includes('marcadores pendientes'));
            expect(todoIssues.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('checkCoherence', () => {
        it('detecta cuando la respuesta no se relaciona con el historial', async () => {
            const evaluator = makeEvaluator();

            const response = 'Aqui tienes la implementacion del pipeline de datos con Apache Spark';
            const history = [
                { role: 'user' as const, content: 'Necesito ayuda con el diseno de la interfaz de usuario' },
                { role: 'assistant' as const, content: 'Te ayudo con el diseno UI' },
                { role: 'user' as const, content: 'Los colores del boton no se ven bien' },
                { role: 'assistant' as const, content: 'Podemos ajustar los estilos CSS' },
                { role: 'user' as const, content: 'Hazme un componente React para el header' },
            ];

            const result = await evaluator.evaluate(response, { history });
            const coherenceIssues = result.issues.filter(i => i.type === 'coherence');
            expect(coherenceIssues.length).toBeGreaterThanOrEqual(1);
        });

        it('no reporta incoherencia cuando la respuesta es relevante', async () => {
            const evaluator = makeEvaluator();

            const response = 'Aqui tienes el componente Header con React y Tailwind';
            const history = [
                { role: 'user' as const, content: 'Necesito un componente Header para mi app React' },
                { role: 'assistant' as const, content: 'Claro, te ayudo con el diseno' },
                { role: 'user' as const, content: 'Quiero que tenga navegacion responsive' },
            ];

            const result = await evaluator.evaluate(response, { history });
            const coherenceIssues = result.issues.filter(i => i.type === 'coherence');
            expect(coherenceIssues.length).toBe(0);
        });
    });

    describe('computeScore', () => {
        it('devuelve 100 cuando no hay issues', async () => {
            const evaluator = makeEvaluator();

            const result = await evaluator.evaluate('Hola, esto es una respuesta simple sin codigo');
            expect(result.score).toBe(100);
            expect(result.approved).toBe(true);
        });

        it('penaliza correctamente segun severidad', async () => {
            const evaluator = makeEvaluator();

            // Respuesta con codigo que tiene multiples issues
            const response = `
\`\`\`typescript
import { fake } from 'paquete-inventado';
function process(data: any) {
    console.log(data);
    // TODO: implementar
}
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            expect(result.score).toBeLessThan(100);
            expect(result.issues.length).toBeGreaterThan(0);
        });

        it('marca como no aprobado cuando score < threshold', async () => {
            const evaluator = makeEvaluator(makeMockClient(), 90); // threshold alto

            const response = `
\`\`\`typescript
import { fake } from 'paquete-inventado-muy-raro';
function process(data: any) {
    console.log(data);
    // TODO: implementar validacion
    // FIXME: esto esta roto
}
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            expect(result.approved).toBe(false);
        });
    });

    describe('hallucinations', () => {
        it('extrae correctamente las alucinaciones del resultado', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
import { fake } from 'paquete-inventado';
this.service.metodoInventadoMuyLargoQueNoExiste();
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            expect(result.hallucinations.length).toBeGreaterThan(0);
            expect(result.hallucinations.every(h => h.type === 'hallucination')).toBe(true);
        });
    });

    describe('evaluate (integracion)', () => {
        it('devuelve estructura completa con todos los campos', async () => {
            const evaluator = makeEvaluator();

            const result = await evaluator.evaluate('Codigo limpio:\n```typescript\nconst x = 1;\n```');

            expect(result).toHaveProperty('score');
            expect(result).toHaveProperty('issues');
            expect(result).toHaveProperty('hallucinations');
            expect(result).toHaveProperty('approved');
            expect(result).toHaveProperty('elapsedMs');
            expect(typeof result.score).toBe('number');
            expect(Array.isArray(result.issues)).toBe(true);
            expect(Array.isArray(result.hallucinations)).toBe(true);
            expect(typeof result.approved).toBe('boolean');
            expect(typeof result.elapsedMs).toBe('number');
        });

        it('no lanza error cuando no hay projectRoot', async () => {
            const evaluator = makeEvaluator();

            await expect(evaluator.evaluate('```typescript\nconst x = 1;\n```')).resolves.toBeDefined();
        });

        it('no lanza error cuando el LLM falla (crash silencioso)', async () => {
            const failingClient = makeMockClient();
            (failingClient.chat as jest.Mock).mockRejectedValue(new Error('API error'));

            const evaluator = makeEvaluator(failingClient);

            const response = `
\`\`\`typescript
import { fake } from 'paquete-inventado-muy-raro';
\`\`\`
            `;

            // No debe lanzar error, debe devolver resultado con issues heuristicos
            const result = await evaluator.evaluate(response);
            expect(result).toBeDefined();
            // 'paquete-inventado-muy-raro' tiene 4 segmentos con guion -> isLikelyRealNpmPackage devuelve false
            const importIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('paquete npm inventado'));
            expect(importIssues.length).toBeGreaterThanOrEqual(1);
        });

        it('procesa respuestas sin bloques de codigo correctamente', async () => {
            const evaluator = makeEvaluator();

            const result = await evaluator.evaluate('Esta es una respuesta puramente textual sin codigo.');
            expect(result.score).toBe(100);
            expect(result.issues.length).toBe(0);
        });
    });

    describe('edge cases', () => {
        it('maneja respuestas vacias', async () => {
            const evaluator = makeEvaluator();

            const result = await evaluator.evaluate('');
            expect(result.score).toBe(100);
        });

        it('maneja respuestas con solo espacios', async () => {
            const evaluator = makeEvaluator();

            const result = await evaluator.evaluate('   \n  \n  ');
            expect(result.score).toBe(100);
        });

        it('maneja bloques de codigo sin lenguaje especificado', async () => {
            const evaluator = makeEvaluator();

            const result = await evaluator.evaluate('```\nalgo aqui\n```');
            expect(result).toBeDefined();
        });

        it('no se confunde con metodos de objetos conocidos en diferentes contextos', async () => {
            const evaluator = makeEvaluator();

            const response = `
\`\`\`typescript
// Prisma
await prisma.user.findUnique({ where: { id } });
await prisma.post.create({ data: { title } });

// Express
app.get('/users', (req, res) => {
    res.json(users);
});

// Lodash
const result = _.get(obj, 'path');
const merged = _.merge(defaults, overrides);
\`\`\`
            `;

            const result = await evaluator.evaluate(response);
            const apiIssues = result.issues.filter(i => i.type === 'hallucination' && i.description.includes('método inventado'));
            expect(apiIssues.length).toBe(0);
        });
    });
});
