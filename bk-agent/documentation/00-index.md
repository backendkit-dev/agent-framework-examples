# BackendKit Agent — índice de documentación

> ⚠️ **Estado (2026-10-09): parte de esta documentación está desactualizada.**
> Fue escrita para la implementación anterior, cuando el runtime de agentes vivía en
> este repositorio. Hoy `bk-agent` es un CLI delgado sobre
> `@backendkit-labs/agent-core` / `agent-coding`
> ([ADR-002](../docs/adr/ADR-002-bk-agent-cli-delgado.md)), y el código de aquella
> implementación se eliminó del árbol (recuperable del historial de git, commit `59d1f02`).
> La fuente de verdad del estado actual es el
> [informe de remediación](../docs/auditorias/remediacion-v1.0.0.md) y el
> [README](../README.md).

## Documentos vigentes

| Documento | Para qué sirve |
|---|---|
| [README.md](../README.md) | Instalación, flags, herramientas, comandos y limitaciones reales |
| [AGENT.md](../AGENT.md) | Instrucciones para agentes que trabajan en este repositorio |
| [02-installation-setup.md](02-installation-setup.md) | Instalación y primer arranque |
| [03-commands-slash.md](03-commands-slash.md) | Referencia de comandos slash |
| [04-spec-driven-development.md](04-spec-driven-development.md) | Flujo `/spec.*` completo |
| [07-workspace-management.md](07-workspace-management.md) | Workspaces multi-proyecto |
| [09-memory-persistence.md](09-memory-persistence.md) | Memoria de proyecto y checkpoints |
| [11-plugins-mcp.md](11-plugins-mcp.md) | Servidores MCP y modo headless |
| [13-troubleshooting.md](13-troubleshooting.md) | Problemas comunes |
| [14-architecture.md](14-architecture.md) | Arquitectura real (reescrito el 2026-10-09) |

## Documentos desactualizados (revisar antes de usarlos)

| Documento | Qué está mal |
|---|---|
| [01-overview.md](01-overview.md) | Atribuye al CLI el "Reflection Engine" y el orquestador propios: hoy los provee el framework y el CLI **no** los activa |
| [05-agents-specialization.md](05-agents-specialization.md) | Los agentes y el routing los define el framework (10 perfiles builtin + los tuyos) |
| [06-skills-system.md](06-skills-system.md) | Los skills se cargan de `~/.bk-agent/skills/global`, `…/packs` y `{proyecto}/.bk-agent/skills` (no del vault) |
| [08-reflection-learning.md](08-reflection-learning.md) | El motor de reflexión propio se eliminó del repositorio; su estado es el del framework |
| [10-backendkit-integration.md](10-backendkit-integration.md) | Las librerías BackendKit **no** son dependencias de este repositorio |
| [12-advanced-config.md](12-advanced-config.md) | Revisar: parte de la configuración la lee el framework (`~/.bk-agent/config.yaml`) |
| [15-mcp-knowledge-service-strategy.md](15-mcp-knowledge-service-strategy.md) | Estrategia, no implementación |
| [16-curator-codex-agent.md](16-curator-codex-agent.md) · [17](17-curator-codex-quick-reference.md) · [18](18-curator-codex-commands-reference.md) · [CURATOR-CODEX-COMMANDS.md](CURATOR-CODEX-COMMANDS.md) | Herramientas de curación de conocimiento, ajenas al CLI |

## Cómo se mantiene esta documentación

- Un documento no puede describir comandos que no existan: `npm run check:docs`
  compara los comandos slash citados en `README.md`, `AGENT.md` y
  `documentation/00-index.md` con los registrados en el código, y falla si hay
  diferencias (se ejecuta en `npm run verify` y en CI).
- Si una función del runtime no está activa en el CLI, se documenta como
  **limitación conocida** (ver el README), no como capacidad.
