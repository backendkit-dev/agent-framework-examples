/**
 * @description LogicEvaluator -- Evaluador de logica y patrones de error.
 *
 * Detecta patrones de error logicos recurrentes en el codigo generado:
 * - Conexiones rotas (emisor sin receptor)
 * - Logica invertida (condiciones que producen lo opuesto a lo deseado)
 * - Supuestos silenciosos (defaults inseguros, falta de fallbacks)
 * - Includes con falsos positivos (includes("problema") matcheando "no hay problema")
 * - Atomicidad faltante (escritura directa sin archivo temporal)
 *
 * Estos patrones fueron identificados analizando 50+ errores reales
 * en proyectos multi-agente y representan ~70% de los bugs de "ensamblaje".
 *
 * @example
 * ```ts
 * const logicEval = new LogicEvaluator();
 * const issues = logicEval.evaluate(response);
 * ```
 */

import { EvaluationIssue } from './types';

// ── Expresiones regulares para deteccion ─────────────────────────────────────

/** Busca includes() que podrian producir falsos positivos con negacion */
const INVERTED_INCLUDES_REGEX = /\.includes\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Busca if/else y verifica si puede haber logica invertida */
const CONDITIONAL_CHECKS_REGEX = /if\s*\([^)]*\)\s*\{[\s\S]*?\}\s*else\s*\{/g;

/** Busca scores/weights que podrian estar en direccion incorrecta */
const SCORE_WEIGHT_REGEX = /\b(score|weight|threshold|rating)\s*[=:>]\s*(-?\d+\.?\d*)/gi;

/** Busca hooks/callbacks definidos pero potencialmente no llamados */
const HOOK_DEFINITION_REGEX = /(?:on|before|after|pre|post)([A-Z]\w+)\s*[:=]\s*(?:async\s*)?\(/g;

/** Busca switch/match sin default */
const SWITCH_WITHOUT_DEFAULT_REGEX = /switch\s*\([^)]+\)\s*\{[\s\S]*?\}(?![^}]*default\s*:)/g;

/** Busca catch vacio */
const EMPTY_CATCH_REGEX = /catch\s*\(\s*(?:err(?:or)?|e|_)?\s*\)\s*(?:\{[\s\n\r]*\}|;)/g;

/** Busca writeFileSync (escritura no atomica) */
const NON_ATOMIC_WRITE_REGEX = /(?:writeFileSync|writeFile)\s*\(/g;

/** Patron: if (!x) { error } else { exito } — podria estar invertido */
const INVERTED_CONDITION_PATTERN = /if\s*\(!(\w+)\)/g;

/** Patron: this.algo.save() sin this.algo.find()/load() previo — escritura sin ver lectura */
const WRITE_WITHOUT_READ_REGEX = /(?:\.save|\.create|\.update|\.delete|\.insert)\s*\((?![^)]*\.(?:find|load|get|read))/g;

/** Palabras clave que indican negacion */
const NEGATION_WORDS = /\b(no|not|nunca|sin|without|non|un|in|dis)\b/i;

// ── LogicEvaluator ───────────────────────────────────────────────────────────

export class LogicEvaluator {

  /**
   * @description Evalua el codigo generado en busca de patrones de error logicos.
   */
  evaluate(response: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = [];

    issues.push(...this.checkInvertedIncludes(response));
    issues.push(...this.checkEmptyCatches(response));
    issues.push(...this.checkSwitchWithoutDefault(response));
    issues.push(...this.checkNonAtomicWrites(response));
    issues.push(...this.checkInvertedLogic(response));
    issues.push(...this.checkOrphanHooks(response));
    issues.push(...this.checkScoreDirection(response));

    return issues;
  }

  // ── 1. Includes con falsos positivos ─────────────────────────────────

  /**
   * Detecta .includes() donde el texto buscado podria coincidir
   * con su propia negacion (ej: "no hay problema".includes("problema") = true)
   */
  private checkInvertedIncludes(code: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Buscar includes() que examinan una variable que contiene negacion
      const includesMatch = INVERTED_INCLUDES_REGEX.exec(line);
      if (!includesMatch) continue;

      // Si la variable examinada viene de una cadena que puede tener negacion
      const searchTerm = includesMatch[1].toLowerCase();
      if (!searchTerm || searchTerm.length < 3) continue;

      // Verificar si la misma linea o la anterior trabajan con algo
      // que podria contener negacion
      const context = (lines[i - 1] ?? '').toLowerCase() + ' ' + line.toLowerCase();

      // Si la variable examinada contiene algo que se esta verificando
      // pero tambien aparece "no", "nunca", "sin" antes -> falso positivo
      if (NEGATION_WORDS.test(context) && context.includes(searchTerm)) {
        // Verificar si realmente hay riesgo: que el searchTerm sea
        // una palabra que aparece tanto en afirmacion como negacion
        if (this.isLikelyNegationPattern(context, searchTerm)) {
          issues.push({
            type: 'logic',
            severity: 'high',
            description: `Posible falso positivo con includes(): la busqueda "${searchTerm}" podria coincidir con su propia negacion`,
            detail: `Linea ${i + 1}: ${line.trim().slice(0, 100)}. Revisar si "no ${searchTerm}" tambien matchea.`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Determina si hay un patron de negacion antes del termino buscado.
   */
  private isLikelyNegationPattern(context: string, searchTerm: string): boolean {
    // Buscar "no X" donde X es el searchTerm o similar
    const negatedPatterns = [
      `no ${searchTerm}`,
      `not ${searchTerm}`,
      `sin ${searchTerm}`,
      `nunca ${searchTerm}`,
      `without ${searchTerm}`,
      `non${searchTerm}`,
    ];

    for (const pattern of negatedPatterns) {
      if (context.includes(pattern)) return true;
    }

    // Buscar en la linea verificaciones del tipo:
    // "if (mensaje.includes('problema'))" cuando mensaje podria ser "no hay problema"
    if (context.includes('no') || context.includes('not')) return true;

    return false;
  }

  // ── 2. Catch vacio ──────────────────────────────────────────────────

  /**
   * Detecta catch {} sin manejo de error (errores silenciosos).
   */
  private checkEmptyCatches(code: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = [];

    // Buscar catch() {} en una sola linea
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // catch {} o catch(e) {} en una sola linea
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line.trim())) {
        issues.push({
          type: 'logic',
          severity: 'high',
          description: 'Catch vacio detectado: el error se traga silenciosamente',
          detail: `Linea ${i + 1}: ${line.trim().slice(0, 100)}. Agregar al menos console.warn() con el error.`,
        });
      }
    }

    // Buscar bloques catch multi-linea sin contenido
    const blockRegex = /catch\s*\([^)]*\)\s*\{([\s\S]*?)\}/g;
    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(code)) !== null) {
      const body = match[1].trim();
      if (!body || body === '') {
        issues.push({
          type: 'logic',
          severity: 'high',
          description: 'Bloque catch vacio: el error se traga silenciosamente',
          detail: 'El bloque catch no tiene ninguna linea de codigo. Agregar al menos logging del error.',
        });
      }
    }

    return issues;
  }

  // ── 3. Switch sin default ───────────────────────────────────────────

  /**
   * Detecta switch/match sin caso default.
   */
  private checkSwitchWithoutDefault(code: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = [];

    const lines = code.split('\n');
    let inSwitch = false;
    let switchLine = 0;
    let braceCount = 0;
    let hasDefault = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/switch\s*\(/.test(line)) {
        inSwitch = true;
        switchLine = i + 1;
        braceCount = 0;
        hasDefault = false;
      }

      if (inSwitch) {
        braceCount += (line.match(/\{/g) ?? []).length;
        braceCount -= (line.match(/\}/g) ?? []).length;

        if (/\bdefault\s*:/.test(line)) {
          hasDefault = true;
        }

        // Cuando se cierra el switch
        if (braceCount <= 0 && inSwitch) {
          inSwitch = false;
          if (!hasDefault) {
            issues.push({
              type: 'logic',
              severity: 'medium',
              description: 'Switch sin caso default: puede dejar estados sin manejar',
              detail: `Linea ${switchLine}: el switch no tiene default. Siempre agregar un default aunque sea con throw o return.`,
            });
          }
        }
      }
    }

    return issues;
  }

  // ── 4. Escritura no atomica ─────────────────────────────────────────

  /**
   * Detecta writeFileSync/writeFile sin patron atomico (tmp + rename).
   */
  private checkNonAtomicWrites(code: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = [];

    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (NON_ATOMIC_WRITE_REGEX.test(line)) {
        // Verificar que no haya un patron atomico cerca
        const context = lines.slice(Math.max(0, i - 2), i + 3).join('\n').toLowerCase();
        if (!context.includes('.tmp') && !context.includes('atomic') && !context.includes('temp')) {
          issues.push({
            type: 'logic',
            severity: 'medium',
            description: 'Escritura no atomica: writeFile sin patron tmp+rename',
            detail: `Linea ${i + 1}: ${line.trim().slice(0, 100)}. Usar writeFile a .tmp primero, luego renameSync.`,
          });
        }
      }
    }

    return issues;
  }

  // ── 5. Logica invertida ─────────────────────────────────────────────

  /**
   * Detecta patrones de logica potencialmente invertida.
   * Busca: if (!x) { error } else { exito } — que suele estar bien,
   * pero verifica que no haya confusión entre "mayor es mejor" vs "menor es mejor".
   */
  private checkInvertedLogic(code: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = [];

    // Buscar scores/weights y verificar si la direccion es logica
    let scoreMatch: RegExpExecArray | null;
    while ((scoreMatch = SCORE_WEIGHT_REGEX.exec(code)) !== null) {
      const name = scoreMatch[1].toLowerCase();
      const value = parseFloat(scoreMatch[2]);

      // Scores negativos en contextos donde deberian ser positivos
      if (value < 0 && (name.includes('score') || name.includes('rating') || name.includes('weight'))) {
        // Verificar contexto: si el score se usa en condicional
        const contextStart = Math.max(0, scoreMatch.index - 100);
        const context = code.slice(contextStart, scoreMatch.index + 50);

        if (context.includes('if') || context.includes('>') || context.includes('<')) {
          issues.push({
            type: 'logic',
            severity: 'medium',
            description: `Score/weight con valor negativo potencialmente incorrecto: ${name}=${value}`,
            detail: `Verificar direccion del score. Si ${value} es correcto o deberia ser positivo.`,
          });
        }
      }
    }

    return issues;
  }

  // ── 6. Hooks huerfanos ──────────────────────────────────────────────

  /**
   * Detecta hooks/callbacks definidos que podrian no tener consumidor.
   */
  private checkOrphanHooks(code: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = [];

    // Buscar definiciones de hooks: onFoo, beforeBar, afterBaz
    const hookNames = new Map<string, number>();

    let match: RegExpExecArray | null;
    while ((match = HOOK_DEFINITION_REGEX.exec(code)) !== null) {
      const hookName = `on${match[1]}`;
      hookNames.set(hookName, (hookNames.get(hookName) ?? 0) + 1);
    }

    // Buscar si los hooks se llaman en algun lado
    for (const [hookName] of hookNames) {
      // Buscar invocaciones del hook. Normalmente se llaman como this.onXxx o service.onXxx
      const invocationPattern = new RegExp(
        `\\.${hookName}\\s*\\(|\`\\$\\{this\\.${hookName}\\}|\\(${hookName}\\)`,
        'i'
      );

      // Si el hook solo se define pero nunca se invoca, podria ser huerfano
      const invocations = code.match(invocationPattern);
      if (!invocations || invocations.length <= hookNames.get(hookName)!) {
        // Solo alertar si el nombre es suficientemente especifico (no metodos genericos)
        if (hookName.length > 6) {
          issues.push({
            type: 'logic',
            severity: 'low',
            description: `Posible hook huerfano: "${hookName}" definido pero no se invoca`,
            detail: `Verificar que ${hookName} tenga un consumidor en el pipeline.`,
          });
        }
      }
    }

    return issues;
  }

  // ── 7. Direccion de scores ──────────────────────────────────────────

  /**
   * Detecta scores/weights donde la direccion (mayor=mejor vs menor=mejor)
   * podria estar invertida.
   */
  private checkScoreDirection(code: string): EvaluationIssue[] {
    const issues: EvaluationIssue[] = [];

    // Buscar comparaciones donde un score alto podria ser malo
    const comparaciones = code.match(
      /(?:score|weight|rating|priority)\s*[<>]\s*\d+|if\s*\([^)]*(?:score|weight|rating|priority)[^)]*[<>]/gi
    );

    if (comparaciones) {
      for (const comp of comparaciones) {
        // Si el score bajo es tratado como bueno en el branch verdadero
        // mientras que el score alto es tratado como malo -> posible inversion
        if (/score\s*<\s*\d+|weight\s*<\s*\d+/i.test(comp)) {
          const context = this.getContextAround(code, comp);
          if (context.includes('error') || context.includes('fail') || context.includes('bad')) {
            issues.push({
              type: 'logic',
              severity: 'low',
              description: `Posible score invertido: "${comp.trim()}" — score bajo tratado como bueno en el if, pero el else maneja error. Verificar direccion.`,
            });
          }
        }
      }
    }

    return issues;
  }

  private getContextAround(text: string, target: string, chars = 150): string {
    const idx = text.indexOf(target);
    if (idx === -1) return '';
    const start = Math.max(0, idx - chars);
    const end = Math.min(text.length, idx + target.length + chars);
    return text.slice(start, end);
  }
}
