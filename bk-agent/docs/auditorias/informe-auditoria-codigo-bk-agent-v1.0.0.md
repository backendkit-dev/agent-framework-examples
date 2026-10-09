---
title: "Auditoría de código — bk-agent (BackendKit Agent)"
version: "v1.0.0"
fecha: "2026-10-07"
tipo: "informe-auditoria-estatica"
veredicto: "NO-GO para release (GO condicional como CLI delgado)"
---

# 📋 INFORME DE AUDITORÍA DE CÓDIGO — bk-agent

> **Estado: remediado parcialmente (2026-10-09).** El código inalcanzable se archivó
> en `legacy/` y se cerraron los hallazgos `[VIVO]` C-2, A-5, A-10, A-11, M-1, M-2,
> M-4, M-5, M-6, M-8, M-13, M-14 y M-16. Ver
> [remediacion-v1.0.0.md](remediacion-v1.0.0.md) y
> [ADR-002](../adr/ADR-002-bk-agent-cli-delgado.md).
> **Las métricas de este informe corresponden al estado auditado (antes de la remediación).**

## 1. RESUMEN EJECUTIVO

- **Puntuación de Salud General: 4.5/10**
- **Riesgo principal:** el 76% del código fuente (21.706 de 28.688 líneas, 106 de 138 archivos) **no es alcanzable desde el único binario publicado** (`bin/cli.ts`). Es una réplica obsoleta de módulos que hoy viven en `@backendkit-labs/agent-core` / `agent-coding`. La documentación (README, `AGENT.md`, `documentation/14-architecture.md`), 32 de las 46 suites de test y los informes de auditoría previos describen y validan un producto que **ya no es el que se ejecuta**. En la superficie realmente viva, el modo `--headless` auto-aprueba todas las aprobaciones (escrituras y comandos), el sandbox de rutas es léxico (bypass por junction/symlink) y la allowlist de comandos incluye intérpretes (`node`, `npx`, `python`) y `docker`.
- **Tiempo estimado de refactorización: 3–4 sprints.** 1 sprint para higiene (borrado de código muerto, CI, lint, `.gitignore`, `.git`) y 2–3 sprints para cerrar la brecha documentación↔código↔tests y endurecer la superficie de ejecución.
- **Alcance y método:** 186 archivos TypeScript; 30.729 líneas en `src/` + `bin/` (28.688 + 2.041); análisis de alcanzabilidad por grafo de imports; ejecución real de la suite con cobertura (`npx jest --coverage`, 712 tests en 43 s); lectura cruzada del runtime efectivo en `node_modules`; **verificación adversarial** de cada hallazgo (7 auditores por subsistema con verificador independiente + 5 auditorías de contraste focalizadas; 18 agentes en total). Los hallazgos se etiquetan **[VIVO]** (alcanzable desde `bin/cli.ts`) o **[LATENTE]** (código muerto respecto del binario).

> **Cómo leer este informe:** los hallazgos `[LATENTE]` no son explotables hoy por el binario, pero son deuda que se copia al framework (varias de estas piezas ya existen duplicadas allí) y volverán a estar vivas si alguien re-cablea `src/`. Los `[VIVO]` afectan al usuario que ejecuta `bk-agent` hoy.

---

## 2. HALLAZGOS POR NIVEL DE CRITICIDAD

### 🔴 CRÍTICOS

#### C-1. El 76% del repositorio es código muerto: el binario ejecuta el framework, no `src/`

- **Ubicación:** `bin/cli.ts:544-590` (todo el runtime), `src/agent/loop.ts` (1.110 líneas), `src/orchestrator/**`, `src/reflection/**`, `src/agent/commit/**`, `src/config/seed-config.ts`, `src/skills/builtin/index.ts`.
- **Evidencia (verificada por grafo de imports):**

```
ENTRYPOINTS: bin/cli.ts
src files: 138 | reachable: 32 | unreachable: 106
src lines: 28688 | reachable: 6982 | unreachable: 21706 (76%)
```

```ts
// bin/cli.ts:544  — no existe ninguna opción `tools`/`extraSkills` en CodingEngineOptions
const engine = createCodingEngine({
    providers, defaultProvider, appName: 'bk-agent', workingDir: cwd, transport,
    orchestration: { enableQA: options.qa !== false, noQA: options.qa === false, onQAReview: handleQAReview },
    maxIterations,
    onIterationLimit: ..., onStep: ..., onToolApproval: ...,
});
```

`bin/cli.ts` **no importa** `AgentLoop`, `tool-executor` ni `getToolDefinitions()`. La palabra `reflection` **no aparece ni una vez** en `bin/cli.ts`. `registerBuiltinHandlers()` (`bin/cli.ts:796`, `2001`) puebla un registry (`src/skills/registry.ts`) cuyo **único consumidor es `src/agent/tool-executor.ts`** (llamado sólo desde `src/agent/loop.ts:297`), y ese loop sólo lo usan `src/research/research-loop.ts` y los tests. El runtime real son los 13 `CODING_TOOLS` del framework (`read_file`, `write_file`, `edit_file`, `list_directory`, `run_command`, `search_files`, `save_context`, `save_learning`, `save_audit`, `get_latest_audit`, `list_audits`, `save_user_preference`, `update_session` + `ask_agent` inyectado por el engine).
- **Evidencia de duplicación (no es código en desuso por azar, es una copia superseded):** `src/reflection/policy-promoter.ts` y `node_modules/@backendkit-labs/agent-core/dist/reflection/policy-promoter.js` contienen **las mismas 41 entradas de `KEYWORD_MAP`** (mismos 40 failureTypes y mismas palabras clave); `historical-loader` 503 vs 462 líneas, `reflection-engine` 404 vs 352, `orchestrator` 471 vs 414, `audit-reporter` 376 vs 322.
- **Impacto:** cada corrección de seguridad o bug se aplica (o no) en dos implementaciones; el equipo audita, testea y documenta código que nadie ejecuta; el `dist/` publica un binario cuyo comportamiento no se corresponde con `src/`. Es la causa raíz de casi todos los demás hallazgos latentes.
- **Solución propuesta:**
  1. Decidir el contrato de una vez: **bk-agent = CLI delgado** sobre el framework (recomendado) y borrar/`archive/` las ramas `src/agent/{loop,agent-loop,evaluation,qa,routing,commit}`, `src/orchestrator/**`, `src/reflection/**`, `src/context/**`, `src/vault/{index-reader,profiler}.ts`, `src/config/seed-config.ts`, `src/bootstrap/global-seed.ts`, `src/skills/{builtin,handlers}` (salvo lo que se re-cablee).
  2. Añadir un test de arquitectura que falle si `src/` vuelve a divergir: p. ej. un script en CI que compare el grafo de alcanzabilidad o que verifique que ningún módulo nuevo es inalcanzable.
  3. Si en cambio `src/` es una librería para terceros, exportarla de verdad en `src/index.ts` (hoy exporta sólo 5 símbolos) y sacarla del paquete del CLI.

#### C-2. `--headless` auto-aprueba todas las aprobaciones: ejecución silenciosa de comandos y escrituras

- **Ubicación:** `bin/cli.ts:581-583` y `bin/cli.ts:796-804`; `node_modules/@backendkit-labs/agent-core/dist/engine/ApprovalGate.js:12,45`.
- **Código problemático:**

```ts
// bin/cli.ts:581
onToolApproval: async (toolName, agentId, argsPreview) => {
    if (agentEvents.isHeadless()) return 'approve';   // ← sin preguntar nunca
```
```js
// ApprovalGate.js
static WRITE_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);
check(...) { if (!this.opts.onToolApproval) return 'run'; ... }
```
- **Impacto:** en `--headless` (el modo que consume el frontend por stdin JSON-Lines, documentado en `documentation/11-plugins-mcp.md`) ninguna escritura ni comando se confirma. Como el contenido del repositorio es entrada no confiable para el modelo (READMEs, issues, resultados de tools), una inyección de prompt se traduce en `run_command` silencioso. La allowlist del framework incluye `node`, `npx`, `python`, `docker`, `kubectl`, `curl`, `xargs`, `chmod`, `icacls`: con `node -e "..."` el allowlist deja de ser una barrera. Es una decisión de diseño, pero **no está documentada como tal ni es opt-in**.
- **Solución:** mantener la aprobación en headless por defecto y exponer un flag explícito y ruidoso (`--dangerously-auto-approve`), con allowlist de comandos propia por sesión y un log de auditoría de cada `run_command` aprobado automáticamente.

#### C-3. Documentación, tests y auditorías describen un producto que no existe

- **Ubicación:** `README.md:42,537,580`; `AGENT.md:52-61`; `documentation/01-overview.md`, `documentation/14-architecture.md:216-246`; `jest.config.js:51-56`; `tests/**`.
- **Evidencia:**

| Afirmación | Estado real |
|---|---|
| `README.md:42,580` "**Reflection Engine** — auto-aprendizaje: patrones de error → políticas automáticas" | No activo: `bin/cli.ts` no pasa `reflection` a `orchestration` y no contiene la palabra "reflection"; `src/reflection/**` (≈3.5k líneas) es inalcanzable |
| `README.md:537` "Command execution (`execute_command`)" | El modelo nunca ve `execute_command`; la tool viva es `run_command` del framework |
| `AGENT.md:52-61` tabla de comandos `nestjs.generateModule`, `generateSecurityMiddleware`, … | Existen como handlers en un registry inalcanzable; no son tools del modelo |
| `documentation/14-architecture.md:216-246` grafo de módulos `bin/cli.ts → src/orchestrator, src/agent/routing, src/reflection, src/memory/updater` | Falso: el CLI sólo importa `src/ui`, `src/memory/updater` (checkpoints), `src/bootstrap/memory-loader`, `src/skills/loader`, `src/types/config`, `src/shared/utils/encoding` y los handlers inalcanzables |
| `documentation/01-overview.md:104-113` "Skills YAML / Vault Skills" | El motor carga skills de `~/.bk-agent/skills/global` y `/packs`; el CLI lista y **escribe** en `~/.bk-agent/skills` (raíz), que el motor no lee |
| `jest.config.js:51-56` `collectCoverageFrom: ['src/**/*.ts', …, '!src/bin/**']` | `bin/cli.ts` (2.041 líneas, el 100% de la superficie viva) **no se mide**; `!src/bin/**` no matchea nada porque `bin/` está en la raíz |
| `docs/auditorias/auditoria-arquitectonica-completa-v1.0.0.md` "Security · Agente security · ✅ GO · 0 hallazgos" | Es una auto-auditoría circular: ese mismo informe lista "Reflection Engine" como uno de los gates, es decir, el producto auditándose a sí mismo |

- **Impacto:** un onboarding nuevo (humano o agente) toma decisiones sobre una arquitectura inexistente; la cobertura del 58% da falsa confianza porque 32 de 46 suites validan módulos que el binario no ejecuta.
- **Solución:** un solo árbol de documentación (`documentation/`), generado o verificado contra el código; borrar `docs/` duplicado y `processed/`/`failed/`; añadir `bin/cli.ts` a `collectCoverageFrom` y un test de contrato del protocolo headless (JSON-Lines) como primera suite.

#### C-4. El motor de auto-aprendizaje convierte texto no confiable en reglas ejecutables (y puede autobloquearse para siempre)

- **Ubicación:** `src/orchestrator/audit/audit-report-renderer.ts:43`, `src/reflection/historical-loader.ts:342`, `src/reflection/reflection-engine.ts:166-194`, `src/reflection/policy-promoter.ts:114-117,205`, `src/orchestrator/audit/audit-ci-blocker.ts:38,44-57`, `src/orchestrator/index.ts:463-465`, `src/orchestrator/policy-engine.ts:245` `[LATENTE]` (duplicado dentro de `@backendkit-labs/agent-core`, por lo que el riesgo viaja con el framework)
- **Código problemático:**

```ts
// audit-report-renderer.ts:43 — el hallazgo viene del review del LLM (qa-service.ts:252),
// se serializa a una tabla markdown sin escapar '|' ni saltos de línea
`| ${h.id} | ${h.dimension} | ${h.hallazgo} | **${h.severidad}** | ${h.evidencia} |`
```
```ts
// policy-promoter.ts:114 — un YAML ilegible se convierte en {} y luego se reescribe el archivo completo
} catch { return {}; }        // …:205  await this.writeManifest(manifest)  → borra orquestador/capabilityMatrix/agents/skills
```
```ts
// audit-ci-blocker.ts:38 — basta que exista el archivo para bloquear; nada lo borra nunca
if (files.some(f => f.startsWith('pending-issues') && f.endsWith('.md'))) return true;
```
- **Impacto:** (1) **Envenenamiento de políticas:** un `hallazgo`/`evidencia` con `|` y saltos de línea inyecta filas falsas en el informe; `historical-loader.ts:342` (`if (parts.length < 7) return null`) las acepta como hallazgos reales, con `severidad` y `failureType` elegidos por el texto inyectado; 3 filas iguales superan el gate de `reflection-engine.ts:172` y escriben una `policyRule` **en el manifest global**, endureciendo gates para todos los proyectos y sin aprobación humana. (2) **Pérdida de configuración global:** cualquier error de lectura del manifest (`yaml.parse` o permisos) hace que el promoter reescriba el archivo con sólo `policyRules`, borrando `orquestador`, `capabilityMatrix`, `agents` y `skills` (`stage-manifest.ts:4`). (3) **Autobloqueo irreversible:** `pending-issues*.md` nunca se borra, `audit-finding-tracer.ts:64` lo excluye, y `audit-ci-blocker` también falla abierto (`catch { return false; }`), mientras la detección de críticos busca `**Crítica|Alta**` que el renderer nunca emite (emite `**critical**`/`**high**`): no bloquea cuando debería y bloquea para siempre cuando no debería. Sumado a `policy-engine.ts:245` (`return true` con condición vacía, que `policy-promoter.ts:270` genera siempre) y a policyRules sin whitelist de campos ni tope (`src/orchestrator/index.ts:463-465`), el propio agente termina autoconfigurando los controles que lo auditan.
- **Solución:** escapar `|`/saltos al renderizar y parsear el informe con estructura (frontmatter/JSON), no con tablas markdown; **exigir aprobación humana o firma antes de promover una política** y aplicar las auto-generadas sólo al proyecto que las produjo; abortar la escritura del manifest si la lectura falla, validar esquema y escribir sólo la clave `policyRules` con backup; calcular el bloqueo de CI desde hallazgos abiertos (no desde la existencia de un archivo) y con fail-closed; lock + `tmp` único (hoy `atomic-write.ts:27` usa `${filePath}.tmp` fijo, así que dos procesos se pisan) en la promoción.

---

### 🟠 ALTOS

#### A-1. Sandbox de rutas léxico (sin `realpath`) + allowlist de comandos con intérpretes

- **Ubicación:** `node_modules/@backendkit-labs/agent-coding/dist/tools/path-sandbox.js:17-48`; `.../run-command.js:12-42`; `src/skills/handlers/path-allowlist.ts:24-31` (variante local, también léxica).
- **Código problemático:**

```js
// path-sandbox.js — único guard de rutas del camino vivo
const abs = resolve(cwd, filePath);
const isInside = (root) => norm(abs) === norm(root) || norm(abs).startsWith(prefix);
if (isInside(cwd)) return abs;
throw new Error(`Access denied: ...`);   // nunca hay fs.realpath / lstat
```
```js
// run-command.js — allowlist de binarios
const COMMAND_ALLOWLIST = new Set([ 'node','npm','npx','yarn','pnpm','bun','tsx', ..., 'python','pip','go','cargo','docker','kubectl','helm','curl','wget','rm','chmod','xargs','icacls', ... ]);
```
- **Impacto:** (1) un **junction/symlink** dentro del `workingDir` (creable por el propio agente, porque `node` está permitido) hace que `readFile`/`writeFile` operen fuera del proyecto: lectura/escritura arbitraria del disco del usuario. (2) La allowlist es un filtro de *nombres de binario*, no un sandbox: `node -e`, `npx`, `python -c`, `docker run -v C:\:/host` y `find . -exec` la atraviesan trivialmente. Se documenta como "seguridad" en `documentation/14-architecture.md:312-324` ("Execution Sandbox"), lo que no se corresponde con la implementación.
- **Solución:** canonicalizar con `fs.realpath` (y comparar por `path.relative`, no por prefijo) antes de aceptar la ruta; tratar la allowlist como conveniencia y, si se quiere contención real, ejecutar comandos en un contenedor/proceso sin privilegios con el proyecto montado en sólo lectura+escritura de su carpeta.

#### A-2. `read_file` no tiene guard de rutas sensibles: `.env` y secretos del proyecto van al modelo sin aprobación

- **Ubicación:** `node_modules/@backendkit-labs/agent-coding/dist/tools/read-file.js:19-26`; contraste con el código muerto que **sí** lo implementaba: `src/skills/handlers/builtins.ts:57-60` + `src/skills/handlers/command-classifier.ts:6` (`SENSITIVE_PATH_BASE` con `password|credential|secret|id_rsa|\.env|\.ssh|\.pem|credentials.json|service-account.json|kubeconfig`).
- **Código problemático:**

```js
// read-file.js (VIVO)
const abs = resolveAndCheck(ctx.workingDir, file_path, ctx.additionalRoots ?? []);
return readFileSync(abs, 'utf-8');     // sin guard de ruta sensible, y read_file no está en WRITE_TOOLS
```
- **Impacto:** `read_file .env` (o `.ssh/id_rsa` si el proyecto lo contiene) se envía al proveedor del modelo y puede terminar persistido en `~/.deepseek-code/projects/{key}/memory/*.md`, sin confirmación y sin aviso. Es el hallazgo de mayor impacto práctico en el camino vivo: la mitigación existía, se escribió, y quedó en el árbol muerto.
- **Solución:** portar `SENSITIVE_PATH_BASE` al `read_file` vivo (y a `edit_file`/`write_file`, que tampoco lo tienen), con confirmación obligatoria + redacción del contenido en el evento del protocolo. Alternativa mejor: que el motor del framework exponga el mismo `isSensitivePath` que el registry local ya tenía.

#### A-3. Los gates de arquitectura/seguridad/QA se auto-aprueban con veredicto `GO` sin revisión

- **Ubicación:** `src/agent/agent-loop/qa-orchestrator.ts:43-74` `[LATENTE]`
- **Código problemático:**

```ts
const hasSubstantialCode = qaService.countCodeLines(clean) >= 8;
...
reporter.recordGate(gate.gateName, gate.agentId, 'GO', [], orchestrationResult.task,
    `Gate automatico: ${gate.gateName} (ruta sin revisiones pendientes)`, true);
```
- **Impacto:** con sólo 8 líneas de código en la respuesta, el FSM avanza `design_review → security_review → qa_review` y persiste tres registros de auditoría con veredicto `GO`, hallazgos vacíos y agentes (`architecture-agent`, `security-agent`, `qa-engineer`) **que nunca ejecutaron nada**. Es acreditación falsa de controles: explica por qué `docs/auditorias/*` puede declarar "Security: GO, 0 hallazgos" mientras el código tiene los bypasses de A-1/A-2. El mismo diseño se copió a `agent-core`.
- **Solución:** no registrar gates por heurística de conteo. Exigir evidencia verificable (ejecución real del especialista o artefacto de review con hallazgos) y usar `pendiente`/`NO-GO` cuando el gate no se ejecutó, nunca `GO` hardcodeado. Separar modelo/rol revisor del autor.

#### A-4. Commit gate y orquestador *fail-open*: un error de configuración desactiva todos los gates en silencio

- **Ubicación:** `src/agent/agent-loop/commit-gate-manager.ts:37-51`, `src/agent/agent-loop/orchestration-bridge.ts:54-57` `[LATENTE]`
- **Código problemático:**

```ts
if (!orchestrationResult) { const fsm = orchestrator?.getFSM(); if (fsm) { ... } return { allowed: true, criticalPath: [] }; }
const fsm = orchestrator?.getFSM();
if (!fsm) { return { allowed: true, criticalPath: [] }; }
```
- **Impacto:** sin orquestador o si `orchestrate()` lanza (YAML malformado, capability-matrix ilegible, parseo), el bridge convierte el error en `undefined` con un `console.warn` y `checkCommitGate` devuelve `allowed: true`. Un fallo de configuración deshabilita el pipeline completo de gates sin que el usuario se entere. Además `checkCommitGate` **muta** el estado de la tarea (`commit-gate-manager.ts:87-119` recorre el FSM hasta 10 pasos y escribe `orchestrationResult.task.status` sin pasar por `transitionTask`, sin `updatedAt` y sin registro de auditoría).
- **Solución:** invertir el default (si el orquestador está configurado pero falló → `allowed: false` + motivo a la UI); distinguir "feature deshabilitada" de "error de ejecución"; separar consulta de mutación y hacer los avances vía `transitionTask` con registro.

#### A-5. "Permitir todo" es pegajoso y anula las reglas de aprobación obligatoria

- **Ubicación:** `bin/cli.ts:583`, `bin/cli.ts:2004-2009` `[VIVO]`; `node_modules/@backendkit-labs/agent-core/dist/engine/ApprovalGate.js:29-51`
- **Código problemático:**

```ts
onToolApproval: async (toolName, agentId, argsPreview) => {
    if (allowAll) return 'approve_all';        // ← cortocircuita ANTES del gate
    ...
}
```
- **Impacto:** el framework tiene patrones de "preguntar siempre" (`npm install`, `pip install`) que pretenden no poder saltarse, pero el callback del CLI responde `approve_all` sin consultar nada en cuanto el usuario eligió "all" una vez, de modo que la instalación de paquetes deja de pedir permiso durante el resto de la sesión. La intención del framework queda anulada por su consumidor.
- **Solución:** que `allowAll` no cubra las herramientas de la lista `ALWAYS_ASK` (preguntar siempre por ellas) y que el permiso global expire por turno o por tool.

#### A-6. Bucles de recuperación inefectivos y modo `auto` sin techo real

- **Ubicación:** `src/agent/loop.ts:667-681`, `src/agent/loop.ts:616-624`, `src/agent/iteration-manager.ts:280-283` `[LATENTE]`
- **Código problemático:**

```ts
// loop.ts:667 — reintento sin progreso si la compactación no redujo nada
if (err.message?.includes('maximum context length') ...) { this.messages = await forceCompact(...); continue; }
```
```ts
// iteration-manager.ts:280 — en 'auto' nunca se pregunta ni se aplica el tope de 100
if (this._mode === 'auto') { return true; }
```
- **Impacto:** `forceCompact` devuelve el **mismo array** cuando hay menos de 4 mensajes a resumir (caso típico si el exceso viene de un único tool result de 80.000 caracteres), así que el `continue` reenvía el request idéntico: bucle degenerado que sólo corta por el tope global (1.000 iteraciones) quemando tokens. En `auto`, `advance()` devuelve `true` siempre y el callback `onIterationLimit` del CLI (que pregunta al usuario) **nunca se invoca**. Además la rama "Resumí lo logrado" (`loop.ts:616-624`) es inalcanzable porque `advance()` marca `_stopped=true` y no se vuelve a llamar al modelo.
- **Solución:** presupuesto de reintentos por tipo de error y abortar con mensaje accionable si la compactación no redujo tokens; que `forceCompact` informe si fue efectiva; aplicar un presupuesto de iteraciones y de coste también en `auto`.

#### A-7. El gate de QA aprueba commits por coincidencia de substrings y falla abierto

- **Ubicación:** `src/agent/qa/qa-service.ts:25,33,142,208-224`; consumido en `src/agent/commit/auto-commit.ts:105` y `src/agent/agent-loop/commit-gate-manager.ts:281` `[LATENTE]`
- **Código problemático:**

```ts
const APPROVAL_PATTERNS = ['visto bueno', 'aprobado', 'approved', 'aprueba', 'ok', ...];   // :25
const REJECTION_PATTERNS = ['problema', 'error', 'falta', 'incorrecto', 'mal', ...];       // :33
... lower.includes(p)                                                                     // :208-224
approved: true,                                                                           // :142 ante error del LLM de QA
```
- **Impacto:** la decisión de commitear se toma por substrings sin límites de palabra: un review que dice "revisé el **token**" aprueba, "**también** se ve bien" aprueba, "el flujo es **normal**" **rechaza**. Y si la llamada al LLM de QA falla, el gate responde `approved: true`. Es un control de calidad que aprueba por accidente y falla abierto, con el agravante de que su veredicto se registra en la auditoría.
- **Solución:** exigir un veredicto estructurado en la primera línea (`APROBADO|RECHAZADO` + JSON de hallazgos), matching por token completo (`\b`), y `approved: false` ante cualquier error del revisor.

#### A-8. Prompt injection asimétrica en el system prompt: se sanea una sección y se interpolan cinco sin sanear

- **Ubicación:** `src/agent/system-prompt.ts:129-152,181-196` `[LATENTE]`
- **Código problemático:**

```ts
// :190 — el propio código declara la intención…
// Sanitizar para evitar prompt injection desde texto generado por LLM
const sanitizedMemo = lessonsMemo.replace(...).slice(0, 3000);      // sólo lessonsMemo
...
parts.push(`...${memoryContext.projectContext}`);                    // :133 crudo
parts.push(`...${formatSessionContext(memoryContext.sessionContent)}`); // :140 crudo
if (contextMarkdown) parts.push(`\n## Contexto del Proyecto\n${contextMarkdown}`);   // :151 crudo
parts.push(formatContextFileSection('...(AGENT.md)', contextFiles.agentMd));          // :182 crudo
parts.push(`\n## Reglas\n${instructions.rules.map(...)}`);                            // :152 crudo
```
- **Impacto:** `AGENT.md`, `USER.md`, `contexto-proyecto.md` y `sesion-actual.md` son archivos que el propio agente escribe a partir de contenido del repositorio (que incluye READMEs, issues y salidas de tools: entrada no confiable). Ese contenido entra al system prompt sin sanear, en el nivel de máxima confianza, y como el agente dispone de `write_file`/`run_command`, la cadena inyección→acción es directa. El desarrollador ya conocía el riesgo (sanitizó una sección) pero la mitigación cubre 1 de 6 superficies; además el prompt usa `process.cwd()` (`:56-57`) en lugar del `workingDir` real, por lo que tras `/switch` describe mal el proyecto activo.
- **Solución:** un único sanitizador aplicado a **todas** las secciones no confiables (delimitadores explícitos tipo `<contexto_no_confiable>` + instrucción de no obedecerlo + truncado), y pasar el `workingDir` real en lugar de `process.cwd()`.

#### A-9. Inyección de código en el generador NestJS vía `base_url`

- **Ubicación:** `src/skills/handlers/nestjs.ts:142-158` `[LATENTE — el módulo se importa en bin/cli.ts:47, pero el handler no es invocable: vive en el registry que el motor nunca consulta]`
- **Código problemático:**

```ts
const baseUrl = (args.base_url as string) || 'process.env.EXTERNAL_API_URL';   // :145
...
baseURL: ${baseUrl.startsWith('process') ? baseUrl : `'${baseUrl}'`},          // :156 → se escribe un .ts
```
- **Impacto:** un `base_url` como `'); require('child_process').execSync('...'); //` se escribe tal cual en el `.ts` generado dentro del proyecto del usuario; si algo lo importa, se ejecuta. La heurística `startsWith('process')` no es una validación: cualquier string que empiece con "process" se inyecta sin comillas.
- **Solución:** validar con `new URL(baseUrl)` (y exigir http/https) y serializar siempre con `JSON.stringify`, nunca con plantillas manuales de comillas.

#### A-10. Inyección de secuencias ANSI/OSC (incluido OSC 52 → portapapeles) desde el modelo y desde archivos del repo

- **Ubicación:** `src/ui/formatters.ts:705,729` (prosa) y `:117` (tool results); `src/ui/terminal.ts:682` (footer) `[VIVO]`
- **Código problemático:**

```ts
// formatters.ts:729 inlineFmt — sólo aplica chalk, no filtra caracteres de control
// formatters.ts:705 — la prosa del modelo entra por aquí:
else result.push(inlineFmt(line));
```
```ts
// formatters.ts:117 — filtra CSI pero NO OSC
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
```
- **Evidencia (medida ejecutando las funciones reales con `ts-node`, no inferida):** `prose_has_OSC52:true`, `prose_has_CSI_2J:true`, `prose_has_hide_cursor:true`; en tool results `toolResult_has_OSC52:true` (el CSI sí se filtra). Los bloques de código sí se limpian (`sanitizeCodeOutput`, `formatters.ts:666`), es decir el sanitizador correcto se aplica a la rama equivocada.
- **Impacto:** una respuesta del modelo —o el contenido de `sesion-actual.md`/cualquier archivo del repo que el CLI imprime (`bin/cli.ts:970`)— puede **escribir el portapapeles del usuario vía OSC 52**, borrar la pantalla, ocultar el cursor o falsificar la línea del prompt. Como el mismo proceso ejecuta `run_command`, la inyección de terminal se suma a la de prompt y permite engañar al usuario sobre lo que el agente está haciendo. El carácter de control llega también al footer (`terminal.ts:682`) y, con stdout redirigido, el log recibe `\r\x1b[2K` cinco veces por segundo (no existe ningún `process.stdout.isTTY` en `src/ui/`).
- **Solución:** sanitizar el texto completo a la entrada de `formatMarkdown` (`sanitizeCodeOutput(text).code`) y ampliar el filtro a OSC (`\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`), CSI con parámetros intermedios y escapes de dos bytes; limpiar los caracteres de control en `updateStatusLine`; y omitir secuencias de cursor cuando `!process.stdout.isTTY`.

#### A-11. Congelamiento O(n²) de la UI durante el streaming

- **Ubicación:** `bin/cli.ts:357-367` `[VIVO]`
- **Código problemático:**

```ts
case 'token': {
    agentResponseBuffer += event.content;
    const firstLine = agentResponseBuffer
        .split('\n')[0]                    // ← divide el buffer COMPLETO en cada token
        .replace(/\*\*/g, '')...
```
- **Evidencia (medida replicando el bloque real):** 5k tokens (39 KB) → 74 ms; 20k (165 KB) → 1,08 s; **50k (429 KB) → 9,9 s de CPU sincrónica**. El costo crece con el cuadrado del tamaño de la respuesta porque se re-divide todo el buffer en cada evento.
- **Impacto:** el terminal se congela durante la generación de respuestas largas —justo el caso de uso del agente— y el usuario no puede interrumpir con Esc mientras el bucle de tokens está bloqueado. Es el hallazgo de rendimiento más caro de la superficie viva.
- **Solución:** calcular la primera línea de forma incremental usando sólo el chunk nuevo (y un flag `firstLineDone`), o acumular en un array de chunks y resolver la primera línea una sola vez.

---

### 🟡 MEDIOS

#### M-1. Utilidades de seguridad y de encoding escritas y **nunca cableadas**

- **Ubicación:** `src/shared/utils/encoding.ts:736` (`sanitizeForConsole`), `:767` (`normalizeString`), `:922` (`resolveSafePath`), `:96` (`validateBuffer`); `src/shared/utils/atomic-write.ts`; `src/skills/handlers/path-allowlist.ts`.
- **Evidencia (conteo de referencias fuera de su propio módulo):**

| Helper | Callers en producción |
|---|---|
| `sanitizeForConsole` | **0** (sólo sus tests) |
| `resolveSafePath` | **0** |
| `normalizeString` | **0** |
| `validateBuffer` | **0** |
| `clearReadCache` | **0** |
| `atomicWriteSync` | **0** |
| `atomicWrite` | 16, **todos en módulos inalcanzables** (reflection/profiler) |
| `setupConsoleEncoding` | **0** (sólo re-exportado en `src/index.ts:4`) |

- **Impacto:** el proyecto tiene el diagnóstico y la cura (sanitizador de consola, helper de path seguro, escritura atómica, `secret-scanner` incluso existe en el framework pero **no está en `CODING_TOOLS`**) y no los aplica precisamente en el camino vivo. Es la firma de un equipo que arregla el síntoma en el módulo equivocado.
- **Solución:** cablear o borrar. En particular: `setupConsoleEncoding()` en el arranque de `bin/cli.ts` (hoy nunca se llama y en PowerShell 5.1 el `chcp 65001` que resuelve el mojibake de consola queda muerto), `sanitizeForConsole` en el borde de salida a terminal, y `atomicWrite` en toda escritura de memoria.

#### M-2. Escrituras de memoria no atómicas y sin lock

- **Ubicación:** `src/bootstrap/memory-loader.ts:167,171` (en la ruta viva `bin/cli.ts:241 → loadMemoryContext → loadLocalMemoryContext → initLocalMemoryFiles`), `src/memory/updater.ts:269,397`, `src/shared/utils/encoding.ts:645-670` `[VIVO]`
- **Código problemático:**

```ts
// memory-loader.ts:167 — inicialización de la memoria del proyecto al arrancar el CLI
try { await fs.access(sesionFile); }
catch { await fs.writeFile(sesionFile, buildLocalSessionTemplate(projectName, date), 'utf-8'); }
```
```ts
// writeFileSafeAsync (encoding.ts:645) — también escribe in-place, sin tmp+rename
await writeFile(filePath, normalized, 'utf-8');
```
- **Impacto:** `sesion-actual.md` y `contexto-proyecto.md` —la memoria persistente que el agente relee en cada arranque— se escriben in-place y sin lock. Un crash, un Ctrl-C o dos terminales trabajando sobre el mismo proyecto dejan el archivo truncado o pierden una actualización completa (read-modify-write sin exclusión mutua). `src/shared/utils/atomic-write.ts` existe y no se usa aquí.
- **Solución:** usar `atomicWrite`/`atomicWriteSync` en `writeFileSafe*` y en `initLocalMemoryFiles` (tmp + rename, con el fallback EPERM ya implementado) y añadir un lock por archivo de memoria.

#### M-3. Cache de lectura sin límite (y decodificación UTF-16 que corrompe el texto)

- **Ubicación:** `src/shared/utils/encoding.ts:94,320-321,331,102` `[LATENTE]` (módulo importado por el CLI, pero `readFileSafe*` sólo lo invocan `updater.ts`/`loop.ts`, que el binario no ejecuta)
- **Código problemático:**

```ts
const readCache = new Map<string, CacheEntry>();          // :94  sin maxSize, sin TTL, sin LRU
...
const text = Buffer.from(buffer).swap16().toString('utf-8');   // :320 UTF-16LE mal decodificado
```
- **Impacto:** (1) el cache guarda el **contenido completo** de cada archivo y sólo se poda al escribir el mismo path (`invalidateCache` es además O(n) porque recorre todas las claves, `:102`); `src/vault/lru-cache.ts` ya implementa un LRU correcto con TTL y no se reutiliza. (2) `swap16()` sobre un buffer UTF-16 produce bytes con NUL intercalados leídos como UTF-8 (`"Hola"` → `"\u0000H\u0000o\u0000l\u0000a"`), es decir texto envenenado en silencio en el prompt del modelo en lugar de un error; el verificador lo reprodujo con Node. El fix es `toString('utf16le')`.
- **Solución:** reutilizar `LRUCache` para `readCache` (y devolver copias: hoy `return cached.result` entrega la misma referencia mutable a todos los llamadores); usar `toString('utf16le')`/`TextDecoder('utf-16le')` y cubrir ambos casos con tests de encoding reales (UTF-16LE/BE, Latin-1, BOM).

#### M-4. Features documentadas que no están cableadas: vault, instalación de skills y reflection

- **Ubicación:** `bin/cli.ts:235-236` y `929` (vault), `bin/cli.ts:1072-1075` (skills), `bin/cli.ts:551-555` (orchestration) `[VIVO]`
- **Evidencia:**

```ts
let vaultPath = '';            // bin/cli.ts:235 — única asignación en todo el archivo
let vaultConnected = false;    // bin/cli.ts:236 — nunca se reasigna
```
```ts
await fsio.writeFile(path.join(skillsDir, `${name}.yaml`), ...);   // ~/.bk-agent/skills/<name>.yaml
```
```js
// agent-core/dist/skills/loader.js:63-97 — lo que el motor realmente lee
~/.bk-agent/skills/global/ · ~/.bk-agent/skills/packs/{pack}/ · {cwd}/.bk-agent/skills/ · ~/.bk-agent/projects/{key}/skills/
```
- **Impacto:** (1) `vaultPath` nunca sale de `''`, así que el header y `/status` muestran siempre "Vault: no conectado", `loadVaultSkills` devuelve siempre `[]` y no existe comando `/obsidian` aunque `builtins.ts:396` diga "Usa /obsidian para conectarlo": toda la integración con Obsidian documentada es inalcanzable. (2) Los skills creados con `/skills → + Crear nuevo skill` se escriben en un directorio que **el motor no lee**, por lo que el usuario cree haber extendido el agente y no ocurrió nada. (3) `orchestration` no incluye `reflection`, así que el "Reflection Engine" del README no aprende nada.
- **Solución:** implementar `/obsidian` de verdad (asignar `vaultPath`/`vaultConnected` y pasarlos al contexto) o retirar la feature y su documentación; escribir los skills en `skills/global/` (o pasar `extraSkills` al engine, que es la vía soportada); decidir explícitamente si `reflection` se activa y documentarlo.

#### M-5. Sin CI, sin lint operativo y sin control de versiones

- **Ubicación:** raíz del proyecto; `package.json:16` (`"lint": "eslint src/"`), `:21` (`"prepare": "husky"`), `:47-52` (`lint-staged`); `Makefile:2`
- **Evidencia (verificado en disco):** `.git` ❌ · `.gitignore` ❌ · `.github` ❌ · `.husky` ❌ · `.npmrc` ❌ · `eslint` en `devDependencies`/`node_modules` ❌ · `Makefile:2` dice `# my-terminal-cli — Makefile` (otro proyecto). Además: no existe `coverageThreshold` en ningún archivo del repo (el único umbral, 70%, está hardcodeado dentro del reporter roto de M-8); `tsconfig.json` sólo incluye `src/**` y `bin/**`, así que `tsc --noEmit` nunca comprueba las 8.723 líneas de tests; y `npm pack --dry-run` confirma que el paquete publicado incluye `tests/` y `src/` (833 archivos, 4,7 MB) porque no hay `files` ni `.npmignore`.
- **Impacto:** nada impide subir código roto (la suite se ejecuta sólo si alguien la ejecuta a mano); `npm run lint` falla por dependencia ausente; el repo no está bajo control de versiones, así que **cualquier `git init` futuro commitearía `node_modules/`, `dist/`, `coverage/` y cualquier `.env`** (y el flujo de commit del propio agente hace `git add .`, `src/agent/commit/git-utils.ts:21`, con `--no-verify`, `src/agent/commit/workflow.ts:54`). `prepublishOnly` sólo compila con `tsc`, sin tests.
- **Solución:** `git init` + `.gitignore` (`node_modules`, `dist`, `coverage`, `*.log`, `.env*`, `processed/`, `failed/`) + workflow de CI (`build`, `tsc --noEmit`, `jest --coverage` con umbral y `bin/cli.ts` incluido) + instalar ESLint de verdad con `typescript-eslint` + `prepublishOnly` que corra tests y lint + borrar el `Makefile` heredado.

#### M-6. Codificación: 2 archivos con UTF-8 inválido, 45 con BOM, y un guard que no detecta ninguno

- **Ubicación:** `src/config/seed-config.ts`, `tests/integration/tool-executor.test.ts` (UTF-8 inválido); `scripts/check-utf8.js:10-23` (guard); 45 archivos `.ts` con BOM.
- **Evidencia:**

```
Archivos con UTF-8 invalido: 2
  src\config\seed-config.ts
  tests\integration\tool-executor.test.ts
Con BOM UTF-8: 45
```
```js
// scripts/check-utf8.js — sólo mira BOM UTF-16
if (buf[0] === 0xff && buf[1] === 0xfe) { ... } else if (buf[0] === 0xfe && buf[1] === 0xff) { ... }
```
- **Impacto:** el proyecto dedica un módulo de 927 líneas a encoding, un ADR (`docs/adr/ADR-001-sanitizacion-filename.md`), un script de pre-commit y reglas en el system prompt ("PROHIBIDO incluir BOM"), y aun así hay un archivo de 1.380 líneas con bytes no-UTF-8 y un test en el mismo estado. El guard llamado `check-utf8` no puede detectar ninguno de los dos casos: la protección es nominal. Además el guard sólo corre en `lint-staged`, que no está instalado, y su patrón es `*.ts` (`package.json:47-52`). Medición adicional: el `Makefile` es **cp1252 mezclado** (byte `0x92` en el offset 2856: no decodifica como UTF-8 estricto), es decir el archivo con más probabilidad de romper una consola Windows es justamente el que ningún check cubre; y `.vscode/settings.json` no fija `files.encoding`, así que el editor tampoco ayuda.
- **Solución:** reescribir `check-utf8.js` para validar `Buffer → TextDecoder('utf-8', {fatal:true})` y rechazar BOM, aplicarlo a todo `src/`, `tests/` y `bin/` en CI (no sólo en staged), y normalizar los 47 archivos afectados de una pasada.

#### M-7. Herramientas MCP y herramientas de escritura del framework fuera del gate de aprobación

- **Ubicación:** `bin/cli.ts:550` (`mcpServers` desde config), `ApprovalGate.js:12` (`WRITE_TOOLS` fijo).
- **Impacto:** `WRITE_TOOLS` es un conjunto hardcodeado de tres nombres. Cualquier tool aportada por un servidor MCP (`MCPRegistrar.js` las registra con nombre con namespace) y las tools de escritura del framework (`save_context`, `save_learning`, `save_audit`, `save_user_preference`, `update_session`, `append_log`) **nunca** piden aprobación, ni siquiera en modo interactivo. Un servidor MCP con efectos laterales (publicar en Slack/GitHub/Postgres) se ejecuta en silencio.
- **Solución:** clasificar por capacidad declarada en la definición de la tool (`writes: true`, `destructive: true`) en lugar de por nombre, y pedir aprobación por defecto para cualquier tool no builtin.

#### M-8. El reporter de Jest invoca un bridge que no puede ejecutarse y silencia el error

- **Ubicación:** `jest.config.js:42-45`, `scripts/jest-reflection-reporter.js:18,21-26`, `scripts/reflection-commit-bridge.mjs:24` `[VIVO — se ejecuta en cada `npm test`]`
- **Código problemático:**

```js
// jest-reflection-reporter.js
const COVERAGE_THRESHOLD_PCT = 70;                                   // :18 único umbral del repo, dentro de un reporter que no funciona
execFile('node', [BRIDGE_PATH, ...], { timeout: 10000 }, () => {});  // :21-26 el callback ignora el error
```
```js
// reflection-commit-bridge.mjs:24 — importa un archivo que no existe: src/ tiene 0 archivos .js
import ... from '../src/reflection/reflection-engine.js';
```
- **Evidencia:** ejecutado a mano, el bridge termina en `ERR_MODULE_NOT_FOUND` (exit 1) y además referencia un `commit-workflow.ps1` inexistente.
- **Impacto:** cada suite fallida (o cada `--coverage` con archivos por debajo del 70%) lanza un proceso `node` condenado, cuyo error se descarta, y el proceso hijo ni se espera (puede sobrevivir al teardown). El "aprendizaje desde los tests" que el reporter dice alimentar **nunca registró un incidente**: una pata entera del sistema de reflexión es un no-op silencioso. Y como ningún archivo del repo define `coverageThreshold`, el único umbral de cobertura del proyecto vive dentro de este reporter roto.
- **Solución:** quitar el reporter de `jest.config.js` (o arreglar el bridge resolviendo vía `dist/` y propagando el error), y mover el umbral a `coverageThreshold.global` con ratchet en CI.

#### M-9. Suites que prueban una copia local de la lógica del CLI y unit tests sobre mocks

- **Ubicación:** `tests/suppress-default-output.test.ts:10-26`; `tests/reflection/reflection-engine.unit.test.ts:15-30`; `tests/reflection/failure-catalog.unit.test.ts:72`
- **Código problemático:**

```
// tests/suppress-default-output.test.ts
 * La logica bajo test REPLICA el bloque en cli.ts
function shouldSuppressOutput(...) { ... }   // definida en el propio test
```
- **Impacto:** 8 de los 10 `expect` de esa suite validan una copia de la lógica, no `bin/cli.ts` (2.041 líneas): un cambio en el CLI no rompe ningún test. En la misma línea, `reflection-engine.unit.test.ts` mockea **todos** sus colaboradores (FailureCatalog, PatternDetector, PolicyPromoter, `memory/updater`, `fs/promises`, `atomic-write`) y lo declara como objetivo ("cubrir branches no alcanzados por los tests de integración"): sube el número de cobertura sin especificar comportamiento. Es la explicación mecánica de por qué el 58% de cobertura convive con 76% de código muerto y 0% del entrypoint.
- **Solución:** exportar y testear la lógica real desde `src/`, reservar los mocks para I/O (con FS real en `mkdtemp`), y medir cobertura sobre el camino vivo.

#### M-10. `tsc --noEmit` no comprueba los tests y el tipado estricto es nominal en los bordes

- **Ubicación:** `tsconfig.json:21-24`; `package.json:16,47-52`
- **Evidencia:** `include` es sólo `src/**` + `bin/**`, por lo que el segundo check de `lint-staged` (`npx tsc --noEmit`) **nunca type-checkea las 8.723 líneas de `tests/`**; medido en el código: 35 `: any` + 27 `as any` en `src/`, 20 + 30 en `bin/cli.ts`, y 11 `require()` dentro de módulos TS (`src/orchestrator/config-loader.ts:35`, `src/agent/routing/weights-store.ts:133`, `src/tools/ripgrep-search.ts:10`) que devuelven `any` precisamente en el borde de I/O. `npx tsc --noEmit` sale 0.
- **Impacto:** el equipo cree tener `strict: true`; lo tiene en el interior y no en la frontera (I/O, ripgrep, `os`) ni en los tests, que son el 28% de las líneas TypeScript.
- **Solución:** añadir `tsconfig.tests.json` incluido en el gate de CI y activar `noUncheckedIndexedAccess` antes de migrar los `any` de borde a tipos declarados.

#### M-11. Dos árboles de estado que no se hablan: `~/.bk-agent` vs `~/.deepseek-code`

- **Ubicación:** `src/bootstrap/global-seed.ts:703,740` escribe en `~/.bk-agent`; `src/bootstrap/context-files-loader.ts:68` lee de `~/.deepseek-code`; `src/agent/routing/weights-store.ts:139` y `src/orchestrator/config-loader.ts:35` usan `~/.deepseek-code`; `src/bootstrap/memory-loader.ts:55-60` usa `~/.bk-agent`. `[LATENTE]`
- **Impacto:** las preferencias globales sembradas (USER.md) nunca llegan al prompt porque se escriben en un directorio distinto del que se lee; los pesos de routing y la config del orquestador viven en otra raíz que los skills y los agentes. El usuario (y el próximo desarrollador) no puede razonar sobre dónde está el estado, y cualquier limpieza manual borra la mitad. Las convenciones de nombre (`deepseek-code` vs `bk-agent`) quedaron de dos etapas del producto.
- **Solución:** una única función `getGlobalDir()` exportada desde un solo módulo, migración explícita del directorio antiguo y test que falle si aparece una ruta `~/.deepseek-code` hardcodeada.

#### M-12. `--no-verify` incondicional + `git add .` en el flujo de commit del agente

- **Ubicación:** `src/agent/commit/workflow.ts:54`; `src/agent/commit/git-utils.ts:21`; `src/agent/commit/types.ts:27` (opción `noVerify` definida y reenviada en `commit-gate-manager.ts:309` pero **nunca leída**) `[LATENTE]`
- **Código problemático:**

```ts
execFileSync('git', ['commit', '--no-verify', '-F', tmp], { ... });   // siempre
execSync('git add .', { ... });                                      // todo, incluido .env
```
- **Impacto:** los hooks de pre-commit del usuario (gitleaks, secret scanning, lint-staged, la propia `check-utf8`) se saltan siempre, y el stageo indiscriminado mete en el commit los archivos que produzca la sesión, incluidos `.env` y claves. La opción `noVerify` existe y se propaga, lo que sugiere que la intención era condicionarla.
- **Solución:** leer `noVerify` (default `false`) y stagear rutas explícitas (`git add -u` + paths del scope) en lugar de `git add .`.

#### M-13. Heurísticas del evaluador con falsos positivos y negativos verificables

- **Ubicación:** `src/agent/evaluation/logic-evaluator.ts:26,89,108,139`; `src/agent/delegation-enforcer.ts:424,433-441` `[LATENTE]`
- **Código problemático:**

```ts
if (context.includes('no') || context.includes('not')) return true;   // :139 — 'node', 'normal', 'nota' matchean
const INVERTED_INCLUDES_REGEX = /.../g;                               // :26 — regex global a nivel módulo…
while ((match = INVERTED_INCLUDES_REGEX.exec(line)))                  // :89 — …reutilizada por línea: lastIndex persiste y saltea matches
```
- **Impacto:** (1) falso positivo: cualquier línea con "node"/"normal"/"nota" junto a un `.includes()` genera un issue `severity: 'high'`, resta 20 al score, dispara un segundo pase al LLM y activa el bucle de auto-corrección sobre respuestas correctas. (2) falso negativo: el `/g` de módulo con `exec` por línea saltea coincidencias alternas, así que inversiones reales no se detectan. (3) `delegation-enforcer.ts:433-441`: una ventana de ±100 caracteres convierte un plan en prosa ("voy a implementar X en `src/foo.ts`") en una "violación" de que se escribió código sin delegar. Un evaluador que se equivoca en ambos sentidos entrena al modelo a desconfiar del sistema.
- **Solución:** resetear `lastIndex` (o no usar `/g` con `exec`), exigir negación adyacente real y contexto de bloque de código, y basar la detección de delegación en tool calls observadas (no en cercanía textual).



#### M-14. `vault_search` construye una regex desde el prompt y recorre el vault sin límite

- **Ubicación:** `src/vault/search.ts:54`, `src/vault/vault-provider.ts:85-88`, `src/skills/handlers/builtins.ts:346` `[LATENTE]` (el handler vive en el registry inalcanzable y `vaultPath` es siempre `''`)
- **Código problemático:**

```ts
const re = new RegExp(keyword, 'gi');   // keyword viene del prompt del usuario/modelo, sin escapar
```
- **Impacto:** un keyword como `user***` lanza `SyntaxError` que el handler no captura (el registry lo convierte en `Error en handler 'vault_search'`), y un patrón como `(a+)+b` es un ReDoS sobre el contenido del vault. Además `vault-provider.ts:85-88` hace un `glob` por cada par (searchPath × pattern) y una lectura secuencial por archivo: N+1 de filesystem proporcional al tamaño del vault.
- **Solución:** escapar el keyword (`keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) o usar `String.includes` para búsqueda literal; limitar longitud y usar uno o dos patrones por búsqueda; cachear el índice del vault en lugar de re-globear por consulta.

#### M-15. `MessageBuffer` retiene todo y reconstruye la pantalla dos veces por render

- **Ubicación:** `src/ui/message-buffer.ts:70-77,227,233`; `src/ui/terminal.ts:813` `[VIVO]`
- **Código problemático:**

```ts
const content = msg.content.split('\n').slice(0, MAX_CONTENT_LINES);   // trunca SÓLO al pintar: el contenido crudo se guarda entero
// render() llama getScrollState() (:227) y luego buildAllLines() otra vez (:233)
```
- **Impacto:** `MAX_MESSAGES` limita por cantidad, no por bytes, así que una sesión larga acumula todo el contenido de las respuestas y de los tool results (medido: 4 MB → 45 ms por render; 30 MB → 110 ms), y `renderMessageArea()` se ejecuta en cada PgUp/PgDn/Ctrl+Home/End: la navegación se degrada de forma perceptible a medida que avanza la sesión.
- **Solución:** truncar y descartar en `add()` (o guardar sólo las últimas N líneas por mensaje), y construir las líneas una vez por render (cachear entre `getScrollState` y `render`).

#### M-16. Timer de "thinking" huérfano y footer sin guarda de TTY

- **Ubicación:** `src/ui/terminal.ts:901,921`; `bin/cli.ts:1993` `[VIVO]`
- **Código problemático:**

```ts
this.thinkingTimer = setInterval(() => { ... }, 150);   // sólo se limpia en stopThinking()
// bin/cli.ts:1993 — el catch alrededor de runEngine sólo llama a spinner.stop()
```
- **Impacto:** si el engine lanza una excepción dentro de un bloque de thinking, queda un `setInterval` eterno escribiendo al footer y **manteniendo vivo el proceso** (la CLI no termina). Combinado con el footer sin guarda de `isTTY`, con stdout redirigido el archivo de log recibe secuencias de cursor cinco veces por segundo.
- **Solución:** `try { … } finally { terminal.stopThinking(); spinner.stop(); }` alrededor de `runEngine`, y omitir secuencias de control cuando `!process.stdout.isTTY`.



---

### 🟢 BAJOS

- **B-1.** `bin/cli.ts` (2.041 líneas) duplica ~10 comandos slash entre la rama headless (619-788) y la TUI (952-1177); las dos ramas ya divergieron (en headless `/models` advierte que el cambio aplica "en la próxima ejecución", en TUI no). Extraer una fábrica de comandos con la función de render inyectada.
- **B-2.** `formatters.ts:410-429`: `computeLCS` devuelve `[]` para archivos >500 líneas, lo que degrada el diff a "todo borrado + todo añadido" **sin truncar**: reescribir un archivo de 2.000 líneas imprime 4.000 líneas en el terminal (`bin/cli.ts:412` llama a `formatFileDiff` en cada `tool_call`). Añadir cota de líneas renderizadas.
- **B-3.** `src/memory/updater.ts:434` y `:296`: `content.replace(re, \`$1${newBody}\n\`)` interpola contenido no confiable en un reemplazo de `String.replace`, donde `$&`, `$1` o `` $` `` se expanden: un `proximos_pasos: ["costo $1 millón"]` corrompe la memoria (reproducido con Node por el verificador). Usar una función de reemplazo. En la misma línea, `truncateSectionItems` (`:277-297`) reconstruye la sección conservando sólo las líneas `- ` o `1. ` y **borra la prosa y sub-bullets del usuario**, y el guard de 8.192 B (`:265,393`) compacta pero no garantiza acotar el archivo: se escribe igual. `[LATENTE]`
- **B-4.** `src/reflection/historical-loader.ts` es el archivo con mayor complejidad aproximada (CCN ≈ 38, 503 líneas, 148 puntos de decisión en 4 funciones) y es código muerto. `[LATENTE]`
- **B-5.** Artefactos en el árbol: `processed/` contiene una copia completa de los 16 documentos de `documentation/`, `failed/` un archivo huérfano, `.bk-agent/agents` y `.backendkit-agent/agents` están vacíos; 13 `.md` en la raíz (3.500 líneas de notas de trabajo: `RESUMEN_TRABAJO_COMPLETADO.md`, `AUTOCOMPLETADO_SUMMARY.md`, …).
- **B-6.** Deuda señalizada en comentarios: 7 `TODO`, 1 `FIXME`, 1 `HACK` y 11 anotaciones `// Bug #N` concentradas en `src/agent/loop.ts` y `specialist-executor.ts` (historial de parches reactivos sobre el loop muerto).
- **B-7.** `pre-commit` del proyecto (`runPreCommitTests`, `src/agent/commit/workflow.ts:367-414`) ejecuta `npx jest`, `go build`, `cargo test`… **del proyecto del usuario** sin confirmación adicional; y `git add .` + `--no-verify` (`git-utils.ts:21`, `workflow.ts:54`) saltan los hooks de git del usuario (gitleaks, pre-commit). `[LATENTE]` en este repo, pero es un riesgo de seguridad si se re-cablea.
- **B-8.** `scripts/patch-loop.mjs:3` y `scripts/patch-loop-4.mjs:3` parchean por regex un archivo de **otro checkout** (`C:\...\deepseek-code\src\agent\loop.ts`) rebanando por `indexOf(...)` y escribiendo sin validar que el resultado compile; si el patrón no matchea imprimen `FAIL` y siguen. En un repo sin `.git` no hay `git diff` ni revert: refactors irreproducibles. Borrarlos.
- **B-9.** Tests frágiles por entorno: `tests/integration/reflection-engine.test.ts:137`, `243`, `325`, `412`, `603`, `752`, `824`, `943` y `tests/integration/context-loader.test.ts:93` usan rutas fijas en `os.tmpdir()` que se destruyen con `fs.promises.rm(..., {recursive:true})` en `beforeEach`, por lo que dos corridas concurrentes se borran los datos entre sí y una abortada deja basura que la siguiente reutiliza; y hay aserciones de tiempo de pared (`expect(elapsed).toBeLessThan(500)`) que no distinguen lectura paralela de secuencial. Usar `mkdtempSync` (como `tests/integration/orchestrator/audit-reporter.test.ts:20`) y mocks para la concurrencia.
- **B-10.** `npm pack` publica `tests/` y `src/` (833 archivos, 4,7 MB) al no haber `files` ni `.npmignore` en `package.json`.
- **B-11.** `src/ui/formatters.ts:625`: `Math.min(40, Math.floor(termCols / colCount) - 2)` produce `colW` negativo con tablas de muchas columnas (200 columnas → una línea de ~2.400 caracteres sin tope); y el corte de 500 de `computeLCS` (`:413`) también aplica a **tokens** en `wordLevelDiff` (`:387`), así que una sola línea minificada degrada a "todo borrado + todo añadido" intra-línea.
- **B-12.** APIs de UI sin llamador: `setThinkingContent` (`src/ui/terminal.ts:877`), `setLastCode` (`:974`) y `setProcessing` (`src/ui/paste-debouncer.ts:60`) dejan los atajos Ctrl+T/Ctrl+Y inertes.

---

## 3. MÉTRICAS DE CALIDAD

| Métrica | Valor medido | Comentario |
|---|---|---|
| Archivos / líneas TS | 186 archivos · 30.729 líneas (`src/` 28.688 + `bin/cli.ts` 2.041) | `src/` 138 archivos |
| Tests | 46 suites · 712 tests · 8.723 líneas · **43 s** | 100% en verde |
| Cobertura (medida con `npx jest --coverage`) | Statements **57,91%** · Branches **44,04%** · Functions **57,9%** · Lines **59,48%** | ⚠️ `bin/cli.ts`, el 100% de la superficie viva, **está excluido** de la medición |
| Cobertura efectiva del producto | ≈ **0%** del entrypoint; 32 de 46 suites (70%) prueban módulos inalcanzables | Falsa confianza: la métrica alta mide código muerto |
| **Código muerto (no alcanzable desde el binario)** | **21.706 / 28.688 líneas = 76%** (106 / 138 archivos) | 6.982 líneas alcanzables, de las cuales ≈1.900 son inertes (registry de handlers + vault con `vaultPath=''`) |
| Duplicación | ~10 comandos slash duplicados headless/TUI; `src/reflection/**` + `src/orchestrator/**` replicados en `@backendkit-labs/agent-core` (41/41 entradas de `KEYWORD_MAP` idénticas) | Deuda de migración, no de copia-pega casual |
| Complejidad ciclomática aprox. | **4,3 promedio** (1.208 funciones, 4.003 puntos de decisión) | Outliers: `historical-loader.ts` ≈38, `orchestrator/types.ts` ≈18, `lru-cache.ts` ≈18, `orchestrator/index.ts` ≈15,8 |
| Archivos más largos | `bin/cli.ts` 2.041 · `seed-config.ts` 1.380 · `loop.ts` 1.110 · `terminal.ts` 990 · `encoding.ts` 927 | Los 4 primeros superan ampliamente el umbral razonable de 500-800 líneas |
| Tipo `any` / `require()` en TS | ≈110 anotaciones `any` · 11 `require()` dentro de módulos TS · 3 supresiones | `strict: true` con `skipLibCheck` no impide el `any` masivo en las fronteras (los handlers hacen `args.x as string` sin validar) |
| Logging | 70 `console.*` en `src/` (además del protocolo de eventos) | No hay logger estructurado ni niveles; imposible filtrar en producción |
| Tests (calidad) | 684/684 bloques `it`/`test` contienen al menos un `expect` | El problema no es la cantidad de aserciones sino su objeto (M-9) |
| Tests de la UI | **0** suites (sólo `tests/slash-registry.test.ts`) | `src/ui/**` (≈2.500 líneas vivas) sin cobertura |
| Empaquetado | `npm pack` incluye `tests/` y `src/` · 833 archivos · 4,7 MB | Sin `files` ni `.npmignore` |
| Deuda Técnica | **ALTA** | Concentrada en: código muerto (76%), documentación divergente, ausencia de CI/lint/VCS y helpers de seguridad no cableados |

---

## 4. PLAN DE ACCIÓN (HOJA DE RUTA)

### Semana 1 — Decidir y podar (crítico)
1. **Tomar la decisión arquitectónica** (C-1): bk-agent = CLI delgado sobre el framework. Congelar `src/` y publicar el acuerdo en un ADR nuevo.
2. **Borrar o archivar** los 106 archivos inalcanzables (o moverlos a `legacy/` fuera del paquete y de la cobertura) y ajustar `src/index.ts`. Eliminar `processed/`, `failed/`, `Makefile`, `.bk-agent/agent*` vacíos y las notas sueltas de la raíz.
3. **Higiene de repositorio** (M-5): `git init` + `.gitignore` + CI (`tsc --noEmit`, `jest --coverage`, ESLint con `typescript-eslint`) + `prepublishOnly` que corra tests y lint.
4. **Endurecer la superficie viva** (C-2, A-5): quitar la auto-aprobación por defecto en `--headless` (flag explícito), hacer que `allowAll` no cubra `ALWAYS_ASK_PATTERNS`, y clasificar herramientas por capacidad (M-7).
5. **Rutas y comandos** (A-1): canonicalizar con `realpath` en el sandbox; documentar la allowlist como conveniencia, no como sandbox; decidir si se elimina `node`/`npx`/`python`/`docker` de la lista o se aísla la ejecución.

### Semana 2 — Riesgo del camino vivo (alto/medio)
6. **Guard de rutas sensibles** (A-2): portar `SENSITIVE_PATH_BASE` a `read_file`/`write_file`/`edit_file` con confirmación y redacción en el protocolo.
7. **Atomicidad y memoria** (M-2, M-3, B-3): `atomicWrite` en todas las escrituras de memoria, `LRUCache` para `readCache`, y reemplazo por función en `replaceSection`/`truncateSectionItems`.
8. **Cablear o retirar** (M-1, M-4): `setupConsoleEncoding()` en el arranque, `sanitizeForConsole` en la salida, y decidir vault/skills/reflection de una vez (implementar o borrar la feature **y su documentación**).
9. **Codificación** (M-6): `check-utf8.js` que valide UTF-8 real y BOM, aplicado en CI; normalizar los 47 archivos afectados.
10. **Cobertura del producto**: incluir `bin/cli.ts` en `collectCoverageFrom` y escribir la primera suite de contrato del protocolo headless (JSON-Lines) más un test del sandbox de rutas (symlink/junction, case-insensitive, prefijos).

### Backlog — Refactor estructural
11. Extraer los servicios de gates/reflection/audit que se quieran conservar **al framework** (fuente única) en lugar de mantener copias; cerrar los hallazgos A-3, A-4 y A-6 en `agent-core` con tests de "gate no ejecutado ⇒ no `GO`" y "error de orquestación ⇒ fail-closed".
12. Partir `bin/cli.ts` (2.041 líneas) en módulos por comando y unificar headless/TUI en una sola implementación con render inyectado (B-1).
13. Cota de líneas en `formatFileDiff` para archivos >500 líneas (B-2); logger estructurado con niveles que reemplace los 70 `console.*`.
14. Regenerar la documentación desde el código (o verificar en CI que los ejemplos de `AGENT.md`/`README.md` existen), y dejar de publicar auditorías auto-generadas como evidencia de control (A-3).
15. Cobertura objetivo: 80% de líneas **sobre el camino vivo** (no sobre el total), con umbral en CI (`coverageThreshold.global` con ratchet: hoy el único umbral, 70%, vive en el reporter roto).
16. Sanitizar ANSI/OSC en `formatMarkdown` y en los tool results (A-10) y eliminar el re-split O(n²) del stream (A-11): son las dos correcciones de mayor impacto percibido por el usuario en la superficie viva.
17. Cablear `setupConsoleEncoding()`/`sanitizeForConsole` y quitar el reporter de reflexión de `jest.config.js` (o arreglar el bridge y propagar el error).
18. Borrar `scripts/patch-*.mjs`, unificar rutas de estado en `getGlobalDir()` (M-11) y usar `mkdtemp` en los tests de integración (B-9).
19. Publicar el paquete con `files`/`.npmignore` (hoy incluye `tests/` y `src/`, 4,7 MB) y añadir `tsconfig.tests.json` al gate.
