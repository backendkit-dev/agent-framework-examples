import * as readline from 'readline';
import chalk from 'chalk';
import { theme } from './theme';
import { MessageBuffer, BufferMessage } from './message-buffer';
import { InputBuffer } from './input-buffer';
import { PasteDebouncer } from './paste-debouncer';
import { copyToClipboard } from './clipboard';
import { saveToStash, loadStash } from './prompt-stash';
import { WavesAnimation, AnimationType, AnimationConfig } from '@backendkit-labs/console-animations';

const sep = () => chalk.hex(theme.colors.border)('─'.repeat(process.stdout.columns || 80));
const FOOTER = () =>
    sep();

const FOOTER_FRAMES = ['◆', '◈', '◇', '◈', '◆', '◈', '◇', '◈'];

function makeFooterAnim<T extends { start(): void; nextFrame(t: number): { content: string } }>(ctor: new (c: AnimationConfig) => T, type: AnimationType): T {
    const a = new ctor({ type, speed: 0 });
    a.start();
    return a;
}

export type ConfirmResult = 'yes' | 'no' | 'all';

export interface TerminalOptions {
    completions?: string[];
    onLine: (line: string) => Promise<void>;
    onEscape?: () => void;
    onClose?: () => void | Promise<void>;
    /** Buffer de mensajes para scroll de historial */
    messageBuffer?: MessageBuffer;
}

const MENU_OPTIONS: { label: string; value: ConfirmResult }[] = [
    { label: 'Sí', value: 'yes' },
    { label: 'Sí, permitir todas durante esta sesión (shift+tab)', value: 'all' },
    { label: 'No', value: 'no' },
];

/**
 * @description Interfaz de usuario interactiva para la CLI.
 * Proporciona menús seleccionables con teclado (↑↓), filtro en vivo,
 * confirmaciones con opción "permitir todas", y prompt con footer de
 * atajos. El desarrollador gana una experiencia tipo IDE sin depender
 * de librerías externas pesadas.
 */
export class Terminal {
    private rl: readline.Interface;
    private closed = false;
    private directOnce = false;
    private inConfirmation = false;
    private footerShown = false;
    private statusText = '';
    private messageBuffer: MessageBuffer;
    private inputBuffer: InputBuffer;
    private pasteDebouncer: PasteDebouncer;
    /** Líneas de mensajes renderizadas actualmente en pantalla */
    private renderedMessageLines = 0;
    /** Callback para redibujar el header cuando se hace scroll */
    private onRenderHeader?: () => void;
    /** Cantidad de líneas que ocupa el header en pantalla */
    private headerLines = 0;
    /** Contenido del thinking block actual (razonamiento del LLM) */
    private thinkingContent: string = "";
    /** Timestamp de inicio del thinking */
    private thinkingStart: number = 0;
    /** Si el thinking block esta expandido (true = mostrar contenido completo) */
    private thinkingExpanded: boolean = false;
    /** ID del timer de actualizacion del footer durante thinking */
    private thinkingTimer: ReturnType<typeof setInterval> | null = null;
    /** Callback para toggle de thinking */
    private onThinkingToggle?: (expanded: boolean) => void;
    /** true si hay una línea de estado inline activa (sin prompt visible) */
    private inlineStatusActive = false;
    /** Índice del frame actual del icono animado en el footer */
    private footerFrameIdx = 0;
    /** Último bloque de código para Ctrl+Y (copiar al portapapeles) */
    private lastCodeBlock: string | null = null;
    /** Acumulador de líneas para entrada multiline con Shift+Enter */
    private multilineAccumulator = '';
    /** Texto original del último paste pendiente de confirmación por Enter */
    private pendingPaste: string | null = null;

    constructor(opts: TerminalOptions) {
        this.messageBuffer = opts.messageBuffer ?? new MessageBuffer();

        // InputBuffer: procesa las entradas en segundo plano sin bloquear el cursor.
        this.inputBuffer = new InputBuffer(async (raw) => {
            // NO limpiar el footer aquí: el footer debe seguir visible durante
            // el "thinking". El primer output real lo limpia via prepareForOutput().
            await opts.onLine(raw);
        });

        // Restaurar el prompt después de que toda la cola se vacía.
        // Este es el único punto donde el prompt vuelve a aparecer tras el LLM.
        this.inputBuffer.setOnDrained(() => {
            if (!this.closed) this.showPrompt();
        });

        // PasteDebouncer: agrupa líneas que llegan rápido (pegado) en un solo bloque.
        // El echo (❯ texto) y el enqueue viven aquí — no en el handler 'line' —
        // para que N líneas pegadas produzcan UN solo echo y UNA sola petición al LLM.
        this.pasteDebouncer = new PasteDebouncer({
            onFlush: ({ text, type }) => {
                if (type === 'paste') {
                    // Paste: NO encolar todavía — inyectar en el buffer de readline
                    // para que el usuario pueda revisar/editar y luego presionar Enter.
                    this.pendingPaste = text;
                    const rl = this.rl as any;
                    const displayText = text.replace(/\n/g, ' ↵ ');
                    rl.line = displayText;
                    rl.cursor = displayText.length;
                    this.footerShown = false;
                    process.stdout.write('\n');
                    rl._refreshLine();
                } else {
                    // Typed: limpiar footer, hacer echo y encolar normalmente.
                    if (this.footerShown) {
                        this.footerShown = false;
                        process.stdout.write('\x1b[2A\r\x1b[J');
                    } else if (this.inlineStatusActive) {
                        this.inlineStatusActive = false;
                        process.stdout.write('\r\x1b[2K');
                    }
                    process.stdout.write(chalk.hex(theme.colors.primary)('❯ ') + chalk.white(text) + '\n');
                    process.stdout.write(sep() + '\n');
                    this.inputBuffer.enqueue(text, type);
                }
            },
        });

        // Capturar SIGINT (Ctrl+C) para cancelar el item en curso y vaciar la cola.
        process.on('SIGINT', () => {
            this.inputBuffer.cancel();
            this.pasteDebouncer.cancel();
            if (!this.closed) {
                process.stdout.write('\n');
                this.showPrompt();
            }
        });

        const completer = opts.completions
            ? (line: string, callback: (err: Error | null, result: readline.CompleterResult) => void): void => {
                // Slash commands
                if (line.startsWith('/')) {
                    const hits = (opts.completions ?? []).filter(c => c.startsWith(line));
                    callback(null, [hits.length ? hits : (opts.completions ?? []).filter(c => c.startsWith('/')), line]);
                    return;
                }
                // @ file autocomplete
                const atMatch = line.match(/@(\S*)$/);
                if (atMatch) {
                    const prefix = atMatch[1];
                    import('fs').then(fs => {
                        import('path').then(pathMod => {
                            try {
                                const dir = prefix.includes('/') ? pathMod.dirname(prefix) : '.';
                                const base = prefix.includes('/') ? pathMod.basename(prefix) : prefix;
                                const entries = fs.readdirSync(dir === '' ? '.' : dir, { withFileTypes: true });
                                const matches = entries
                                    .filter(e => e.name.startsWith(base))
                                    .slice(0, 15)
                                    .map(e => {
                                        const rel = dir === '.' ? e.name : dir + '/' + e.name;
                                        return line.slice(0, line.length - atMatch[1].length) + rel + (e.isDirectory() ? '/' : '');
                                    });
                                callback(null, [matches, line]);
                            } catch {
                                callback(null, [[], line]);
                            }
                        });
                    });
                    return;
                }
                callback(null, [[], line]);
            }
            : undefined;

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            completer: completer as any,
        });

        // Shift+Enter: multiline — acumula la línea actual y muestra continuación
        const rl = this.rl as any;
        const _origTtyWrite = rl._ttyWrite?.bind(rl);
        rl._ttyWrite = (s: string, key: any) => {
            if (key && key.shift && (key.name === 'return' || key.name === 'enter')) {
                const current = rl.line || '';
                this.multilineAccumulator += (this.multilineAccumulator ? '\n' : '') + current;
                rl.line = '';
                rl.cursor = 0;
                process.stdout.write('\n' + chalk.hex(theme.colors.textDim)('↳ '));
                return;
            }
            _origTtyWrite?.(s, key);
        };

        if (process.stdin.isTTY) {
            // Escuchamos 'data' en raw mode para detectar Escape (0x1b) sin depender
            // de emitKeypressEvents, que en Windows descompone las flechas en múltiples
            // keypress y causa interferencias con los menús.
            readline.emitKeypressEvents(process.stdin, this.rl);
            process.stdin.on('keypress', async (_, key) => {
                if (this.inConfirmation) return;
                if (key?.name === 'escape') opts.onEscape?.();
                // ── Scroll de historial ────────────────────────────────
                const cols = process.stdout.columns || 80;
                if (key?.name === 'pageup') {
                    this.messageBuffer.scrollPageUp(this.getPageSize());
                    this.renderMessageArea();
                } else if (key?.name === 'pagedown') {
                    this.messageBuffer.scrollPageDown(this.getPageSize(), cols);
                    this.renderMessageArea();
                } else if (key?.ctrl && key?.name === 'home') {
                    this.messageBuffer.scrollToTop();
                    this.renderMessageArea();
                } else if (key?.ctrl && key?.name === 't' && !this.inConfirmation) {
                    this.toggleThinking();
                } else if (key?.ctrl && key?.name === 'end') {
                    this.messageBuffer.scrollToBottom();
                    this.renderMessageArea();
                } else if (key?.ctrl && key?.name === 'y') {
                    if (this.lastCodeBlock) {
                        const ok = copyToClipboard(this.lastCodeBlock);
                        this.showToast(ok ? 'Código copiado al portapapeles' : 'No se pudo copiar', ok ? 'success' : 'error');
                    } else {
                        this.showToast('No hay código para copiar', 'info');
                    }
                } else if (key?.ctrl && key?.name === 's') {
                    const line = (this.rl as any).line as string || '';
                    if (line.trim()) {
                        saveToStash(line.trim());
                        this.showToast('Prompt guardado en stash', 'success');
                    } else {
                        this.showToast('El prompt está vacío', 'info');
                    }
                } else if (key?.ctrl && key?.name === 'p') {
                    const entries = loadStash();
                    if (entries.length === 0) {
                        this.showToast('Stash vacío', 'info');
                    } else {
                        const selected = await this.selectMenu(
                            'Recuperar prompt del stash:',
                            entries.map(e => ({ label: e.preview, value: e.text }))
                        );
                        if (selected) {
                            const rl = this.rl as any;
                            rl.line = selected;
                            rl.cursor = selected.length;
                            rl._refreshLine();
                        }
                    }
                }
            });
        }

        this.rl.on('line', (line) => {
            if (this.inConfirmation) return;

            // Si hay un paste pendiente, este Enter lo confirma.
            // Recuperar el texto original (con \n reales) a menos que el usuario lo haya editado.
            let actualLine: string;
            if (this.pendingPaste !== null) {
                const displayVersion = this.pendingPaste.replace(/\n/g, ' ↵ ');
                actualLine = line === displayVersion
                    ? this.pendingPaste                    // sin cambios → usar original
                    : line.replace(/ ↵ /g, '\n');         // editado → convertir ↵ de vuelta
                this.pendingPaste = null;
            } else {
                actualLine = line;
            }

            // Combinar con acumulador multiline (Shift+Enter)
            const fullLine = this.multilineAccumulator
                ? this.multilineAccumulator + '\n' + actualLine
                : actualLine;
            this.multilineAccumulator = '';

            if (fullLine.trim()) {
                this.pasteDebouncer.receiveLine(fullLine);
            } else {
                // Enter en blanco: limpiar footer y restaurar prompt.
                if (this.footerShown) {
                    this.footerShown = false;
                    process.stdout.write('\x1b[2A\r\x1b[J');
                } else if (this.inlineStatusActive) {
                    this.inlineStatusActive = false;
                    process.stdout.write('\r\x1b[2K');
                }
                if (!this.closed) this.showPrompt();
            }
        });

        this.rl.on('close', async () => {
            this.closed = true;
            this.pasteDebouncer.cancel();
            await opts.onClose?.();
            process.exit(0);
        });
    }

    private selectMenu<T>(
        question: string,
        items: { label: string; description?: string; value: T }[],
        extraKey?: (key: any, cleanup: (v: T | null) => void) => boolean
    ): Promise<T | null> {
        const linesFor = (item: { description?: string }) => item.description ? 2 : 1;
        const totalLines = items.reduce((acc, it) => acc + linesFor(it), 0);

        if (!process.stdin.isTTY || !process.stdin.setRawMode) {
            return new Promise<T | null>(resolve => {
                this.inConfirmation = true;
                const prompt = items.map((it, i) => `${i + 1}. ${it.label}`).join(' / ');
                this.rl.question(
                    '\n  ' + chalk.hex(theme.colors.warning)('\u203b') + ' ' + question + chalk.hex(theme.colors.textDim)(` (${prompt}) `),
                    answer => {
                        this.inConfirmation = false;
                        const n = parseInt(answer.trim(), 10);
                        resolve((n >= 1 && n <= items.length) ? items[n - 1].value : null);
                    }
                );
            });
        }

        return new Promise<T | null>(resolve => {
            this.inConfirmation = true;
            const wasRaw = process.stdin.isRaw ?? false;
            process.stdin.setRawMode!(true);
            let selected = 0;

            // Suppress readline's own TTY key processing to prevent history-navigation
            // output from polluting the menu while arrow keys are held.
            const rl = this.rl as any;
            const origTtyWrite = rl._ttyWrite?.bind(rl);
            if (origTtyWrite) rl._ttyWrite = () => { };

            process.stdout.write('\n  ' + chalk.hex(theme.colors.warning)('\u203b') + ' ' + question + '\n');

            let renderingOptions = false;
            let renderOptionsPending = false;

            const doRenderOptions = (first = false) => {
                renderingOptions = true;
                renderOptionsPending = false;
                // Move cursor back to start of rendered area and clear to end of screen
                if (!first) process.stdout.write(`\x1b[${totalLines}A\r\x1b[0J`);
                items.forEach((item, i) => {
                    const active = i === selected;
                    const cursor = active ? chalk.hex(theme.colors.info)(' ❯') : '  ';
                    const label = active
                        ? chalk.hex(theme.colors.info)(`${i + 1}. ${item.label}`)
                        : chalk.hex(theme.colors.textDim)(`${i + 1}. ${item.label}`);
                    process.stdout.write(`${cursor} ${label}\n`);
                    if (item.description) {
                        process.stdout.write(`     ${chalk.hex(theme.colors.textDim)(item.description)}\n`);
                    }
                });
                renderingOptions = false;
                if (renderOptionsPending) doRenderOptions();
            };

            const scheduleRenderOptions = (first = false) => {
                if (first) { doRenderOptions(true); return; }
                if (renderingOptions) { renderOptionsPending = true; return; }
                doRenderOptions();
            };

            scheduleRenderOptions(true);

            const cleanup = (result: T | null) => {
                process.stdin.removeListener('keypress', onKey);
                if (origTtyWrite) rl._ttyWrite = origTtyWrite;
                process.stdin.setRawMode!(wasRaw);
                this.rl.write(null, { ctrl: true, name: 'u' });
                this.inConfirmation = false;
                process.stdout.write('\n');
                resolve(result);
            };

            const onKey = (_str: string | undefined, key: any) => {
                if (!key) return;
                if (key.repeat) return;
                if (extraKey?.(key, cleanup)) return;
                if (key.name === 'up') {
                    if (selected > 0) selected--;
                    scheduleRenderOptions();
                } else if (key.name === 'down') {
                    if (selected < items.length - 1) selected++;
                    scheduleRenderOptions();
                } else if (key.name === 'return') {
                    cleanup(items[selected].value);
                } else if (key.name >= '1' && key.name <= String(items.length)) {
                    selected = parseInt(key.name, 10) - 1;
                    scheduleRenderOptions();
                    cleanup(items[selected].value);
                } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
                    cleanup(null);
                }
            };

            process.stdin.on('keypress', onKey);
        });
    }

    /**
     * @description Menú con filtro en vivo para listas dinámicas o largas.
     * El usuario escribe para filtrar, navega con ↑↓ y confirma con Enter.
     * Ideal para listas de skills, proyectos, agentes — donde hay muchos
     * ítems y se necesita encontrar rápido sin depender de scroll manual.
     */
    filteredSelect(
        question: string,
        items: { label: string; value: string }[],
        fixedBottom: { label: string; value: string }[] = []
    ): Promise<string | null> {
        if (!process.stdin.isTTY || !process.stdin.setRawMode) {
            return new Promise<string | null>(resolve => {
                this.inConfirmation = true;
                const all = [...items, ...fixedBottom];
                const prompt = all.map((it, i) => `${i + 1}. ${it.label}`).join('\n  ');
                this.rl.question(
                    '\n  ' + chalk.hex(theme.colors.warning)('\u203b') + ' ' + question + '\n  ' + prompt + '\n  Número: ',
                    answer => {
                        this.inConfirmation = false;
                        const n = parseInt(answer.trim(), 10);
                        resolve((n >= 1 && n <= all.length) ? all[n - 1].value : null);
                    }
                );
            });
        }

        return new Promise<string | null>(resolve => {
            this.inConfirmation = true;
            const wasRaw = process.stdin.isRaw ?? false;
            process.stdin.setRawMode!(true);

            const rl = this.rl as any;
            const origTtyWrite = rl._ttyWrite?.bind(rl);
            if (origTtyWrite) rl._ttyWrite = () => { };

            let filter = '';
            let selected = 0;
            let renderedLines = 0;
            let rendering = false;
            let renderPending = false;

            const getVisible = (): { label: string; value: string }[] => {
                const f = filter.toLowerCase();
                const filtered = f
                    ? items.filter(it => it.value.toLowerCase().includes(f) || it.label.toLowerCase().includes(f))
                    : items;
                return [...filtered, ...fixedBottom];
            };

            const doRender = (first = false) => {
                rendering = true;
                renderPending = false;
                const visible = getVisible();
                if (selected >= visible.length) selected = Math.max(0, visible.length - 1);

                // Limpiar línea por línea: subir y borrar cada línea del bloque anterior
                if (!first && renderedLines > 0) {
                    for (let i = 0; i < renderedLines; i++) {
                        process.stdout.write('\x1b[A\r\x1b[2K');
                    }
                }

                let lines = 0;

                // Filter input line
                const filterDisplay = filter ? chalk.hex(theme.colors.info)(filter) : chalk.hex(theme.colors.textDim)('escribe para filtrar…');
                process.stdout.write(`\r\x1b[2K  ${chalk.hex(theme.colors.textDim)('/')} ${filterDisplay}\n`);
                lines++;

                if (visible.length === 0) {
                    process.stdout.write(`\r\x1b[2K  ${chalk.hex(theme.colors.textDim)('(sin resultados)')}\n`);
                    lines++;
                } else {
                    for (let i = 0; i < visible.length; i++) {
                        const active = i === selected;
                        const cursor = active ? chalk.hex(theme.colors.info)('❯') : ' ';
                        const label = active ? chalk.hex(theme.colors.info)(visible[i].label) : chalk.hex(theme.colors.textDim)(visible[i].label);
                        process.stdout.write(`\r\x1b[2K  ${cursor} ${label}\n`);
                        lines++;
                    }
                }

                process.stdout.write(`\r\x1b[2K  ${chalk.dim('↑↓ navegar · letras filtrar · ⌫ borrar · ⏎ elegir · ⎋ cancelar')}\n`);
                lines++;

                renderedLines = lines;
                rendering = false;

                // Si llegaron más eventos mientras renderizábamos, volver a renderizar
                if (renderPending) doRender();
            };

            // Render sincrónico con flag de reentrada: evita renderizados múltiples
            // cuando Windows emite varios keypress events para una sola pulsación.
            // A diferencia de setImmediate, procesa el render inmediatamente sin
            // latencia, y si llegan eventos durante el render, se encolan.
            const scheduleRender = (first = false) => {
                if (first) {
                    doRender(true);
                    return;
                }
                if (rendering) {
                    renderPending = true;
                    return;
                }
                doRender();
            };

            process.stdout.write('\n  ' + chalk.hex(theme.colors.warning)('\u203b') + ' ' + question + '\n');
            scheduleRender(true);

            const cleanup = (result: string | null) => {
                process.stdin.removeListener('keypress', onKey);
                if (origTtyWrite) rl._ttyWrite = origTtyWrite;
                process.stdin.setRawMode!(wasRaw);
                this.rl.write(null, { ctrl: true, name: 'u' });
                this.inConfirmation = false;
                process.stdout.write('\n');
                resolve(result);
            };

            const onKey = (_str: string | undefined, key: any) => {
                if (!key) return;
                // Ignorar key repeat (Windows emite key.repeat=true en flechas sostenidas)
                if (key.repeat) return;
                if (key.name === 'up') {
                    if (selected > 0) selected--;
                    scheduleRender();
                } else if (key.name === 'down') {
                    const visible = getVisible();
                    if (selected < visible.length - 1) selected++;
                    scheduleRender();
                } else if (key.name === 'return') {
                    const visible = getVisible();
                    if (visible.length > 0) cleanup(visible[selected].value);
                } else if (key.name === 'backspace') {
                    if (filter.length > 0) { filter = filter.slice(0, -1); selected = 0; scheduleRender(); }
                } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
                    cleanup(null);
                } else {
                    const ch = key.sequence;
                    if (ch && ch.length === 1 && ch.charCodeAt(0) >= 32 && !key.ctrl && !key.meta) {
                        filter += ch;
                        selected = 0;
                        scheduleRender();
                    }
                }
            };

            process.stdin.on('keypress', onKey);
        });
    }

    /**
     * @description Muestra un menú de confirmación con tres opciones:
     * Sí, No, o "Sí, permitir todas durante esta sesión".
     * El usuario gana control granular sobre las confirmaciones de herramientas
     * sin tener que responder individualmente cada una.
     */
    confirm(question: string): Promise<ConfirmResult> {
        return this.selectMenu<ConfirmResult>(
            question,
            MENU_OPTIONS,
            (key, cleanup) => {
                if (key.name === 'tab' && key.shift) { cleanup('all'); return true; }
                return false;
            }
        ).then(r => r ?? 'no');
    }

    /**
     * @description Menú seleccionable con teclado (↑↓) para listas cortas.
     * Ideal para opciones con descripciones donde cada ítem necesita contexto
     * adicional. El usuario navega y confirma con Enter sin escribir.
     */
    select(question: string, items: { label: string; description?: string; value: string }[]): Promise<string | null> {
        return this.selectMenu(question, items);
    }

    /**
     * @description Solicita texto libre al usuario.
     * Útil para entradas que no encajan en menús predefinidos
     * (ej: nombres personalizados, rutas, valores específicos).
     */
    input(prompt: string): Promise<string | null> {
        return new Promise<string | null>(resolve => {
            this.inConfirmation = true;
            this.rl.question('\n  ' + chalk.hex(theme.colors.warning)('\u203b') + ' ' + prompt + ' ', answer => {
                this.inConfirmation = false;
                const val = answer.trim();
                resolve(val || null);
            });
        });
    }

    /**
     * @description Confirmación simple Sí/No sin la opción "permitir todas".
     * Diseñada para preguntas que no involucran herramientas (ej: "¿Continuar?").
     * El valor por defecto es Sí para agilizar flujos comunes.
     */
    yesNo(question: string, defaultYes = true): Promise<boolean> {
        return this.selectMenu<boolean>(question, [
            { label: 'Sí', value: true },
            { label: 'No', value: false },
        ]).then(r => r ?? defaultYes);
    }

    /**
     * @description Marca el próximo prompt para mostrarse sin el footer de atajos.
     * Útil después de respuestas largas donde el footer ya se mostró y se
     * quiere evitar duplicación visual.
     */
    useDirectPrompt(): void {
        this.directOnce = true;
    }

    static getPromptPrefix(): string {
        return chalk.hex(theme.colors.primary)('❯');
    }

    /**
     * @description Limpia el footer+❯ justo antes de que el agente escriba output.
     * Llamar desde onStreamStart, onToolCall, onAgentRouting, etc. en cli.ts para
     * que el output aparezca sin pisar el footer ni el prompt ❯.
     */
    prepareForOutput(): void {
        if (this.footerShown) {
            this.footerShown = false;
            process.stdout.write('\x1b[1A\r\x1b[J');
        } else if (this.inlineStatusActive) {
            // Limpiar el estado inline activo antes de escribir output del agente
            this.inlineStatusActive = false;
            process.stdout.write('\r\x1b[2K');
        }
    }

    /**
     * @description Actualiza el texto de estado que aparece en el footer
     * (encima del prompt ❯). Usado por el spinner para mostrar progreso
     * en vivo sin bloquear la entrada del usuario.
     *
     * Cuando hay prompt visible (footerShown): actualiza el footer encima del ❯.
     * Cuando no hay prompt (tools en ejecución): escribe inline con \r sobre la
     * línea actual para que el spinner de métricas sea visible durante tool calls.
     */
    updateStatusLine(text: string): void {
        this.statusText = text;
        if (text) this.footerFrameIdx++;
        if (this.footerShown) {
            // Cursor está en la línea ❯ (abajo). Subir 1 al footer, limpiar,
            // escribir nuevo footer, bajar de vuelta a la línea ❯.
            process.stdout.write('\x1b[1A\r\x1b[2K' + this.buildFooter() + '\x1b[1B\r');
        } else if (text) {
            // Sin prompt: mostrar estado inline con \r para no avanzar línea.
            // El spinner de tool calls (startWithMetrics) usa este modo.
            const cols = process.stdout.columns || 80;
            const plain = text.slice(0, cols - 4);
            const icon = FOOTER_FRAMES[this.footerFrameIdx % FOOTER_FRAMES.length];
            process.stdout.write('\r\x1b[2K' + chalk.hex(theme.colors.info)(icon) + ' ' + chalk.hex(theme.colors.textDim)(plain));
            this.inlineStatusActive = true;
        } else if (this.inlineStatusActive) {
            // Limpiar línea inline cuando el spinner termina
            process.stdout.write('\r\x1b[2K');
            this.inlineStatusActive = false;
        }
    }

    /**
     * @description Construye la línea de footer.
     * Si hay texto de estado activo muestra "✽ texto ─────", si no "─────────".
     */
    private buildFooter(): string {
        const cols = process.stdout.columns || 80;
        if (this.statusText) {
            const plain = this.statusText;
            const fill = Math.max(1, cols - plain.length - 4);
            const icon = FOOTER_FRAMES[this.footerFrameIdx % FOOTER_FRAMES.length];
            return (
                chalk.hex(theme.colors.info)(icon) + ' ' +
                chalk.hex(theme.colors.textDim)(plain) + ' ' +
                chalk.hex(theme.colors.border)('─'.repeat(fill))
            );
        }
        return chalk.hex(theme.colors.border)('─'.repeat(cols));
    }

    /**
     * @description Dibuja el bloque de prompt interactivo:
     *
     *   ✽ label… (2m 47s · ↑ 7.7k tokens) ──────  ← footer (con estado o vacío)
     *   ❯                                           ← prompt (cursor aquí, abajo)
     *
     * El cursor queda en la línea ❯ — readline gestiona la entrada allí.
     * El footer se actualiza in-situ via updateStatusLine() sin mover el cursor.
     */
    showPrompt(): void {
        const prefix = chalk.hex(theme.colors.primary)('❯') + ' ';
        this.rl.setPrompt(prefix);

        if (this.directOnce) {
            this.directOnce = false;
            process.stdout.write('\n' + this.buildFooter() + '\n' + prefix);
        } else {
            process.stdout.write('\n' + this.buildFooter() + '\n');
            this.rl.prompt();
        }

        this.footerShown = true;
    }

    /**
     * @description Calcula el tamaño de página para PageUp/PageDown.
     * Usa la altura de la terminal menos el espacio ocupado por header,
     * prompt y footer (aproximadamente 7 líneas fijas).
     */
    private getPageSize(): number {
        const rows = process.stdout.rows || 24;
        return Math.max(5, rows - 7);
    }

    /**
     * @description Registra la cantidad de líneas que ocupa el header.
     * Necesario para que renderMessageArea pueda subir hasta el header
     * y redibujarlo junto con los mensajes durante el scroll.
     */
    setHeaderLines(lines: number): void {
        this.headerLines = lines;
    }

    /**
     * @description Registra un callback para redibujar el header.
     * Se invoca antes de renderizar el área de mensajes para que el
     * header se mantenga visible durante el scroll.
     */
    setOnRenderHeader(cb: () => void): void {
        this.onRenderHeader = cb;
    }

    /**
     * @description Renderiza el área de mensajes del buffer en pantalla.
     * Sube hasta el header (si hay headerLines registrado), lo redibuja,
     * limpia las líneas de mensajes anteriores y escribe las nuevas.
     * Se llama cuando el usuario hace scroll con PgUp/PgDown.
     */
    private renderMessageArea(): void {
        const rows = process.stdout.rows || 24;
        const cols = process.stdout.columns || 80;
        // Área disponible: altura total - header - prompt(3) - footer(2) - separadores
        const availableHeight = Math.max(3, rows - this.headerLines - 7);

        // Subir hasta el header y redibujarlo
        if (this.headerLines > 0 && this.onRenderHeader) {
            // Subir: headerLines + renderedMessageLines (todo lo que hay en pantalla)
            const totalToClear = this.headerLines + this.renderedMessageLines;
            for (let i = 0; i < totalToClear; i++) {
                process.stdout.write('\x1b[A\r\x1b[2K');
            }
            // Redibujar header
            this.onRenderHeader();
        } else {
            // Sin header: solo limpiar mensajes
            if (this.renderedMessageLines > 0) {
                for (let i = 0; i < this.renderedMessageLines; i++) {
                    process.stdout.write('\x1b[A\r\x1b[2K');
                }
            }
        }

        // Renderizar nuevas líneas de mensajes
        const lines = this.messageBuffer.render(availableHeight, cols);
        this.renderedMessageLines = lines.length;

        for (const line of lines) {
            process.stdout.write(line + '\n');
        }
    }

    /**
     * @description Agrega un mensaje al buffer y lo muestra en pantalla.
     * Si el buffer está siguiendo el final (followEnd), hace scroll automático.
     * Redibuja el header si hay callback registrado.
     * @param msg Mensaje a agregar
     */
    addMessage(msg: BufferMessage): void {
        // Subir hasta el header y redibujarlo, luego limpiar mensajes
        if (this.headerLines > 0 && this.onRenderHeader) {
            const totalToClear = this.headerLines + this.renderedMessageLines;
            for (let i = 0; i < totalToClear; i++) {
                process.stdout.write('\x1b[A\r\x1b[2K');
            }
            this.onRenderHeader();
        } else {
            // Limpiar solo líneas de mensajes
            if (this.renderedMessageLines > 0) {
                for (let i = 0; i < this.renderedMessageLines; i++) {
                    process.stdout.write('\x1b[A\r\x1b[2K');
                }
            }
        }
        this.renderedMessageLines = 0;

        this.messageBuffer.add(msg);

        // Si estábamos siguiendo el final, el nuevo mensaje se verá
        // cuando se renderice el próximo prompt
    }

    /**
     * @description Obtiene el buffer de mensajes para acceso externo.
     */
    getMessageBuffer(): MessageBuffer {
        return this.messageBuffer;
    }

    /**
     * @description Inicia el loop de la terminal mostrando el primer prompt.
     * Es el punto de entrada de la UI: a partir de aquí el usuario puede
     * escribir mensajes y usar los atajos del teclado.
     */
    start(): void {
        this.showPrompt();
    }

    /**
     * @description Cierra la terminal y libera recursos de readline.
     * Una vez cerrada, no se pueden enviar más mensajes. Se llama
     * automáticamente al salir de la aplicación.
     */

    /**
     * @description Actualiza el contenido del thinking block en vivo.
     * content es un delta incremental — se acumula en thinkingContent.
     */
    setThinkingContent(content: string, elapsedMs: number): void {
        this.thinkingContent += content;
        if (this.thinkingStart === 0) this.thinkingStart = Date.now() - elapsedMs;
        if (this.thinkingExpanded) {
            const lines = content.split("\n").filter(l => l.trim());
            const preview = lines.slice(0, 3).join(" ").slice(0, 80);
            const elapsed = ((Date.now() - this.thinkingStart) / 1000).toFixed(1);
            this.updateStatusLine("\u{1F4AD} " + preview + (lines.length > 3 ? "..." : "") + " (" + elapsed + "s)");
        } else {
            const elapsed = ((Date.now() - this.thinkingStart) / 1000).toFixed(1);
            this.updateStatusLine("\u{1F4AD} Reasoning (" + elapsed + "s)  Ctrl+T para expandir");
        }
    }

    /**
     * @description Inicia el thinking block.
     * label: texto descriptivo del agente activo (ej: "🤖 General").
     */
    startThinking(label = '\u{1F4AD} Razonando'): void {
        this.thinkingStart = Date.now();
        this.thinkingContent = "";
        this.thinkingExpanded = false;
        this.updateStatusLine(label + '...');
        const wavesAnim = makeFooterAnim(WavesAnimation, AnimationType.WAVES);
        this.thinkingTimer = setInterval(() => {
            const elapsed = ((Date.now() - this.thinkingStart) / 1000).toFixed(1);
            const f = wavesAnim.nextFrame(performance.now());
            const wave = f.content ? f.content + '  ' : '';
            if (this.thinkingExpanded && this.thinkingContent) {
                const lines = this.thinkingContent.split("\n").filter(l => l.trim());
                const preview = lines.slice(0, 3).join(" ").slice(0, 60);
                this.updateStatusLine(wave + label + ' ' + preview + (lines.length > 3 ? "..." : "") + " (" + elapsed + "s)");
            } else if (this.thinkingContent) {
                this.updateStatusLine(wave + label + " (" + elapsed + "s)  Ctrl+T para expandir");
            } else {
                this.updateStatusLine(wave + label + " (" + elapsed + "s)");
            }
        }, 150);
    }

    /**
     * @description Finaliza el thinking block. Agrega el contenido al buffer de mensajes.
     */
    stopThinking(): void {
        if (this.thinkingTimer) {
            clearInterval(this.thinkingTimer);
            this.thinkingTimer = null;
        }
        if (this.thinkingContent.trim()) {
            const elapsed = ((Date.now() - this.thinkingStart) / 1000).toFixed(1);
            const displayContent = this.thinkingExpanded
                ? this.thinkingContent
                : "\u{1F4AD} Reasoning (" + elapsed + "s)";
            this.messageBuffer.add({
                role: "system",
                content: displayContent,
                timestamp: new Date(),
                meta: "thinking",
            });
        }
        this.thinkingContent = "";
        this.thinkingStart = 0;
        this.updateStatusLine("");
    }

    /**
     * @description Togglea el thinking block entre colapsado y expandido.
     */
    private toggleThinking(): void {
        this.thinkingExpanded = !this.thinkingExpanded;
        this.onThinkingToggle?.(this.thinkingExpanded);
        if (this.thinkingExpanded && this.thinkingContent) {
            const lines = this.thinkingContent.split("\n").filter(l => l.trim());
            const preview = lines.slice(0, 5).join(" ").slice(0, 100);
            const elapsed = ((Date.now() - this.thinkingStart) / 1000).toFixed(1);
            this.updateStatusLine("\u{1F4AD} " + preview + (lines.length > 5 ? "..." : "") + " (" + elapsed + "s)  Ctrl+T para colapsar");
        } else {
            const elapsed = ((Date.now() - this.thinkingStart) / 1000).toFixed(1);
            this.updateStatusLine("\u{1F4AD} Reasoning (" + elapsed + "s)  Ctrl+T para expandir");
        }
    }

    /**
     * @description Registra un callback para el toggle de thinking.
     */
    setOnThinkingToggle(cb: (expanded: boolean) => void): void {
        this.onThinkingToggle = cb;
    }

    close(): void {
        this.closed = true;
        this.rl.close();
    }

    /**
     * @description Guarda el último bloque de código para ser copiado con Ctrl+Y.
     */
    setLastCode(code: string): void { this.lastCodeBlock = code; }

    /**
     * @description Muestra un mensaje toast temporal en la línea actual.
     * Desaparece automáticamente después de durationMs milisegundos.
     */
    showToast(text: string, type: 'success' | 'info' | 'error' = 'info', durationMs = 2200): void {
        const icon  = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
        const color = type === 'success' ? theme.colors.success
                    : type === 'error'   ? theme.colors.error
                    :                      theme.colors.info;
        const msg = chalk.hex(color)(icon + '  ' + text);
        process.stdout.write('\r\x1b[2K' + msg);
        setTimeout(() => { process.stdout.write('\r\x1b[2K'); }, durationMs);
    }
}
