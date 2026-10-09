---
adr: "ADR-002"
titulo: "bk-agent como CLI delgado sobre BackendKit Labs"
estado: "aceptado"
fecha: "2026-10-09"
contexto: "auditoría de código v1.0.0"
---

# ADR-002 — bk-agent es un CLI delgado; el runtime de agentes vive en el framework

## Contexto

La auditoría de código ([informe v1.0.0](../auditorias/informe-auditoria-codigo-bk-agent-v1.0.0.md))
midió que **21.706 de 28.688 líneas de `src/` (76%, 106 de 138 archivos) no eran
alcanzables desde `bin/cli.ts`**, el único entrypoint publicado. Esa
implementación (loop de agentes, orquestador, motor de reflexión, evaluación, QA,
commit workflow, vault, handlers de skills) fue **extraída a
`@backendkit-labs/agent-core` / `agent-coding`** — la duplicación es literal: 41
de 41 entradas de `KEYWORD_MAP` idénticas en `src/reflection/policy-promoter.ts`
y en `agent-core/dist/reflection/policy-promoter.js`.

Consecuencias medidas de mantener las dos copias:

- La documentación (`README.md`, `AGENT.md`, `documentation/14-architecture.md`),
  32 de 46 suites de test y los informes de auditoría previos describían un
  producto que ya no se ejecutaba.
- `bin/cli.ts` (2.041 líneas, el 100% de la superficie viva) estaba **excluido**
  de `collectCoverageFrom`: la cobertura del 58% medía, sobre todo, código muerto.
- Los gates de seguridad del código muerto (por ejemplo el `isSensitivePath` que
  protege `.env`) daban una falsa sensación de control: el camino vivo no los
  aplica.
- Cada corrección de seguridad o bug había que aplicarla (o no) en dos sitios.

## Decisión

1. **`bk-agent` es un CLI**: su responsabilidad es la interfaz (TUI y headless
   JSON-Lines), los comandos slash, la memoria de proyecto y las utilidades
   locales (encoding, saneado de terminal, política de aprobación). El runtime de
   agentes se consume de `@backendkit-labs/agent-core` / `agent-coding` y **no se
   reimplementa aquí**.
2. La implementación previa se **archiva en `legacy/`** (no se borra), excluida de
   build, tests, cobertura y lint. Ver [`legacy/README.md`](../../legacy/README.md).
3. La superficie pública del paquete (`src/index.ts`) exporta **solo** lo que este
   repositorio mantiene y testea. `AgentLoop` y `AgentClient` dejan de exportarse
   (quedan en `legacy/`).
4. Cualquier pieza del `legacy/` que se quiera conservar se **sube al framework**
   con sus tests; no se revive como copia local.
5. Regla de arquitectura verificable: **ningún archivo de `src/` puede quedar
   inalcanzable** desde `bin/cli.ts` o `src/index.ts`. Se verifica en CI con
   `scripts/check-reachability.mjs`.

## Medida temporal: endurecimiento de las tools de archivos

El framework no permite inyectar herramientas (`createCodingEngine` pasa
`tools: CODING_TOOLS` fijo y el registro interno no es accesible aunque los `.d.ts`
declaren lo contrario — hallazgo N-8). Para no dejar abiertos dos hallazgos de
severidad alta, el CLI **sustituye las definiciones de las cuatro herramientas de
archivos dentro de ese array** antes de crear el engine
(`src/security/apply-tool-guards.ts`).

Condiciones de esta medida, que la hacen aceptable como temporal:

1. **No reimplementa** el runtime: envuelve la definición original y delega en ella
   cuando la operación es legítima.
2. **No falla en silencio**: si una herramienta cambia de nombre o desaparece, el CLI
   avisa (consola o evento `system`) y el test de integración falla.
3. **Verificada contra las tools reales** del framework
   (`tests/tool-guards.integration.test.ts`), incluido un junction real.
4. **Se retira** en cuanto exista `tools`/`extraTools` en `CodingEngineOptions`; en ese
   momento la integración pasa a ser `guardFileTools(engine.tools, …)`.

## Estado de la remediación

| Acción | Estado |
|---|---|
| Decisión documentada (este ADR) | ✅ |
| `legacy/` archivado (119 módulos + 41 suites) | ✅ |
| `bin/cli.ts` sin imports del runtime muerto | ✅ |
| Cobertura incluye `bin/**` y umbral de ratchet | ✅ |
| Guard de encoding real (`check-utf8.js`) + 45 archivos normalizados | ✅ |
| Aprobación fail-closed en `--headless` (`--auto-approve` explícito) | ✅ |
| Saneado ANSI/OSC en la UI (OSC 52 → portapapeles) | ✅ |
| Filtro de protocolo headless extraído y testeado | ✅ |
| Guard de contención canónica (junction/symlink) y de rutas sensibles | ✅ activo en el binario (sustitución temporal de `CODING_TOOLS`; ver medida temporal) |
| `read_file` con guard de rutas sensibles | ✅ activo en el binario (misma medida temporal) |
| Retirar la medida temporal cuando el framework exponga `tools`/`extraTools` | ⏳ upstream (N-8) |
| Sandbox de rutas con `realpath` dentro del framework | ⛔ upstream (`agent-coding/tools/path-sandbox.ts`) |
| Aprobación para tools MCP / escrituras del framework | ⛔ upstream (`agent-core/engine/ApprovalGate.ts`) |
| CI en el repo raíz | ✅ `.github/workflows/bk-agent-ci.yml` |
| Documentación alineada (README, AGENT.md, índice, arquitectura) | ✅ con guard `check:docs` (comandos y enlaces) |
| Empaquetado (solo lo que el binario usa) | ✅ `files` + `clean` antes de compilar (579 → 103 archivos) |
| Podar `legacy/` definitivamente | ⏳ decisión del equipo (`git rm -r legacy/`) |

## Consecuencias

- **Positivas:** el repositorio pasa de 30.729 a ~7.200 líneas de código vivo;
  una sola fuente de verdad para el runtime; la cobertura mide lo que se publica;
  los tests corren en 8 s en vez de 43 s.
- **Negativas:** se pierden (quedan archivados) los tests de los módulos
  archivados; hay que coordinar con el framework los tres arreglos marcados como
  `upstream`; `legacy/` sigue ocupando espacio en el árbol hasta que se borre.
- **Riesgo asumido:** si alguien necesita una pieza del `legacy/`, debe arreglar
  sus imports antes de usarla (no compila tal cual). Está documentado.
