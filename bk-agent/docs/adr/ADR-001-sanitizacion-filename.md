---
tags:
  - decision
  - adr
  - sanitizacion
  - multiplataforma
fecha_creacion: 2026-05-01
estado: aceptado
---

# ADR-001 — Sanitización Multiplataforma de Nombres de Archivo

**Fecha:** 2026-05-01  
**Estado:** Aceptado  
**Impacto:** `deepseek-code` (audit-reporter, memory-loader, checkpoint-manager)

---

## Contexto

`deepseek-code` escribe archivos en el sistema de archivos local
(`~/.deepseek-code/projects/{cwd-hashed}/audits/`, `memory/`, `checkpoints/`).
Los nombres de archivo se construyen a partir de datos del dominio del usuario:

- Nombres de sprint o feature (ej: `checkpoint-<nombre>`)
- Nombres de proyecto
- Timestamps formateados

En Windows, ciertos caracteres no están permitidos en nombres de archivo:
`< > : " / \ | ? *`

Esto provocó un error en producción:

```
ENOENT: no such file or directory, open '...audits\informe-final-multigate-como-funciona-\checkpoint-<nombre>-crear-checkp-v1.1.0.md'
```

El nombre contenía `<` y `>` sin escapar, además de una barra invertida (`\checkpoint`)
interpretada como separador de directorios.

---

## Decisión

Implementar una función `sanitizeFilename()` en `src/shared/utils/string-utils.ts`
que centralice la sanitización de nombres de archivo con la siguiente lógica:

1. **Minúsculas** — consistencia entre sistemas case-sensitive (Linux) e insensitive (Windows/macOS).
2. **Espacios → guiones** — evita URLs con `%20` y paths con espacios.
3. **Eliminar caracteres inválidos** — `<>:"/\|?*` (los no permitidos en Windows).
4. **Colapsar guiones múltiples** — `---` → `-`.
5. **Recortar guiones extremos** — evita nombres que empiecen/terminen con guión.
6. **Fallback `"untitled"`** — si el input es vacío o solo contenido inválido.

**Ubicación:** `src/shared/utils/string-utils.ts` (junto a `encoding.ts`, que ya es
el módulo de utilidades compartidas del proyecto).

**No se usa una librería externa** (`sanitize-filename`, `slugify`) por:
- Cero dependencias adicionales
- Lógica trivial (~15 líneas)
- Control total sobre el comportamiento

---

## Alternativas Consideradas

| Opción | Descripción | Decisión |
|--------|-------------|----------|
| **A — Helper compartido propio** | Función `sanitizeFilename()` centralizada | ✅ **Elegida** |
| **B — Sanitización inline** | Cada archivo sanitiza por su cuenta | ❌ Rechazada: duplicación de código, riesgo de inconsistencias |
| **C — Librería npm** | `sanitize-filename` o `slugify` | ❌ Rechazada: dependencia innecesaria para lógica simple |
| **D — Whitelist Unicode** | Permitir solo ciertos caracteres Unicode | ❌ Rechazada: complejidad innecesaria para el alcance actual |

---

## Consecuencias

### Positivas
- ✅ Código centralizado y testeable (19 tests unitarios pasando)
- ✅ Sin dependencias externas
- ✅ Comportamiento predecible en Windows, Linux y macOS
- ✅ Elimina duplicación: se removió la función local `sanitizeFilename()` en `audit-reporter.ts`
- ✅ Fácil de extender si se requiere soporte Unicode en el futuro

### Negativas
- ⚠️ Pérdida de información: caracteres significativos (`:`, `<`, `>`) se pierden.
  - Mitigación: los consumidores deben formatear antes de pasar a `sanitizeFilename()`.
- ⚠️ No soporta caracteres Unicode acentuados (se eliminan). Si se requiere en el futuro,
  migrar a una whitelist Unicode sin cambiar la interfaz.

### Riesgos
| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Colisión de nombres tras sanitización | Media | Agregar sufijo incremental si el archivo ya existe (responsabilidad del llamador) |
| Nombres vacíos tras sanitización | Alta | ✅ Ya mitigado: retorna `"untitled"` |
| Diferencia de comportamiento Windows vs Unix | Baja | El algoritmo es idéntico para ambos |

---

## Archivos Afectados

- `src/shared/utils/string-utils.ts` — función `sanitizeFilename()` (nueva)
- `src/orchestrator/audit-reporter.ts` — refactorizado para usar el helper compartido
- Próximos: `src/memory/updater.ts` (checkpoints), `src/bootstrap/memory-loader.ts`

---

## Referencias

- [Caracteres no permitidos en nombres de archivo Windows](https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
- Issue original: error `ENOENT` al generar informe final con `checkpoint-<nombre>`

---

*Creado por DeepSeek Code el 2026-05-01*
