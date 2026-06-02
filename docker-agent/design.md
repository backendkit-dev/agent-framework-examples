# Design Document — Docker Agent

> Generado por el Project Manager durante el flujo de init.
> Fecha: 2026-06-01

## Status

- **Maturity**: Beta
- **Status**: Approved
- **Last review**: 2026-06-01

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Language | TypeScript 5.7+ (Node.js 20+) | El framework backendkit-agent-framework está escrito en TypeScript/Node.js. Tipado fuerte con interfaces y tipos nativos. |
| Agent Framework | `@bk/agent-core` (packages/core) | Framework monorepo que provee AgentEngine, ToolRegistry, AgentRegistry, DelegationBus, tipos y transportes. |
| Docker SDK | dockerode | SDK oficial de Docker para Node.js, permite interactuar con el daemon vía API REST/Unix socket. |
| Docker Compose | child_process + `docker compose` CLI | dockerode no cubre Compose; se usa execSync/exec con parsing estructurado de salida. |
| Testing | Jest + testcontainers (Node.js) | testcontainers-node permite levantar contenedores reales en tests de integración. |
| Linting | Biome / ESLint + Prettier | Estándar en ecosistema TypeScript. |
| CI | GitHub Actions | Ejecución de tests con Docker-in-Docker para integración real. |
| Package Manager | npm workspaces | El framework usa npm workspaces; el proyecto docker-agent puede ser un workspace aparte o un proyecto independiente. |

## Architecture (C4 Level 1)

### System Context

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Agent System                       │
│                                                             │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────┐  │
│  │  Solicitante  │──▶│  Docker Agent    │──▶│ Docker     │  │
│  │  (otro agente)│◀──│  (AgentEngine)   │◀──│ Daemon     │  │
│  └──────────────┘   └──────────────────┘   └────────────┘  │
│                              │                              │
│                              ▼                              │
│                      ┌──────────────┐                       │
│                      │  Docker      │                       │
│                      │  Compose CLI │                       │
│                      └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### Container Diagram (Level 2)

```
┌──────────────────────────────────────────────────────────────┐
│                    Docker Agent Process                       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  AgentEngine (@bk/agent-core)                        │   │
│  │  ┌────────────┐ ┌──────────┐ ┌──────────────────┐   │   │
│  │  │  Tool:     │ │ Tool:    │ │ Tool:            │   │   │
│  │  │  Container │ │ Compose  │ │ Inspect & Prune  │   │   │
│  │  │  Manager   │ │ Manager  │ │ Manager          │   │   │
│  │  └─────┬──────┘ └────┬─────┘ └────────┬─────────┘   │   │
│  │        │             │                │              │   │
│  │  ┌─────▼─────────────▼────────────────▼──────────┐   │   │
│  │  │  Docker SDK Layer (dockerode + child_process) │   │   │
│  │  └────────────────────┬──────────────────────────┘   │   │
│  └───────────────────────┼──────────────────────────────┘   │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ Docker      │
                    │ Daemon      │
                    │ (Unix Socket│
                    │  o TCP)     │
                    └─────────────┘
```

### Layers

1. **AgentEngine**: Core del framework que maneja el ciclo de vida del agente, registro de tools (ToolRegistry), registro de agentes (AgentRegistry), y comunicación con otros agentes vía DelegationBus.
2. **Tools**: Módulos funcionales que exponen operaciones Docker como ToolDefinition (con `name`, `description`, `parameters` JSON Schema, y `execute`).
   - `ContainerManager`: Crear, ejecutar, detener, eliminar contenedores individuales.
   - `ComposeManager`: Orquestar entornos multi-servicio con Docker Compose.
   - `InspectAndPruneManager`: Diagnóstico, logs, limpieza de recursos.
3. **Docker SDK Layer**: Abstracción sobre dockerode y child_process para comandos Compose. Traduce excepciones de Docker a errores del framework.

## Key Decisions

| ID | Decision | Rationale | Alternatives Considered |
|---|---|---|---|
| ADR-001 | Usar TypeScript + dockerode | El framework backendkit-agent-framework es TypeScript/Node.js. dockerode es el SDK oficial de Docker para Node.js. | Python + docker-py — se descartó porque backendkit-agent-framework no soporta Python. |
| ADR-002 | child_process para Docker Compose | dockerode no expone API para Compose. La CLI `docker compose` es la interfaz estándar. | Usar compose-spec (Go) — overkill para este proyecto. |
| ADR-003 | Comunicación síncrona request/response vía DelegationBus | Los agentes solicitantes esperan una respuesta inmediata. El framework provee DelegationBus con soporte paralelo. | Cola de mensajes (RabbitMQ) — innecesario para Beta. |
| ADR-004 | Configuración vía environment variables | Docker Agent se ejecuta como servicio; las configs (socket path, timeout, etc.) vienen del entorno. | Archivo YAML de configuración — se añadirá si es necesario. |
| ADR-005 | Tests con testcontainers-node | Permite tests de integración reales sin mockear Docker. | Mock de dockerode — no detecta regresiones reales del daemon. |
| ADR-006 | Proyecto independiente (no workspace del monorepo) | El docker-agent debe ser instalable y ejecutable sin depender del monorepo completo del framework. | npm workspace dentro del monorepo — más acoplamiento del necesario. |

## Directory Structure

```
docker-agent/
├── src/
│   ├── index.ts               # Punto de entrada: crea AgentEngine, registra tools y agent profile
│   ├── agent.ts               # DockerAgentProfile: definición del agente (id, name, icon, systemPrompt, allowedTools)
│   ├── tools/
│   │   ├── container.ts       # ToolDefinition: container.create, .exec, .stop, .remove, .logs, .inspect
│   │   ├── compose.ts         # ToolDefinition: compose.up, .down, .build, .logs, .ps
│   │   └── system.ts          # ToolDefinition: system.prune, system.info
│   ├── docker/
│   │   ├── client.ts          # Wrapper sobre dockerode (singleton)
│   │   ├── compose.ts         # child_process wrapper para docker compose
│   │   └── types.ts           # Interfaces y tipos (ContainerSpec, ComposeSpec, ContainerInfo, etc.)
│   ├── config.ts              # Config desde env vars
│   └── errors.ts              # Jerarquía de errores del agente
├── tests/
│   ├── setup.ts               # Fixtures de testcontainers
│   ├── container.test.ts
│   ├── compose.test.ts
│   └── system.test.ts
├── compose-files/             # Templates de docker-compose.yml para entornos comunes
│   ├── postgres-redis.yml
│   ├── mysql-rabbitmq.yml
│   └── mongodb-elasticsearch.yml
├── prompt.md                  # Especificación original del proyecto
├── design.md                  # Este documento
├── specification.md           # Contratos API y modelos de datos
├── security.md                # Análisis de seguridad
├── roadmap.md                 # Plan de entregas
├── AGENT.md                   # Instrucciones operativas para sesiones de agente
├── package.json               # Dependencias y configuración del proyecto
└── README.md
```
