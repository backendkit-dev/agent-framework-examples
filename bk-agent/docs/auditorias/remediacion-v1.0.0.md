---
title: "Remediación de la auditoría — bk-agent"
version: "v1.0.0"
fecha: "2026-10-09"
tipo: "informe-remediacion"
informe_base: "informe-auditoria-codigo-bk-agent-v1.0.0.md"
adr: "../adr/ADR-002-bk-agent-cli-delgado.md"
---

# 🔧 INFORME DE REMEDIACIÓN — bk-agent

## 1. Qué cambió (antes → después)

| Métrica | Antes | Después |
|---|---|---|
| Código vivo (`src/` + `bin/`) | 30.729 líneas / 139 archivos | **6.641 líneas** (`src/` 4.759 + `bin/cli.ts` 1.882) |
| Módulos alcanzables desde el binario | 32 de 138 (76% muerto) | **24 de 24 (0% muerto)**, verificado en CI |
| Código eliminado | — | 119 módulos / 20.623 líneas + 41 suites / 8.078 líneas (archivados en `legacy/` durante la revisión y luego eliminados; recuperables de `59d1f02`) |
| Suites de test | 48 (32 sobre código muerto) | **15 suites / 187 tests**, todas sobre el camino vivo |
| Tiempo de suite | 43 s | **11 s** |
| Cobertura *reportada* | 58% (medía código muerto) | **20,23%** (medición real, ver N-1) |
| `bin/cli.ts` en la cobertura | excluido | incluido (0%; el resto es manejo de eventos y los 37 handlers de comando) |
| Lógica de protocolo en `bin/cli.ts` | filtro `<recap>` inline, 0 tests | extraído a `src/ui/headless-stream.ts` con **10 tests** |
| Lógica de `/spec` en `bin/cli.ts` | parseo de `design.json` sin validar, veredicto QA con regex inline | extraído a `src/spec/design-state.ts` con **16 tests** |
| Guard de archivos (A-1/A-2) | inexistente | `src/security/**` con **48 tests**, incluida verificación contra las tools reales del framework y un junction real |
| Aprobaciones extra (M-7) | MCP y tools de estado sin gate | `src/security/apply-extra-approvals.ts` con **16 tests** |
| Guard de encoding | solo detectaba BOM UTF-16 | **UTF-8 estricto + BOM**; 106 archivos OK, 45 normalizados |
| Lint | `npm run lint` roto (ESLint no instalado) | **ESLint 10 + typescript-eslint**, 0 errores |
| Typecheck de tests | nunca se ejecutaba (`isolatedModules`) | **incluido en el gate** (pasa) |
| Dependencias productivas vulnerables | 1 alta (brace-expansion) | **0** (`npm audit --omit=dev`) |
| Empaquetado | `npm pack` publicaba 579 archivos / 2,4 MB (incluía `tests/`, `src/` y `dist/` compilado del árbol borrado) | **103 archivos / 692,8 kB**: `files: [dist, README.md, AGENT.md]` + `clean` antes de compilar |
| Documentación alineada | README 1064 líneas y `14-architecture` 330 describiendo el producto anterior | README **135** líneas y arquitectura **95**, contra el binario; índice con los documentos marcados como desactualizados |
| Guard de documentación | no existía | `check:docs`: comandos citados deben estar registrados + enlaces locales con casing exacto |
| CI | no existía | `.github/workflows/bk-agent-ci.yml` (scoped a `bk-agent/**`) |

Gate único: `npm run verify` → encoding → reachability → typecheck (app+tests) → lint → tests.
Verificado en esta sesión, todo en verde.

## 2. Hallazgos cerrados

| ID | Hallazgo | Qué se hizo |
|---|---|---|
| C-1 | 76% de código inalcanzable | Eliminado del árbol tras verificarlo contra git (ADR-002) + guard `scripts/check-reachability.mjs` que falla si vuelve a pasar |
| C-2 | `--headless` auto-aprobaba todo | `--auto-approve` explícito y visible; sin él, headless **deniega** mutaciones (aviso por evento) |
| C-3 | Docs/tests describían otro producto | `src/index.ts` exporta solo la superficie viva; ADR-002; guard `check-docs`; este informe |
| A-5 | `allowAll` pegajoso anulaba las reglas "preguntar siempre" | `decideApproval`/`decisionFromUserAnswer` no cubren `npm/pip install` con el permiso global |
| A-10 | Inyección ANSI/OSC 52 desde el modelo | `stripTerminalEscapes`/`sanitizeSingleLine` aplicados en `formatMarkdown`, tool results, footer y spinner |
| A-11 | UI O(n²) en streaming | El label del spinner se calcula incremental (buffer de 512 chars), no re-dividiendo todo |
| M-1 | Helpers de seguridad nunca cableados | `setupConsoleEncoding()` en el arranque; `sanitizeForConsole` en la superficie pública |
| M-2 | Escrituras de memoria no atómicas | `atomicWrite`/`atomicWriteSync` en `writeFileSafe*` y en la inicialización de memoria |
| M-3 | `readCache` sin límite; UTF-16 mal decodificado | **No cerrado**: el cache sin LRU y el `swap16().toString('utf-8')` siguen en `encoding.ts`. Es código vivo del paquete pero hoy **sin llamador en el binario** (solo lo usaban módulos archivados): corregir o borrar cuando se decida su uso (§7) |
| M-4 | vault/skills/reflection no cableados | Vault retirado de la UI (header/status/skills); los skills se escriben ahora en `~/.bk-agent/skills/global`, la capa que el motor sí lee |
| M-5 | Sin CI/lint/lint-staged operativo | Workflow + ESLint real + `lint-staged` con globs correctos + `.gitignore` + `prepublishOnly` que verifica |
| M-6 | 2 archivos UTF-8 inválidos y 45 con BOM | Normalizados; `check-utf8.js` reescrito (UTF-8 estricto + BOM) y en CI |
| M-8 | Reporter de Jest que invocaba un bridge muerto | Eliminado de `jest.config.js` |
| M-13 | Suites que probaban copias/mocks | Archivadas con su código; quedan las que prueban comportamiento real |
| M-14 | `tsc --noEmit` no cubría los tests | `tsconfig.tests.json` + `typecheck` en el gate (pasa) |
| M-16 | Timer de thinking huérfano | `finally { terminal.stopThinking(); spinner.stop(); }` alrededor de `runEngine` |
| A-1 | Sandbox de rutas léxico (escape por junction/symlink) | **Cerrado en el binario** con `src/security/tool-guards.ts` + `apply-tool-guards.ts`: contención canónica antes de cada operación de archivo. Verificado con un junction real |
| A-2 | `read_file` sin guard de rutas sensibles | **Cerrado en el binario**: `.env`, claves privadas, `credentials.json`… requieren aprobación (denegado en headless salvo `--auto-approve`) |
| M-3 | `readCache` sin límite y UTF-16 mal decodificado | **Cerrado**: cache LRU acotado (200 entradas, `src/shared/utils/lru-cache.ts`) + copia defensiva del resultado; `decodeWithFallback` detecta UTF-16 (BOM o patrón de NULs) **antes** del UTF-8 y decodifica con `utf16le` |
| M-7 | Tools MCP y de estado del framework sin aprobación | **Cerrado** con `src/security/apply-extra-approvals.ts`: se envuelve `approvalGate.check` (paso obligado de toda tool call). Las tools MCP piden aprobación salvo `readOnlyHint`, y las de estado (`save_context`, `save_learning`, `save_audit`, `save_user_preference`, `update_session`) siempre. Respeta el modo `auto` y es fail-closed en headless |
| B-1/B-3 | Duplicación y bugs de reemplazo | Desaparecieron al eliminar el runtime duplicado |

## 3. Hallazgos nuevos, descubiertos al remediar

**N-1 (alto) — La cobertura y el typecheck estaban auto-desactivados.**
`jest.config.js` declaraba `roots: ['<rootDir>/tests']`: además de ser redundante con
`testMatch`, **impide que Jest instrumente archivos no importados por ningún test**, así
que `collectCoverageFrom` quedaba reducido a lo que los tests cargaban. Sumado a
`isolatedModules: true` en `tsconfig.json` (ts-jest transpila sin comprobar tipos), el
"58% de cobertura, 712 tests" describía un subconjunto y ningún test estaba
type-checkeado. Medición honesta tras corregirlo: **13,28% de statements**, con
`bin/cli.ts`, `terminal.ts` y `formatters.ts` en **0%**.

**N-2 (medio) — El modo headless rompía su propio protocolo.**
`console.log(formatHeader(...))` se ejecutaba antes de la rama headless, así que el
primer output por stdout era un recuadro ASCII y no JSON-Lines. Un frontend que parsea
stdout recibía basura antes del primer evento. Corregido (guard `isHeadless()`) y
**verificado**: 0 líneas no-JSON en el smoke test.

**N-3 (bajo) — `--no-stream` era una opción muerta.** `options.stream` se leía en
`useStream`, que nunca se usaba. Opción y variable eliminadas (cambio visible en
`--help`).

**N-4 (medio) — Dependencias.** `npm audit --omit=dev` daba 1 vulnerabilidad alta
(`brace-expansion`, DoS, transitiva de `glob`); corregida → 0 en producción. Quedan 34
avisos **solo de desarrollo** (toolchain de ESLint), a revisar sin urgencia.

**N-5 (bajo) — Estado de vault ficticio.** Tras retirar `vaultConnected`, el header caía
en la rama `false` y mostraba "○ sin vault" en cada arranque. Ahora el label solo se
pinta si el consumidor informa el estado.

**N-6 (bajo) — `src/config/seed-config.ts` tenía mojibake irreversible.**
Además del BOM y de los bytes UTF-8 inválidos, su contenido tenía
`configuraci+¦n`, `pol+¡ticas`, `ÔåÆ`: una corrupción previa que no se puede revertir
mecánicamente (se eliminó con el resto del runtime muerto). Los bytes inválidos del test sí se repararon
(`confirmación`, `éxito`).

**N-7 (bajo) — El filtro de `<recap>` descartaba texto.** En el modo headless, todo lo
que el modelo emitiera **después** de `</recap>` dentro del mismo chunk se perdía en
silencio. Al extraer el filtro a `src/ui/headless-stream.ts` se corrigió (el remanente
vuelve al stream) y se cubrió con 10 tests, incluido el caso crítico de un `<recap>`
partido entre dos chunks, que antes dependía de un `holdback` de 8 caracteres **sin
ninguna prueba**.

**N-8 (alto, upstream) — La API pública de herramientas no permite extenderlas, y sus
tipos mienten.** `AgentEngine.d.ts` declara `tools: ToolRegistry`, pero en runtime esa
propiedad **no existe** (`Object.keys(engine)` no la incluye y `engine.tools === undefined`).
Además `createCodingEngine` pasa `tools: CODING_TOOLS` **hardcodeado** y no reenvía
`opts.tools`, así que ningún consumidor puede añadir ni reemplazar una herramienta por la
vía soportada. Es lo único que impide cerrar A-1/A-2 desde el CLI: la implementación ya
está escrita y testeada aquí (`src/security/tool-guards.ts`).

**N-9 (medio) — El README estaba trackeado como `Readme.Md`.** En Windows funciona (FS
case-insensitive), pero en Linux/CI y en el paquete npm el nombre no coincide con el que
espera un consumidor ni con los enlaces `README.md` de la propia documentación. Se
renombró con `git mv` y el guard de documentación ahora verifica que **cada enlace local
resuelva con el casing exacto** (probado: un enlace roto a propósito falla con exit 1).

**N-10 (medio) — El paquete publicaba artefactos compilados de código que ya no existe.**
`npm run build` ejecutaba `tsc` sin limpiar `dist/`, así que el tarball arrastraba el
JavaScript compilado del árbol anterior (incluido `dist/src/vault/*`, `orchestrator`,
`reflection`…): **579 archivos, 555,7 kB comprimidos, 2,4 MB descomprimidos**. Con
`prebuild` → `clean` (`rm -rf dist`) el paquete queda en **103 archivos, 150,4 kB
comprimidos, 692,8 kB descomprimidos**, y se corresponden con `src/` + `bin/`.

**N-11 (medio) — `design.json` se parseaba sin validar y rompía los comandos `/spec`.**
`specReadDesign` hacía `JSON.parse` y devolvía el resultado tal cual; los comandos
encadenaban `state.phases.find(...)`, así que un `design.json` vacío, truncado o con otra
forma lanzaba un `TypeError` dentro del handler. Ahora `src/spec/design-state.ts` valida y
normaliza el estado (`parseDesignState`), y devuelve `null` ante cualquier forma
inesperada; los tests cubren los casos inválidos.

**N-12 (bajo) — `--no-delegation` era otra opción muerta.** El flag estaba declarado en
`--help` pero `options.delegation` no se leía en ninguna parte, y el framework no ofrece
forma de desactivar la delegación (`ask_agent` se inyecta al agente por defecto desde
`AgentEngine.getToolsForAgent`, sin opción de configuración). Se eliminó el flag y el
README explica ahora cómo funciona la orquestación y que, para trabajar sin delegación,
hay que cambiar el agente activo (`/agent <id>`).

## 4. Medida temporal que cierra A-1/A-2, y lo que queda upstream

**A-1 y A-2 están cerrados en el binario** mediante una sustitución *in situ*: el CLI
reemplaza las definiciones de `read_file`, `write_file`, `edit_file` y `list_directory`
**dentro del array `CODING_TOOLS`** antes de llamar a `createCodingEngine`, que pasa ese
mismo array (por referencia) a `createBaseEngine` (ver
[`src/security/apply-tool-guards.ts`](../../src/security/apply-tool-guards.ts)).

- Conserva nombre, descripción y schema originales y **delega en la implementación del
  framework** cuando la llamada es legítima (sin reimplementar nada).
- Verificado contra las tools reales: lectura normal, `.env` denegado sin filtrar
  contenido y permitido con aprobación, sandbox del framework intacto y **junction real
  bloqueado** (`tests/tool-guards.integration.test.ts`).
- Si el framework renombra o quita una tool, el CLI **avisa** (`Guards de archivos no
  aplicados a: …`) y en headless lo emite como evento `system`; nunca falla en silencio.
- **Es temporal**: se retira en cuanto `CodingEngineOptions` acepte `tools`/`extraTools`
  (una vez exista, la integración es `guardFileTools(engine.tools, …)`).

### Pendiente upstream

| Hallazgo | Archivo upstream | Cambio propuesto |
|---|---|---|
| N-8 la API no permite inyectar herramientas (y el `.d.ts` declara `tools` inexistente en runtime) | `agent-coding/dist/index.js` (`createCodingEngine` → `tools: CODING_TOOLS`) y `agent-core/dist/engine/AgentEngine.d.ts` | Aceptar y reenviar `tools`/`extraTools` en `CodingEngineOptions`; alinear el `.d.ts` con el runtime |
| A-1 (definitivo) sandbox de rutas léxico | `agent-coding/dist/tools/path-sandbox.js:17-48` | Canonicalizar con `fs.realpathSync.native` (el helper `checkCanonicalContainment` de este repo ya lo hace) |
| A-2 (definitivo) `read_file` sin guard de rutas sensibles | `agent-coding/dist/tools/read-file.ts` | Portar `isSensitivePath` de este repo |
| M-7 (definitivo) tools MCP y de estado sin aprobación | `agent-core/dist/engine/ApprovalGate.js:12` | Clasificar por capacidad declarada (`writes`, `destructive`) en la definición de la tool, no por un `Set` fijo de 3 nombres |

Mientras la medida temporal esté activa, conviene **verificar la versión instalada** de
`@backendkit-labs/agent-coding`: el test `apply-tool-guards` falla explícitamente si el
framework renombra o quita alguna de las cuatro herramientas.

### Medida temporal equivalente para las aprobaciones (M-7)

Las tools MCP y las de estado del framework se gatean envolviendo
`engine.approvalGate.check` ([`apply-extra-approvals.ts`](../../src/security/apply-extra-approvals.ts)),
por el mismo motivo: no hay API pública para clasificar tools. Tiene las mismas garantías
(no reimplementa, no falla en silencio, 16 tests) y el mismo punto de retiro: cuando
`ApprovalGate` clasifique por capacidad declarada.

## 5. Cómo verificarlo

```bash
npm run verify          # encoding + reachability + docs + typecheck(app+tests) + lint + tests
npm run test:coverage   # 16,15% con umbral de ratchet (16/11/14/17)
npm run build && node dist/bin/cli.js --help
DEEPSEEK_API_KEY=sk-x bash -c 'echo "{\"type\":\"user_input\",\"text\":\"/tokens\"}" | node dist/bin/cli.js --headless'
```

## 6. Cómo revertir

- Los 160 archivos del runtime anterior están en el historial: `git show 59d1f02:bk-agent/src/agent/loop.ts`
  (o `git checkout 59d1f02 -- bk-agent/src bk-agent/tests` para restaurarlos todos).
- El trabajo está en dos commits: `df55842` (remediación) y `cb90603` (limpieza de artefactos).
- Los cambios de `bin/cli.ts`, `formatters.ts`, `encoding.ts`, `jest.config.js` y
  `package.json` están en `git diff` (13 archivos modificados).
- Las dos decisiones de producto tomadas aquí están documentadas y son reversibles:
  **vault fuera de la UI** (M-4) y **`--no-stream` eliminado** (N-3).

## 7. Próximos pasos sugeridos

1. **Cobertura del camino vivo**: `bin/cli.ts` sigue en 0%. Ya se extrajeron el filtro de
   protocolo (N-7) y el estado de `/spec` (N-11); lo que queda dentro es el manejo de
   eventos de la TUI y los 37 handlers de comando, que necesitan un arnés que simule
   terminal + engine. Subir el umbral de ratchet en cada PR. Objetivo: 60%.
2. **PR upstream** con los cuatro puntos de §4: el importante es N-8 (aceptar
   `tools`/`extraTools`), que permite retirar la sustitución temporal y aplica también a
   M-7.
3. **Podar `legacy/`**: hecho en `cb90603` (−20.623 líneas).
4. **Docs**: `README.md`, `AGENT.md`, `documentation/00-index.md` y
   `documentation/14-architecture.md` ya están alineados contra el binario; el resto del
   árbol (`documentation/01..13`, `15..18`, curator) queda **marcado como desactualizado
   en el índice**, con el motivo de cada uno. Revisarlos o retirarlos es decisión del
   equipo.
5. **Artefactos sueltos** sin trackear en `bk-agent/` (decisión del usuario):
   `processed/` (copia de `documentation/`), `failed/`, `test-docker.mjs` y las 6 notas
   `AUTOCOMPLETADO_*`/`IMPLEMENTATION_EXAMPLES.md` (más el `Makefile` heredado, que sí
   está trackeado).
