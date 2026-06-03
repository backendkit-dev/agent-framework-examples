/**
 * @description Buffer de mensajes de conversación con scroll vertical.
 * Almacena los mensajes user/assistant/system/error de la sesión y permite
 * navegar con ↑↓, PageUp/PageDown, Ctrl+Home/End. Se integra con el Terminal
 * para mostrar el historial completo sin depender del input history de readline.
 * El desarrollador revisa conversaciones largas sin perder el contexto visual.
 */

import chalk, { type ChalkInstance } from 'chalk';
import { theme } from './theme';

export interface BufferMessage {
    role: 'user' | 'assistant' | 'system' | 'error' | 'tool';
    content: string;
    timestamp: Date;
    /** Metadatos opcionales: nombre de herramienta, agente, etc. */
    meta?: string;
}

export interface ScrollState {
    /** Índice del primer mensaje visible */
    topIndex: number;
    /** Cantidad de líneas visibles en pantalla */
    visibleLines: number;
    /** Alto total en líneas de todos los mensajes */
    totalLines: number;
    /** Indica si hay contenido oculto arriba */
    hasMoreAbove: boolean;
    /** Indica si hay contenido oculto abajo */
    hasMoreBelow: boolean;
}

const MAX_MESSAGES = 200;
const MAX_CONTENT_LINES = 100; // líneas máximas por mensaje antes de truncar

/**
 * @description Formatea un timestamp Date a HH:MM:SS.
 */
function formatTimestamp(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/**
 * @description Obtiene el color de acento para el contenido según el rol.
 */
function getRoleColor(msg: BufferMessage): ChalkInstance {
    switch (msg.role) {
        case 'user': return chalk.hex(theme.colors.primary);
        case 'assistant': return chalk.hex(theme.colors.text);
        case 'system': return chalk.hex(theme.colors.info);
        case 'error': return chalk.hex(theme.colors.error);
        case 'tool': return chalk.hex(theme.colors.textDim);
    }
}

/**
 * @description Calcula las líneas visibles de un mensaje según el ancho de terminal.
 * Incluye timestamp, prefijo por rol, color de contenido y separador entre mensajes.
 * Trunca contenido excesivo para evitar saturar el buffer.
 */
function formatMessageLines(msg: BufferMessage, cols: number): string[] {
    const prefix = getRolePrefix(msg);
    const color = getRoleColor(msg);
    const ts = chalk.hex(theme.colors.textDim)(formatTimestamp(msg.timestamp));
    const indent = '  ';

    const content = msg.content
        .split('\n')
        .slice(0, MAX_CONTENT_LINES)
        .map(line => {
            // Truncar líneas individuales muy largas
            if (line.length > cols - 6) return line.slice(0, cols - 9) + '…';
            return line;
        });

    // Línea de cabecera: timestamp + prefijo + primera línea del contenido
    const lines: string[] = [];
    const header = ts + ' ' + prefix;
    if (content.length > 0) {
        lines.push(color(header + ' ' + content[0]));
        for (let i = 1; i < content.length; i++) {
            lines.push(indent + color(content[i]));
        }
    } else {
        lines.push(color(header));
    }

    // Si se truncó por MAX_CONTENT_LINES
    if (msg.content.split('\n').length > MAX_CONTENT_LINES) {
        lines.push(chalk.hex(theme.colors.textDim)(indent + '… +' + (msg.content.split('\n').length - MAX_CONTENT_LINES) + ' líneas más'));
    }

    return lines;
}

function getRolePrefix(msg: BufferMessage): string {
    switch (msg.role) {
        case 'user':
            return chalk.hex(theme.colors.primary)('$>');
        case 'assistant':
            return chalk.hex(theme.colors.success)('◆');
        case 'system':
            return chalk.hex(theme.colors.info)('◇');
        case 'error':
            return chalk.hex(theme.colors.error)('▲');
        case 'tool':
            return chalk.hex(theme.colors.textDim)('◌');
    }
}

/**
 * @description Buffer circular de mensajes de conversación con scroll.
 * Almacena hasta MAX_MESSAGES mensajes y permite navegar el historial
 * con operaciones de scroll. Se actualiza automáticamente cuando se
 * agregan nuevos mensajes (scroll al final).
 */
export class MessageBuffer {
    private messages: BufferMessage[] = [];
    /** Índice del primer mensaje visible en pantalla */
    private scrollTop = 0;
    /** Si es true, el scroll sigue el final automáticamente */
    private followEnd = true;

    /**
     * @description Agrega un mensaje al buffer. Si followEnd está activo,
     * hace scroll automático al final para mostrar el mensaje nuevo.
     */
    add(msg: BufferMessage): void {
        this.messages.push(msg);
        if (this.messages.length > MAX_MESSAGES) {
            this.messages = this.messages.slice(-MAX_MESSAGES);
        }
        if (this.followEnd) {
            // El scroll se recalcula en getScrollState
            this.scrollTop = Infinity; // se ajusta en el próximo render
        }
    }

    /**
     * @description Agrega múltiples mensajes de una vez.
     * Útil para restaurar historial desde memoria persistente.
     */
    addAll(msgs: BufferMessage[]): void {
        for (const msg of msgs) {
            this.messages.push(msg);
        }
        if (this.messages.length > MAX_MESSAGES) {
            this.messages = this.messages.slice(-MAX_MESSAGES);
        }
        if (this.followEnd) {
            this.scrollTop = Infinity;
        }
    }

    /**
     * @description Limpia todo el buffer.
     */
    clear(): void {
        this.messages = [];
        this.scrollTop = 0;
        this.followEnd = true;
    }

    /**
     * @description Obtiene todos los mensajes almacenados.
     */
    getAll(): BufferMessage[] {
        return [...this.messages];
    }

    /**
     * @description Construye todas las líneas renderizadas de todos los mensajes,
     * con separadores entre mensajes. Es la fuente de verdad para scroll y render.
     */
    private buildAllLines(cols: number): string[] {
        const allLines: string[] = [];
        const separator = chalk.hex(theme.colors.border)('─'.repeat(Math.min(cols - 2, 40)));
        for (let i = 0; i < this.messages.length; i++) {
            if (i > 0) allLines.push(separator);
            const lines = formatMessageLines(this.messages[i], cols);
            allLines.push(...lines);
        }
        return allLines;
    }

    /**
     * @description Calcula el estado de scroll actual según el alto disponible.
     * @param availableHeight Alto disponible en líneas para mostrar mensajes
     * @param terminalWidth Ancho de la terminal en columnas
     */
    getScrollState(availableHeight: number, terminalWidth: number): ScrollState {
        const cols = terminalWidth || 80;
        const allLines = this.buildAllLines(cols);
        const totalLines = allLines.length;

        // Ajustar scrollTop si está en Infinity (follow end)
        if (this.scrollTop === Infinity || this.scrollTop > totalLines - availableHeight) {
            this.scrollTop = Math.max(0, totalLines - availableHeight);
        }

        // Asegurar que scrollTop esté en rango
        this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, totalLines - availableHeight)));

        const hasMoreAbove = this.scrollTop > 0;
        const hasMoreBelow = this.scrollTop + availableHeight < totalLines;

        return {
            topIndex: this.scrollTop,
            visibleLines: availableHeight,
            totalLines,
            hasMoreAbove,
            hasMoreBelow,
        };
    }

    /**
     * @description Renderiza los mensajes visibles en el área disponible.
     * @param availableHeight Alto disponible en líneas
     * @param terminalWidth Ancho de la terminal en columnas
     * @returns Array de líneas renderizadas para mostrar en pantalla
     */
    render(availableHeight: number, terminalWidth: number): string[] {
        const cols = terminalWidth || 80;
        const state = this.getScrollState(availableHeight, cols);

        if (state.totalLines === 0) {
            return [];
        }

        const allLines = this.buildAllLines(cols);

        // Slice visible
        const visible = allLines.slice(state.topIndex, state.topIndex + availableHeight);

        // Agregar indicadores de scroll
        const result: string[] = [];
        if (state.hasMoreAbove) {
            result.push(chalk.hex(theme.colors.textDim)('  ▲ ' + state.topIndex + ' líneas arriba'));
        }
        result.push(...visible);
        if (state.hasMoreBelow) {
            const remaining = state.totalLines - (state.topIndex + visible.length);
            result.push(chalk.hex(theme.colors.textDim)('  ▼ ' + remaining + ' líneas más'));
        }

        return result;
    }

    // ── Operaciones de scroll ──────────────────────────────────────────

    /**
     * @description Desplaza una línea hacia arriba (ver mensajes más antiguos).
     */
    scrollUp(): void {
        this.followEnd = false;
        if (this.scrollTop > 0) {
            this.scrollTop--;
        }
    }

    /**
     * @description Calcula el total de líneas renderizadas para todos los mensajes.
     */
    private getTotalLines(cols?: number): number {
        return this.buildAllLines(cols ?? 80).length;
    }

    /**
     * @description Desplaza una línea hacia abajo (ver mensajes más recientes).
     */
    scrollDown(cols?: number): void {
        const totalLines = this.getTotalLines(cols);
        if (this.scrollTop < totalLines - 1) {
            this.scrollTop++;
        }
        if (this.scrollTop >= totalLines - 1) {
            this.followEnd = true;
        }
    }

    /**
     * @description Desplaza una página hacia arriba.
     * @param pageSize Cantidad de líneas por página
     */
    scrollPageUp(pageSize: number): void {
        this.followEnd = false;
        this.scrollTop = Math.max(0, this.scrollTop - pageSize);
    }

    /**
     * @description Desplaza una página hacia abajo.
     * @param pageSize Cantidad de líneas por página
     */
    scrollPageDown(pageSize: number, cols?: number): void {
        const totalLines = this.getTotalLines(cols);
        this.scrollTop = Math.min(totalLines - 1, this.scrollTop + pageSize);
        if (this.scrollTop >= totalLines - 1) {
            this.followEnd = true;
        }
    }

    /**
     * @description Va al inicio del historial.
     */
    scrollToTop(): void {
        this.followEnd = false;
        this.scrollTop = 0;
    }

    /**
     * @description Va al final del historial (mensajes más recientes).
     */
    scrollToBottom(): void {
        this.followEnd = true;
        this.scrollTop = Infinity; // se ajusta en el próximo render
    }

    /**
     * @description Indica si el buffer está siguiendo el final automáticamente.
     */
    isFollowingEnd(): boolean {
        return this.followEnd;
    }

    /**
     * @description Cantidad de mensajes almacenados.
     */
    get length(): number {
        return this.messages.length;
    }
}
