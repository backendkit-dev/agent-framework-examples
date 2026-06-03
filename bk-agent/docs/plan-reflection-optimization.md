# Plan: Optimizacion del Reflection Engine

**Estado general:** Completado (TASK-08 omitida — customExpression ya eliminado en TASK-07)  
**Ultima actualizacion:** 2026-05-09  
**Autor:** mairon cuello + Claude Sonnet 4.6  

### Correccion al diagnostico inicial

Al leer el codigo real se encontro que TASK-01 y TASK-02 ya estaban implementadas antes de este plan:
- `Orchestrator.updateRules()` existe en `src/orchestrator/index.ts:440`
- `loadManifestPolicyRules()` lee `manifest.yaml` en cada llamada a `orchestrate()` — el reload ya es dinamico
- La arquitectura separa correctamente `policy-rules.yaml` (reglas manuales, startup) de `manifest.yaml` (auto-promovidas, runtime)

El bug real encontrado: `PolicyCondition.customExpression` existia en el tipo pero `matchesCondition()` lo ignoraba silenciosamente — una policy con solo ese campo matcheaba todos los tasks. Resuelto con soporte `keywords` (ver nota en TASK-01).


---

## Diagnostico inicial

El Reflection Engine tiene una arquitectura solida (MAPE-K, 5 dominios, 40 failureTypes) pero opera al ~30% de su potencial real. Los problemas no son de diseno sino de integracion:

| Problema | Impacto |
|---|---|
| Policies se cargan solo al inicio (require reinicio) | El aprendizaje no aplica en la sesion actual |
| AgentHook no esta cableado al ResponseEvaluator | El dominio mas critico no recibe datos |
| TestHook no tiene reporter de Jest | test-domain nunca acumula incidentes reales |
| Policies promovidas son demasiado genericas | No agregan valor diferencial al Orchestrator |
| Deteccion por keywords tiene falsos positivos | Clasificacion erronea de incidentes |
| AuditHook: completeSprint() rara vez se llama | audit-domain recibe pocos datos reales |

---

## Leyenda de estado

- `[ ]` Pendiente
- `[~]` En progreso
- `[x]` Completado
- `[!]` Bloqueado (depende de otra tarea)

---

## Prioridad 1 — Recarga dinamica de policies (impacto inmediato, esfuerzo bajo)

### TASK-01: Agregar `updateRules()` al Orchestrator

**Estado:** `[x]`  
**Completado:** pre-existente en `src/orchestrator/index.ts:440`

**Nota:** Ya implementado. Adicionalmente se agrego soporte `keywords` en `PolicyCondition` y `matchesCondition()` (commit `feat(orchestrator): add keywords condition to policy engine`) que habilita TASK-07/08 y corrige el bug del `customExpression` silencioso.

---

### TASK-02: Recargar manifest antes de cada `processInput`

**Estado:** `[x]`  
**Completado:** pre-existente en `src/orchestrator/index.ts` via `loadManifestPolicyRules()`

**Nota:** Ya implementado. `Orchestrator.orchestrate()` llama `loadManifestPolicyRules()` en cada ejecucion, que lee `~/.deepseek-code/manifest.yaml` desde disco. Las policies auto-promovidas por PolicyPromoter durante la sesion se recogen en el siguiente mensaje sin reiniciar.

---

## Prioridad 2 — Cablear AgentHook al ResponseEvaluator (impacto alto, esfuerzo medio)

### TASK-03: Conectar ResponseEvaluator → AgentHook

**Estado:** `[x]`  
**Completado:** `src/agent/loop.ts` — reporta `response_rejected_by_evaluator` y `agent_hallucination` al agentHook cuando el evaluador rechaza la respuesta  
**Archivos:** `src/agent/evaluation/index.ts`, `src/agent/loop.ts`, `bin/cli.ts`

**Problema:** `ResponseEvaluator` detecta problemas en las respuestas del agente pero no los reporta al ReflectionEngine. Los eventos `response_rejected_by_evaluator` y `wrong_agent_selected` nunca se persisten.

**Implementacion:**

Opcion A — Callback en AgentLoop:
```typescript
// AgentLoopOptions
onEvaluationIssue?: (issue: EvaluationIssue, agentId: string) => void;

// bin/cli.ts
onEvaluationIssue: (issue, agentId) => {
    agentHook.reportAgentFailure(
        issue.description,
        agentId,
        [],
        'response_rejected_by_evaluator',
        'agent'
    );
},
```

Opcion B — Inyectar AgentHook directamente en AgentLoop (mas acoplado, no recomendada).

**Reportar tambien:** En `onAgentRouting` cuando el router detecta que el agente seleccionado no coincide con el dominio esperado.

**Criterio de completitud:** Despues de 3 rechazos del evaluator para el mismo agente, el catalogo muestra un patron en agent-domain.

---

### TASK-04: Reportar `wrong_agent_selected` en el router

**Estado:** `[x]`  
**Completado:** `src/agent/loop.ts` — en el callback de routing, detecta cuando el router elige un agente fuera de la recomendacion del orquestador  
**Archivos:** `src/agent/routing/index.ts`, `src/agent/loop.ts`  
**Depende de:** TASK-03

**Problema:** El AgentRouter cambia de agente cuando detecta mismatch, pero no registra ese evento como incidente.

**Implementacion:** En `AgentRouter.route()`, cuando el agente seleccionado difiere del actual y el motivo es dominio-incompatible, emitir via callback.

**Criterio de completitud:** El catalogo acumula eventos `wrong_agent_selected` cuando el router hace switching por incompatibilidad de dominio.

---

## Prioridad 3 — TestHook via Jest reporter (impacto alto, esfuerzo medio)

### TASK-05: Crear Jest custom reporter para TestHook

**Estado:** `[x]`  
**Completado:** `scripts/jest-reflection-reporter.js` + `jest.config.js` — onTestResult reporta fallos de suite via bridge  
**Archivos:** `scripts/jest-reflection-reporter.js` (nuevo), `jest.config.js`

**Problema:** `test-domain` nunca recibe datos porque Jest no llama automaticamente al TestHook. Se necesita un reporter customizado.

**Implementacion:**

```javascript
// scripts/jest-reflection-reporter.mjs
export default class ReflectionReporter {
    async onTestSuiteResult(_suite, result) {
        if (!result.failureMessage) return;
        await exec(`node scripts/reflection-commit-bridge.mjs \
            --type test \
            --message "${result.failureMessage.slice(0, 200)}" \
            --files "${result.testFilePath}"`);
    }

    async onRunComplete(_contexts, results) {
        if (results.numFailedTestSuites === 0) return;
        // reportar cobertura si esta por debajo del threshold
    }
}
```

```javascript
// jest.config.js — agregar:
reporters: ['default', '<rootDir>/scripts/jest-reflection-reporter.mjs'],
```

**Criterio de completitud:** Despues de 3 fallos del mismo test suite, el catalogo muestra patron en test-domain y se promueve policy.

---

### TASK-06: Reportar cobertura baja automaticamente

**Estado:** `[x]`  
**Completado:** `scripts/jest-reflection-reporter.js` — onRunComplete detecta archivos bajo threshold y los reporta via bridge  
**Archivos:** `scripts/jest-reflection-reporter.js`  
**Depende de:** TASK-05

**Implementacion:** En `onRunComplete`, si `results.coverageMap` existe y hay archivos por debajo del threshold, llamar:

```javascript
await exec(`node scripts/reflection-commit-bridge.mjs \
    --type coverage \
    --message "Coverage ${actual}% < threshold ${threshold}%" \
    --files "${lowCoverageFiles.join(',')}"`);
```

**Criterio de completitud:** Fallos de cobertura se acumulan en test-domain con failureType `coverage_below_threshold`.

---

## Prioridad 4 — Mejorar calidad de policies promovidas

### TASK-07: Policies con condiciones especificas por keywords

**Estado:** `[x]`  
**Completado:** `src/reflection/policy-promoter.ts` — KEYWORD_MAP con 40 failureTypes, buildCondition() reescrito  
**Archivos:** `src/reflection/policy-promoter.ts`

**Problema:** `buildCondition()` genera condiciones por dominio+actionType pero no por contenido del mensaje. Una policy de `hardcoded_secret` deberia dispararse cuando el mensaje menciona credenciales, no en toda tarea `high` risk.

**Implementacion:**

```typescript
// policy-promoter.ts — buildCondition()
private buildCondition(pattern: DetectedPattern): PolicyCondition {
    const keywordMap: Record<string, string[]> = {
        'hardcoded_secret':      ['password', 'secret', 'api_key', 'token', 'credential'],
        'missing_rollback':      ['transaccion', 'transaction', 'base de datos', 'database'],
        'security_vulnerability':['seguridad', 'auth', 'jwt', 'oauth', 'vulnerabilidad'],
        'tsc_noEmit_type_error': ['typescript', 'types', 'compile'],
        'architecture_violation':['arquitectura', 'capa', 'modulo', 'dependencia'],
    };

    const keywords = keywordMap[pattern.failureType];
    return {
        domain: pattern.domain,
        ...(keywords?.length ? { customExpression: `keywords: [${keywords.join(', ')}]` } : {}),
        riskLevel: pattern.severity === 'Critica' ? 'critical' : 'high',
    };
}
```

**Criterio de completitud:** Una policy de `hardcoded_secret` solo dispara cuando el mensaje del usuario contiene palabras clave relevantes.

---

### TASK-08: Que PolicyEngine consuma `customExpression` de keyword matching

**Estado:** `[x]`  
**Esfuerzo:** 3-4h  
**Archivos:** `src/orchestrator/policy-engine.ts`  
**Depende de:** TASK-07

**Nota:** Resuelta indirectamente en TASK-07. PolicyPromoter ya no genera `customExpression` — usa `keywords[]` nativo que `matchesCondition()` evalua desde TASK-01. No requiere cambios adicionales.

**Problema original:** Aunque PolicyPromoter genere `customExpression`, PolicyEngine no evalua ese campo actualmente.

**Implementacion:** En `PolicyEngine.evaluate(task, userMessage)`, parsear `customExpression: "keywords: [...]"` y evaluar contra el mensaje del usuario:

```typescript
private matchesCustomExpression(expr: string, userMessage: string): boolean {
    const match = expr.match(/^keywords:\s*\[(.+)\]$/);
    if (!match) return false;
    const keywords = match[1].split(',').map(k => k.trim().toLowerCase());
    const msg = userMessage.toLowerCase();
    return keywords.some(kw => msg.includes(kw));
}
```

**Criterio de completitud:** Las policies generadas por el engine aplican selectivamente segun el contenido del mensaje.

---

## Prioridad 5 — Corregir deteccion de failureType

### TASK-09: Agregar contexto negativo en `detectAuditFailureType`

**Estado:** `[x]`  
**Completado:** `matchesWithoutNegation()` + `NEGATORS` en audit-domain.ts y test-domain.ts  
**Archivos:** `src/reflection/domains/audit-domain.ts`, `src/reflection/domains/test-domain.ts`

**Problema:** La deteccion por substring produce falsos positivos. "verificar que no hay secrets" se clasifica como `hardcoded_secret`. "no hay rollback en esta version" como `missing_rollback`.

**Implementacion:**

```typescript
// Reemplazar busqueda simple por funcion con contexto negativo
function containsWithoutNegation(text: string, keywords: string[]): boolean {
    const negators = ['no hay', 'sin ', 'no tiene', 'verificar', 'validar', 'evitar'];
    const lower = text.toLowerCase();
    return keywords.some(kw => {
        const idx = lower.indexOf(kw);
        if (idx === -1) return false;
        const prefix = lower.slice(Math.max(0, idx - 20), idx);
        return !negators.some(neg => prefix.includes(neg));
    });
}
```

**Criterio de completitud:** Hallazgos que mencionan issues para evitar (no afirmaciones) no se clasifican como incidentes.

---

## Prioridad 6 — Completar integracion de AuditHook

### TASK-10: Asegurar que `completeSprint()` se llama al finalizar gates

**Estado:** `[x]`  
**Esfuerzo:** 2h  
**Archivos:** `src/agent/loop.ts`, `src/orchestrator/audit-reporter.ts`

**Problema:** `AuditReporter.completeSprint()` (que llama a `AuditReflectionBridge`) rara vez se invoca en el flujo real. Los hallazgos de los gates de auditoría no llegan al catalogo.

**Implementacion:** En `AgentLoop`, despues de ejecutar todos los `requiredGates`, llamar:

```typescript
if (this.options.orchestrator?.auditReporter && gatesExecuted.length > 0) {
    await this.options.orchestrator.auditReporter.completeSprint(gatesExecuted).catch(() => {});
}
```

**Criterio de completitud:** Despues de ejecutar un gate de security o QA, los hallazgos aparecen en el catalogo de audit-domain.

---

## Prioridad 7 — Observabilidad del engine

### TASK-11: Comando `/reflection` en la CLI

**Estado:** `[x]`  
**Esfuerzo:** 2h  
**Archivos:** `bin/cli.ts`

**Problema:** No hay forma de ver el estado del Reflection Engine desde la sesion interactiva. El desarrollador no sabe si hay patrones cerca del umbral o reglas ya promovidas.

**Implementacion:** Agregar slash command `/reflection` que muestre:

```
📊 Reflection Engine — Estado

Incidentes totales: 12
Sin resolver:       8

Por dominio:
  audit    4 incidentes · 1 patron
  commit   6 incidentes · 2 patrones → 1 regla promovida
  agent    2 incidentes
  test     0 incidentes
  bootstrap 0 incidentes

Patrones cerca del umbral (2/3):
  commit · missing_type (2 ocurrencias)
  audit  · missing_test_coverage (2 ocurrencias)

Reglas promovidas activas: 1
  POL-COMMIT-001 · typecheck_failed_before_commit
```

**Criterio de completitud:** `/reflection` muestra el estado real del engine con datos del catalogo.

---

### TASK-12: Log de aplicacion de policies en consola

**Estado:** `[x]`  
**Esfuerzo:** 1h  
**Archivos:** `src/orchestrator/policy-engine.ts`, `bin/cli.ts`

**Problema:** Cuando una policy se aplica a una tarea, no hay feedback visible al usuario. El aprendizaje es invisible.

**Implementacion:** `PolicyEngine.evaluate()` deberia retornar las reglas que matchearon. En cli.ts mostrar brevemente: `[policy] POL-AUDIT-001 activa — gate de security requerido`.

**Criterio de completitud:** El usuario ve cuando una policy auto-generada esta afectando el comportamiento del agente.

---

## Resumen de tareas

| ID | Descripcion | Prioridad | Esfuerzo | Estado | Depende de |
|---|---|:---:|:---:|:---:|---|
| TASK-01 | `updateRules()` en Orchestrator | P1 | 2h | `[x]` | — |
| TASK-02 | Recarga dinamica del manifest | P1 | 30m | `[x]` | TASK-01 |
| TASK-03 | ResponseEvaluator → AgentHook | P2 | 4h | `[x]` | — |
| TASK-04 | `wrong_agent_selected` en router | P2 | 1h | `[x]` | TASK-03 |
| TASK-05 | Jest reporter para TestHook | P3 | 4h | `[x]` | — |
| TASK-06 | Reporte de cobertura baja | P3 | 1h | `[x]` | TASK-05 |
| TASK-07 | Policies con keywords especificos | P4 | 6h | `[x]` | — |
| TASK-08 | PolicyEngine consume customExpression | P4 | 4h | `[x]` | TASK-07 |
| TASK-09 | Deteccion sin falsos positivos | P5 | 2h | `[x]` | — |
| TASK-10 | `completeSprint()` al finalizar gates | P6 | 2h | `[x]` | — |
| TASK-11 | Comando `/reflection` en CLI | P7 | 2h | `[x]` | — |
| TASK-12 | Log visible de policies aplicadas | P7 | 1h | `[x]` | TASK-08 |

**Esfuerzo total estimado:** ~30h  
**Impacto esperado al completar P1+P2:** El engine aplica lo aprendido en la misma sesion.  
**Impacto esperado al completar P1-P4:** Los 3 dominios criticos (agent, commit, test) reciben datos reales.  
**Impacto esperado al completar todo:** El sistema opera al 90%+ de su potencial — aprendizaje real, policies especificas, observabilidad completa.

---

## Orden de ejecucion recomendado

```
TASK-01 → TASK-02        (P1: feedback loop real-time — 2.5h)
TASK-09                  (P5: calidad de datos — 2h, hace el resto mas valioso)
TASK-03 → TASK-04        (P2: AgentHook — 5h)
TASK-05 → TASK-06        (P3: TestHook — 5h)
TASK-10                  (P6: AuditHook — 2h)
TASK-07 → TASK-08        (P4: policies especificas — 10h)
TASK-11 → TASK-12        (P7: observabilidad — 3h)
```

La secuencia prioriza primero hacer funcionar el feedback loop (TASK-01/02), luego mejorar la calidad de los datos (TASK-09), y finalmente conectar las fuentes de datos (TASK-03/04/05/06/10). Las mejoras de policy (TASK-07/08) y observabilidad (TASK-11/12) van al final porque dependen de que haya datos reales acumulados.
