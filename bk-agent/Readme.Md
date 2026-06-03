# DeepSeek Code

Agente de codificacion CLI potenciado por DeepSeek. Sistema multi-agente con orquestacion inteligente, auto-aprendizaje, auditoria integrada y memoria persistente.

---

## Indice

1. [Que es DeepSeek Code?](#que-es-deepseek-code)
2. [Instalacion](#instalacion)
3. [Inicio rapido](#inicio-rapido)
4. [Arquitectura del sistema](#arquitectura-del-sistema)
5. [Comandos CLI](#comandos-cli)
6. [Sesion interactiva](#sesion-interactiva)
7. [Seleccion automatica de agentes](#seleccion-automatica-de-agentes)
8. [Auto-aprendizaje (Reflection Engine)](#auto-aprendizaje-reflection-engine)
9. [Auditorias multi-gate](#auditorias-multi-gate)
10. [Manejo de contexto y memoria](#manejo-de-contexto-y-memoria)
11. [Uso del vault de Obsidian](#uso-del-vault-de-obsidian)
12. [Git Workflow](#git-workflow)
13. [Configuracion](#configuracion)
14. [Variables de entorno](#variables-de-entorno)

---

## Que es DeepSeek Code?

DeepSeek Code es un **asistente de codificacion autonomo** que opera desde la terminal. No es un chat generico: entiende tu proyecto real, ejecuta herramientas como `read_file`, `write_file`, `execute_command` y `ripgrep_search`, y coordina **8 agentes especializados** con un orquestador inteligente que revisa calidad, seguridad y arquitectura antes de cada entrega.

### Capacidades clave

| Capacidad | Descripcion |
|-----------|-------------|
| 8 Agentes Expertos | General, Security, Infrastructure, Architect, Data, Backend, Frontend, QA |
| Orquestacion Multi-agente | Pipeline architecture -> security -> QA -> informe final |
| Obsidian Vault | Busca patrones existentes antes de generar codigo nuevo |
| Audit Reporter | Informes multi-gate con version semantica, SHA-256 y trazabilidad hallazgo -> commit |
| Reflection Engine | Auto-aprendizaje: detecta patrones de error (>=3 ocurrencias) y los promociona a policyRules |
| Memoria Persistente | Contexto de proyecto que sobrevive entre sesiones |
| Git Flow Integrado | Conventional Commits con validacion automatica (tsc + tests) |
| Skills Extensibles | Especializaciones con triggers automaticos |

---

## Instalacion

### Requisitos

| Requisito | Version minima | Notas |
|-----------|---------------|-------|
| Node.js | 18+ | Requerido para ejecucion |
| npm | 9+ | Gestor de paquetes |
| ripgrep (rg) | 13+ | Busqueda rapida en codigo |
| PowerShell | 5.1+ | Windows (nativo) |
| Git | 2.30+ | Control de versiones |

### Desde NPM

```bash
npm install -g deepseek-code-tui
```

### Desde el repositorio

```bash
git clone <repo-url>
cd deepseek-code
npm install
npm run build
npm link
```

### Verificar instalacion

```bash
deepseek-code --version
# -> 0.2.0
```

---

## Inicio rapido

### 1. Configurar API Key

```bash
# Windows PowerShell
$env:DEEPSEEK_API_KEY = "sk-..."

# Linux / macOS
export DEEPSEEK_API_KEY="sk-..."
```

### 2. Inicializar proyecto

```bash
cd mi-proyecto
deepseek-code init --vault-path "/ruta/a/mi/vault"
```

Esto crea:
```
.ai-assistant/
  config.yaml           <- Configuracion del agente
  context.md            <- Descripcion del proyecto
  instructions.md       <- Reglas y triggers del vault
.obsidian-vault/
  link.txt              <- Ruta al vault de Obsidian
```

### 3. Iniciar sesion

```bash
deepseek-code
```

### 4. Primeros comandos

```
> explícame la estructura del proyecto
> /context               <- muestra el contexto cargado
> /skills                <- lista skills disponibles
> /tokens                <- uso del context window
```

---

## Arquitectura del sistema

### Componentes principales

```
+------------------------------------------------------------------+
|                     DEEPSEEK CODE CLI v0.2.0                      |
|                                                                   |
|  +------------+  +----------+  +-----------+  +---------------+  |
|  |  Terminal   |  |  Agent   |  |   Tool     |  |Skill Engine   |  |
|  |  Interactiva|<-+  Loop    |->|  Executor  |  |(load/registry)|  |
|  +------------+  +----+-----+  +-----+-----+  +-------+-------+  |
|                       |              |                 |          |
|  +-----------------+  |   +---------+----------+     |          |
|  |  Orchestrator    |<-+   |  DeepSeek Client    |     |          |
|  |  (multi-agente)  |      |  (API DeepSeek)    |     |          |
|  +--------+--------+      +---------+----------+     |          |
|           |                        |                 |          |
|  +--------+--------+    +----------+----------+  +---+--------+ |
|  |  Audit Reporter  |    |  Reflection Engine   |  |  Vault     | |
|  |  (informes MD)   |    |  (auto-aprendizaje) |  |  Search    | |
|  +-----------------+    +---------------------+  +------------+ |
|                                                                   |
|  +-----------------+    +---------------------+                   |
|  |  Memory System   |    |  Bootstrap / Config  |                   |
|  |  (sesion+proyecto)|   |  (carga inicial)    |                   |
|  +-----------------+    +---------------------+                   |
+------------------------------------------------------------------+
         |                        |                        |
         v                        v                        v
  +--------------+       +--------------+       +------------------+
  |  Sistema de   |       |  DeepSeek API |       |  Obsidian Vault   |
  |  Archivos     |       |  (chat/reason)|       |  (patrones/rec)   |
  +--------------+       +--------------+       +------------------+
```

### Flujo de una peticion

1. **Usuario** escribe un mensaje en la terminal
2. **Agent Loop** recibe el input y lo pasa al **Orchestrator**
3. **Orchestrator** ejecuta el pipeline: Intent Detection -> Domain Detection -> Risk Scoring -> Policy Engine
4. **Seleccion de agentes**: segun dominios detectados y politicas aplicadas
5. **Ejecucion**: el agente seleccionado usa herramientas (read_file, write_file, etc.) contra el codigo real
6. **Gates de calidad**: si aplica, se ejecutan gates de security, architecture y/o QA
7. **Respuesta**: se muestra al usuario con formato Markdown

---

## Comandos CLI

### `deepseek-code` - Sesion interactiva

```bash
deepseek-code [opciones]
```

| Opcion | Default | Descripcion |
|--------|---------|-------------|
| `-k, --api-key <key>` | `$DEEPSEEK_API_KEY` | API key de DeepSeek |
| `-m, --model <model>` | `deepseek-chat` | Modelo a usar |
| `-b, --base-url <url>` | API oficial | URL base alternativa |
| `--no-vault` | - | Desactiva integracion con vault |
| `--skill <name>` | todos activos | Activa solo un skill |
| `--max-iterations <n>` | `100` | Limite de tool calls por turno |
| `--iteration-mode <mode>` | `interactive` | Modo: interactive / auto / step-by-step |
| `--command-timeout <s>` | sin limite | Timeout para execute_command |
| `--no-stream` | - | Modo batch (sin streaming) |
| `--no-qa` | - | Desactiva revision automatica de QA |
| `--no-delegation` | - | Desactiva delegacion a sub-agentes |

### `deepseek-code init` - Inicializar proyecto

```bash
deepseek-code init [--vault-path "ruta/al/vault"]
```

### `deepseek-code research <tema>` - Investigacion autonoma

```bash
deepseek-code research "Circuit Breaker pattern en NestJS"
```

---

## Sesion interactiva

### Comandos internos (slash commands)

| Comando | Descripcion |
|---------|-------------|
| `/help` | Muestra todos los comandos disponibles |
| `/clear` | Limpia la pantalla y muestra el logo |
| `/reset-context` | Reinicia la conversacion (mantiene sistema y memoria) |
| `/context` | Muestra el contexto del proyecto |
| `/tokens` | Uso de tokens con barra visual |
| `/usage` | Tokens y costo estimado de sub-agentes |
| `/skills` | Lista, instala y crea skills |
| `/agent` | Cambia de agente especializado |
| `/agent reload` | Recarga agentes custom desde disco |
| `/models` | Cambia el modelo de IA (V3 / R1) |
| `/obsidian <ruta>` | Conecta o cambia vault de Obsidian |
| `/memoria` | Muestra memoria persistente del proyecto |
| `/switch [proyecto]` | Cambia de proyecto (requiere vault) |
| `/proyectos` | Lista proyectos locales conocidos |
| `/checkpoint <nombre>` | Crea checkpoint del feature actual |
| `/reload-files` | Recarga AGENT.md y USER.md del workspace |
| `/iteration` | Cambia modo de iteracion en caliente |
| `/status` | Panel completo de estado del sistema |
| `/research <tema>` | Investiga y guarda articulo en vault |
| `@commit` | Architecture Agent genera plan de commit + QA ejecuta |
| `@test` | Staged -> tests -> QA -> commit automatico |
| `salir` / `exit` | Cierra la sesion |

### Herramientas del agente

| Herramienta | Accion | Confirma? |
|-------------|--------|:---------:|
| `read_file` | Lee contenido de archivo | No |
| `list_directory` | Lista contenido de directorio | No |
| `ripgrep_search` | Busca patron en el codigo | No |
| `git_diff` | Muestra cambios de git | No |
| `vault_search` | Busca patrones en el vault | No |
| `write_file` | Escribe o modifica archivo | Si (diff) |
| `edit_file` | Edita archivo (reemplazo exacto) | Si (diff) |
| `execute_command` | Ejecuta comando shell | Si (warning) |
| `ask_agent` | Delega a sub-agente especializado | No (configurable) |

---

## Seleccion automatica de agentes

DeepSeek Code incluye **8 agentes especializados built-in** que se activan automaticamente segun el contexto del mensaje.

### Los 8 agentes

| Agente | ID | Icono | Modelo | Disparadores (triggers) |
|--------|----|:-----:|--------|------------------------|
| **General** | `general` | robot | `deepseek-chat` | Default - cualquier mensaje |
| **Security** | `security` | lock | `deepseek-reasoner` | seguridad, vulnerabilidad, jwt, oauth, autenticacion |
| **Infrastructure** | `infrastructure` | gear | `deepseek-chat` | docker, kubernetes, terraform, ci/cd, aws |
| **Architect** | `architecture` | building | `deepseek-reasoner` | arquitectura, ddd, microservicio, adr, c4 |
| **Data Engineer** | `data` | chart | `deepseek-chat` | sql, pipeline, spark, bigquery, machine learning |
| **Backend** | `backend` | desktop | `deepseek-reasoner` | implementa, api, endpoint, nestjs, crud |
| **Frontend** | `frontend` | art | `deepseek-chat` | react, vue, componente, css, tailwind |
| **QA Engineer** | `qa-engineer` | test_tube | `deepseek-chat` | test, testing, cobertura, jest, playwright |

### Como funciona el ruteo

1. **Deteccion textual** - El mensaje del usuario se analiza con los `triggers` de cada agente
2. **Seleccion** - Se elige el agente con mas coincidencias. Si hay empate, gana el mas especifico
3. **Cambio de modelo** - Si el agente requiere `deepseek-reasoner`, el modelo cambia automaticamente
4. **Retorno** - Al terminar, se vuelve al agente `general`

### Pipeline de orquestacion

El **Orchestrator** ejecuta un pipeline de 4 etapas:

1. **Intent Detection** - Clasifica la accion (design, implement, review, test, investigate)
2. **Domain Detection** - Identifica bounded contexts (security, backend, database, etc.)
3. **Risk Scoring** - Calcula nivel de riesgo tecnico (low, medium, high, critical)
4. **Policy Engine** - Aplica reglas y determina agentes/gates obligatorios

El resultado es un `OrchestrationResult` que contiene:
- `task` - Contexto enriquecido con dominios, riesgo y estado
- `selectedAgents` - Agentes seleccionados con scores
- `agentPipeline` - Pipeline secuencial (review -> implement -> verify)
- `requiredGates` - Gates que deben pasar (qa, security, architecture)
- `commitAllowed` - Si el commit esta permitido

### Agentes personalizados

Puedes crear agentes propios en:

```
~/.deepseek-code/agents/<id>.md
```

Formato del archivo:

```yaml
---
name: Mi Experto
icon: wizard
description: Experto en tecnologia X
model: deepseek-reasoner
triggers: [palabra-clave, otra-palabra]
---

## Especializacion: Mi Experto

Instrucciones personalizadas para el agente.
```

Los agentes personalizados se fusionan con los built-in. Si usas el mismo `id`, **reemplazan** al built-in.

---

## Auto-aprendizaje (Reflection Engine)

El **Reflection Engine** es el sistema de auto-mejora que convierte errores recurrentes en reglas deterministas. Implementa el patron MAPE-K (Monitor-Analyze-Plan-Execute over a Knowledge base).

### Pipeline

```
Feedback (incidente) -> FailureCatalog (persistencia) -> PatternDetector (>=3 ocurrencias) -> PolicyPromoter (manifest.yaml) -> PolicyEngine (prevencion futura)
```

### Regla de oro

> Si un fallo ocurre 3 veces, no debe seguir siendo decision del LLM - debe convertirse en policy.

### 5 dominios de captura

| Dominio | FailureTypes | Hook | Se integra en |
|---------|:------------:|------|---------------|
| **Audit** | 10 | `AuditHook` | `AuditReporter.completeSprint()` |
| **Test** | 8 | `TestHook` | Test Validation Gate |
| **Commit** | 9 | `CommitHook` | Pre-commit / commit-msg hooks |
| **Agent** | 7 | `AgentHook` | Agent orchestrator / evaluator |
| **Bootstrap** | 8 | `BootstrapHook` | Project initialization |

### Ejemplo de ciclo completo

1. **Feedback**: Security gate detecta "hardcoded_secret"
2. **Catalog**: Se guarda en failures.json
3. **Detector**: Ya hay 3 ocurrencias de "hardcoded_secret"
4. **Promoter**: Se escribe policyRule en manifest.yaml
5. **Prevention**: El orquestador ahora bloquea automaticamente cualquier tarea que involucre secretos sin gate de security

### API publica

```typescript
import { ReflectionEngine } from './reflection';

const engine = new ReflectionEngine({ projectRoot: process.cwd() });
await engine.initialize();

// Reportar un incidente
await engine.reportIncident({
  domain: 'audit',
  failureType: 'missing_rollback',
  severity: 'Alta',
  dimension: 'resiliencia',
  gate: 'qa-engineer',
  agenteResponsable: 'backend',
  hallazgo: 'Transaccion sin rollback en error',
  recomendacion: 'Agregar try/catch con rollback explicito',
  archivos: ['src/orders/create-order.ts'],
});

// Obtener estadisticas
const stats = await engine.getStats();
// -> { totalFailures: 42, patternsDetected: 5, policiesPromoted: 3, ... }
```

### Configuracion

```yaml
# En ~/.deepseek-code/orchestrator.yaml
reflection:
  enabled: true
  promotionThreshold: 3        # Ocurrencias para promover a policy
  autoPromote: true            # Promocion automatica sin confirmacion
  autoGenerateAdr: true        # Genera ADR automatico al promover
  activeDomains:
    - audit
    - test
    - commit
    - agent
    - bootstrap
```

---

## Auditorias multi-gate

El **Audit Reporter** genera informes Markdown con version semantica y verificacion de integridad SHA-256.

### Pipeline de gates

1. **Architecture Gate** - Valida diseno, patrones y estructura
2. **Security Gate** - Revisa vulnerabilidades y buenas practicas de seguridad
3. **QA Gate** - Verifica tests, cobertura y calidad del codigo
4. **Informe Final** - Consolidado con veredicto GO / NO-GO / NO-GO condicional

### Versionado

| Evento | Incremento | Ejemplo |
|--------|:----------:|---------|
| Gate individual | `patch` | `v1.0.0` -> `v1.0.1` |
| Informe final | `minor` | `v1.0.0` -> `v1.1.0` |
| Reset manual | `major` | `v1.0.0` -> `v2.0.0` |

### Estructura de archivos

```
~/.deepseek-code/projects/{hash}/audits/
  gate-architecture-v1.0.0.md
  gate-security-v1.0.1.md
  gate-qa-v1.0.2.md
  informe-final-multigate-v1.1.0.md
  pending-issues-*.md              <- Issues criticos/altos bloqueantes
  auto-gates-2026-05-02.md         <- Reporte diario de auto-gates silenciosos
  lecciones-aprendidas.md           <- Memo acumulativo
  .audit-report-version.json        <- Estado del versionado
```

### Tipos de hallazgos

| Severidad | Significado | Accion |
|-----------|-------------|--------|
| Critica | Perdida de datos, brecha de seguridad | Bloquea deploy obligatoriamente |
| Alta | Cobertura insuficiente, sin CI/CD | Bloquea deploy hasta resolver |
| Media | Code smells, documentacion faltante | Resolver en el sprint |
| Baja | Mejoras cosmeticas o menores | Backlog tecnico |

### Trazabilidad hallazgo -> commit

Cada hallazgo puede marcarse como resuelto vinculandolo a un commit:

```typescript
await auditReporter.markFindingResolved("H-001", "abc123", "fix: add timeout to tool executor");
```

### Bloqueo de deploys (CI/CD)

```typescript
const report = await auditReporter.generateCiReport();
if (!report.ok) {
  console.log(report.message); // "Deploy bloqueado"
  process.exit(1);
}
```

---

## Manejo de contexto y memoria

La memoria permite que DeepSeek Code recuerde el contexto del proyecto entre sesiones.

### Ubicacion

```
~/.deepseek-code/projects/{hash}/
  memory/
    sesion-actual.md        <- Estado actual de la sesion
    contexto-proyecto.md    <- Stack, arquitectura, convenciones
    proyecto-log.md         <- Historial de sesiones y hitos
    checkpoints/            <- Snapshots de estado
  audits/                   <- Informes de auditoria
  reflection/
    failures.json           <- Catalogo del Reflection Engine
```

El `{hash}` se genera a partir del directorio de trabajo, aislando la memoria por proyecto.

### Memoria dinamica auto-gestionada (Capa 1)

Los agentes especialistas pueden dejar marcas `[memory:*]` en sus respuestas para actualizar automaticamente la memoria de sesion sin depender del agente General.

Formato soportado:
```
[memory:feature] Nombre del feature
[memory:progress] 75%
[memory:issues] Issue 1 detectado
[memory:decision] Se decidio X porque Y
[memory:next-steps] Paso 1; Paso 2; Paso 3
[memory:notes] Nota adicional
```

El sistema detecta estas marcas, las parsea y llama automaticamente a `updateSessionMemory()`.

### Comandos de memoria

| Comando | Accion |
|---------|--------|
| `/memoria` | Muestra la memoria persistente del proyecto activo |
| `/checkpoint <nombre>` | Crea un checkpoint y compacta la sesion |
| `/switch [proyecto]` | Cambia de proyecto (requiere vault) |
| `/proyectos` | Lista proyectos locales conocidos |

### Herramientas de actualizacion

El sistema expone dos herramientas para actualizar la memoria:

- `update_session_memory` - Actualiza feature en curso, progreso, proximos pasos, issues, decisiones
- `update_project_context` - Actualiza stack, arquitectura, convenciones, proyectos relacionados, archivos clave

---

## Uso del vault de Obsidian

DeepSeek Code se integra con tu **vault de Obsidian** como base de conocimiento personal.

### Que hace con el vault?

1. **Busca patrones** antes de generar codigo - evita reinventar la rueda
2. **Guarda investigaciones** como notas estructuradas (`/research <tema>`)
3. **Extrae patrones reutilizables** automaticamente cuando completas una feature
4. **Instala skills** desde el vault al sistema de skills activo

### Configurar vault

```bash
deepseek-code init --vault-path "/ruta/absoluta/a/mi/vault"
```

O en sesion interactiva:

```
> /obsidian /ruta/absoluta/a/mi/vault
```

### Estructura esperada del vault

```
mi-vault/
  00-Memoria-DeepSeek/        <- Memoria de proyectos (auto-gestionado)
    contexto-activo.md
    proyectos/
    agentes/                  <- Agentes editables guardados aqui
  04-Recursos/                <- Carpeta de busqueda por defecto
    Backend/
      Microservicios/
      RabbitMQ/
    Arquitectura/
    Skills/                   <- Skills instalables desde vault
  00-INDEX-PATRONES.md        <- Indice generado automaticamente
```

### Comportamiento de busqueda

1. El agente extrae **keywords** de tu mensaje
2. Busca archivos `.md` relevantes en `04-Recursos/`
3. Si encuentra patrones utiles, los incluye como contexto
4. Marca el resultado con (vault) o (generado nuevo)

### VaultProvider (arquitectura desacoplada)

La busqueda en el vault usa la interfaz `VaultProvider` que desacopla la fuente del vault (filesystem, mock, git, S3, API) de la logica de busqueda.

Implementaciones disponibles:
- `FileSystemVaultProvider` - Acceso a filesystem local (produccion)
- `MockVaultProvider` - Vault en memoria para tests

```typescript
import { VaultProvider, FileSystemVaultProvider } from './vault/vault-provider';

const provider = new FileSystemVaultProvider('/ruta/al/vault');
const results = await provider.search(['**/*.md'], ['04-Recursos']);
```

### Extraccion de patrones al vault

Cuando implementes codigo que sea un patron reutilizable (value objects, aggregate roots, domain errors, configuraciones genericas, clientes HTTP, etc.):

1. Usa `extract_to_vault` para guardarlo en el vault
2. La ruta debe ser dentro de `04-Recursos/` (ej: `04-Recursos/Backend/Patrones/mi-patron.md`)
3. Incluye tags relevantes (stack, tipo de patron)
4. NO extraer codigo especifico del negocio - solo lo generico y reutilizable

---

## Git Workflow

DeepSeek Code integra Git Flow con **validacion automatica pre-commit** (Test Validation Gate).

### Estructura de ramas

```
master (produccion)
  ^ merge desde release (con tag vX.Y.Z)
release/X.Y.Z (staging)
  ^ merge desde develop
develop (integracion)
  ^ merge desde feature/* o fix/*
feature/{iniciales}_{descripcion}_{YYYYMMDD}
fix/{iniciales}_{descripcion}_{YYYYMMDD}
```

### Validacion automatica (Test Validation Gate)

Antes de **cualquier commit**, el workflow ejecuta:

1. `tsc --noEmit` - Si falla -> ABORTA
2. `jest run` - Si falla -> ABORTA

### Comandos Makefile

```bash
# Tests
make test                    # npx jest
make typecheck               # npx tsc --noEmit
make test-coverage           # npx jest --coverage

# Commits (auto-crea rama feature/fix)
make commit type=feat scope=cli msg="add prompt" dev=mc

# Feature explicita
make feature type=feat scope=prompt msg="implement input" dev=mc

# Bug fix
make fix type=fix scope=prompt msg="fix input lag" dev=mc

# Finalizar feature -> merge a develop
make finish-feature dev=mc

# Crear release branch
make release type=feat scope=cli msg="bump v1.1.0" version=1.1.0

# Finalizar release -> merge a master + tag + merge back
make finish-release version=1.1.0
```

### Script PowerShell directo

```powershell
# Commit
pwsh scripts/commit-workflow.ps1 -Type feat -Scope cli -Message "add prompt" -DeveloperInitials "mc"

# Finish feature
pwsh scripts/commit-workflow.ps1 -FinishFeature -DeveloperInitials "mc"

# Finish release
pwsh scripts/commit-workflow.ps1 -FinishRelease -Version "1.1.0"
```

### Formato de commits (Conventional Commits)

```
<tipo>(<ambito>): <descripcion imperativa>

[cuerpo opcional]

[footer opcional]
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`, `perf`, `ci`, `build`, `revert`

**Scopes:** `cli`, `components`, `prompt`, `theme`, `messages`, `config`, `deps`, `infra`, `docs`, `api`, `core`, `ui`, `utils`, `types`, `styles`, `scripts`, `root`

---

## Configuracion

### Archivos de configuracion global

```
~/.deepseek-code/
  manifest.yaml                  <- CONFIGURACION UNIFICADA
       (orchestrator + capabilityMatrix + policyRules + agents + skills)
  bootstrap-state.json           <- Estado de inicializacion
  agents/*.md                    <- Agentes personalizados
  skills/*.yaml                  <- Skills instalados
  scripts/*.ps1                  <- Workflow scripts
  templates/*                    <- Templates (Makefile, etc.)
```

### Configuracion local del proyecto

```
.ai-assistant/
  config.yaml                    <- Configuracion del agente para este proyecto
  context.md                     <- Descripcion del proyecto
  instructions.md                <- Reglas y triggers personalizados
```

#### `config.yaml`

```yaml
vault:
  path: /ruta/al/vault
  auto_sync: true
  auto_use: true
  search_paths:
    - 04-Recursos
    - mis-patrones

extraction:
  enabled: true
  trigger: on_feature_complete
  patterns: true
  snippets: true
  configs: true
  ask_before_extract: false

usage:
  enabled: true
  priority: vault_first         # vault_first | generate_first
  search_before_generate: true

notification:
  enabled: true
  style: inline                 # inline | summary
  emojis: true
```

---

## Variables de entorno

| Variable | Descripcion | Requerida |
|----------|-------------|:---------:|
| `DEEPSEEK_API_KEY` | API key de DeepSeek | Si (si no se usa `--api-key`) |
| `DEEPSEEK_CODE_CONFIG_DIR` | Directorio de configuracion alternativo | No |
| `USERPROFILE` (Windows) | Home del usuario (para `~/.deepseek-code/`) | No |
| `HOME` (Linux/macOS) | Home del usuario | No |

---

## Estructura del proyecto

```
deepseek-code/
  bin/
    cli.ts                        <- Entry point de la CLI
  docs/
    adr/                          <- Architecture Decision Records
    c4/                           <- Diagramas C4 (Mermaid)
    auditorias/                   <- Informes de auditoria
  scripts/                        <- PowerShell scripts
    commit-workflow.ps1           <- Workflow de commits
    bootstrap.ps1                 <- Inicializacion
    reflection-*.mjs              <- Puentes para Reflection Engine
  skills/                         <- Skills YAML instalados
  src/
    agent/                        <- Sistema de agentes
      loop.ts                     <- Bucle principal del agente
      tool-executor.ts            <- Ejecutor de herramientas
      profiles.ts                 <- 8 perfiles built-in
      evaluator.ts                <- Evaluacion de respuestas
      loader.ts                   <- Carga de agentes personalizados
      iteration-manager.ts        <- Control de iteraciones
      delegation-enforcer.ts      <- Enforce de delegacion
      routing/                    <- Router de agentes
      commit/                     <- Workflow de commits
      qa/                         <- Servicio de QA
      agent-loop/                 <- Modulos extraidos del loop
    api/
      client.ts                   <- Wrapper de OpenAI SDK
      types.ts
    bootstrap/                    <- Inicializacion del proyecto
      config-loader.ts            <- Carga config.yaml
      context-loader.ts           <- Carga context.md
      detector.ts                 <- Detecta .ai-assistant/
      memory-loader.ts            <- Carga memoria persistente
      instructions-loader.ts      <- Carga instructions.md
    config/
      seed-config.ts              <- Seed de configuracion inicial
    memory/
      updater.ts                  <- Actualiza memoria persistente
      memory-tag-parser.ts        <- Parsea marcas [memory:*]
    orchestrator/                 <- Orquestador multi-agente
      index.ts                    <- Clase Orchestrator
      config-loader.ts            <- Carga YAML de orquestacion
      domain-detector.ts          <- Detecta dominios
      policy-engine.ts            <- Motor de politicas
      risk-scorer.ts              <- Scoring de riesgo
      intent-detector.ts          <- Detecta intencion
      gate-resolver.ts            <- Resolucion de gates
      fsm.ts                      <- Maquina de estados
      audit-reporter.ts           <- Generador de informes
      audit/                      <- Sub-sistemas de auditoria
      types.ts                    <- Tipos del orquestador
    reflection/                   <- Reflection Engine
      types.ts                    <- Tipos base
      failure-catalog.ts          <- Catalogo persistente
      pattern-detector.ts         <- Detector >=3 ocurrencias
      policy-promoter.ts          <- Escritor en manifest.yaml
      reflection-engine.ts        <- Orquestador del engine
      lessons-memo-generator.ts   <- Generador de lecciones
      historical-loader.ts        <- Carga historica
      domains/                    <- FailureTypes por dominio
      hooks/                      <- Hooks de integracion
    research/                     <- Investigacion autonoma
    shared/utils/                 <- Utilidades compartidas
    skills/                       <- Sistema de skills
    tools/                        <- Definiciones de herramientas
    types/                        <- Tipos del sistema
    ui/                           <- Interfaz de terminal
    vault/                        <- Integracion con vault
      vault-provider.ts           <- Interfaz VaultProvider
      search.ts                   <- Busqueda de patrones
      extractor.ts                <- Extraccion al vault
      index-reader.ts             <- Lector de indice
      lru-cache.ts                <- Cache LRU
      profiler.ts                 <- Perfilador de busqueda
  tests/                          <- Tests del sistema
    integration/                  <- Tests de integracion
  manifest.yaml                   <- Configuracion unificada
  Makefile                        <- Comandos de workflow
  package.json                    <- Dependencias y scripts
  AGENT.md                        <- Instrucciones del proyecto
  USER.md                         <- Preferencias del desarrollador
```

---

## Licencia

MIT 2026 DeepSeek Code
