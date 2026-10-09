# BackendKit Agent (`bk-agent`)

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

CLI de asistente de programación para backend Node.js/NestJS con el ecosistema
BackendKit Labs. **Este repositorio es el CLI**; el runtime de agentes (loop de
LLM, orquestador, QA, skills, memoria de sesión) vive en
[`@backendkit-labs/agent-core`](https://www.npmjs.com/package/@backendkit-labs/agent-core)
y [`@backendkit-labs/agent-coding`](https://www.npmjs.com/package/@backendkit-labs/agent-coding).
Ver [ADR-002](docs/adr/ADR-002-bk-agent-cli-delgado.md).

## Qué hace

- **Interfaz**: TUI interactiva con streaming, diffs y métricas de tokens; o modo
  `--headless` (JSON-Lines por stdout) para un frontend externo.
- **Comandos**: 37 comandos slash, incluido el flujo completo de spec-driven
  development (`/spec.*`) y la gestión de workspaces multi-proyecto.
- **Memoria de proyecto**: `~/.deepseek-code/projects/{key}/memory/` guarda
  `sesion-actual.md` y `contexto-proyecto.md`, que se inyectan en cada sesión.
- **Skills**: capas del framework (`~/.bk-agent/skills/global`, `…/packs`,
  `{proyecto}/.bk-agent/skills`).
- **Agentes**: 10 perfiles builtin (`general`, `project-manager`, `coder`,
  `backend`, `frontend`, `qa-engineer`, `security`, `architecture`,
  `infrastructure`, `data`) más los que definas en `~/.bk-agent/agents/`.
- **Delegación**: el modelo puede invocar agentes especialistas con `ask_agent`.
- **MCP**: servidores MCP configurables (comando `/plugin`).

## Instalación

```bash
npm install -g @backendkit-labs/agent
# o desde el repositorio:
npm install && npm run build && npm link
```

Requisito: Node.js 20+.

## Configuración

```bash
# Windows PowerShell
$env:DEEPSEEK_API_KEY = "sk-..."
# Linux / macOS
export DEEPSEEK_API_KEY="sk-..."
```

Opcional: `~/.bk-agent/config.yaml` para proveedores, modelo por defecto y
servidores MCP.

## Uso

```bash
bk-agent                        # TUI interactiva
bk-agent --model deepseek-reasoner
bk-agent --iteration-mode auto  # sin confirmaciones (usar con cuidado)
bk-agent --headless             # JSON-Lines por stdin/stdout
```

### Flags

| Flag | Descripción |
|---|---|
| `-k, --api-key <key>` | API key (preferir la variable de entorno) |
| `-m, --model <model>` | `deepseek-chat` (V3, por defecto) o `deepseek-reasoner` (R1) |
| `-b, --base-url <url>` | URL base de la API |
| `--max-iterations <n>` | Máximo de iteraciones de herramientas por turno (100) |
| `--iteration-mode <mode>` | `interactive`, `step-by-step` (por defecto) o `auto` |
| `--command-timeout <s>` | Timeout de `run_command` en segundos |
| `--no-qa` | Desactiva la revisión automática de QA |
| `--headless` | Modo JSON-Lines para frontend externo |
| `--auto-approve` | **Peligroso.** Aprueba toda escritura y comando sin confirmar. En `--headless` es obligatorio para permitir mutaciones; sin él, headless **deniega** escrituras y comandos |

### Herramientas que el modelo puede ejecutar

`read_file`, `write_file`, `edit_file`, `list_directory`, `run_command`,
`search_files`, `save_context`, `save_learning`, `save_audit`, `get_latest_audit`,
`list_audits`, `save_user_preference`, `update_session`, `ask_agent`, más las que
aporten los servidores MCP.

`write_file`, `edit_file` y `run_command` piden confirmación (salvo en modo `auto`
o con `--auto-approve`); `run_command` está limitado a una allowlist de binarios
(npm, git, node, python, docker, kubectl, curl…).

### Comandos slash

Disponibles en la TUI; los marcados con · también en `--headless`:

| Comando | Qué hace |
|---|---|
| `/help` · | Lista de comandos |
| `/clear` · | Limpia la pantalla |
| `/reset-context` · | Reinicia la conversación (mantiene sistema y memoria) |
| `/context` | Contexto activo del proyecto |
| `/tokens` · | Tokens de la sesión |
| `/usage` · | Tokens y costo de sub-agentes |
| `/status` · | Panel de estado |
| `/memory` · | Memoria persistente del proyecto |
| `/agent` · | Lista o cambia el agente activo |
| `/agents` | Lista los agentes disponibles (framework) |
| `/models` · | Lista o cambia el modelo |
| `/plugin` | Gestiona servidores MCP (list, add, remove) |
| `/iteration` | Cambia el modo de iteración |
| `/init` · | Analiza/inicializa el proyecto con `project-manager` |
| `/skills` · | Lista, instala o crea skills |
| `/prompt` · | Genera un prompt estructurado |
| `/checkpoint` | Crea, lista o carga checkpoints de sesión |
| `/switch` · | Cambia de workspace/proyecto |
| `/workspace` · | Gestiona workspaces (create/add/remove/delete) |
| `/spec.prompt` | Inicia el flujo spec-driven: guarda `prompt.md` |
| `/spec.specify` `/spec.plan` `/spec.init` | Genera `specification.md`, `design.md`, `roadmap.md` |
| `/spec.revise.prompt` `/spec.revise.specify` `/spec.revise.plan` | Reescribe un documento con feedback |
| `/spec.show.prompt` `/spec.show.specify` `/spec.show.plan` `/spec.show.roadmap` | Muestra los documentos |
| `/spec.next` `/spec.run` `/spec.qa` `/spec.advance` | Siguiente tarea, implementación, QA y avance de fase |
| `/spec.go` `/spec.context` `/spec.overview` | Ejecución autónoma del roadmap, contexto y resumen |

### Orquestación de agentes

El motor (`@backendkit-labs/agent-core`) hace dos cosas por cada mensaje:

1. **Routing** — detecta intención, dominios y riesgo, aplica el *policy engine* y
   elige el agente. El CLI activa ese pipeline siempre, y la revisión de QA salvo
   que pases `--no-qa`.
2. **Delegación** — el agente activo puede invocar a otros con la herramienta
   `ask_agent` (una o varias en paralelo). El framework **solo se la ofrece al
   agente por defecto** (`general`), que tiene `delegatesTo: ["*"]`; los
   especialistas no delegan a su vez.

| Agente | Rol | Delega |
|---|---|---|
| `general` (por defecto) | Enruta y delega | Sí (`ask_agent`) |
| `project-manager`, `coder`, `backend`, `frontend`, `qa-engineer`, `security`, `architecture`, `infrastructure`, `data` | Especialistas con sus propias herramientas | No |

Notas:

- La delegación **no se puede desactivar** desde el CLI (no existe la opción en el
  framework y `ask_agent` se inyecta al agente por defecto). Si querés trabajar sin
  delegación, cambiá el agente activo con `/agent <id>`: en un especialista la
  herramienta no está disponible.
- `ask_agent` no pasa por el gate de aprobación (no muta nada); lo que sí lo hace
  son las herramientas de escritura/ejecución que usan los especialistas, con la
  política descrita arriba.
- El estado de estos agentes (y de los tuyos en `~/.bk-agent/agents/`) se ve en
  `/agent` y en el evento `config` del modo headless.

### Modo headless (JSON-Lines)

```bash
echo '{"type":"user_input","text":"/tokens"}' | bk-agent --headless
```

Eventos por stdout: `ready`, `config`, `user_message`, `block_start`, `token`,
`recap`, `tool_call`, `tool_result`, `tool_approval_request`, `agent_switch`,
`metrics`, `block_end`, `qa_review`, `system`, `error`, `done`, `clear`.
Entrada por stdin: `{"type":"user_input","text":"…"}` y `{"type":"interrupt"}`.

## Desarrollo

```bash
npm run verify          # encoding + arquitectura + typecheck + lint + tests
npm test                # 10 suites / 129 tests
npm run test:coverage   # cobertura con umbral de ratchet
npm run dev             # TUI desde el código fuente (tsx)
```

Reglas del repositorio:

- **`src/` no puede tener código inalcanzable** desde `bin/cli.ts` o `src/index.ts`
  (`npm run check:reachability`); lo que ya no se usa se elimina (queda en el historial de git).
- Todo archivo debe ser **UTF-8 sin BOM** (`npm run lint:utf8`).
- **ESLint** obligatorio (`npm run lint`).

## Limitaciones conocidas

- El **vault de Obsidian no está implementado** en el CLI (no hay comando para
  conectarlo); la memoria vive en `~/.deepseek-code/`.
- El endurecimiento de las tools de archivos (contención canónica de symlinks y
  aprobación de rutas sensibles como `.env`) se aplica hoy **sustituyendo las
  definiciones dentro de `CODING_TOOLS`** antes de crear el engine, porque
  `createCodingEngine` no acepta herramientas propias (el `.d.ts` de `AgentEngine`
  declara `tools`, pero en runtime no existe). El CLI avisa si deja de poder aplicarlo.
  Se retirará cuando el framework acepte `tools`/`extraTools`
  (ver [remediación §4](docs/auditorias/remediacion-v1.0.0.md)).
- La cobertura del entrypoint es **0%**: `bin/cli.ts` no está cubierto por tests.

## Documentación

- [Estado de la auditoría y remediación](docs/auditorias/remediacion-v1.0.0.md)
- [Informe de auditoría de código](docs/auditorias/informe-auditoria-codigo-bk-agent-v1.0.0.md)
- [ADR-002: bk-agent como CLI delgado](docs/adr/ADR-002-bk-agent-cli-delgado.md)
- [documentation/](documentation/00-index.md) — guías del producto (**parcialmente
  desactualizadas**: ver el aviso del índice)

## Licencia

MIT
