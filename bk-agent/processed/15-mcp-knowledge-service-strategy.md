# 15 - Knowledge Agent como Servicio MCP: Estrategia Arquitectónica

Estrategia completa para exponer knowledge-agent como servicio MCP centralizado para múltiples agentes de codificación (Claude Code, bk-agent, OpenCode, etc.).

## 🎯 Objetivo Estratégico

```
Knowledge Agent MCP Server
    ↓
Múltiples agentes consultan
    ↓
RAG Semántico en vaults
    ↓
Un único source of truth por dominio
```

### Agentes Que Se Benefician

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│  Claude Code    OpenCode    bk-agent    Otros      │
│       │             │            │         │        │
│       └─────────┬───┴────────┬───┘         │        │
│                 │            │             │        │
│              MCP Bus (Knowledge Agent)      │        │
│                 │            │             │        │
│       ┌─────────┴───────┬────┴─────────────┘        │
│       │                 │                  │         │
│   bk-agent-vault   product-vault     other-vaults   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## 🏗️ Opción Recomendada: MCP Server Standalone ⭐⭐⭐

### Arquitectura
```
┌──────────────────────────────────────────┐
│   Knowledge Agent MCP Server             │
│   (puerto: 3100 por defecto)             │
│                                          │
│  - Busca semánticamente en vaults        │
│  - Escribe insights de vuelta            │
│  - Multi-vault support                   │
│  - ObsidianRAGProvider                   │
└────────┬─────────────────────────────────┘
         │
    HTTP/WebSocket
    ╱          ╲
   ╱            ╲
  ╱              ╲
┌─────────┐  ┌──────────┐  ┌──────────┐
│ Claude  │  │ bk-agent │  │ OpenCode │
│  Code   │  │  (CLI)   │  │  (agent) │
└─────────┘  └──────────┘  └──────────┘
```

### Ventajas
- ✅ **Desacoplado** — Servidor independiente
- ✅ **Escalable** — Múltiples clientes
- ✅ **Multi-vault** — Maneja N vaults
- ✅ **Stateless** — Fácil de replicar
- ✅ **Reutilizable** — Cualquier agente
- ✅ **Fácil onboarding** — Configura 1 servidor

### Desventajas
- ❌ Requiere servidor corriendo
- ❌ Network overhead (vs in-process)
- ❌ Punto único de fallo (pero fácil de replicar)

---

## 📋 Tools Expuestos por MCP

### 1. search_knowledge
```typescript
{
  name: "search_knowledge",
  description: "Búsqueda semántica en vault",
  inputs: {
    query: "¿Cuáles son los parámetros de /spec.run?",
    vault: "bk-agent",  // default
    limit: 5,           // max resultados
    threshold: 0.7      // similitud mínima
  },
  returns: {
    chunks: [
      {
        source: "03-commands-slash.md",
        title: "/spec.run",
        content: "...",
        score: 0.95,
        section: "Spec Commands"
      }
    ]
  }
}
```

### 2. write_knowledge
```typescript
{
  name: "write_knowledge",
  description: "Escribir insight al vault",
  inputs: {
    title: "Nueva lección: error handling",
    content: "Siempre usar Result<T>...",
    tags: ["error-handling", "best-practice"],
    vault: "bk-agent",
    source: "claude-code"
  }
}
```

### 3. list_vaults
```typescript
{
  name: "list_vaults",
  description: "Listar vaults disponibles",
  returns: {
    vaults: [
      { name: "bk-agent-vault", chunks: 156, lastIndexed: "2026-06-13" },
      { name: "product-vault", chunks: 89, lastIndexed: "2026-06-12" }
    ]
  }
}
```

### 4. get_vault_stats
```typescript
{
  name: "get_vault_stats",
  description: "Estadísticas del vault",
  returns: {
    vault: "bk-agent-vault",
    totalChunks: 156,
    lastIndexed: "2026-06-13T10:30:00Z",
    searchLatency: "45ms",
    indexSize: "2.3MB"
  }
}
```

### 5. reindex_vault
```typescript
{
  name: "reindex_vault",
  description: "Reindexar vault (detecta cambios)",
  inputs: {
    vault: "bk-agent"
  }
}
```

---

## 🔌 Integración con Agentes

### Para Claude Code
```json
{
  "mcpServers": {
    "knowledge": {
      "command": "node",
      "args": ["./knowledge-agent-mcp-server.js"],
      "env": {
        "MCP_PORT": "3100",
        "KNOWLEDGE_VAULTS_DIR": "/vaults",
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

Uso en Claude Code:
```
Usuario: "¿Cómo uso /spec.run?"

Claude:
  [Calling search_knowledge(query: "spec.run", vault: "bk-agent")]
  
  Según el vault (bk-agent):
  
  /spec.run ejecuta la generación de código para la fase actual.
  
  Proceso:
  1. Lee specification.md + design.md
  2. Orquesta especialistas
  3. Genera código
  4. QA automático
  5. Muestra resultados
  
  [Fuente: 03-commands-slash.md, score: 0.95]
```

### Para bk-agent
```yaml
# skills/knowledge-agent-skill.yaml
name: "Knowledge RAG"
version: "1.0.0"
description: "Consultar vault de bk-agent"

triggers:
  - "consult vault"
  - "search knowledge"
  - "ask about bk-agent"

tools:
  - name: "search_knowledge"
    handler: "mcp.knowledge.search"
    description: "Busca en vault de bk-agent"

systemPromptAddition: |
  Tienes acceso a búsqueda semántica del vault de bk-agent.
  Usa search_knowledge() para cualquier pregunta sobre bk-agent.
  SIEMPRE cita las fuentes del vault.
```

Uso en bk-agent:
```
Usuario: "¿Qué hace /spec.advance?"

bk-agent:
  [Activating Knowledge RAG skill]
  [search_knowledge(query: "/spec.advance", vault: "bk-agent")]
  
  Según el vault:
  
  /spec.advance mueve a la siguiente fase.
  
  Opciones:
  - /spec.advance --passed "notas"  → avanza a siguiente fase
  - /spec.advance --failed "notas"  → revierte a IMPLEMENT
  
  [Fuente: 03-commands-slash.md]
```

### Para OpenCode
```json
{
  "mcpServers": {
    "knowledge": {
      "command": "node",
      "args": ["/usr/local/bin/knowledge-agent-mcp"],
      "env": {
        "KNOWLEDGE_VAULTS": "bk-agent,product,architecture",
        "MCP_PORT": "3100"
      }
    }
  }
}
```

---

## 📊 Arquitectura Multi-Vault

### Estructura de Directorios
```
~/.knowledge-agent/
├── vaults/
│   ├── bk-agent-vault/
│   │   ├── index.json              # RAG embeddings + metadata
│   │   ├── vault-config.yaml       # Configuración
│   │   └── 04-Recursos/            # Actual vault content
│   ├── product-vault/
│   │   ├── index.json
│   │   └── ...
│   └── architecture-vault/
│       └── ...
├── config.yaml                     # Configuración global
├── server.log                      # Logs del servidor
└── auth-keys.yaml                  # API keys
```

### Format de Index RAG
```json
{
  "vault": "bk-agent-vault",
  "version": "1",
  "metadata": {
    "totalChunks": 156,
    "lastIndexed": "2026-06-13T10:30:00Z",
    "embeddingModel": "text-embedding-3-small",
    "indexSize": "2.3MB"
  },
  "chunks": [
    {
      "id": "chunk-001",
      "source": "03-commands-slash.md",
      "title": "/help command",
      "content": "Display available commands...",
      "embedding": [0.12, -0.45, ...],  // 1536 dimensiones
      "metadata": {
        "section": "Commands",
        "tags": ["command", "help", "reference"],
        "updated": "2026-06-13",
        "importance": 0.9
      }
    },
    // ... más chunks
  ]
}
```

---

## 🚀 Roadmap: Implementación Phased

### Fase 1: MCP Server Local (Semanas 1-3) ✅
```
Tareas:
- [ ] Crear knowledge-agent-mcp package
- [ ] Implementar MCP protocol handler
- [ ] Portar tools (search, write)
- [ ] Multi-vault support
- [ ] Integrar con Claude Code (local)
- [ ] Integrar con bk-agent (skill)
- [ ] Tests unitarios

Resultado: MVP funcionando localmente
Estimación: 2-3 semanas
```

### Fase 2: Docker & Team (Semanas 4-8)
```
Tareas:
- [ ] Dockerfile
- [ ] Auth layer (API keys)
- [ ] Rate limiting
- [ ] Integrar con OpenCode
- [ ] Docker Compose config
- [ ] Documentación

Resultado: Equipo puede usar servidor centralizado
Estimación: 3-4 semanas
```

### Fase 3: Cloud Deployment (Semanas 9-12)
```
Tareas:
- [ ] Deploy a Vercel/Railway
- [ ] Monitoring & observability
- [ ] Performance optimization
- [ ] CI/CD pipeline
- [ ] Public documentation

Resultado: Servicio cloud disponible
Estimación: 3-4 semanas
```

### Fase 4: Ecosystem (Meses 4-6)
```
Tareas:
- [ ] Plugin registry (opcional)
- [ ] Enterprise auth (OAuth2)
- [ ] Advanced features
- [ ] Expand vaults

Resultado: Plataforma escalable
Estimación: Ongoing
```

---

## 💡 Decisiones Arquitectónicas

### 1. Usar MCP Standard
**Decision:** ✅ MCP (vs protocolo custom)

**Por qué:**
- Ya soportado por Claude Code
- Compatible con ecosystem BackendKit
- Future-proof
- Standardizado

---

### 2. Servidor Standalone
**Decision:** ✅ Standalone (vs embedded)

**Por qué:**
- Escalable a múltiples agentes
- Desacoplado
- Reutilizable
- Fácil de replicar

---

### 3. Embeddings In-Process
**Decision:** ✅ In-Process (Fase 1-2), Remote (Fase 3)

**Por qué:**
- Baja latencia
- Más simple
- Upgrade fácil después

---

### 4. Autenticación Simple
**Decision:** ✅ API Keys (Fase 1-2), OAuth2 (Fase 3)

**Por qué:**
- Team/local es prioritario
- Upgrade path claro
- Flexible

---

## 🔐 Security & Governance

### Niveles de Acceso

```
┌──────────────────────────────────────┐
│  ADMIN (Curador)                     │
│  ✓ write_knowledge (cualquier tema)  │
│  ✓ reindex_vault                     │
│  ✓ delete_insight                    │
│  ✓ manage_users                      │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│  AGENTS (Escribir)                   │
│  ✓ write_knowledge (insights)        │
│  ✓ search_knowledge                  │
│  ✓ Requiere aprobación? (configurable)
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│  USERS (Lectura)                     │
│  ✓ search_knowledge                  │
│  ✓ list_vaults                       │
│  ✓ Solo lectura                      │
└──────────────────────────────────────┘
```

### Auditoría de Writes
```yaml
# Cada write_knowledge se registra
- timestamp: "2026-06-13T10:30:00Z"
  agent: "bk-agent"
  action: "write_knowledge"
  vault: "bk-agent-vault"
  title: "Nueva lección de error handling"
  status: "pending_review"
  reviewer: "admin@backendkit.dev"
```

---

## ✨ Comparación: Antes vs Después

### SIN Knowledge Agent MCP

```
Claude Code
    ↓
Pregunta: "¿Cuáles son los parámetros de /spec.run?"
    ↓
Respuesta: Basada en conocimiento de entrenamiento
    ↓
Posible divergencia con documentación
    ↓
Sin citas exactas
```

### CON Knowledge Agent MCP

```
Claude Code + bk-agent + OpenCode
    ↓
Pregunta: "¿Cuáles son los parámetros de /spec.run?"
    ↓
Búsqueda RAG: search_knowledge(vault: "bk-agent")
    ↓
Resultado: Chunks de 03-commands-slash.md (score: 0.95)
    ↓
Respuesta: Citada exactamente del vault
    ↓
100% consistente y verificable
```

---

## 📊 Beneficios por Agente

| Agente | Sin MCP | Con MCP |
|--------|---------|---------|
| **Claude Code** | Depende conocimiento entrenamiento | ✅ Acceso a vaults, respuestas citadas |
| **bk-agent** | Genérico, sin contexto | ✅ Auto-contextualización, aprendizaje |
| **OpenCode** | Aislado | ✅ Reutiliza knowledge compartido |
| **Otros** | Inconsistentes | ✅ Consistencia cross-agent |

---

## 🎯 Próximos Pasos

### Inmediato (Esta semana)
1. ✅ Crear documentación estratégica (HECHO)
2. ⏳ Procesar vault con curator-agent
3. ⏳ Crear índice RAG inicial

### Próximas 2 semanas
4. Crear `knowledge-agent-mcp` package
5. Implementar core MCP server
6. Integrar con Claude Code (local)

### Mes siguiente
7. Docker image
8. Integración con bk-agent
9. Tests y documentación

---

## ✅ Resumen

**Estrategia:** Exposer knowledge-agent como MCP Server centralizado

**Beneficio:** Múltiples agentes (Claude Code, bk-agent, OpenCode) acceden a un único vault de conocimiento con búsqueda semántica.

**Timeline:** 6 meses hasta producción

**ROI:** 
- Respuestas más precisas (citadas del vault)
- Consistencia cross-agent
- Vault que aprende con cada sesión
- Reutilización de conocimiento

---

**Status:** 📋 Estrategia Completa  
**Siguiente:** Implementar Fase 1 (MCP Server)
