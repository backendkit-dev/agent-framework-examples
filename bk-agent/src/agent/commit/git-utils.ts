/**
 * @description Utilidades Git para el módulo Commit Workflow
 *
 * Proporciona funciones para interactuar con el repositorio Git:
 * stageo, detección de archivos, validación de scope, etc.
 */

import { execSync } from 'child_process';

// ── Stageo ───────────────────────────────────────────────────────────────────

/**
 * @description Ejecuta `git add .` para stagear todos los archivos modificados.
 * Se ejecuta automáticamente antes de cada commit, así el usuario no necesita
 * stagear manualmente.
 *
 * @returns true si el stage fue exitoso
 */
export function stageAllChanges(): boolean {
  try {
    execSync('git add .', {
      cwd: process.cwd(),
      timeout: 30_000,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

// ── Detección de archivos ────────────────────────────────────────────────────

/**
 * @description Obtiene la lista de archivos staged en el repositorio git actual.
 * Ejecuta `git diff --cached --name-only` para listar los archivos.
 *
 * @returns Lista de rutas de archivos staged, o array vacío si no hay staged o no es un repo git.
 */
export function getStagedFiles(): string[] {
  try {
    const output = execSync('git diff --cached --name-only', {
      cwd: process.cwd(),
      timeout: 10_000,
      stdio: 'pipe',
    }).toString().trim();
    if (!output) return [];
    return output.split('\n').map(f => f.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @description Obtiene la lista de archivos modificados (staged + unstaged) en el repositorio.
 * Ejecuta `git status --porcelain` para detectar todos los cambios.
 *
 * @returns Lista de rutas de archivos con cambios (staged o unstaged).
 */
export function getAllChangedFiles(): string[] {
  try {
    const output = execSync('git status --porcelain', {
      cwd: process.cwd(),
      timeout: 10_000,
      stdio: 'pipe',
    }).toString().trim();
    if (!output) return [];
    return output.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/\s+/);
        const filename = parts.slice(1).join(' ');
        return filename.replace(/^"|"$/g, '');
      });
  } catch {
    return [];
  }
}

/**
 * @description Obtiene el diff completo de los archivos staged.
 * Útil para que QA revise qué cambios se están intentando commitear
 * cuando fallan los tests.
 *
 * @returns El diff en texto plano, o string vacío si no hay diff o no es un repo git.
 */
export function getGitDiff(): string {
  try {
    const output = execSync('git diff --cached', {
      cwd: process.cwd(),
      timeout: 10_000,
      stdio: 'pipe',
    }).toString();
    return output;
  } catch {
    return '';
  }
}

// ── Git config ───────────────────────────────────────────────────────────────

/**
 * @description Verifica que git tenga configurado user.name y user.email.
 * Sin esta configuración, git commit falla con "please tell me who you are".
 */
export function checkGitConfig(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  try {
    const name = execSync('git config user.name', { cwd: process.cwd(), timeout: 5000, stdio: 'pipe' })
      .toString().trim();
    if (!name) missing.push('user.name');
  } catch {
    missing.push('user.name');
  }
  try {
    const email = execSync('git config user.email', { cwd: process.cwd(), timeout: 5000, stdio: 'pipe' })
      .toString().trim();
    if (!email) missing.push('user.email');
  } catch {
    missing.push('user.email');
  }
  return { ok: missing.length === 0, missing };
}

// ── Validación de archivos staged vs scope ───────────────────────────────────

/**
 * @description Valida que los archivos staged coincidan con el scope del commit.
 *
 * El scope define qué parte del proyecto se está modificando (ej: 'cli', 'api', 'ui').
 * Esta función verifica que los archivos staged estén dentro de directorios que
 * correspondan al scope declarado.
 *
 * @param scope - Scope del commit (ej: 'cli', 'api', 'core')
 * @param stagedFiles - Lista de archivos staged
 * @returns Objeto con validación y mensaje descriptivo
 *
 * @example
 * ```ts
 * const result = validateStagedFilesMatchScope('cli', ['bin/cli.ts', 'src/ui/terminal.ts']);
 * // result.valid === true
 * // result.mismatches === []
 * ```
 */
export function validateStagedFilesMatchScope(
  scope: string,
  stagedFiles: string[]
): { valid: boolean; mismatches: string[]; message: string } {
  if (stagedFiles.length === 0) {
    return {
      valid: false,
      mismatches: [],
      message: [
        'No hay archivos staged. No se puede hacer commit.',
        '',
        'Para stagear archivos, usa uno de estos comandos:',
        '  git add <archivo>          → stagea un archivo específico',
        '  git add src/mi-archivo.ts  → ejemplo',
        '  git add -p                 → stageo interactivo (recomendado)',
        '',
        'Luego ejecuta /commit nuevamente.',
      ].join('\n'),
    };
  }

  const scopePatterns: Record<string, RegExp[]> = {
    'cli': [/^bin\//, /^src\/cli\//],
    'api': [/^src\/api\//, /^src\/orchestrator\//],
    'ui': [/^src\/ui\//],
    'core': [/^src\//],
    'config': [/\.(yaml|yml|json|toml|ini|env)$/i, /^\./],
    'docs': [/\.md$/, /^docs\//, /^README/],
    'test': [/\.(test|spec|e2e)\.(ts|js|tsx|jsx)$/i, /^tests\//, /^__tests__\//],
    'deps': [/^package\.json$/, /^package-lock\.json$/, /^yarn\.lock$/, /^pnpm-lock\.yaml$/],
    'infra': [/^Dockerfile/, /^docker-compose/, /^\.github\//, /^k8s\//, /^terraform\//],
    'scripts': [/^scripts\//],
    'root': [/./],
  };

  const patterns = scopePatterns[scope] || [/^src\//, /^bin\//];

  const mismatches: string[] = [];

  for (const file of stagedFiles) {
    const matches = patterns.some(p => p.test(file));
    if (!matches) {
      mismatches.push(file);
    }
  }

  if (mismatches.length === 0) {
    return {
      valid: true,
      mismatches: [],
      message: `✓ Todos los archivos staged corresponden al scope "${scope}".`,
    };
  }

  const totalFiles = stagedFiles.length;
  const mismatchRatio = mismatches.length / totalFiles;

  if (mismatchRatio > 0.5) {
    return {
      valid: false,
      mismatches,
      message: [
        `⚠️  ${mismatches.length} de ${totalFiles} archivos staged NO corresponden al scope "${scope}":`,
        ...mismatches.map(f => `    - ${f}`),
        '',
        `Sugerencia: Si estos archivos pertenecen a otro cambio, staggea solo los archivos`,
        `relacionados con "${scope}" y haz un commit separado para el otro scope.`,
        '',
        `Para continuar de todas formas, usa --no-verify o responde "sí" a la confirmación.`,
      ].join('\n'),
    };
  }

  return {
    valid: true,
    mismatches,
    message: [
      `⚠️  ${mismatches.length} archivo(s) staged no parecen corresponder al scope "${scope}":`,
      ...mismatches.map(f => `    - ${f}`),
      '',
      `Revisa que estos archivos pertenezcan realmente a este cambio.`,
    ].join('\n'),
  };
}
