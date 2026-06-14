# workflow.empresa.ventas

Instancia del `orchestrator-agent` configurada para el equipo de ventas de una empresa de software consulting.

---

## Qué es esto

Este directorio **no es una app** — es una **configuración de dominio** para el motor genérico `orchestrator-agent`. La relación es la misma que entre un framework y una aplicación: el orquestador es el motor, este workflow es la instancia de negocio.

```
backendkit-agents/
  packages/orchestrator-agent/    ← el MOTOR (genérico, reusable)
    dist/server.js                   proceso MCP que corre

agent-framework-examples/
  workflow.empresa.ventas/        ← la INSTANCIA (dominio ventas)
    orchestrator.yaml                le dice al motor QUÉ hacer
    flows/                           flujos de trabajo declarados
    vault/                           conocimiento del dominio
```

---

## Estructura

### `orchestrator.yaml` — el cerebro de la instancia

Define qué agentes existen en este equipo de ventas y qué LLM provider usan:

```yaml
agents:
  - id: lead-agent          # especialista en calificación BANT
  - id: proposal-agent      # redacta propuestas  [GATE]
  - id: pricing-agent       # calcula precios y descuentos
  - id: legal-sales-agent   # revisa contratos    [GATE]
  - id: crm-agent           # registra en CRM
  - id: writer-agent        # redacta emails y documentos
```

Los `[GATE]` son pasos que pausan y esperan aprobación humana antes de continuar.

### `flows/` — los procesos declarados

Recetas YAML que definen qué agentes ejecutar, en qué orden, con qué dependencias:

```
calificacion-lead.yaml:
  s1-investigar  (lead-agent)
       ↓
  s2-estimar-valor  (pricing-agent)   ← recibe output de s1
       ↓
  s3-email-contacto  (writer-agent)   ← recibe output de s1 + s2
       ↓
  s4-registrar-crm  (crm-agent)       ← recibe todo

propuesta-comercial.yaml:
  s1-propuesta-tecnica  (proposal-agent)  [GATE → aprobación humana]
       ↓
  s2-pricing  (pricing-agent)
       ↓
  s3-revision-legal  (legal-sales-agent)  [GATE → aprobación humana]
       ↓
  s4-documento-final  (writer-agent)
       ↓
  s5-actualizar-crm  (crm-agent)
```

### `vault/` — el conocimiento del dominio

Archivos Markdown indexados con TF-IDF (SimpleEmbedder) e inyectados como contexto RAG en el prompt de cada agente:

```
vault/
  productos/
    catalogo-servicios.md       → qué vendemos y a quién
    pricing-policy.md           → tarifas 2026 y política de descuentos
  procesos/
    ciclo-venta.md              → etapas del pipeline, criterios de avance
    calificacion-bant.md        → señales positivas/negativas BANT + ICP
  politicas/
    condiciones-comerciales.md  → SLA, NDA, IP, cláusulas prohibidas
  lecciones/                    → (vacío al inicio) se llena solo tras cada run
```

El índice vectorial se genera en `.orchestrator/rag-lance/` al primer run y se actualiza incrementalmente (solo re-indexa archivos modificados).

---

## Cómo funciona en runtime

```
test-flow.mjs
    │
    │  spawn stdio
    ▼
orchestrator-agent (dist/server.js)
    │
    ├──► lee orchestrator.yaml      → sabe qué agentes existen y qué provider usar
    │
    ├──► indexa vault/*.md          → 87 chunks en LanceDB (.orchestrator/rag-lance/)
    │
    │  recibe orchestrator_run con flow_id="calificacion-lead"
    │
    ├──► carga flows/calificacion-lead.yaml
    │        │
    │        │  por cada step:
    │        │    1. busca en vault lo relevante para esa tarea  ← RAG
    │        │    2. arma prompt = system(agente) + task + vault_context + outputs_previos
    │        │    3. llama al LLM (DeepSeek) → obtiene el output
    │        │    4. guarda en RunStore (.orchestrator/runs/)
    │
    └──► al terminar: consolidateRun() → LLM destila aprendizajes → vault/lecciones/
```

Los agentes **no son procesos separados** — son el mismo LLM invocado con un system prompt distinto por cada rol. El vault RAG es lo que los hace especialistas reales en ventas.

---

## Setup

### 1. Variables de entorno

```bash
cp .env.example .env
# Editá .env y completá:
DEEPSEEK_API_KEY=sk-...
```

### 2. Build del motor (solo la primera vez o cuando cambia el código)

```bash
cd ../../backendkit-agents/packages/orchestrator-agent
npm run build
```

### 3. Ejecutar un flow

```bash
# Desde workflow.empresa.ventas/
node test-flow.mjs calificacion-lead     # califica un nuevo lead (4 agentes)
node test-flow.mjs propuesta-comercial   # arma propuesta con 2 gates de aprobación
node test-flow.mjs dynamic               # el orquestador planifica libremente
TASK="..." node test-flow.mjs dynamic    # tarea custom
```

O via npm:
```bash
npm run test:lead
npm run test:propuesta
npm run test:libre
```

---

## Agentes y sus roles

| Agente | Rol | Gate |
|--------|-----|------|
| `lead-agent` | Investiga y califica con BANT. Determina fit, score y próximos pasos | — |
| `proposal-agent` | Redacta propuesta técnica: scope, entregables, cronograma, valor diferencial | ✓ |
| `pricing-agent` | Estructura el precio según catálogo, aplica descuentos dentro de política | — |
| `legal-sales-agent` | Revisa SLA, responsabilidad, NDA, IP, terminación | ✓ |
| `crm-agent` | Registra actividades, actualiza pipeline, define próximas acciones | — |
| `writer-agent` | Redacta emails, comunicaciones ejecutivas, documentos de presentación | — |

---

## Datos persistentes

Todo lo que genera el orquestador se guarda en `.orchestrator/` (gitignoreado):

```
.orchestrator/
  runs/          → historial de ejecuciones (JSON por run)
  rag-lance/     → índice vectorial TF-IDF del vault
```

Y en `vault/lecciones/` (commiteado): aprendizajes destilados por `consolidateRun()` tras ejecuciones interesantes.

---

## Cómo extender este workflow

**Agregar un agente nuevo:**
1. Declararlo en `orchestrator.yaml` bajo `agents:`
2. Agregarlo a los flows YAML que lo necesiten
3. Opcionalmente darle un `system_prompt` personalizado en el YAML

**Agregar conocimiento al vault:**
1. Crear un `.md` en la carpeta temática de `vault/`
2. El próximo run re-indexa automáticamente (cambio de mtime detectado)

**Crear un flow nuevo:**
1. Crear `flows/mi-flow.yaml` con los steps y dependencias
2. Declararlo en `orchestrator.yaml` bajo `flows:` con su `trigger`

**Crear otro workflow de otra área (ej. marketing):**
```bash
cp -r workflow.empresa.ventas workflow.empresa.marketing
# Editar orchestrator.yaml con los agentes de marketing
# Editar vault/ con el conocimiento de marketing
# Los flows y test-flow.mjs se reusan sin cambios
```
