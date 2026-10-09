# Análisis: Autocompletado para Comandos sin `/` en bk-agent

## Contexto Actual

El proyecto `bk-agent` tiene dos tipos de comandos:

### 1. **Comandos con `/` (Slash Commands)**
- Implementados en el framework de Claude Code
- Ejemplos: `/help`, `/models`, `/skills`, `/agent`, etc.
- **Ya tienen autocompletado** implementado en `src/ui/terminal.ts` (líneas 144-179)
- El completer filtra comandos que coincidan con lo escrito

### 2. **Comandos sin `/` (CLI Commands)**
- Implementados con `commander.js` v12
- Definidos en `bin/cli.ts` con `.option()` y subcomandos
- Ejemplos esperados: `bk-agent domain add`, `bk-agent domain list`, etc.
- **NO TIENEN autocompletado** actualmente

---

## Opciones de Implementación

### **Opción 1: Extender el Completer en Terminal (Recomendada para interactividad)**

**Ventaja:**
- Autocompletado dentro del REPL interactivo
- Consistente con el flujo actual
- No requiere shell-specific setup

**Desventaja:**
- Solo funciona dentro de la sesión interactiva
- No disponible cuando se ejecuta `bk-agent <cmd>` directamente desde shell

**Implementación:**
```typescript
// En src/ui/terminal.ts, extender el completer

const completer = opts.completions && opts.cliCommands 
    ? (line: string, callback) => {
        // Si empieza con '/', usar slash commands (código actual)
        if (line.startsWith('/')) { ... }
        
        // Si NO tiene '/', proporcionar CLI commands completados
        // Ej: "domain a" → ["domain add", "domain remove"]
        if (!line.includes(' ') && line.trim()) {
            const hits = opts.cliCommands.filter(cmd => cmd.startsWith(line));
            callback(null, [hits, line]);
        }
        
        // Si tiene espacio, completar subcomandos
        // Ej: "domain add --" → ["--name", "--description"]
        if (line.startsWith('domain ')) {
            const subCmd = line.split(' ')[1];
            const flags = getDomainCommandFlags(subCmd);
            callback(null, [flags, line]);
        }
        
        // @ file autocomplete (código actual)
        ...
    }
```

---

### **Opción 2: Commander.js Shell Completions (Recomendada para shell)**

**Ventaja:**
- Autocompletado nativo en bash/zsh/powershell
- Funciona cuando ejecutas `bk-agent <cmd>` desde cualquier shell
- Estándar de industria

**Desventaja:**
- Requiere instalación/setup inicial (ej: `eval "$(bk-agent completion bash)"`)
- Código adicional para generar completions
- Diferentes scripts para cada shell

**Implementación:**
Commander v12 soporta completions nativamente. Se necesita:

```typescript
// Crear nuevo archivo: src/shell-completion.ts
export function registerCompletions(program: Command) {
    program
        .addCommand(createCompletionCommand(program));
}

// En bin/cli.ts:
import { registerCompletions } from '../src/shell-completion';
registerCompletions(program);

// Uso:
// $ eval "$(bk-agent completion bash)"
// $ bk-agent domain <TAB>
```

---

### **Opción 3: Híbrida (Recomendada - Mejor UX)**

Implementar **ambas** opciones:

1. **Para REPL interactivo** → Opción 1 (terminal completer extendido)
2. **Para shell directo** → Opción 2 (commander completions)

**Flujo:**
```
Usuario ejecuta: bk-agent
  ↓
Entra a REPL interactivo
  ↓
Completer del Terminal autocompleta slash commands + CLI commands
  
---

Usuario ejecuta: bk-agent domain add --name foo
  ↓
Commander.js procesa directamente (no entra a REPL)
  ↓
Si `--` + TAB → shell completion (Opción 2) autocompleta flags
```

---

## Estructura de Comandos Recomendada

Basándose en `src/reflection/commands/domain-commands.ts`:

```
Comandos principales:
├── domain
│   ├── add [--name] [--description] [--failure-types]
│   ├── remove [--name]
│   ├── enable [--name]
│   ├── disable [--name]
│   ├── list [--active-only] [--builtin-only]
│   └── show [--name]
├── skills
│   ├── list
│   ├── install
│   ├── remove
│   └── enable/disable
├── checkpoint
│   ├── create [--name]
│   ├── list
│   ├── load [--id]
│   └── delete [--id]
└── workspace
    ├── create [--name]
    ├── list
    ├── add [--path]
    ├── remove [--name]
    └── switch [--workspace] [--project]
```

---

## Propuesta: Implementación en 3 Fases

### **Fase 1: Autocompletado en Terminal Interactivo**
- Extender `src/ui/terminal.ts` completer
- Agregar opción `cliCommands` en `TerminalOptions`
- En `bin/cli.ts`, extraer comandos de commander y pasarlos al Terminal
- **Tiempo estimado:** 2-3 horas

### **Fase 2: Shell Completions para Bash/Zsh**
- Crear `src/shell-completion.ts` con soporte commander
- Generar completions dinámicamente
- Documentar instalación en README
- **Tiempo estimado:** 3-4 horas

### **Fase 3: PowerShell Completions**
- Crear profile script para PowerShell
- Documentar instalación
- **Tiempo estimado:** 2 horas

---

## Ejemplo de Resultado Final

**En REPL interactivo:**
```
❯ domai<TAB>
domain

❯ domain <TAB>
add       disable   enable    list      remove    show

❯ domain add --<TAB>
--name               --description        --failure-types      --help
```

**Desde shell:**
```bash
$ eval "$(bk-agent completion bash)"

$ bk-agent domain <TAB>
add       disable   enable    list      remove    show

$ bk-agent domain add --<TAB>
--name               --description        --failure-types      --help
```

---

## Archivos a Modificar/Crear

### Modificar:
1. `src/ui/terminal.ts` - Extender completer
2. `bin/cli.ts` - Pasar CLI commands al Terminal

### Crear:
1. `src/shell-completion.ts` - Generar completions
2. `src/bin/completion.sh` - Script bash
3. `src/bin/completion.zsh` - Script zsh (opcional)
4. `src/bin/completion.ps1` - Script PowerShell (opcional)

---

## Recomendación

**Implementar la opción 3 (Híbrida)** por:
- ✅ Mejor experiencia en REPL
- ✅ Soporte completo para shell directo
- ✅ Escalable para múltiples shells
- ✅ Coherente con estándares CLI

**Prioridad:**
1. Fase 1 (Terminal interactivo) - impacto inmediato
2. Fase 2 (Bash/Zsh) - mayoría de usuarios
3. Fase 3 (PowerShell) - si es necesario

---

## Referencias
- [Commander.js Completions](https://github.com/tj/commander.js/blob/master/examples/completion.js)
- [Node.js readline API](https://nodejs.org/api/readline.html#readline_rl_createinterface_options)
- [Bash Completion](https://www.gnu.org/software/bash/manual/html_node/Programmable-Completion.html)
