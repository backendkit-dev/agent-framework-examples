# BackendKit Agent (`bk-agent`) — instrucciones para agentes que trabajan en este repo

`bk-agent` es un **CLI de asistente de programación** para backend Node.js/NestJS.
El runtime de agentes (loop de LLM, orquestador, QA, skills, memoria de sesión) **no
vive aquí**: se consume de `@backendkit-labs/agent-core` y `@backendkit-labs/agent-coding`.
Este repositorio mantiene la interfaz (TUI y headless), los comandos, la memoria de
proyecto y las utilidades locales. Ver [ADR-002](docs/adr/ADR-002-bk-agent-cli-delgado.md).

## Qué contiene este repositorio

| Ruta | Qué es |
|---|---|
| `bin/cli.ts` | Entry point publicado: parseo de flags, TUI, protocolo headless, comandos slash |
| `src/ui/` | Terminal, formateo (markdown, diffs), spinner, buffers de entrada |
| `src/agent/approval-policy.ts` | Política de aprobación de herramientas (fail-closed en headless) |
| `src/security/` | Guard de contención canónica (symlink/junction) y rutas sensibles |
| `src/shared/utils/` | Encoding, escritura atómica, saneado de terminal |
| `src/bootstrap/memory-loader.ts`, `src/memory/updater.ts` | Memoria persistente del proyecto |
| `src/skills/loader.ts` | Carga de skills YAML |
| `src/commands/slash-registry.ts` | Registro de comandos |
| `tests/` | 10 suites / 129 tests del camino vivo |
| historial de git | La implementación previa al framework se archivó y luego se eliminó del árbol (commit `cb90603`); recuperable con `git show 59d1f02:bk-agent/src/...` |
| `docs/` | ADRs e informes de auditoría/remediación (fuente de verdad del estado del proyecto) |

## Reglas del repositorio (obligatorias)

1. **Nada inalcanzable en `src/`**: todo módulo debe ser alcanzable desde `bin/cli.ts` o
   `src/index.ts`. Lo que deja de usarse se elimina (queda en el historial de git), no se deja suelto.
   Verificación: `npm run check:reachability`.
2. **UTF-8 sin BOM** en todos los archivos. Verificación: `npm run lint:utf8`.
3. **Cero errores de ESLint** (`npm run lint`) y **typecheck de app y tests**
   (`npm run typecheck`).
4. Antes de dar algo por terminado: `npm run verify` en verde.
5. No duplicar en este repo lo que ya provee el framework: si hace falta una pieza del
   runtime, se sube a `agent-core`/`agent-coding`, no se copia.

## Superficie real del CLI

- **Flags**: `--api-key`, `--model`, `--base-url`, `--max-iterations`,
  `--iteration-mode`, `--command-timeout`, `--no-qa`, `--no-delegation`, `--headless`,
  `--auto-approve`.
- **Herramientas del modelo** (las provee el framework): `read_file`, `write_file`,
  `edit_file`, `list_directory`, `run_command`, `search_files`, `save_context`,
  `save_learning`, `save_audit`, `get_latest_audit`, `list_audits`,
  `save_user_preference`, `update_session`, `ask_agent` + tools MCP.
  `write_file`/`edit_file`/`run_command` requieren aprobación; en `--headless` se
  deniegan salvo `--auto-approve`.
- **Comandos slash**: `/help`, `/clear`, `/reset-context`, `/context`, `/tokens`,
  `/usage`, `/status`, `/memory`, `/agent`, `/models`, `/iteration`, `/init`,
  `/skills`, `/prompt`, `/checkpoint`, `/switch`, `/workspace` y la familia `/spec.*`
  (prompt → specify → plan → init → next/run/qa/advance, más revise/show/go).
  La referencia completa, con los disponibles en headless, está en el
  [README](README.md#comandos-slash).

## Librerías del ecosistema BackendKit Labs

Cuando el usuario trabaje en un **proyecto** que las use, respetá sus patrones (no son
dependencias de este repositorio salvo `console-animations`):

- `@backendkit-labs/result` — manejo tipado de errores con `ok`/`err`, `andThen`, `map`,
  `orElse`, `match`. Los errores de dominio son string union types, no clases `Error`.
- `@backendkit-labs/circuit-breaker` — 4xx (salvo 429/503) = error de negocio, no abre el
  circuito; 5xx, timeouts y fallos de red = infraestructura, sí lo abren.
- `@backendkit-labs/bulkhead` — control de concurrencia;
  `Bulkhead.execute(() => CircuitBreaker.execute(() => operacion()))`.
- `@backendkit-labs/http-client` — axios + circuit breaker + retry exponencial + `Result`.
- `@backendkit-labs/observability` — `ObservabilityModule.forRoot()` primero en el
  `AppModule`, `BkLogger` en lugar de `console.log`, `CorrelationIdInterceptor` y
  `BkExceptionFilter` en `main.ts`.
- `@backendkit-labs/pipeline` — pipeline async type-safe (`stop-on-first`, `collect-all`).
- `@backendkit-labs/request-scanner` — detección de SQLi/XSS/path traversal/SSRF;
  requiere `.npmrc` con `@backendkit-labs:registry=https://npm.pkg.github.com`.
- `@backendkit-labs/console-animations` — animaciones de terminal para CLIs Node.js
  (spinners, progress bars). Usar en lugar de implementar spinners a mano.

## Cómo trabajar aquí

- Los informes de `docs/auditorias/` son la fuente de verdad del estado: leé el de
  remediación antes de proponer cambios grandes.
- El runtime anterior no está en el árbol: si necesitás una pieza, recuperala del
  historial (`git show 59d1f02:bk-agent/src/...`), arreglá sus imports y traela con tests,
  o subila al framework.
- No agregues documentación que describa funciones que el binario no tiene: es
  exactamente el problema que motivó la auditoría.
