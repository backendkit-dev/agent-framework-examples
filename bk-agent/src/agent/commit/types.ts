/**
 * @description Tipos del módulo Commit Workflow
 */

export interface CommitWorkflowOptions {
  /** Tipo de commit convencional */
  type?: 'feat' | 'fix' | 'refactor' | 'test' | 'docs' | 'chore' | 'style' | 'perf' | 'ci' | 'build' | 'revert';
  /** Scope del cambio */
  scope?: string;
  /** Mensaje corto en imperativo */
  message?: string;
  /** Cuerpo opcional del commit */
  body?: string;
  /** Si es breaking change */
  breakingChange?: boolean;
  /** Iniciales del desarrollador para branch naming */
  developerInitials?: string;
  /** Tipo de branch (auto-detect si no se especifica) */
  branchType?: 'feature' | 'fix' | 'release';
  /** Si debe finalizar la feature (merge a develop) */
  finishFeature?: boolean;
  /** Si debe finalizar la release (merge a master + tag) */
  finishRelease?: boolean;
  /** Versión para release */
  version?: string;
  /** Skip pre-commit hooks */
  noVerify?: boolean;
  /** Si true, ejecuta git add -A antes de commitear (default: false) */
  autoStage?: boolean;
}

export interface CommitWorkflowResult {
  /** Si el workflow se ejecutó con éxito */
  success: boolean;
  /** Salida del script */
  output: string;
  /** Error si ocurrió */
  error?: string;
  /** Rama creada/usada */
  branchName?: string;
}
