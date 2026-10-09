# 14 — Arquitectura real

> Reescrito el 2026-10-09. La versión anterior describía una arquitectura que ya no se
> ejecuta (loop, orquestador y motor de reflexión propios). Ver
> [ADR-002](../docs/adr/ADR-002-bk-agent-cli-delgado.md) y el
> [informe de remediación](../docs/auditorias/remediacion-v1.0.0.md).

## Regla de oro

**`bk-agent` es un CLI.** El runtime de agentes no vive en este repositorio: se consume
de `@backendkit-labs/agent-core` (motor, orquestador, memoria, aprobaciones, MCP) y
`@backendkit-labs/agent-coding` (perfiles de agentes, tools de código, skills builtin).
Todo lo que era una implementación propia de ese runtime está archivado en `legacy/` y
**no forma parte del producto**.

## Capas

```
                    ┌──────────────────────────────────────────┐
   usuario / frontend│  bin/cli.ts  (entry point publicado)     │
                    │  · flags y arranque                      │
                    │  · TUI interactiva (src/ui/*)             │
                    │  · protocolo headless JSON-Lines          │
                    │  · comandos slash (33)                    │
                    │  · política de aprobación                 │
                    └───────────────┬──────────────────────────┘
                                    │ createCodingEngine(...)
                    ┌───────────────▼──────────────────────────┐
                    │  @backendkit-labs/agent-coding            │
                    │  perfiles de agentes · CODING_TOOLS       │
                    │  skills builtin · capability matrix       │
                    └───────────────┬──────────────────────────┘
                                    │ createBaseEngine(...)
                    ┌───────────────▼──────────────────────────┐
                    │  @backendkit-labs/agent-core              │
                    │  AgentEngine: loop, delegación (ask_agent)│
                    │  orquestador · QA · ApprovalGate · MCP    │
                    │  SessionMemory · ProjectStore · skills    │
                    └──────────────────────────────────────────┘
```

## Qué aporta este repositorio

| Módulo | Responsabilidad |
|---|---|
| `bin/cli.ts` | Parseo de flags, TUI, protocolo headless, registro de los 33 comandos slash, callback de aprobación |
| `src/ui/` | Terminal (prompt, footer, selección), formateo (markdown, diffs, tablas), spinner y métricas, buffers de entrada y pegado |
| `src/agent/approval-policy.ts` | Decisión de aprobación de herramientas: herramientas que mutan, operaciones que se preguntan siempre, fail-closed en headless |
| `src/security/` | Detección de rutas sensibles y contención canónica de rutas (junction/symlink). **Escrito y testeado; su activación depende del framework** (ver §limitaciones) |
| `src/bootstrap/memory-loader.ts` | Localiza y crea la memoria del proyecto (`~/.deepseek-code/projects/{key}/memory/`) |
| `src/memory/updater.ts` | Re-exporta checkpoints/compactación del framework y helpers de workspaces |
| `src/skills/loader.ts` | Lectura de skills YAML en la capa global |
| `src/shared/utils/` | Encoding (BOM, UTF-16, line endings), escritura atómica, saneado ANSI/OSC |
| `src/commands/slash-registry.ts` | Registro y autocompletado de comandos |

## Flujo de un turno

```
input del usuario
   ↓
bin/cli.ts: ¿es un comando slash?  → sí → handler del comando
   ↓ no
engine.run(texto)
   ↓
AgentEngine: system prompt (framework) + memoria + skills + historial
   ↓
LLM (deepseek-chat | deepseek-reasoner) → tool_calls
   ↓
ApprovalGate: write_file / edit_file / run_command → callback del CLI
   ↓ (aprobado)
ejecución de la tool (framework) → resultado al historial → siguiente iteración
   ↓
eventos al transporte → TUI (render markdown/diff) o headless (JSON-Lines)
   ↓
memoria del proyecto: sesion-actual.md / contexto-proyecto.md
```

## Modos de ejecución

| Modo | Comportamiento |
|---|---|
| `interactive` | Pregunta antes de cada paso y antes de cada herramienta que muta |
| `step-by-step` (por defecto) | Pregunta por herramientas que mutan; avanza sin interrumpir cada iteración |
| `auto` | No pregunta nada (el usuario ya lo pidió) |
| `--headless` | Sin TUI: JSON-Lines por stdout. **Deniega** escrituras y comandos salvo `--auto-approve` |

## Estado y persistencia

| Qué | Dónde |
|---|---|
| Memoria del proyecto | `~/.deepseek-code/projects/{key}/memory/` (`sesion-actual.md`, `contexto-proyecto.md`, `checkpoints/`) |
| Auditorías de tools | `…/audits/tool-calls.ndjson` |
| Configuración y agentes | `~/.bk-agent/config.yaml`, `~/.bk-agent/agents/` |
| Skills | `~/.bk-agent/skills/global`, `~/.bk-agent/skills/packs`, `{proyecto}/.bk-agent/skills` |
| Historial de conversación | `…/memory/history.json` |

## Limitaciones conocidas (arquitectura)

1. **Contención de rutas**: el sandbox del framework es léxico, así que el CLI envuelve
   `read_file`, `write_file`, `edit_file` y `list_directory` con una comprobación
   canónica (`realpath`) y aprobación de rutas sensibles. Lo hace sustituyendo las
   definiciones dentro de `CODING_TOOLS` antes de crear el engine, porque
   `createCodingEngine` no acepta herramientas propias (hallazgo N-8). Ver
   [remediación §4](../docs/auditorias/remediacion-v1.0.0.md).
2. **Vault de Obsidian**: no implementado en el CLI.
3. **Cobertura**: el entrypoint `bin/cli.ts` no está cubierto por tests (0%).

## Verificación en CI

`npm run verify` ejecuta, en orden: encoding (UTF-8 sin BOM) → reachability (`src/` sin
código inalcanzable) → typecheck (app + tests) → lint → tests. El workflow está en
`.github/workflows/bk-agent-ci.yml`, filtrado a cambios de `bk-agent/**`.
