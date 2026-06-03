/**
 * @description AuditReportRenderer — Renderiza informes Markdown de auditoría.
 *
 * Responsabilidades:
 * - Renderizar informe de gate individual (renderGateReport)
 * - Renderizar informe final multi-gate (renderFinalReport)
 * - Construir resumen ejecutivo (buildExecutiveSummary)
 * - Calcular hash SHA-256 de integridad
 */

import * as crypto from 'crypto';
import { TaskContext } from '../../types/task-context';
import {
  AuditFinding,
  GateRecord,
  GateVeredict,
  SprintInfo,
  FinalReport,
} from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function calculateHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ── AuditReportRenderer ──────────────────────────────────────────────────────

export class AuditReportRenderer {
  /**
   * @description Renderiza un informe de gate individual en Markdown.
   */
  renderGateReport(
    record: GateRecord,
    version: string,
    fecha: string,
    task?: TaskContext
  ): string {
    const findingsTable = record.hallazgos.length > 0
      ? `| ID | Dimensión | Hallazgo | Severidad | Evidencia | Recomendación | Agente responsable |\n` +
        `|----|-----------|----------|-----------|-----------|---------------|--------------------|\n` +
        record.hallazgos.map(h =>
          `| ${h.id} | ${h.dimension} | ${h.hallazgo} | **${h.severidad}** | ${h.evidencia} | ${h.recomendacion} | ${h.agenteResponsable} |`
        ).join('\n')
      : '*Sin hallazgos*';

    const content = `---
title: "Informe de Gate: ${record.gate}"
version: "${version}"
fecha: "${fecha}"
tipo: "gate"
auditor: "${record.agente}"
veredicto: "${record.veredicto}"
tags:
  - auditoria
  - gate
  - ${record.gate.toLowerCase().replace(/\s+/g, '-')}
---

# 📋 Informe de Gate: ${record.gate}

> **Auditor:** ${record.agente}  
> **Fecha:** ${fecha}  
> **Versión del informe:** ${version}  
> **Veredicto:** ${record.veredicto === 'GO' ? '✅ APROBADO' : record.veredicto === 'NO-GO condicional' ? '⚠️ APROBADO CON CONDICIONES' : '❌ NO APROBADO'}

---

## Matriz de Hallazgos

${findingsTable}

${record.notas ? `\n## Notas\n\n${record.notas}\n` : ''}
${task ? `## Contexto de la Tarea\n\n- **Prompt:** ${task.rawPrompt}\n- **Tipo:** ${task.actionType}\n- **Domino(s):** ${task.domains.join(', ')}\n- **Nivel de Riesgo:** ${task.riskLevel}\n` : ''}

---

*Generado automáticamente por DeepSeek Code — Audit Reporter*
`;

    return this.wrapWithIntegrity(content, version, fecha);
  }

  /**
   * @description Renderiza el informe final multi-gate en Markdown.
   */
  renderFinalReport(report: FinalReport, version: string, fecha: string): string {
    const findingsMatrix = report.gates.flatMap(g =>
      g.hallazgos.map(h => ({ gate: g.gate, ...h }))
    );

    const reportContentForHash = JSON.stringify(report);
    const totalHash = calculateHash(reportContentForHash);

    const findingsTable = findingsMatrix.length > 0
      ? `| ID | Gate | Dimensión | Hallazgo | Severidad | Evidencia | Recomendación | Agente |\n` +
        `|----|------|-----------|----------|-----------|-----------|---------------|--------|\n` +
        findingsMatrix.map(h =>
          `| ${h.id} | ${h.gate} | ${h.dimension} | ${h.hallazgo} | **${h.severidad}** | ${h.evidencia} | ${h.recomendacion} | ${h.agenteResponsable} |`
        ).join('\n')
      : '*Sin hallazgos en ningún gate*';

    const riesgosTable = report.riesgos.length > 0
      ? `| Riesgo | Probabilidad | Impacto | Mitigación |\n` +
        `|--------|-------------|---------|------------|\n` +
        report.riesgos.map(r => `| ${r.riesgo} | ${r.probabilidad} | ${r.impacto} | ${r.mitigacion} |`).join('\n')
      : '*Sin riesgos acumulados*';

    const inmediatos = findingsMatrix.filter(h => h.severidad === 'critical' || h.severidad === 'high');
    const cortoPlazo = findingsMatrix.filter(h => h.severidad === 'medium');
    const medioPlazo = findingsMatrix.filter(h => h.severidad === 'low');

    const remediacion = `
### 🔴 Inmediato (${inmediatos.length})
${inmediatos.length > 0
  ? inmediatos.map(h => `- **${h.id}** (${h.gate}): ${h.hallazgo} → ${h.recomendacion} (_${h.agenteResponsable}_)`).join('\n')
  : '*No hay hallazgos críticos o altos pendientes*'}

### 🟡 Corto plazo (${cortoPlazo.length})
${cortoPlazo.length > 0
  ? cortoPlazo.map(h => `- **${h.id}** (${h.gate}): ${h.hallazgo} → ${h.recomendacion}`).join('\n')
  : '*No hay hallazgos medios pendientes*'}

### 🟢 Medio plazo (${medioPlazo.length})
${medioPlazo.length > 0
  ? medioPlazo.map(h => `- **${h.id}** (${h.gate}): ${h.hallazgo} → ${h.recomendacion}`).join('\n')
  : '*No hay hallazgos bajos pendientes*'}
`;

    const veredictoBlock = report.veredictoFinal === 'GO'
      ? `\`\`\`\n┌─────────────────────────────────────────────────────────────┐\n│                                                             │\n│   ✅   ✅   ✅   ✅                                         │\n│  🏷️  🏗️  🔐  🔍                                         │\n│                                                             │\n│              🚀 APTO PARA COMMIT                            │\n│                                                             │\n│  Sprint: ${report.sprint.name}                              │\n│  ${report.sprint.newFiles.length + report.sprint.modifiedFiles.length} archivos · 0 blockers · 0 vulnerabilidades    │\n│                                                             │\n└─────────────────────────────────────────────────────────────┘\n\`\`\``
      : `\`\`\`\n┌─────────────────────────────────────────────────────────────┐\n│                                                             │\n│   ⚠️   ⚠️   ⚠️                                             │\n│  🏷️  🏗️  🔐  🔍                                         │\n│                                                             │\n│           ⛔ NO APTO PARA COMMIT                            │\n│                                                             │\n│  Sprint: ${report.sprint.name}                              │\n│  ${inmediatos.length} blocker(s) · ${cortoPlazo.length} pendiente(s)    │\n│                                                             │\n└─────────────────────────────────────────────────────────────┘\n\`\`\``;

    const content = `---
title: "Informe Final Multi-Gate: ${report.sprint.name}"
version: "${version}"
fecha: "${fecha}"
tipo: "informe-final"
sprint: "${report.sprint.name}"
veredicto: "${report.veredictoFinal}"
hash_total: "${totalHash}"
tags:
  - auditoria
  - informe-final
  - ${report.sprint.name.toLowerCase().replace(/\s+/g, '-')}
---

# 📋 Informe Final Multi-Gate
## Sprint: ${report.sprint.name}

> **Versión del proyecto:** ${report.sprint.version}  
> **Versión del informe:** ${version}  
> **Fecha del informe:** ${fecha}  
> **SHA-256 total:** \`${totalHash}\`  
> **Propósito del sprint:** ${report.sprint.purpose}

---

${this.buildExecutiveSummary(report.sprint, report.veredictoFinal, report.gates)}

---

## 📊 Matriz de Hallazgos por Dimensión

${findingsTable}

---

## 📈 Riesgos Acumulados Top ${Math.min(report.riesgos.length, 5)}

${riesgosTable}

---

## 🛠️ Plan de Remediación Priorizado

${remediacion}

---

## ✅ Veredicto Final Multi-Gate

${veredictoBlock}

### Resumen para el Mensaje de Commit

\`\`\`
${report.sprint.name}: ${report.sprint.purpose}

${report.sprint.newFiles.map(f => `- ${f}`).join('\n')}
${report.sprint.modifiedFiles.map(f => `- ${f}`).join('\n')}
\`\`\`

---

## 📎 Historial de Gates

| Fecha | Gate | Auditor | Veredicto |
|-------|------|---------|-----------|
${report.gates.map(g => `| ${g.fecha} | ${g.gate} | ${g.agente} | ${g.veredicto} |`).join('\n')}

---

*Generado por DeepSeek Code — Sistema Multi-Agente · Audit Reporter*
*Agentes participantes: ${[...new Set(report.gates.map(g => g.agente))].join(', ')}*
*Última actualización: ${report.fecha} UTC*
`;

    return this.wrapWithIntegrity(content, version, fecha);
  }

  // ── Resumen Ejecutivo ─────────────────────────────────────────────────────

  /**
   * @description Construye el resumen ejecutivo del sprint.
   */
  buildExecutiveSummary(sprint: SprintInfo, veredictoFinal: GateVeredict, gates: GateRecord[]): string {
    const gatesSummary = gates.map(g =>
      `| ${g.gate} | ${g.veredicto === 'GO' ? '✅' : g.veredicto === 'NO-GO condicional' ? '⚠️' : '❌'} ${g.veredicto} | ${g.agente} |`
    ).join('\n');

    return `
## 🧭 Resumen Ejecutivo

| Gate | Estado | Auditor |
|------|--------|---------|
${gatesSummary}
| 🚀 **Veredicto Final** | **${veredictoFinal === 'GO' ? '✅ APTO PARA COMMIT' : veredictoFinal === 'NO-GO condicional' ? '⚠️ NO-GO CONDICIONAL' : '❌ NO-GO'}** | — |

### 📦 Cambios en el Sprint (${sprint.newFiles.length + sprint.modifiedFiles.length} archivos)

**Propósito:** ${sprint.purpose}

**🔵 Nuevos archivos (${sprint.newFiles.length}):**
${sprint.newFiles.map(f => `- \`${f}\``).join('\n')}

**🟡 Archivos modificados (${sprint.modifiedFiles.length}):**
${sprint.modifiedFiles.map(f => `- \`${f}\``).join('\n')}

**🧪 Tests:** ${sprint.testCount} tests · ${sprint.testTime}
`;
  }

  // ── Integridad ─────────────────────────────────────────────────────────────

  /**
   * @description Envuelve el contenido con hash SHA-256 y metadatos de integridad.
   */
  private wrapWithIntegrity(content: string, version: string, fecha: string): string {
    const hash = calculateHash(content);
    return `**SHA-256:** \`${hash}\`  \n**Versión del informe:** ${version}  \n**Fecha:** ${fecha}  \n\n---\n\n${content}`;
  }
}
