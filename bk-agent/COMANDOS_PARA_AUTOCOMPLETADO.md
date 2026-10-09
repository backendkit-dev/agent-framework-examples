# Comandos Identificados para Autocompletado en bk-agent

## Análisis del Proyecto

El proyecto **bk-agent** funciona principalmente en **modo REPL interactivo** (no como CLI tradicional con subcomandos). Los comandos son slash commands (`/`) que controlan el agente.

### Estado Actual
- ✅ Todos los comandos tienen `/` (slash commands)
- ✅ Ya hay autocompletado para slash commands en el Terminal
- ❌ No hay comandos CLI sin `/` implementados

---

## Comandos Slash Existentes (Candidatos para Expandir Autocompletado)

### 📋 Comandos de Control del Sistema
```
/help              Muestra los comandos disponibles
/clear             Limpiar pantalla
/reset-context     Reiniciar conversacion (mantiene sistema)
/context           Ver contexto activo del proyecto
/tokens            Uso de tokens en el contexto actual
/usage             Tokens y costo de sub-agentes en esta sesion
/status            Panel de estado del sistema
/memory            Ver memoria persistente del proyecto activo
```

### 👤 Comandos de Agente y Modelo
```
/agent [id]        Lista o cambia el agente activo
/models [id]       Lista o cambia el modelo de IA
/iteration         Ver o cambiar modo de iteracion
```

### 💾 Comandos de Sesión y Skills
```
/skills            Ver, instalar o crear skills
/init              Inicializar o analizar proyecto
/prompt            Genera un prompt estructurado desde una frase
/switch [ws][proj] Cambiar workspace/proyecto activo
/workspace [sub]   Gestionar workspaces (create/add/remove/delete)
/checkpoint        Gestionar checkpoints
  ├─ /checkpoint create [--name]   Crear checkpoint
  ├─ /checkpoint list              Listar checkpoints
  ├─ /checkpoint load <n>          Cargar checkpoint
  └─ /checkpoint delete <id>       Eliminar checkpoint
```

### 🏗️ Comandos de Especificación (Spec-Driven Development)
```
Fase SPEC:
  /spec.prompt      Guarda requisitos iniciales en prompt.md
  /spec.specify     Genera specification.md desde prompt.md
  /spec.plan        Genera design.md (arquitectura)
  /spec.revise.*    Corrige documentos existentes

Fase IMPLEMENT:
  /spec.init        Inicializa el roadmap de fases
  /spec.next        Muestra instrucciones de la etapa actual
  /spec.run         Genera código de la fase actual
  /spec.qa          QA evalúa la fase actual
  /spec.advance     Avanza de etapa

Utilidades:
  /spec.show.*      Muestra los documentos sin coste LLM
    ├─ /spec.show.prompt
    ├─ /spec.show.specify
    ├─ /spec.show.plan
    └─ /spec.show.roadmap [fase]

  /spec.revise.*    Corrige o amplía documentos
    ├─ /spec.revise.prompt
    ├─ /spec.revise.specify
    └─ /spec.revise.plan

Ejecución:
  /spec.go          Ejecuta todas las fases de forma autónoma
```

---

## Propuesta: Qué Autocompletar

### **Opción A: Mejorar Autocompletado Existente de Slash Commands**

El autocompletado actual funciona bien, pero se puede mejorar con:

1. **Sugerencias de subcomandos** para slash commands con grupo:
   ```
   /checkpoint <TAB>
   → create  delete  list  load
   
   /spec. <TAB>
   → show.prompt   show.specify   show.plan   show.roadmap
   → revise.prompt revise.specify revise.plan
   → init          next           run        qa  advance  go
   
   /workspace <TAB>
   → create  add  remove  delete  switch
   ```

2. **Sugerencias de argumentos** para comandos que los necesitan:
   ```
   /agent <TAB>
   → (listar IDs de agentes disponibles)
   
   /models <TAB>
   → deepseek-chat  deepseek-reasoner  (modelos disponibles)
   
   /checkpoint load <TAB>
   → (listar checkpoints disponibles)
   ```

3. **Sugerencias de flags** (aunque pocos comandos los usan):
   ```
   /workspace create --<TAB>
   → --name
   
   /checkpoint create --<TAB>
   → --name
   ```

---

### **Opción B: Crear Comandos CLI Sin Slash (Nuevos)**

Si el usuario quiere agregar comandos de CLI tradicionales (sin `/`):

```bash
# Comandos propuestos para CLI
bk-agent config get [key]
bk-agent config set [key] [value]
bk-agent config list
bk-agent config edit

bk-agent project init
bk-agent project list
bk-agent project switch [name]

bk-agent skill list
bk-agent skill install [name]
bk-agent skill remove [name]

bk-agent checkpoint create [--name]
bk-agent checkpoint list
bk-agent checkpoint load [id]
bk-agent checkpoint delete [id]

bk-agent agent list
bk-agent agent info [id]
```

---

## Comparativa: Qué Implementar

| Opción | Costo | Beneficio | Recomendación |
|--------|-------|-----------|---------------|
| **A: Mejorar Slash** | 1-2h | Alto (USA ve mejora inmediata) | ⭐⭐⭐ Primero |
| **B: CLI sin slash** | 4-6h | Medio (usuarios avanzados) | ⭐⭐ Después |
| **Ambas** | 5-7h | Alto + Alto | ⭐⭐⭐⭐ Si hay tiempo |

---

## Mi Recomendación

### **Fase 1: Expandir Autocompletado de Slash Commands** (RÁPIDO)

Mejorar `src/ui/terminal.ts` para que cuando el usuario escribe:

```
/spec<TAB>         → Lista todos /spec.* (show, revise, init, next, run, qa, advance, go)
/spec.show<TAB>    → Lista /spec.show.prompt, .specify, .plan, .roadmap
/checkpoint<TAB>   → Lista create, delete, list, load
/agent<TAB>        → Lista IDs reales de agentes (backend, frontend, qa-engineer, etc.)
/models<TAB>       → Lista deepseek-chat, deepseek-reasoner
```

**Archivo a modificar:**
- `src/ui/terminal.ts` (extender la lógica del completer para ser más inteligente)

**Tiempo:** 1-2 horas
**Impacto:** Directo, todos lo ven en REPL

---

### **Fase 2: Comandos CLI Optativos (DESPUÉS)**

Si el usuario quiere ejecutar desde shell directo:
```bash
bk-agent --version
bk-agent --help
bk-agent config list
bk-agent config get API_KEY
```

**Tiempo:** 2-3 horas adicionales

---

## Estructura de Datos para Autocompletado Mejorado

```typescript
// Definir en nuevo archivo: src/commands/slash-commands-registry.ts

export const SLASH_COMMANDS_REGISTRY = {
  system: {
    group: 'Sistema',
    commands: [
      { name: '/help', description: 'Muestra los comandos disponibles' },
      { name: '/clear', description: 'Limpiar pantalla' },
      { name: '/status', description: 'Panel de estado del sistema' },
    ]
  },
  
  config: {
    group: 'Configuración',
    commands: [
      { name: '/agent', args: '[id]', subcommands: ['list', 'switch'], description: 'Cambiar agente' },
      { name: '/models', args: '[id]', description: 'Cambiar modelo' },
      { name: '/iteration', args: '[mode]', values: ['interactive', 'auto', 'step-by-step'], description: 'Modo iteración' },
    ]
  },
  
  storage: {
    group: 'Almacenamiento',
    commands: [
      { 
        name: '/checkpoint', 
        subcommands: [
          { name: 'create', args: '[--name]' },
          { name: 'list' },
          { name: 'load', args: '[id]' },
          { name: 'delete', args: '[id]' },
        ],
        description: 'Gestionar checkpoints'
      },
      {
        name: '/workspace',
        subcommands: [
          { name: 'create', args: '[--name]' },
          { name: 'list' },
          { name: 'add', args: '[--path]' },
          { name: 'remove', args: '[--name]' },
          { name: 'switch', args: '[--workspace] [--project]' },
        ],
        description: 'Gestionar workspaces'
      },
    ]
  },
  
  spec: {
    group: 'Especificación (Spec-Driven Dev)',
    commands: [
      // Design phase
      { name: '/spec.prompt', args: '<description>', description: 'Guardar requisitos iniciales' },
      { name: '/spec.specify', args: '[hint]', description: 'Generar specification.md' },
      { name: '/spec.plan', args: '[hint]', description: 'Generar design.md' },
      
      // Revise
      { 
        name: '/spec.revise',
        subcommands: [
          { name: '.prompt', args: '<feedback>' },
          { name: '.specify', args: '<feedback>' },
          { name: '.plan', args: '<feedback>' },
        ]
      },
      
      // Show
      { 
        name: '/spec.show',
        subcommands: [
          { name: '.prompt' },
          { name: '.specify' },
          { name: '.plan' },
          { name: '.roadmap', args: '[fase]' },
        ]
      },
      
      // Execution
      { name: '/spec.init', description: 'Inicializar roadmap' },
      { name: '/spec.next', description: 'Instrucciones de la etapa actual' },
      { name: '/spec.run', description: 'Generar código de la fase' },
      { name: '/spec.qa', description: 'QA evalúa la fase' },
      { name: '/spec.advance', args: '[--passed|--failed]', description: 'Avanzar etapa' },
      { name: '/spec.go', description: 'Ejecutar todas las fases automáticamente' },
    ]
  }
};
```

---

## Implementación Paso a Paso (Opción A - Recomendada)

### Paso 1: Extraer metadata de comandos
```typescript
// bin/cli.ts - antes de crear el Terminal
const SLASH_COMMANDS_WITH_META = [
  {
    name: '/spec.show',
    type: 'group',
    completions: ['.prompt', '.specify', '.plan', '.roadmap'],
    description: 'Muestra documentos sin coste LLM'
  },
  {
    name: '/checkpoint',
    type: 'group',
    completions: ['create', 'delete', 'list', 'load'],
    description: 'Gestionar checkpoints'
  },
  // ... más comandos
];
```

### Paso 2: Pasar al Terminal
```typescript
terminal = new Terminal({
  completions: SLASH_COMMANDS,
  commandMeta: SLASH_COMMANDS_WITH_META,  // NUEVO
  // ... resto de opciones
});
```

### Paso 3: Mejorar el completer en terminal.ts
```typescript
const completer = (line: string, callback) => {
  if (line.startsWith('/')) {
    // Buscar si es un grupo (/spec.)
    const groupMatch = line.match(/^\/([a-z-]+)\.?(\w*)/);
    if (groupMatch) {
      const [, base, partial] = groupMatch;
      const group = opts.commandMeta?.find(c => c.name.startsWith('/' + base));
      if (group && group.type === 'group') {
        const hits = group.completions
          .map(c => '/' + base + c)
          .filter(c => c.startsWith(line));
        callback(null, [hits, line]);
        return;
      }
    }
    
    // Fallback: completar comandos normales
    const hits = (opts.completions ?? []).filter(c => c.startsWith(line));
    callback(null, [hits.length ? hits : (opts.completions ?? []), line]);
    return;
  }
  
  // ... resto de lógica (@ file, etc.)
};
```

---

## Resultado Final

### Mejora Visible
```bash
$ bk-agent
❯ /spec<TAB>
/spec.go              /spec.init             /spec.next             /spec.plan
/spec.prompt          /spec.qa               /spec.revise.plan      /spec.revise.prompt
/spec.revise.specify  /spec.run              /spec.show.plan        /spec.show.prompt
/spec.show.roadmap    /spec.show.specify     /spec.advance          /spec.specify

❯ /spec.show<TAB>
/spec.show.plan       /spec.show.prompt      /spec.show.roadmap     /spec.show.specify

❯ /checkpoint<TAB>
create  delete  list  load

❯ /agent<TAB>
backend  frontend  general  qa-engineer  architecture  project-manager

❯ /models<TAB>
deepseek-chat  deepseek-reasoner
```

---

## Conclusión

**Recomendación de implementación:**

1. **Empezar por Opción A** (2-3 comandos para probar)
   - `/spec` → sugerencias de subcomandos
   - `/checkpoint` → subcomandos (create, list, load, delete)
   - `/workspace` → subcomandos

2. **Después expandir a todos** si la experiencia es buena

3. **Opcionalmente**, agregar Opción B (CLI) si hay demanda

¿Quieres que empience a implementar la Opción A?
