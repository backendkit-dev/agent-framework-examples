# Mejoras — AuditReporter

> Extraído del bloque `MEJORAS 2026-05-01` del archivo `src/orchestrator/audit-reporter.ts`.
> Fecha de referencia: 2026-05-01

## Silent Gates (batch diario)

Genera un reporte diario con todos los auto-gates silenciosos acumulados. Reduce 130+ archivos individuales a 1 reporte diario consolidado.

**Métodos:**
- `generateDailySilentGatesReport(fecha?: string): Promise<string | null>`
- `getSilentGates(): Array<{ gate, agente, fecha, veredicto }>`
- `clearSilentGates(): void`

## Complete Sprint

Completa un sprint generando el informe final, reporte diario de auto-gates, y pending issues si el veredicto es NO-GO.

**Método:**
- `completeSprint(sprint, finalVeredict?): Promise<{ reportPath, pendingIssues, silentReportPath }>`

## Trazabilidad Hallazgo → Commit

Marca un hallazgo como resuelto, asociándolo con un commit. Busca en memoria y en disco.

**Métodos:**
- `markFindingResolved(findingId, commitHash, commitMessage?): Promise<boolean>`
- `markFindingsResolvedByFiles(commitHash, modifiedFiles): Promise<number>`

## CLI audit check (bloqueo de deploys)

Verifica si hay hallazgos críticos/altos sin resolver. Útil para CI/CD: si retorna `true`, el pipeline debe fallar.

**Métodos:**
- `hasCriticalOpenFindings(): Promise<boolean>`
- `generateCiReport(): Promise<{ ok, criticalCount, highCount, findings, message }>`

## Reflexión (Reflection Bridge)

Conecta el `AuditReporter` con el `ReflectionEngine`.

**Métodos:**
- `connectReflectionEngine(engine: ReflectionEngine): void`
- `disconnectReflectionEngine(): void`
