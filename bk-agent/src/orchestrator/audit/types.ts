/**
 * @description Tipos compartidos del subsistema de auditoría.
 *
 * Estos tipos se usan en AuditReporter y todas las clases helper.
 * Se extrajeron del archivo audit-reporter.ts original para evitar
 * dependencias circulares.
 */

// ── Hallazgo de auditoría ────────────────────────────────────────────────────

export interface AuditFinding {
  id: string;
  dimension: string;
  hallazgo: string;
  severidad: 'critical' | 'high' | 'medium' | 'low';
  evidencia: string;
  recomendacion: string;
  agenteResponsable: string;
  /** SHA del commit que resolvió este hallazgo (opcional) */
  resolvedByCommit?: string;
  /** Fecha en que se resolvió (YYYY-MM-DD HH:mm:ss UTC) */
  resolvedAt?: string;
}

// ── Veredicto de gate ────────────────────────────────────────────────────────

export type GateVeredict = 'GO' | 'NO-GO' | 'NO-GO condicional';

// ── Registro de gate ─────────────────────────────────────────────────────────

export interface GateRecord {
  gate: string;
  agente: string;
  veredicto: GateVeredict;
  fecha: string;
  hallazgos: AuditFinding[];
  notas?: string;
}

// ── Información del sprint ───────────────────────────────────────────────────

export interface SprintInfo {
  name: string;
  version: string;
  purpose: string;
  newFiles: string[];
  modifiedFiles: string[];
  testCount: number;
  testTime: string;
}

// ── Lección aprendida ────────────────────────────────────────────────────────

export interface Lesson {
  dimension: string;
  patron: string;
  frecuencia: number;
  gravedad: 'critical' | 'high' | 'medium' | 'low';
  recomendacion: string;
}

// ── Informe final ────────────────────────────────────────────────────────────

export interface FinalReport {
  sprint: SprintInfo;
  gates: GateRecord[];
  veredictoFinal: GateVeredict;
  resumen: string;
  riesgos: Array<{ riesgo: string; probabilidad: string; impacto: string; mitigacion: string }>;
  fecha: string;
}

// ── Silent gate (para batch diario) ──────────────────────────────────────────

export interface SilentGateRecord {
  gate: string;
  agente: string;
  fecha: string;
  veredicto: GateVeredict;
  notas?: string;
}

// ── Resultado de CI ──────────────────────────────────────────────────────────

export interface CiReport {
  ok: boolean;
  criticalCount: number;
  highCount: number;
  findings: AuditFinding[];
  message: string;
}

// ── Stats de auditoría ───────────────────────────────────────────────────────

export interface AuditStats {
  totalGates: number;
  withFindings: number;
  approvalRate: number;
  lessonsCount: number;
}
