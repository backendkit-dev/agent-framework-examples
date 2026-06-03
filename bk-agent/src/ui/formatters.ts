/**
 * @description Funciones de formateo visual para la terminal.
 * Proporciona syntax highlighting (TypeScript, SQL, YAML), formato de
 * tool calls, headers de sesión, bloques de código con bordes y
 * formato inline (negritas, código). El desarrollador recibe respuestas
 * legibles y con estructura visual sin depender de librerías externas
 * de renderizado Markdown.
 */

import chalk from 'chalk';
import { highlight as cliHighlight, supportsLanguage } from 'cli-highlight';
import { theme } from './theme';
import { sanitizeCodeOutput } from '../shared/utils/encoding';
import * as fs from 'fs';
import * as path from 'path';

const TOOL_ICONS: Record<string, string> = {
  read_file: '◌',
  write_file: '◈',
  list_directory: '◫',
  execute_command: '◎',
  ripgrep_search: '◉',
  git_diff: '◐',
  vault_search: '◑',
  save_to_vault: '◒',
};

// Strip ANSI escape codes for length calculation
function visible(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function padRight(s: string, len: number): string {
  const vlen = visible(s).length;
  return s + ' '.repeat(Math.max(0, len - vlen));
}

function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  if (text.length <= maxWidth) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? current + ' ' + word : word;
    if (next.length <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word.length > maxWidth ? word.slice(0, maxWidth - 1) + '…' : word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * @description Formatea la invocación de una herramienta del agente.
 * Muestra el nombre en negrita y el primer argumento truncado a 60 caracteres.
 * El desarrollador ve qué herramienta se está ejecutando y con qué parámetros.
 */

/**
 * @description Formatea el inicio de una tool call con icono y nombre.
 * Muestra un spinner visual y el nombre de la herramienta.
 */
export function formatToolCallStart(name: string, argsStr: string): string {
    let argsDisplay = "";
    try {
        const args = JSON.parse(argsStr);
        const [, val] = Object.entries(args)[0] ?? [];
        if (val !== undefined) {
            const str = String(val);
            argsDisplay = str.length > 60 ? str.slice(0, 60) + "\u2026" : str;
        }
    } catch { }
    return "\n" + chalk.hex(theme.colors.info)("\u27F3") + " " + chalk.bold(name) + chalk.hex(theme.colors.textDim)("(" + argsDisplay + ")");
}

/**
 * @description Formatea el resultado de una tool call con duracion y estado.
 * Muestra check verde si exito, cruz roja si error, con el tiempo de ejecucion.
 */
export function formatToolCallEnd(name: string, durationMs: number, success: boolean, result: string): string {
    const elapsed = (durationMs / 1000).toFixed(1) + "s";
    if (success) {
        const preview = result.split("\n").filter(l => l.trim()).slice(0, 2).join("; ").slice(0, 80);
        return chalk.hex(theme.colors.success)("\u2713") + " " + chalk.bold(name) + chalk.hex(theme.colors.textDim)(" (" + elapsed + ")") + (preview ? "\n" + chalk.hex(theme.colors.textDim)("  \u2514 " + preview) : "");
    } else {
        const errorPreview = result.split("\n").filter(l => l.trim()).slice(0, 1).join("").slice(0, 60);
        return chalk.hex(theme.colors.error)("\u2717") + " " + chalk.bold(name) + chalk.hex(theme.colors.textDim)(" (" + elapsed + ")") + chalk.hex(theme.colors.error)(" \u2192 " + errorPreview);
    }
}

export function formatToolCall(name: string, argsStr: string): string {
  let argsDisplay = '';
  try {
    const args = JSON.parse(argsStr);
    const [, val] = Object.entries(args)[0] ?? [];
    if (val !== undefined) {
      const str = String(val);
      argsDisplay = str.length > 60 ? str.slice(0, 60) + '\u2026' : str;
    }
  } catch { }
  return '\n' + chalk.hex(theme.colors.success)('\u25CF') + ' ' + chalk.bold(name) + chalk.hex(theme.colors.textDim)('(' + argsDisplay + ')');
}

/**
 * @description Formatea el resultado de una herramienta para mostrarlo
 * en la terminal. Trunca a 8 líneas y 120 columnas para evitar saturar
 * la pantalla con resultados extensos.
 */
export function formatToolResult(result: string): string {
  const lines = result.split('\n').filter(l => l.trim());
  if (!lines.length) return chalk.hex(theme.colors.textDim)('  \u23BF  ') + chalk.hex(theme.colors.textDim)('(no content)');
  const maxLines = 8;
  const maxCols = 120;
  const shown = lines.slice(0, maxLines);
  const extra = lines.length > maxLines ? lines.length - maxLines : 0;
  const body = shown.map((l, i) =>
    i === 0
      ? chalk.hex(theme.colors.textDim)('  \u23BF  ') + chalk.hex(theme.colors.textDim)(l.slice(0, maxCols))
      : chalk.hex(theme.colors.textDim)('     ' + l.slice(0, maxCols - 2))
  ).join('\n');
  return body + (extra > 0 ? chalk.hex(theme.colors.textDim)('\n     \u2026 +' + extra + ' l\u00EDneas m\u00E1s') : '');
}

/**
 * @description Formatea la salida de un comando ejecutado en terminal.
 * Similar a formatToolResult pero sin filtrado de líneas vacías,
 * preservando la estructura original del output.
 */
export function formatCommandOutput(content: string | null): string {
  if (!content || !content.trim()) {
    return chalk.hex(theme.colors.textDim)('  \u23BF  ') + chalk.hex(theme.colors.textDim)('(no content)');
  }
  const lines = content.split('\n');
  const first = chalk.hex(theme.colors.textDim)('  \u23BF  ') + lines[0];
  const rest = lines.slice(1).map(l => '     ' + l);
  return [first, ...rest].join('\n');
}

const w = () => process.stdout.columns || 80;

/**
 * @description Genera el encabezado visual que marca el inicio de una
 * respuesta del agente, con el nombre "DeepSeek Code" y una línea
 * separadora que se adapta al ancho de la terminal.
 */
export function formatResponseHeader(): string {
  const fill = Math.max(0, w() - 18);
  return chalk.hex(theme.colors.success)('\n\u25C6 ') + chalk.bold.hex(theme.colors.info)('bk') + chalk.bold('-agent') + chalk.hex(theme.colors.textDim)('  ' + '\u2500'.repeat(fill));
}

/**
 * @description Línea separadora que se adapta al ancho de la terminal.
 * Usada para marcar el final de una respuesta o sección.
 */
export function formatSeparator(): string {
  return chalk.hex(theme.colors.textDim)('\n' + '\u2500'.repeat(w()));
}

/**
 * @description Formatea el eco del mensaje del usuario en la terminal,
 * mostrándolo con el prefijo "$>" en verde neón.
 */
export function formatUserEcho(text: string): string {
  return chalk.hex(theme.colors.primary)('\n$> ') + chalk.white(text);
}

function shortCwd(): string {
  const cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const short = home ? cwd.replace(home, '~') : cwd;
  // Keep last 2 path segments if too long
  const max = 42;
  if (short.length <= max) return short;
  const parts = short.replace(/\\/g, '/').split('/');
  return '\u2026/' + parts.slice(-2).join('/');
}

/**
 * @description Extrae el nombre del proyecto desde el context.md.
 * Busca la línea `**Nombre:** <nombre>` y retorna el valor.
 * Si encuentra placeholders sin resolver ({{...}} o [Nombre]),
 * retorna string vacío para que el sistema use el nombre del directorio.
 */
export function extractProjectName(contextMarkdown: string): string {
  const match = contextMarkdown.match(/\*\*Nombre:\*\*\s*(.+)/);
  if (match) {
    const name = match[1].trim();
    // Si tiene {{PROJECT_NAME}} (placeholder sin resolver), usamos el nombre del directorio
    if (name.includes('{{') || name.includes('[Nombre]')) {
      return '';
    }
    return name;
  }
  return '';
}

export interface HeaderInfo {
  model: string;
  vaultConnected: boolean;
  vaultName?: string;
  projectName?: string;
  memoryProject?: string;
  memorySource?: 'vault' | 'local';
  activeWorkspace?: string;
  agentIcon?: string;
  agentName?: string;
  skillsCount?: number;
  customAgentsCount?: number;
  version?: string;
}

/**
 * @description Construye el header visual de la sesión interactiva.
 * Muestra: logo ASCII, nombre del proyecto, modelo activo, agente,
 * ruta del directorio, estado del vault, skills cargados y proyecto
 * de memoria activo. El desarrollador obtiene de un vistazo el
 * contexto completo de la sesión.
 */
export function formatHeader(info: HeaderInfo): string {
  const {
    model,
    vaultConnected,
    vaultName,
    projectName,
    memoryProject,
    memorySource,
    activeWorkspace,
    agentIcon = '\u{1F916}',
    agentName = 'general',
    skillsCount = 0,
    customAgentsCount = 0,
    version = '0.2.0',
  } = info;

  const BK = chalk.bold.hex(theme.colors.info);
  const logo = [
    BK('\u250F\u2513 \u2533\u250F\u2501'),
    BK('\u2523\u253B\u2513\u2523\u253B\u2513'),
    BK('\u2517\u2501\u251B\u253B \u253B'),
  ];

  // Line 2: project [\u203A workspace] model agent
  const workspaceSuffix = activeWorkspace && activeWorkspace !== 'default'
    ? chalk.hex(theme.colors.textDim)(' \u203A ') + chalk.hex(theme.colors.accent)(activeWorkspace)
    : '';
  const projectLabel = projectName
    ? chalk.hex(theme.colors.secondary)('\u25C9 ') + chalk.bold.white(projectName) + workspaceSuffix
    : chalk.hex(theme.colors.textDim)('\u25C9 ') + chalk.hex(theme.colors.textDim).italic('sin proyecto');
  const modelLabel = chalk.hex(theme.colors.info)(model);
  const agentLabel = chalk.hex(theme.colors.textDim)(agentIcon + ' ' + agentName);
  const line2Parts = [projectLabel, modelLabel, agentLabel];

  // Line 3: cwd vault counts memory project
  const vaultLabel = vaultConnected
    ? chalk.hex(theme.colors.success)('\uD83D\uDCDA ') + chalk.hex(theme.colors.success)(vaultName || 'vault')
    : chalk.hex(theme.colors.textDim)('\u25CB sin vault');
  const line3Parts: string[] = [chalk.hex(theme.colors.textDim)(shortCwd()), vaultLabel];
  if (skillsCount > 0) line3Parts.push(chalk.hex(theme.colors.textDim)(skillsCount + ' skill' + (skillsCount > 1 ? 's' : '')));
  if (customAgentsCount > 0) line3Parts.push(chalk.hex(theme.colors.textDim)(customAgentsCount + ' agente' + (customAgentsCount > 1 ? 's' : '') + ' custom'));
  if (memoryProject) {
    const icon = memorySource === 'local' ? '\uD83D\uDCBE' : '\uD83E\uDDE0';
    const label = icon + ' ' + memoryProject;
    line3Parts.push(memoryProject !== projectName
      ? chalk.hex(theme.colors.accent)(label)
      : chalk.hex(theme.colors.textDim)(label)
    );
  }

  const sep = chalk.hex(theme.colors.textDim)('  \u00B7  ');
  const info2 = [
    '   ' + chalk.bold.hex(theme.colors.info)('bk') + chalk.bold.white('-agent') + chalk.hex(theme.colors.textDim)('  v' + version),
    '   ' + line2Parts.join(sep),
    '   ' + line3Parts.join(sep),
  ];

  const lines = logo.map((l, i) => l + (info2[i] ?? ''));
  return '\n' + lines.join('\n') + '\n';
}

// ── Diff Visual ───────────────────────────────────────────────────────────

/**
 * @description Renderiza la diferencia entre dos bloques de código.
 * Líneas eliminadas en fondo rojo tachado, líneas añadidas en fondo verde negrita.
 * Degrada a texto plano si chalk.level === 0 (CI, pipe sin TTY).
 */
export function formatDiff(oldCode: string, newCode: string): string {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');

  const removed: Set<number> = new Set();
  const added: Set<number> = new Set();

  // Diff LCS línea a línea usando índices de new/old
  const lcs = computeLCS(oldLines, newLines);
  let oi = 0, ni = 0, li = 0;
  const hunks: Array<{ kind: 'removed' | 'added' | 'same'; line: string }> = [];

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi === lcs[li][0] && ni === lcs[li][1]) {
      hunks.push({ kind: 'same', line: oldLines[oi] });
      oi++; ni++; li++;
    } else if (oi < oldLines.length && (li >= lcs.length || oi < lcs[li][0])) {
      hunks.push({ kind: 'removed', line: oldLines[oi] });
      oi++;
    } else {
      hunks.push({ kind: 'added', line: newLines[ni] });
      ni++;
    }
  }

  if (chalk.level === 0) {
    return hunks.map(h => {
      if (h.kind === 'removed') return '- ' + h.line;
      if (h.kind === 'added') return '+ ' + h.line;
      return '  ' + h.line;
    }).join('\n');
  }

  const header = '  ' + chalk.hex(theme.colors.textDim)('┌──') + chalk.hex(theme.colors.info)(' diff ');
  const footer = '  ' + chalk.hex(theme.colors.textDim)('└' + '─'.repeat(47));

  try {
    const bodyLines: string[] = [];
    let i = 0;
    while (i < hunks.length) {
      const h = hunks[i];
      if (h.kind === 'removed' && i + 1 < hunks.length && hunks[i + 1].kind === 'added') {
        const { oldFormatted, newFormatted } = wordLevelDiff(h.line, hunks[i + 1].line);
        bodyLines.push(chalk.hex(theme.colors.textDim)('  │ ') + chalk.red('- ') + oldFormatted);
        bodyLines.push(chalk.hex(theme.colors.textDim)('  │ ') + chalk.green('+ ') + newFormatted);
        i += 2;
      } else if (h.kind === 'removed') {
        bodyLines.push(chalk.hex(theme.colors.textDim)('  │ ') + chalk.bgRed.whiteBright('- ' + h.line));
        i++;
      } else if (h.kind === 'added') {
        bodyLines.push(chalk.hex(theme.colors.textDim)('  │ ') + chalk.bgGreen.black('+ ' + h.line));
        i++;
      } else {
        bodyLines.push(chalk.hex(theme.colors.textDim)('  │   ' + h.line));
        i++;
      }
    }
    return '\n' + header + '\n' + bodyLines.join('\n') + '\n' + footer + '\n';
  } catch {
    return hunks.map(h => {
      if (h.kind === 'removed') return '- ' + h.line;
      if (h.kind === 'added') return '+ ' + h.line;
      return '  ' + h.line;
    }).join('\n');
  }
}

function wordLevelDiff(oldLine: string, newLine: string): { oldFormatted: string; newFormatted: string } {
  const tokenize = (s: string) => s.match(/(\S+|\s+)/g) ?? [s];
  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);
  const lcs = computeLCS(oldTokens, newTokens);

  let oi = 0, ni = 0, li = 0;
  let oldResult = '';
  let newResult = '';

  while (oi < oldTokens.length || ni < newTokens.length) {
    if (li < lcs.length && oi === lcs[li][0] && ni === lcs[li][1]) {
      oldResult += oldTokens[oi];
      newResult += newTokens[ni];
      oi++; ni++; li++;
    } else if (oi < oldTokens.length && (li >= lcs.length || oi < lcs[li][0])) {
      oldResult += chalk.bgRed.whiteBright(oldTokens[oi]);
      oi++;
    } else {
      newResult += chalk.bgGreen.black(newTokens[ni]);
      ni++;
    }
  }

  return { oldFormatted: oldResult, newFormatted: newResult };
}

function computeLCS(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length, n = b.length;
  // Para diffs grandes, limitamos a 500 líneas para no bloquear el event loop
  if (m > 500 || n > 500) return [];

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result: Array<[number, number]> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.push([i - 1, j - 1]); i--; j--; }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--;
    else j--;
  }
  return result.reverse();
}

// ── Syntax Highlighting ANSI ──────────────────────────────────────────────

/** Palabras clave de TypeScript/JavaScript */
const TS_KEYWORDS = new Set([
  'abstract', 'as', 'any', 'async', 'await', 'boolean', 'break', 'case', 'catch',
  'class', 'const', 'constructor', 'continue', 'declare', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from',
  'function', 'get', 'if', 'implements', 'import', 'in', 'infer', 'instanceof',
  'interface', 'is', 'keyof', 'let', 'module', 'namespace', 'never', 'new',
  'null', 'number', 'of', 'package', 'private', 'protected', 'public', 'readonly',
  'record', 'return', 'satisfies', 'set', 'static', 'string', 'super', 'switch',
  'symbol', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined',
  'unknown', 'using', 'var', 'void', 'while', 'with', 'yield',
]);

/** Palabras clave adicionales para SQL */
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'JOIN', 'LEFT',
  'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'NOT', 'IN', 'NULL',
  'IS', 'LIKE', 'BETWEEN', 'EXISTS', 'GROUP', 'BY', 'ORDER', 'ASC',
  'DESC', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'AS', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CASCADE',
  'INT', 'INTEGER', 'VARCHAR', 'TEXT', 'BOOLEAN', 'TIMESTAMP', 'DATE',
  'BIGINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'SERIAL', 'UUID',
]);

/** Palabras clave adicionales para YAML/JSON */
const YAML_KEYWORDS = new Set(['true', 'false', 'yes', 'no', 'on', 'off', 'null', '~']);

/**
 * @description Aplica syntax highlighting ANSI a una línea de código
 * según el lenguaje. Colorea: keywords (cyan), strings (green),
 * numbers (yellow), comments (dim), decorators (magenta), types (blue).
 * El desarrollador lee código coloreado directamente en la terminal
 * sin depender de un IDE o plugin externo.
 */
function highlightLine(line: string, lang: string): string {
  // Comentarios de línea completa
  if ((lang === 'typescript' || lang === 'javascript' || lang === 'ts' || lang === 'js' || lang === 'jsx' || lang === 'tsx') && /^\s*\/\//.test(line)) {
    return chalk.hex(theme.colors.textDim)(line);
  }
  if ((lang === 'python' || lang === 'yaml' || lang === 'yml' || lang === 'makefile') && /^\s*#/.test(line)) {
    return chalk.hex(theme.colors.textDim)(line);
  }
  if (lang === 'sql' && /^\s*--/.test(line)) {
    return chalk.hex(theme.colors.textDim)(line);
  }

  let result = '';
  let i = 0;
  const len = line.length;

  while (i < len) {
    // Decoradores @ (TypeScript/Java)
    if (line[i] === '@' && /[a-zA-Z_]/.test(line[i + 1] ?? '')) {
      let end = i + 1;
      while (end < len && /[a-zA-Z0-9_.]/.test(line[end])) end++;
      result += chalk.hex(theme.colors.accent)(line.slice(i, end));
      i = end;
      continue;
    }

    // strings comillas dobles
    if (line[i] === '"') {
      let end = i + 1;
      while (end < len && line[end] !== '"') {
        if (line[end] === '\\') end++; // skip escape
        end++;
      }
      if (end < len) end++; // incluir comilla de cierre
      result += chalk.hex(theme.colors.success)(line.slice(i, end));
      i = end;
      continue;
    }

    // strings comillas simples
    if (line[i] === "'") {
      let end = i + 1;
      while (end < len && line[end] !== "'") {
        if (line[end] === '\\') end++;
        end++;
      }
      if (end < len) end++;
      result += chalk.hex(theme.colors.success)(line.slice(i, end));
      i = end;
      continue;
    }

    // backtick strings (template literals)
    if (line[i] === '`') {
      let end = i + 1;
      while (end < len && line[end] !== '`') {
        if (line[end] === '\\') end++;
        end++;
      }
      if (end < len) end++;
      result += chalk.hex(theme.colors.success)(line.slice(i, end));
      i = end;
      continue;
    }

    // Números (enteros y flotantes)
    if (/[0-9]/.test(line[i]) && (i === 0 || /[\s(,=[<+\-*\/%!|&^~?:;]/.test(line[i - 1]))) {
      let end = i;
      if (line[end] === '0' && (line[end + 1] === 'x' || line[end + 1] === 'X')) {
        end += 2;
        while (end < len && /[0-9a-fA-F]/.test(line[end])) end++;
      } else {
        while (end < len && /[0-9.]/.test(line[end])) end++;
        if (line[end] === 'n') end++; // BigInt
      }
      result += chalk.hex(theme.colors.warning)(line.slice(i, end));
      i = end;
      continue;
    }

    // Identificadores
    if (/[a-zA-Z_$]/.test(line[i])) {
      let end = i;
      while (end < len && /[a-zA-Z0-9_$]/.test(line[end])) end++;
      const word = line.slice(i, end);

      // Palabras clave del lenguaje
      if (TS_KEYWORDS.has(word) || (lang === 'sql' && SQL_KEYWORDS.has(word)) ||
        ((lang === 'yaml' || lang === 'yml') && YAML_KEYWORDS.has(word))) {
        result += chalk.hex(theme.colors.info)(word);
        i = end;
        continue;
      }

      // Tipos comunes (Capitalized en TS/JS)
      if ((lang === 'typescript' || lang === 'ts' || lang === 'tsx') &&
        /^[A-Z]/.test(word) && word.length >= 2 && !/^[A-Z]+$/.test(word)) {
        result += chalk.hex(theme.colors.primary)(word);
        i = end;
        continue;
      }

      result += word;
      i = end;
      continue;
    }

    result += line[i];
    i++;
  }

  return result;
}

/**
 * @description Aplica syntax highlighting a un bloque de código multilínea.
 * Usa cli-highlight (highlight.js) cuando el lenguaje está soportado,
 * con fallback al highlighter manual para lenguajes no reconocidos.
 */
function highlightCode(lang: string, code: string): string {
  const normalizedLang = lang.toLowerCase().replace(/^csharp$/, 'c#');
  if (normalizedLang && chalk.level > 0) {
    try {
      if (supportsLanguage(normalizedLang)) {
        return cliHighlight(code, { language: normalizedLang, ignoreIllegals: true });
      }
    } catch { }
  }
  return code.split('\n').map(line => highlightLine(line, normalizedLang)).join('\n');
}

/**
 * @description Renderiza texto Markdown en la terminal con formato visual.
 * Soporta: bloques de código con bordes y syntax highlighting, headings
 * (h1-h3 con iconos), listas, recap y formato inline (negritas, código).
 * El desarrollador lee respuestas estructuradas sin necesidad de un
 * visor Markdown externo.
 */
function formatTable(tableLines: string[]): string | null {
  const rows: string[][] = [];
  let headerEnd = -1;

  for (const line of tableLines) {
    const t = line.trim();
    if (!t.startsWith('|')) return null;
    if (/^\|[\s\-:|]+\|$/.test(t)) {
      headerEnd = rows.length;
      continue;
    }
    const cells = t.slice(1, t.endsWith('|') ? -1 : undefined)
      .split('|')
      .map(c => c.trim());
    rows.push(cells);
  }

  if (rows.length === 0) return null;

  const colCount = Math.max(...rows.map(r => r.length));
  for (const row of rows) {
    while (row.length < colCount) row.push('');
  }

  // Cell widths include 1 space padding on each side
  const cellWidths: number[] = Array.from({ length: colCount }, (_, ci) =>
    Math.max(6, ...rows.map(r => r[ci].length)) + 2
  );

  const termCols = Math.max(40, (process.stdout.columns || 80) - 2);
  const totalBorders = colCount + 1;
  const totalWidth = cellWidths.reduce((a, b) => a + b, 0) + totalBorders;

  if (totalWidth > termCols) {
    const available = termCols - totalBorders;
    const totalContent = cellWidths.reduce((a, b) => a + b, 0);
    for (let ci = 0; ci < colCount; ci++) {
      cellWidths[ci] = Math.max(8, Math.round((cellWidths[ci] / totalContent) * available));
    }
  }

  const b = chalk.hex(theme.colors.border);
  const TOP = '┌' + cellWidths.map(w => '─'.repeat(w)).join('┬') + '┐';
  const MID = '├' + cellWidths.map(w => '─'.repeat(w)).join('┼') + '┤';
  const BOT = '└' + cellWidths.map(w => '─'.repeat(w)).join('┴') + '┘';

  const out: string[] = [b(TOP)];

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const isHeader = headerEnd > 0 ? ri < headerEnd : ri === 0;
    const wrapped: string[][] = row.map((cell, ci) => wrapText(cell, cellWidths[ci] - 2));
    const maxLines = Math.max(...wrapped.map(c => c.length));

    for (let l = 0; l < maxLines; l++) {
      let rowStr = b('│');
      for (let ci = 0; ci < colCount; ci++) {
        const cellText = wrapped[ci]?.[l] ?? '';
        const contentW = cellWidths[ci] - 2;
        let cell: string;
        if (isHeader) {
          const pad = Math.max(0, contentW - cellText.length);
          const lpad = Math.floor(pad / 2);
          cell = ' ' + ' '.repeat(lpad) + chalk.bold.white(cellText) + ' '.repeat(pad - lpad) + ' ';
        } else {
          cell = ' ' + chalk.hex(theme.colors.textDim)(cellText.padEnd(contentW)) + ' ';
        }
        rowStr += cell + b('│');
      }
      out.push(rowStr);
    }

    out.push(b(ri < rows.length - 1 ? MID : BOT));
  }

  return out.join('\n');
}

export function formatMarkdown(text: string): string {
  // Split on fenced code blocks to handle them separately
  const segments: Array<{ type: 'text' | 'code'; content: string; lang: string }> = [];
  const codeRe = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', content: text.slice(last, m.index), lang: '' });
    segments.push({ type: 'code', content: m[2], lang: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', content: text.slice(last), lang: '' });

  return segments.map(seg => {
    if (seg.type === 'code') {
      const langLabel = seg.lang ? ' ' + seg.lang + ' ' : '';
      const bar = chalk.hex(theme.colors.textDim)('\u2500'.repeat(48));
      const header = chalk.hex(theme.colors.textDim)('  \u250C\u2500\u2500') + chalk.hex(theme.colors.info)(langLabel);
      const { code: cleanCode, hadIssues, issues } = sanitizeCodeOutput(seg.content.trimEnd());
      const sanitizeWarning = hadIssues
        ? chalk.hex(theme.colors.warning)('  \u26A0 codigo sanitizado: ' + issues.join(', ') + '\n')
        : '';
      const highlighted = highlightCode(seg.lang, cleanCode);
      const codeLines = highlighted.split('\n');
      const lineNumWidth = Math.max(2, String(codeLines.length).length);
      const body = codeLines
        .map((l, idx) => {
          const num = chalk.hex(theme.colors.textDim)(String(idx + 1).padStart(lineNumWidth));
          return '  ' + num + chalk.hex(theme.colors.textDim)(' \u2502 ') + l;
        })
        .join('\n');
      const footer = '  ' + chalk.hex(theme.colors.textDim)('\u2514' + bar);
      return '\n' + sanitizeWarning + header + '\n' + body + '\n' + footer + '\n';
    }

    const textLines = seg.content.split('\n');
    const result: string[] = [];
    let i = 0;
    while (i < textLines.length) {
      const line = textLines[i];
      if (/^\s*\|/.test(line)) {
        let j = i;
        while (j < textLines.length && /^\s*\|/.test(textLines[j])) j++;
        if (j > i) {
          const rendered = formatTable(textLines.slice(i, j));
          if (rendered !== null) { result.push(rendered); i = j; continue; }
        }
      }
      if (line.startsWith('# ')) result.push('\n' + chalk.bold.hex(theme.colors.info)('  \u25C9 ' + line.slice(2)) + '\n');
      else if (line.startsWith('## ')) result.push('\n' + chalk.bold.hex(theme.colors.secondary)('  \u25C8 ' + line.slice(3)) + '\n');
      else if (line.startsWith('### ')) result.push('\n' + chalk.bold('  \u25C7 ' + line.slice(4)) + '\n');
      else if (/^[-*] /.test(line)) result.push(chalk.hex(theme.colors.textDim)('  \u2022 ') + inlineFmt(line.slice(2)));
      else if (/^\d+\. /.test(line)) {
        const [, num] = line.match(/^(\d+)/) ?? ['', ''];
        result.push(chalk.hex(theme.colors.info)('  ' + num + '. ') + inlineFmt(line.replace(/^\d+\. /, '')));
      }
      else if (/^\u203B\s*recap:/i.test(line)) result.push(formatRecap(line));
      else result.push(inlineFmt(line));
      i++;
    }
    return result.join('\n');
  }).join('');
}

/**
 * @description Formatea una línea de recap (※ recap: ...) con un diseño
 * destacado: barra superior e inferior, texto en negrita blanca y
 * contenido en itálica. El desarrollador identifica rápidamente el
 * resumen de lo que se hizo y el siguiente paso.
 */
function formatRecap(line: string): string {
  const content = line.replace(/^\u203B\s*recap:\s*/i, '').trim();
  const cols = Math.min(process.stdout.columns || 80, 80);
  const bar = chalk.hex(theme.colors.textDim)('\u2504'.repeat(cols - 2));
  return [
    '\n' + bar,
    chalk.bold.hex(theme.colors.accent)('  \u203B ') + chalk.bold.white('recap  ') + chalk.hex(theme.colors.textDim)('\u00B7') + '  ' + chalk.italic(content),
    bar,
  ].join('\n');
}

/**
 * @description Aplica formato inline a texto: negritas (**texto**) y
 * código inline (`código`) con fondo tenue. Usada internamente por
 * formatMarkdown para párrafos y listas.
 */
function inlineFmt(t: string): string {
  return t
    .replace(/\*\*(.+?)\*\*/g, (_, s) => chalk.bold(s))
    .replace(/`([^`]+)`/g, (_, s) => chalk.bgHex(theme.colors.bgLight).hex(theme.colors.text)(' ' + s + ' '));
}

const FILE_EDIT_TOOLS = new Set(['edit_file', 'write_file', 'multi_edit_file']);
const DIFF_CONTEXT = 3;

function diffCols(): number {
  return Math.min((typeof process !== 'undefined' ? process.stdout?.columns ?? 80 : 80), 100);
}

function renderDiffLine(lineNum: number, prefix: ' '|'+'|'-', code: string, cols: number): string {
  const LN = String(lineNum).padStart(6);
  const maxCode = cols - 14;
  const snippet = code.slice(0, maxCode);
  if (prefix === '-') {
    const fill = Math.max(1, cols - 10 - snippet.length);
    return chalk.red('── ') + chalk.dim(LN) + chalk.red(' − ') + chalk.red(snippet) + chalk.dim('─'.repeat(fill));
  }
  if (prefix === '+') {
    return chalk.green('   ' + LN + ' + ') + chalk.green(snippet);
  }
  return chalk.dim('   ' + LN + '   ' + snippet);
}

function buildEditDiff(filePath: string, oldStr: string, newStr: string): string {
  let src: string;
  try { src = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; }
  const nOld = oldStr.replace(/\r\n/g, '\n');
  const nNew = newStr.replace(/\r\n/g, '\n');
  const idx = src.indexOf(nOld);
  if (idx === -1) return '';
  const allLines = src.split('\n');
  const firstIdx = src.slice(0, idx).split('\n').length - 1; // 0-based
  const oldLines = nOld.split('\n');
  const newLines = nNew.split('\n');
  const lastIdx = firstIdx + oldLines.length - 1;
  const dispStart = Math.max(0, firstIdx - DIFF_CONTEXT);
  const dispEnd = Math.min(allLines.length - 1, lastIdx + DIFF_CONTEXT);
  const cols = diffCols();
  const out: string[] = [];
  for (let i = dispStart; i < firstIdx; i++) out.push(renderDiffLine(i + 1, ' ', allLines[i] ?? '', cols));
  oldLines.forEach((l, i) => out.push(renderDiffLine(firstIdx + i + 1, '-', l, cols)));
  newLines.forEach((l, i) => out.push(renderDiffLine(firstIdx + i + 1, '+', l, cols)));
  for (let i = lastIdx + 1; i <= dispEnd; i++) out.push(renderDiffLine(i + 1, ' ', allLines[i] ?? '', cols));
  return out.join('\n');
}

export function formatFileDiff(toolName: string, argsStr: string): string {
  if (!FILE_EDIT_TOOLS.has(toolName)) return '';
  try {
    const args = JSON.parse(argsStr) as Record<string, unknown>;
    const filePath = String(args.file_path ?? '');
    const base = path.basename(filePath);
    const cols = diffCols();

    if (toolName === 'edit_file') {
      const oldStr = String(args.old_string ?? '');
      const newStr = String(args.new_string ?? '');
      const added = newStr.split('\n').length;
      const removed = oldStr.split('\n').length;
      const diff = buildEditDiff(filePath, oldStr, newStr);
      if (!diff) return '';
      const summary = chalk.dim('  ⎿  ') +
        chalk.green('+' + added) + chalk.dim(' / ') + chalk.red('−' + removed) +
        chalk.dim(' lines  ·  ' + base);
      const sep = chalk.dim('─'.repeat(cols));
      return '\n' + summary + '\n' + sep + '\n' + diff + '\n' + sep;
    }

    if (toolName === 'write_file') {
      const newContent = String(args.content ?? '');
      let oldContent = '';
      let isNew = false;
      try { oldContent = fs.readFileSync(filePath, 'utf8'); } catch { isNew = true; }
      const newLines = newContent.split('\n').length;
      const oldLines = oldContent.split('\n').length;
      if (isNew) {
        return '\n' + chalk.dim('  ⎿  ') + chalk.green('new file') + chalk.dim('  ·  ' + newLines + ' lines  ·  ' + base);
      }
      const delta = newLines - oldLines;
      const sign = delta >= 0 ? chalk.green('+' + delta) : chalk.red('−' + Math.abs(delta));
      return '\n' + chalk.dim('  ⎿  ') + sign + chalk.dim(' lines  ·  ' + base);
    }

    if (toolName === 'multi_edit_file') {
      const edits = (args.edits as { old_string: string; new_string: string }[]) ?? [];
      let totalAdded = 0; let totalRemoved = 0;
      for (const e of edits) {
        totalAdded += e.new_string.split('\n').length;
        totalRemoved += e.old_string.split('\n').length;
      }
      const summary = chalk.dim('  ⎿  ') +
        chalk.green('+' + totalAdded) + chalk.dim(' / ') + chalk.red('−' + totalRemoved) +
        chalk.dim(' lines  ·  ' + base + '  ·  ' + edits.length + ' edits');
      const diffs = edits.map(e => buildEditDiff(filePath, e.old_string, e.new_string)).filter(Boolean);
      if (!diffs.length) return '\n' + summary;
      const sep = chalk.dim('─'.repeat(cols));
      return '\n' + summary + '\n' + sep + '\n' + diffs.join('\n' + sep + '\n') + '\n' + sep;
    }
  } catch { }
  return '';
}
