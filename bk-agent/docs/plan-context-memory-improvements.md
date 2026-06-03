# Plan: Mejoras de Contexto y Memoria

**Estado general:** En progreso  
**Ultima actualizacion:** 2026-05-10 (todas las TASKs completadas — plan cerrado)  
**Autor:** mairon cuello + Claude Sonnet 4.6  
**Rama base:** develop

---

## Diagnostico

Analisis del sistema de contexto y memoria revelo dos brechas principales:

### Brecha 1 — Reflection Engine desconectado de la memoria persistente

El Reflection Engine acumula incidentes reales (hallazgos de QA, errores de agente,
fallos de test) y genera patrones valiosos, pero ningun mecanismo los propaga a
`sesion-actual.md` ni `contexto-proyecto.md`. El ciclo de aprendizaje queda
cerrado solo a nivel de `manifest.yaml` (policies) y `lecciones-aprendidas.md`
(system prompt), sin actualizacion de la memoria operativa del usuario.

### Brecha 2 — Contexto de especialistas truncado

Cuando el General delega en un especialista via `ask_agent`, este recibe solo los
ultimos 6 mensajes del historial (`maxExchanges * 2` en `specialist-executor.ts:265`).
Si la conversacion tiene 40+ turnos, el especialista puede operar sin contexto de
decisiones criticas tomadas hace varios intercambios.

### Brechas secundarias

| # | Problema | Archivo | Linea |
|---|---|---|---|
| 3 | `sesion-actual.md` se carga entero en system prompt sin limite | `src/agent/system-prompt.ts` | — |
| 4 | Agentes especializados no tienen instruccion de emitir `[memory:*]` | `src/agent/profiles.ts` | — |
| 5 | Compactacion unica por turno — respuesta larga puede re-exceder sin re-compactar | `src/agent/loop.ts` | 511 |
| 6 | Token counting aproximado `chars/4` sin calibracion por tipo de mensaje | `src/context/token-counter.ts` | 4 |
| 7 | `sesion-actual.md` crece durante la sesion sin compactacion automatica | `src/memory/updater.ts` | — |

---

## Leyenda de estado

- `[ ]` Pendiente
- `[~]` En progreso
- `[x]` Completado
- `[!]` Bloqueado (depende de otra tarea)

---

## Prioridad 1 — Reflection Engine → Memoria persistente

### TASK-01: Propagacion de hallazgos criticos a sesion-actual.md

**Estado:** `[x]`  
**Esfuerzo:** 3h  
**Archivos:** `src/reflection/hooks/audit-hook.ts`, `src/memory/updater.ts`  
**Depende de:** —

**Problema:**  
`AuditHook.reportFinding()` registra hallazgos en el catalogo de incidentes pero
no actualiza `sesion-actual.md`. El usuario ve los hallazgos solo si ejecuta
`/reflection`. Entre sesiones, se pierden.

**Implementacion:**  
En `AuditHook`, cuando el hallazgo tiene severidad `Alta` o `Critica`, llamar
a `updateSessionMemory()` con los issues:

```typescript
// src/reflection/hooks/audit-hook.ts
if (finding.severidad === 'Alta' || finding.severidad === 'Critica') {
    await updateSessionMemory(projectDir, {
        issues: [`[${finding.severidad}] ${finding.hallazgo} (${finding.dimension})`],
    });
}
```

Requiere que `AuditHook` reciba `projectDir` como dependencia opcional (actualmente
solo recibe `ReflectionEngine`).

**Criterio de completitud:**  
Despues de que un gate reporta un hallazgo de severidad Alta, `sesion-actual.md`
contiene el issue en la seccion "Issues Activos" sin intervencion manual.

---

### TASK-02: Propagacion de patrones promovidos a contexto-proyecto.md

**Estado:** `[x]`  
**Esfuerzo:** 2h  
**Archivos:** `src/reflection/reflection-engine.ts`, `src/memory/updater.ts`  
**Depende de:** —

**Problema:**  
Cuando `reflect()` promueve un patron a policyRule (via `PolicyPromoter`),
el hallazgo arquitectonico implicito no se escribe en `contexto-proyecto.md`.
Solo queda en `manifest.yaml` y en `lecciones-aprendidas.md`.

**Implementacion:**  
En `ReflectionEngine.reflect()`, al promover una regla, llamar a
`updateProjectContext()` con una nota sobre la convencion aprendida:

```typescript
// src/reflection/reflection-engine.ts - dentro de reflect()
if (rule && this.options.projectDir) {
    await updateProjectContext(this.options.projectDir, {
        notas: `[auto] Policy promovida: ${rule.name} — ${pattern.recommendedAction}`,
    });
}
```

**Criterio de completitud:**  
Despues de que un patron se promueve automaticamente, `contexto-proyecto.md`
refleja la nueva convencion en la seccion "Notas" sin intervencion manual.

---

### TASK-03: Seccion `## Aprendizajes del Engine` en sesion-actual.md

**Estado:** `[x]`  
**Esfuerzo:** 3h  
**Archivos:** `src/memory/updater.ts`, `src/reflection/lessons-memo-generator.ts`  
**Depende de:** TASK-01, TASK-02

**Problema:**  
`sesion-actual.md` no tiene seccion dedicada a lecciones del Reflection Engine.
Las notas se agregan en la seccion geneerica "Notas" mezcladas con notas manuales.

**Implementacion:**  
Agregar seccion `## Aprendizajes del Engine` al template de `sesion-actual.md`
y funcion `updateEngineInsights()` en `updater.ts`:

```typescript
// src/memory/updater.ts
export async function updateEngineInsights(
    projectDir: string,
    insights: string[],
): Promise<string> {
    // Agrega items a ## Aprendizajes del Engine
    // Si la seccion no existe, la crea
    // Limita a los ultimos 10 items (evita crecimiento infinito)
}
```

**Criterio de completitud:**  
`sesion-actual.md` tiene seccion `## Aprendizajes del Engine` que se actualiza
automaticamente con hallazgos y patrones sin saturar otras secciones.

---

## Prioridad 2 — Contexto de especialistas

### TASK-04: Resumen de contexto largo para especialistas

**Estado:** `[x]`  
**Esfuerzo:** 4h  
**Archivos:** `src/agent/agent-loop/specialist-executor.ts`  
**Depende de:** —

**Problema:**  
`buildRecentContext()` en `specialist-executor.ts:265` entrega solo los ultimos
6 mensajes al especialista. Si la conversacion tiene 40+ turnos, el especialista
pierde contexto de decisiones criticas.

**Implementacion:**  
Cuando el historial del General supera 12 mensajes, usar el `ContextSummarizer`
para generar un resumen compacto del historial completo y entregarlo al especialista
ADEMAS de los ultimos 6 mensajes:

```typescript
// src/agent/agent-loop/specialist-executor.ts
const SUMMARY_THRESHOLD = 12;

async function buildSpecialistContext(
    generalMessages: Message[],
    summarizer: ContextSummarizer,
    maxExchanges = 3,
): Promise<string> {
    const nonSystem = generalMessages.filter(m => m.role !== 'system');
    if (nonSystem.length <= SUMMARY_THRESHOLD) {
        // historial corto: comportamiento actual
        return buildRecentContext(generalMessages, maxExchanges);
    }
    // historial largo: resumen + recientes
    const toSummarize = nonSystem.slice(0, -maxExchanges * 2);
    const summary = await summarizer.summarize(toSummarize);
    const recentRaw = buildRecentContext(generalMessages, maxExchanges);
    return `## Resumen de conversacion previa\n${summary}\n\n## Intercambios recientes\n${recentRaw}`;
}
```

**Criterio de completitud:**  
Un especialista invocado en el turno 40 recibe un resumen del historial completo
mas los 6 mensajes recientes. Sus respuestas demuestran conocimiento de decisiones
tomadas en los primeros turnos.

---

### TASK-05: Instruccion de `[memory:*]` en perfiles de especialistas

**Estado:** `[x]`  
**Esfuerzo:** 1h  
**Archivos:** `src/agent/profiles.ts`  
**Depende de:** —

**Problema:**  
Los perfiles de especialistas (`qa-engineer`, `security-agent`, `architecture-agent`)
no tienen instruccion en su `systemPromptAddition` para emitir tags `[memory:*]`.
El mecanismo existe (`memory-tag-parser.ts`) pero los agentes nunca lo usan porque
no saben que existe.

**Implementacion:**  
Agregar al final de `systemPromptAddition` de cada perfil especialista:

```typescript
// src/agent/profiles.ts - perfil architecture-agent
systemPromptAddition: `
  ...
  IMPORTANTE: Cuando tomes decisiones arquitectonicas significativas, incluye al final:
  [memory:decision] <descripcion de la decision y razon>
`,
// perfil qa-engineer
systemPromptAddition: `
  ...
  IMPORTANTE: Si detectas issues criticos, incluye al final:
  [memory:issues] <issue 1>; <issue 2>
`,
// perfil security-agent
systemPromptAddition: `
  ...
  IMPORTANTE: Si detectas vulnerabilidades, incluye al final:
  [memory:issues] [security] <descripcion>
`,
```

**Criterio de completitud:**  
Cuando `architecture-agent` toma una decision de diseno, `sesion-actual.md` se
actualiza automaticamente con la decision sin `/checkpoint` manual.

---

## Prioridad 3 — Gestion del tamano de sesion-actual.md

### TASK-06: Limite de tamano en sesion-actual.md + compactacion automatica

**Estado:** `[x]`  
**Esfuerzo:** 3h  
**Archivos:** `src/memory/updater.ts`, `src/bootstrap/memory-loader.ts`  
**Depende de:** —

**Problema:**  
`sesion-actual.md` puede crecer indefinidamente si se hacen muchas llamadas a
`update_session_memory` o `updateSessionMemory` durante una sesion larga.
El archivo completo se inyecta en el system prompt en cada turno, aumentando
el uso de tokens del contexto.

**Implementacion:**  
En `updateSessionMemory()`, si el archivo supera 8KB, ejecutar compactacion
de secciones antiguas (mover decisions/issues resueltos a un buffer) antes de escribir:

```typescript
// src/memory/updater.ts
const SESSION_MAX_BYTES = 8192; // 8KB

export async function updateSessionMemory(
    projectDir: string,
    updates: SessionMemoryUpdate,
): Promise<string> {
    // ... logica existente ...

    // Post-write: compactar si supera limite
    const finalSize = Buffer.byteLength(content, 'utf-8');
    if (finalSize > SESSION_MAX_BYTES) {
        content = compactSessionContent(content);
        await writeFileSafeAsync(sesionFile, content);
    }
}

function compactSessionContent(content: string): string {
    // Trunca "Decisiones" a las ultimas 5
    // Trunca "Issues Activos" a los ultimos 5
    // Preserva intactos: Feature en Curso, Proximos Pasos, Aprendizajes del Engine
}
```

**Criterio de completitud:**  
`sesion-actual.md` nunca supera 8KB. Secciones historicas se comprimen sin
perder el estado operativo actual.

---

### TASK-07: Truncado inteligente de sesion-actual.md en system prompt

**Estado:** `[x]`  
**Esfuerzo:** 2h  
**Archivos:** `src/agent/system-prompt.ts`, `src/bootstrap/memory-loader.ts`  
**Depende de:** —

**Problema:**  
En `buildAgentSystemPrompt()` el contenido de `sesion-actual.md` se incluye
completo. Si el archivo tiene 20KB (sesion larga, muchos agentes escribiendo),
consume ~5K tokens de contexto en cada turno.

**Implementacion:**  
En `buildAgentSystemPrompt()`, si `memoryContext.sessionContent` supera 3KB,
incluir solo las secciones de alta prioridad:

```typescript
// src/agent/system-prompt.ts
const MAX_SESSION_CHARS = 3000;

function formatSessionContext(sessionContent: string): string {
    if (sessionContent.length <= MAX_SESSION_CHARS) return sessionContent;

    // Extraer solo secciones criticas
    const critical = extractSections(sessionContent, [
        'Feature en Curso',
        'Proximos Pasos',
        'Issues Activos',
        'Aprendizajes del Engine',
    ]);
    return `${critical}\n\n*(sesion-actual.md truncada — usa /memory para ver completa)*`;
}
```

**Criterio de completitud:**  
Con una `sesion-actual.md` de 15KB, el system prompt incluye solo las secciones
criticas (~2KB) y no el documento completo.

---

## Prioridad 4 — Precision del token counter y compactacion

### TASK-08: Token counter calibrado por tipo de mensaje

**Estado:** `[ ]`  
**Esfuerzo:** 2h  
**Archivos:** `src/context/token-counter.ts`  
**Depende de:** —

**Problema:**  
`estimateTokens()` usa `Math.ceil(text.length / 4)` para todo. Los mensajes
con tool_calls tienen overhead de estructura JSON no contabilizado, y los
mensajes `system` suelen tener mayor densidad que los `user`/`assistant`.

**Implementacion:**  
Calibrar por tipo de mensaje:

```typescript
// src/context/token-counter.ts
export function estimateMessagesTokens(messages: Message[]): number {
    return messages.reduce((total, msg: any) => {
        const baseChars = typeof msg.content === 'string' ? msg.content.length : 0;
        const toolOverhead = msg.tool_calls
            ? JSON.stringify(msg.tool_calls).length * 0.8  // JSON es mas denso
            : 0;
        const roleMultiplier = msg.role === 'system' ? 1.1 : 1.0; // system es mas denso
        return total + Math.ceil((baseChars + toolOverhead) * roleMultiplier / 4);
    }, 0);
}
```

**Criterio de completitud:**  
El estimador diverge menos de ±8% respecto al conteo real de un mensaje con
tool_calls pesado (verificar contra tokenizador de OpenAI o tiktoken).

---

### TASK-09: Re-compactacion si respuesta larga re-excede el umbral

**Estado:** `[ ]`  
**Esfuerzo:** 2h  
**Archivos:** `src/agent/loop.ts`, `src/agent/agent-loop/context-manager.ts`  
**Depende de:** —

**Problema:**  
En `loop.ts:511`, `compactIfNeeded()` se ejecuta ANTES de enviar a la API.
Si el modelo responde con una respuesta muy larga (codigo extenso + explicacion),
el array puede re-exceder el umbral antes del siguiente turno, pero no se
re-compacta hasta el turno siguiente.

**Implementacion:**  
Agregar verificacion post-respuesta:

```typescript
// src/agent/loop.ts - despues de push de assistant response (~linea 743)
this.messages.push({ role: 'assistant', content: clean });

// Re-compactar si la respuesta hizo exceder el umbral
const tokensAfter = estimateMessagesTokens(this.messages);
if (tokensAfter > CONTEXT_THRESHOLD_TOKENS * 1.2) {
    this.messages = await forceCompact(this.messages, this.summarizer, 6);
}
```

**Criterio de completitud:**  
Cuando el modelo genera una respuesta de 4000+ palabras, el contexto se
compacta automaticamente en el mismo turno sin esperar al siguiente.

---

## Prioridad 5 — Checkpoints consultables

### TASK-10: Checkpoints read-only — el agente puede consultarlos

**Estado:** `[ ]`  
**Esfuerzo:** 4h  
**Archivos:** `src/memory/updater.ts`, `src/bootstrap/memory-loader.ts`, `bin/cli.ts`  
**Depende de:** —

**Problema:**  
Los archivos `checkpoint-YYYY-MM-DD-{nombre}.md` se escriben pero **nunca se leen**.
No existe ningun codigo que abra el directorio `checkpoints/`. Son write-only.
El unico valor actual es para el usuario humano que los abre manualmente en un editor.
Tres gaps concretos:

1. No hay comando CLI para listar o cargar un checkpoint previo
2. El agente no sabe que existen al iniciar una sesion nueva
3. No hay herramienta `read_checkpoint` disponible para que el agente consulte
   el estado de un feature anterior cuando el usuario lo referencia

**Implementacion en tres partes:**

**Parte A — `listCheckpoints()` y `readCheckpoint()` en updater.ts:**

```typescript
// src/memory/updater.ts
export interface CheckpointSummary {
    filename: string;
    date: string;
    feature: string;
    path: string;
}

export async function listCheckpoints(projectDir: string): Promise<CheckpointSummary[]> {
    const dir = path.join(projectDir, 'checkpoints');
    try {
        const files = await fs.readdir(dir);
        return files
            .filter(f => f.startsWith('checkpoint-') && f.endsWith('.md'))
            .map(f => {
                // checkpoint-2026-05-09-nombre-feature.md
                const [, date, ...nameParts] = f.replace('.md', '').split('-');
                return {
                    filename: f,
                    date: `${date}-${nameParts[0]}-${nameParts[1]}`,
                    feature: nameParts.slice(2).join('-'),
                    path: path.join(dir, f),
                };
            })
            .sort((a, b) => b.date.localeCompare(a.date)); // mas reciente primero
    } catch {
        return [];
    }
}

export async function readCheckpoint(projectDir: string, filename: string): Promise<string | null> {
    const filePath = path.join(projectDir, 'checkpoints', filename);
    try {
        const r = await readFileSafeAsync(filePath);
        return r.content;
    } catch {
        return null;
    }
}
```

**Parte B — Comando `/checkpoint list` y `/checkpoint load <nombre>` en cli.ts:**

```typescript
// bin/cli.ts - dentro del handler de /checkpoint
if (featureName === 'list') {
    const checkpoints = await listCheckpoints(memoryContext.projectDir);
    if (checkpoints.length === 0) {
        console.log(formatCommandOutput(chalk.dim('Sin checkpoints guardados.')));
        return;
    }
    const lines = checkpoints.map((cp, i) =>
        `  ${i + 1}. ${chalk.cyan(cp.date)} — ${cp.feature}`
    );
    console.log(formatCommandOutput(lines.join('\n')));
    return;
}

if (featureName.startsWith('load ')) {
    const target = featureName.slice(5).trim();
    const checkpoints = await listCheckpoints(memoryContext.projectDir);
    const match = checkpoints.find(cp =>
        cp.feature.includes(target) || cp.filename.includes(target)
    );
    if (!match) {
        console.log(formatCommandOutput(chalk.red(`Checkpoint no encontrado: ${target}`)));
        return;
    }
    const content = await readCheckpoint(memoryContext.projectDir, match.filename);
    if (content) {
        agent.injectContextMessage(`## Checkpoint: ${match.feature} (${match.date})\n\n${content}`);
        console.log(formatCommandOutput(chalk.green(`Checkpoint cargado: ${match.feature}`)));
    }
    return;
}
```

**Parte C — `injectContextMessage()` en AgentLoop:**

```typescript
// src/agent/loop.ts
public injectContextMessage(content: string): void {
    // Agrega como mensaje system efimero (no persiste entre turnos)
    // Se inserta despues del system principal, antes del proximo user message
    this.pendingContextInjection = content;
}

// En _processInput(), antes de push del user message:
if (this.pendingContextInjection) {
    this.messages.push({ role: 'system', content: this.pendingContextInjection });
    this.pendingContextInjection = undefined;
}
```

**Criterio de completitud:**

- `/checkpoint list` muestra todos los checkpoints ordenados por fecha
- `/checkpoint load reflection-engine` inyecta el checkpoint en el contexto del agente
- El agente puede responder preguntas como "que teniamos pendiente en el feature X"
  consultando el checkpoint cargado sin que el usuario abra el archivo manualmente
- El checkpoint inyectado no persiste en `messages[]` mas alla del turno donde se uso

---

## Prioridad 3 (adicional) — Soporte multi-stack

### TASK-11: Pre-commit y perfiles de agente agnósticos al lenguaje

**Estado:** `[x]`  
**Esfuerzo:** 3h  
**Archivos:** `src/agent/commit/workflow.ts`, `src/agent/profiles.ts`, `src/bootstrap/global-seed.ts`  
**Depende de:** —

**Problema:**  
El sistema asume TypeScript/Node en tres puntos criticos:

1. **`runPreCommitTests()` — bloqueante** (`src/agent/commit/workflow.ts:348`):
   Ejecuta `npx tsc --noEmit` + `npx jest` incondicionalmente. En un proyecto Go
   o Rust sin `tsconfig.json`, el pre-commit falla con error de proceso antes de
   poder commitear nada.

2. **Perfil `coder`** (`src/agent/profiles.ts:87`):
   Instruccion hardcodeada: `"Verificas que compile (tsc --noEmit)"`. El agente
   usaria el comando equivocado en proyectos Go, Rust o Python.

3. **Perfil `backend-agent`** (`src/agent/profiles.ts:229`):
   `"Siempre entrega codigo TypeScript con tipado estricto."` — instruccion
   incorrecta en un proyecto Go o Python.

**Casos afectados:**

| Proyecto | Señal detectada | Problema |
|---|---|---|
| Go | `go.mod` | `npx tsc` → `command not found` o `tsconfig not found` |
| Rust | `Cargo.toml` | idem |
| Python | `pyproject.toml` | idem |
| Rush monorepo | `rush.json` (no detectado) | AGENT.md generico; `npx jest` corre desde raiz sin tests |

Nota: `global-seed.ts` ya detecta Go, Rust, Python y genera el AGENT.md correcto.
El gap esta exclusivamente en el pre-commit y en los profiles builtin.

**Implementacion:**

**Parte A — `detectStack()` compartida en `workflow.ts`:**

```typescript
// src/agent/commit/workflow.ts
async function detectStack(cwd: string): Promise<'go' | 'rust' | 'python' | 'node'> {
    if (await fileExists(path.join(cwd, 'go.mod')))           return 'go';
    if (await fileExists(path.join(cwd, 'Cargo.toml')))       return 'rust';
    if (await fileExists(path.join(cwd, 'pyproject.toml')) ||
        await fileExists(path.join(cwd, 'requirements.txt'))) return 'python';
    return 'node'; // default: Node/TypeScript
}

export async function runPreCommitTests() {
    const stack = await detectStack(process.cwd());
    switch (stack) {
        case 'go':
            execSync('go build ./...', execOpts);
            execSync('go test ./...', execOpts);
            break;
        case 'rust':
            execSync('cargo check', execOpts);
            execSync('cargo test', execOpts);
            break;
        case 'python':
            execSync('python -m pytest --tb=short', execOpts);
            break;
        default:
            execSync('npx tsc --noEmit', execOpts);
            execSync('npx jest --passWithNoTests --maxWorkers=1', execOpts);
    }
}
```

**Parte B — Perfiles de agente con placeholders de stack:**

En `profiles.ts`, reemplazar referencias TS hardcodeadas por texto neutral:

```typescript
// coder — antes:
'3. Verificas que compile (tsc --noEmit)'
// coder — despues:
'3. Verificas que compile segun el stack del proyecto (tsc, go build, cargo check, etc.)'

// backend-agent — antes:
'Siempre entrega codigo TypeScript con tipado estricto.'
// backend-agent — despues:
'Siempre entrega codigo en el lenguaje del proyecto con tipado estricto cuando el stack lo soporte.'
```

**Parte C — Deteccion de Rush en `global-seed.ts`:**

```typescript
// Antes del bloque Node/package.json:
if (await fileExists(path.join(cwd, 'rush.json'))) {
    return {
        type: 'rush-monorepo',
        runtime: 'Node.js (Rush monorepo)',
        buildTool: 'rush build',
        testFramework: 'rush test (por paquete)',
        // ... convenciones de monorepo
    };
}
```

**Criterio de completitud:**

- En un proyecto con `go.mod`, el pre-commit ejecuta `go build ./... && go test ./...` sin errores
- En un proyecto con `Cargo.toml`, el pre-commit ejecuta `cargo check && cargo test`
- El agente `coder` no menciona `tsc` en proyectos no-TypeScript
- Un proyecto Rush genera AGENT.md con estructura de monorepo y `rush build` como buildTool

---

## Resumen de tareas

| ID | Descripcion | Prioridad | Esfuerzo | Estado | Depende de |
|---|---|:---:|:---:|:---:|---|
| TASK-01 | Hallazgos criticos → sesion-actual.md | P1 | 3h | `[x]` | — |
| TASK-02 | Patrones promovidos → contexto-proyecto.md | P1 | 2h | `[x]` | — |
| TASK-03 | Seccion `## Aprendizajes del Engine` en sesion | P1 | 3h | `[x]` | TASK-01, 02 |
| TASK-04 | Resumen de contexto largo para especialistas | P2 | 4h | `[x]` | — |
| TASK-05 | `[memory:*]` en system prompt de especialistas | P2 | 1h | `[x]` | — |
| TASK-06 | Limite 8KB + compactacion automatica de sesion | P3 | 3h | `[x]` | — |
| TASK-07 | Truncado inteligente de sesion en system prompt | P3 | 2h | `[x]` | — |
| TASK-08 | Token counter calibrado por tipo de mensaje | P4 | 2h | `[x]` | — |
| TASK-09 | Re-compactacion post-respuesta larga | P4 | 2h | `[x]` | — |
| TASK-10 | Checkpoints consultables: list + load + inject | P5 | 4h | `[x]` | — |
| TASK-11 | Pre-commit multi-stack: Go, Rust, Python, Rush | P3 | 3h | `[x]` | — |

**Esfuerzo total estimado:** ~29h

---

## Impacto esperado por prioridad

**P1 (TASK-01/02/03):** El Reflection Engine cierra el ciclo completo hacia la
memoria operativa. Los hallazgos de QA, seguridad y patrones promovidos aparecen
en `sesion-actual.md` y `contexto-proyecto.md` automaticamente. El usuario
retoma sesiones con contexto actualizado sin depender de `/checkpoint` manual.

**P2 (TASK-04/05):** Los especialistas operan con contexto completo del historial
(no solo los 6 mensajes recientes) y saben como contribuir a la memoria compartida.
Reduce la perdida de contexto en sesiones largas con delegaciones multiples.

**P3 (TASK-06/07):** La memoria persistente no crece infinitamente y no consume
tokens innecesarios del system prompt. Sesiones de 4h+ se mantienen eficientes.

**P4 (TASK-08/09):** El sistema opera mas cerca del limite real del modelo con
mejor precision. Elimina el riesgo de exceder el contexto entre turnos.

**P5 (TASK-10):** Los checkpoints pasan de ser write-only a write-read. El agente
puede consultar el estado de cualquier feature anterior en segundos, sin que el
usuario abra archivos manualmente. Cierra el ciclo de utilidad del `/checkpoint`.

---

## Arquitectura del ciclo completo (objetivo)

```
Codigo generado
    ↓
QA / Security / Audit gates
    ↓
AuditReporter.completeSprint()          [existente]
    ↓
ReflectionEngine.reportIncident()        [existente]
    ↓
TASK-01: AuditHook → sesion-actual.md   [nuevo]
    ↓
ReflectionEngine.reflect()              [existente]
    ↓
TASK-02: patron promovido → contexto-proyecto.md   [nuevo]
    ↓
TASK-03: Aprendizajes del Engine en sesion-actual.md [nuevo]
    ↓
System prompt (proxima sesion)          [cierra el ciclo]
```

```
ask_agent (delegacion)
    ↓
TASK-04: especialista recibe resumen historico [nuevo]
    ↓
TASK-05: especialista emite [memory:decision]  [nuevo]
    ↓
loop.ts:674 → updateSessionMemory()     [existente]
    ↓
sesion-actual.md actualizada
```

```
/checkpoint <nombre>           [existente — escribe]
    ↓
checkpoints/checkpoint-YYYY-MM-DD-{nombre}.md

/checkpoint list               [TASK-10 — lista]
    ↓
Muestra checkpoints ordenados por fecha

/checkpoint load <nombre>      [TASK-10 — lee e inyecta]
    ↓
TASK-10: injectContextMessage() → messages[] efimero
    ↓
Agente responde con contexto del feature anterior
```
