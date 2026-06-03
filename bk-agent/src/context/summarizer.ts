/**
 * @description Compactación inteligente del historial de conversación.
 * 
 * Preserva decisiones arquitectónicas, secciones de recap/resumen y cualquier
 * contenido marcado como permanente. Resumen solo lo conversacional puro
 * (intercambios usuario↔asistente) para maximizar la retención de información
 * útil mientras se reduce el consumo de tokens.
 */

import { AgentClient } from '../api/client';
import { Message } from '../api/types';

// ── Patrones para detectar contenido a preservar ────────────────────────────

/** Secciones que contienen decisiones arquitectónicas o técnicas */
const DECISION_PATTERNS = [
    /##\s*Decisi[oó]n(?:es)?/i,
    /##\s*ADR/i,
    /##\s*Arquitectura/i,
    /##\s*Trade.?[Oo]ffs?/i,
    /##\s*Alternativas?/i,
    /##\s*Consecuencias/i,
    /##\s*Contexto (?:de la )?Decisi[oó]n/i,
    /##\s*Razones?\s*(?:t[eé]cnicas)?/i,
    /##\s*Justificaci[oó]n/i,
    /(?:decisión|decision|adr)\s*:\s*(?:aceptada|accepted|propuesta|proposed|supercedida|superseded)/i,
];

/** Secciones que ya son resúmenes o recaps */
const SUMMARY_PATTERNS = [
    /<recap>[\s\S]*?<\/recap>/i,
    /##\s*Resumen/i,
    /##\s*Recap/i,
    /##\s*Pr[oó]ximos Pasos/i,
    /##\s*Next Steps/i,
    /##\s*Logros?/i,
    /##\s*Progresso/i,
    /##\s*Progreso/i,
    /##\s*Checklist/i,
    /##\s*Entregables?/i,
];

/** Bloques de código con patrones de configuración/infraestructura */
const INFRASTRUCTURE_PATTERNS = [
    /```(?:yaml|yml|json|dockerfile|env|ini|toml)/i,
    /(?:docker-compose|Dockerfile|package\.json|tsconfig|\.env)/,
    /(?:kubectl|helm|terraform|ansible)/i,
];

export class ContextSummarizer {
    constructor(private client: AgentClient) { }

    /**
     * @description Compacta el historial preservando contenido valioso.
     * 
     * Estrategia:
     * 1. Extraer secciones de decisiones técnicas → se preservan textualmente
     * 2. Extraer secciones de recap/resumen → se preservan textualmente
     * 3. Extraer configuraciones/infraestructura → se preservan textualmente
     * 4. El resto (conversacional puro) se resume por LLM
     * 5. Se recombina todo en un resumen estructurado
     */
    async summarize(msgs: Message[]): Promise<string> {
        // Separar mensajes del sistema (no se resumen)
        const systemMsgs = msgs.filter(m => m.role === 'system');
        const conversationMsgs = msgs.filter(m => m.role !== 'system');

        if (conversationMsgs.length < 4) {
            // Poca conversación → devolver tal cual
            return this.formatRawMessages(conversationMsgs);
        }

        // Extraer contenido valioso de todos los mensajes
        const preserved = this.extractValuableContent(msgs);

        // Si no hay nada conversacional que resumir, devolver solo lo preservado
        const conversationalText = conversationMsgs
            .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : ''}`)
            .join('\n\n');

        if (!conversationalText.trim()) {
            return preserved.length > 0
                ? preserved.join('\n\n---\n\n')
                : '(historial vacío)';
        }

        // Resumir lo conversacional
        let summary = '';
        try {
            const prompt = [
                'Resume esta conversación en máximo 300 palabras.',
                'Enfócate en: QUÉ se hizo, POR QUÉ se hizo, y qué QUEDA PENDIENTE.',
                'Omite saludos, cortesías y repeticiones.',
                '',
                conversationalText.slice(0, 8000),
            ].join('\n');

            const resp = await this.client.chat([
                { role: 'system', content: 'Eres un resumidor técnico. Resumes conversaciones de programación manteniendo contexto técnico.', },
                { role: 'user', content: prompt },
            ]);
            summary = resp.content || '';
        } catch {
            // Si falla el LLM, concatenación simple como fallback
            summary = this.fallbackSummarize(conversationalText);
        }

        // Recombinary
        const parts: string[] = [];
        if (preserved.length > 0) {
            parts.push('## 📌 Decisiones y Recaps (preservado)');
            parts.push(...preserved);
            parts.push('');
        }
        if (summary.trim()) {
            parts.push('## 💬 Conversación resumida');
            parts.push(summary);
        }

        return parts.join('\n');
    }

    /**
     * @description Extrae secciones valiosas del historial que deben preservarse
     * textualmente durante la compactación.
     */
    private extractValuableContent(msgs: Message[]): string[] {
        const preserved: string[] = [];
        const seen = new Set<string>();

        for (const msg of msgs) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (!content) continue;

            // Extraer bloques <recap>...</recap>
            const recapRegex = /<recap>([\s\S]*?)<\/recap>/gi;
            let match: RegExpExecArray | null;
            while ((match = recapRegex.exec(content)) !== null) {
                const text = match[1].trim();
                const key = text.slice(0, 80);
                if (text && !seen.has(key)) {
                    seen.add(key);
                    preserved.push(`※ ${text}`);
                }
            }

            // Extraer secciones por patrón (decisión o resumen)
            const lines = content.split('\n');
            let inValuableSection = false;
            let sectionLines: string[] = [];

            for (const line of lines) {
                // Detectar inicio de sección valiosa
                if (!inValuableSection) {
                    const isStart = DECISION_PATTERNS.some(p => p.test(line)) ||
                        SUMMARY_PATTERNS.some(p => p.test(line));
                    if (isStart && !line.startsWith('```')) {
                        inValuableSection = true;
                        sectionLines = [line];
                        continue;
                    }
                }

                if (inValuableSection) {
                    // Detectar fin: otra sección o bloque de código
                    if ((line.startsWith('## ') || line.startsWith('---')) && sectionLines.length > 1) {
                        inValuableSection = false;
                        const section = sectionLines.join('\n').trim();
                        const key = sectionLines[0]?.slice(0, 60) ?? '';
                        if (section && !seen.has(key)) {
                            seen.add(key);
                            preserved.push(section);
                        }
                        sectionLines = [];
                        continue;
                    }
                    sectionLines.push(line);
                }
            }

            // Si la sección llegó hasta el final del mensaje
            if (inValuableSection && sectionLines.length > 1) {
                const section = sectionLines.join('\n').trim();
                const key = sectionLines[0]?.slice(0, 60) ?? '';
                if (section && !seen.has(key)) {
                    seen.add(key);
                    preserved.push(section);
                }
            }

            // Extraer bloques de código de infraestructura
            const codeRegex = /```(\w*)\n([\s\S]*?)```/g;
            while ((match = codeRegex.exec(content)) !== null) {
                const lang = match[1];
                const code = match[2].trim();
                if (!code) continue;

                // Solo preservar si es infraestructura o tiene muchos caracteres
                const isInfra = INFRASTRUCTURE_PATTERNS.some(p =>
                    p.test(`\`\`\`${lang}`) || p.test(code)
                );
                if (isInfra || code.length > 300) {
                    const key = `code:${code.slice(0, 60)}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        preserved.push(`\`\`\`${lang}\n${code}\n\`\`\``);
                    }
                }
            }
        }

        return preserved;
    }

    /**
     * @description Fallback cuando el LLM falla: resume heurísticamente
     * tomando el primer y último intercambio.
     */
    private fallbackSummarize(text: string): string {
        const exchanges = text.split(/\n(?=user:|assistant:)/).filter(Boolean);
        if (exchanges.length <= 2) return text.slice(0, 2000);

        const first = exchanges[0]?.slice(0, 300) ?? '';
        const last = exchanges[exchanges.length - 1]?.slice(0, 300) ?? '';
        return [
            `Inicio: ${first}`,
            `Último: ${last}`,
            `Total: ${exchanges.length} intercambios`,
        ].join('\n\n');
    }

    private formatRawMessages(msgs: Message[]): string {
        return msgs
            .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 500) : ''}`)
            .filter(Boolean)
            .join('\n\n');
    }
}
