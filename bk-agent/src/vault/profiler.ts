import { searchVaultPatterns } from './search';
import { Instructions, AIAssistantConfig } from '../types/config';
import { defaultInstructions } from '../types/config';
import { atomicWrite } from '../shared/utils/atomic-write';
import * as path from 'path';
import * as os from 'os';

interface TokenDetail {
  path: string;
  chars: number;
  tokens: number;
  relevance: number;
  trigger: string;
}

interface ProfileEntry {
  query: string;
  resultCount: number;
  elapsedMs: number;
  totalTokens: number;
  totalChars: number;
  avgTokensPerResult: number;
  maxTokensPerResult: number;
  minTokensPerResult: number;
  details: TokenDetail[];
  timestamp: string;
}

interface ProfileReport {
  entries: ProfileEntry[];
  totalQueries: number;
  totalTimeMs: number;
  avgTimeMs: number;
  maxTimeMs: number;
  minTimeMs: number;
  emptyResults: number;
  totalTokensAll: number;
  avgTokensPerQuery: number;
  avgResultsPerQuery: number;
}

const profileHistory: ProfileEntry[] = [];

function nowISO(): string {
  return new Date().toISOString();
}

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * @description Mapa de triggers a patrones de glob especificos.
 * Cada trigger busca solo en los subdirectorios donde es probable
 * encontrar documentacion relevante, reduciendo tokens inyectados.
 * Los patrones son relativos a cada search_path (ej: 04-Recursos).
 */
const TRIGGER_PATTERNS: Record<string, string[]> = {
  // NestJS
  nestjs: ['Backend/NestJS/**/*.md', 'Backend/Microservicios/**/*.md'],
  typeorm: ['Backend/NestJS/**/*.md', 'Backend/Microservicios/**/*.md'],
  entity: ['Backend/NestJS/**/*.md', 'Backend/Microservicios/**/*.md'],
  decorador: ['Backend/NestJS/**/*.md', 'Backend/Microservicios/**/*.md'],
  modulo: ['Backend/NestJS/**/*.md', 'Backend/Microservicios/**/*.md'],
  middleware: ['Backend/NestJS/**/*.md', 'Backend/Microservicios/**/*.md'],
  guard: ['Backend/NestJS/**/*.md', 'Backend/Seguridad/**/*.md'],
  swagger: ['Backend/NestJS/**/*.md'],

  // TypeScript / Backend core
  typescript: ['Backend/**/*.md', 'Backend/Microservicios/**/*.md'],
  repository: ['Backend/Microservicios/**/*.md', 'Backend/Patrones/**/*.md'],
  patron: ['**/*.md'],
  patrones: ['**/*.md'],
  pattern: ['**/*.md'],

  // Value Objects / Domain
  'value object': ['Backend/Microservicios/**/*.md', 'Backend/Patrones/**/*.md'],
  'domain error': ['Backend/Microservicios/**/*.md'],
  'branded type': ['Backend/Microservicios/**/*.md'],
  'use case': ['Backend/Microservicios/**/*.md'],

  // Seguridad
  jwt: ['Backend/Seguridad/**/*.md', 'Backend/Microservicios/**/*.md'],
  autenticacion: ['Backend/Seguridad/**/*.md', 'Backend/Microservicios/**/*.md'],
  seguridad: ['Backend/Seguridad/**/*.md'],

  // Docker / Infra
  docker: ['DevOps/Docker/**/*.md', 'Infraestructura/**/*.md'],
  postgres: ['DevOps/Docker/**/*.md', 'Bases de Datos/**/*.md'],

  // Git / DevOps
  git: ['DevOps/**/*.md'],

  // Configuracion general
  configuracion: ['Backend/NestJS/**/*.md', 'Backend/Microservicios/**/*.md'],
};

/**
 * @description Construye Instructions con patrones de glob especificos
 * segun el trigger. Si un trigger no tiene mapeo explicito, usa patron comodin
 * como fallback (busqueda amplia).
 */
export function buildInstructions(triggers?: string[]): Instructions {
  const base = defaultInstructions();
  if (triggers && triggers.length > 0) {
    base.triggers = triggers.map((t) => {
      const patterns = TRIGGER_PATTERNS[t.toLowerCase()];
      return {
        keywords: [t],
        patterns: patterns ?? ['**/*.md'],
      };
    });
  }
  return base;
}

export async function profileVaultSearch(
  userPrompt: string,
  instructions: Instructions,
  vaultPath: string,
  config?: AIAssistantConfig
): Promise<{ result: unknown; report: ProfileEntry }> {
  const start = Date.now();
  const result = await searchVaultPatterns(userPrompt, instructions, vaultPath, config);
  const elapsedMs = Date.now() - start;

  const results = Array.isArray(result) ? result : [];

  const details: TokenDetail[] = results.map((r: any) => {
    const chars = r.content?.length ?? 0;
    return {
      path: r.path ?? 'unknown',
      chars,
      tokens: charsToTokens(chars),
      relevance: r.relevance ?? 0,
      trigger: r.trigger ?? '?',
    };
  });

  const totalChars = details.reduce((s, d) => s + d.chars, 0);
  const totalTokens = charsToTokens(totalChars);
  const tokensPerResult = details.map((d) => d.tokens);

  const entry: ProfileEntry = {
    query: userPrompt,
    resultCount: results.length,
    elapsedMs,
    totalTokens,
    totalChars,
    avgTokensPerResult: tokensPerResult.length > 0
      ? Math.round(tokensPerResult.reduce((a, b) => a + b, 0) / tokensPerResult.length)
      : 0,
    maxTokensPerResult: tokensPerResult.length > 0 ? Math.max(...tokensPerResult) : 0,
    minTokensPerResult: tokensPerResult.length > 0 ? Math.min(...tokensPerResult) : 0,
    details,
    timestamp: nowISO(),
  };

  profileHistory.push(entry);
  return { result, report: entry };
}

export function getVaultProfileSummary(): string {
  if (profileHistory.length === 0) {
    return 'No hay datos de perfilado. Ejecuta profileVaultSearch() primero.';
  }

  const totalQueries = profileHistory.length;
  const totalTimeMs = profileHistory.reduce((sum, e) => sum + e.elapsedMs, 0);
  const avgTimeMs = totalTimeMs / totalQueries;
  const maxTimeMs = Math.max(...profileHistory.map((e) => e.elapsedMs));
  const minTimeMs = Math.min(...profileHistory.map((e) => e.elapsedMs));
  const emptyResults = profileHistory.filter((e) => e.resultCount === 0).length;
  const totalTokensAll = profileHistory.reduce((sum, e) => sum + e.totalTokens, 0);
  const avgTokensPerQuery = Math.round(totalTokensAll / totalQueries);
  const totalResults = profileHistory.reduce((sum, e) => sum + e.resultCount, 0);
  const avgResultsPerQuery = totalResults / totalQueries;

  const report: ProfileReport = {
    entries: profileHistory,
    totalQueries,
    totalTimeMs,
    avgTimeMs: Math.round(avgTimeMs * 100) / 100,
    maxTimeMs,
    minTimeMs,
    emptyResults,
    totalTokensAll,
    avgTokensPerQuery,
    avgResultsPerQuery: Math.round(avgResultsPerQuery * 100) / 100,
  };

  const lines: string[] = [
    '=== VAULT SEARCH PROFILE REPORT ===',
    'Total queries: ' + report.totalQueries,
    'Total time: ' + report.totalTimeMs + 'ms',
    'Avg time: ' + report.avgTimeMs + 'ms',
    'Max time: ' + report.maxTimeMs + 'ms',
    'Min time: ' + report.minTimeMs + 'ms',
    'Empty results: ' + report.emptyResults,
    'Total tokens inyectados (todos): ' + report.totalTokensAll,
    'Avg tokens por query: ' + report.avgTokensPerQuery,
    'Avg resultados por query: ' + report.avgResultsPerQuery,
    '',
    '--- Per-query breakdown ---',
  ];

  for (const entry of report.entries) {
    lines.push(
      '  [' + entry.timestamp + '] "' + entry.query + '"'
    );
    lines.push(
      '    -> ' + entry.resultCount + ' results | ' + entry.elapsedMs + 'ms | ' + entry.totalTokens + ' tokens total | avg ' + entry.avgTokensPerResult + ' tok/result'
    );
    if (entry.details.length > 0) {
      lines.push('    Detail per result:');
      for (const d of entry.details) {
        const shortPath = d.path.length > 60 ? '...' + d.path.slice(-57) : d.path;
        lines.push('      [rel=' + d.relevance + ' trig=' + d.trigger + '] ' + d.chars + ' chars / ' + d.tokens + ' tok - ' + shortPath);
      }
    }
  }

  lines.push('=== END REPORT ===');
  return lines.join('\n');
}

export async function saveProfileReport(reportPath?: string): Promise<string> {
  const summary = getVaultProfileSummary();
  const targetPath = reportPath || path.join(os.tmpdir(), 'vault-profile-' + Date.now() + '.txt');
  await atomicWrite(targetPath, summary);
  return targetPath;
}