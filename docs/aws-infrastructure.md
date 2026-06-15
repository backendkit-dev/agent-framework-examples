# AWS Infrastructure Design — Agent Framework

## Diagrama

```
Internet
    │
    ▼
┌─────────────────────────────────────┐
│  ALB  (HTTPS, SSL termination)      │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  API Service  (ECS Fargate)         │  ← stateless, N réplicas
│  POST /runs   → 202 + run_id        │
│  GET  /runs/:id → status            │
│  POST /runs/:id/approve             │
└────────────────┬────────────────────┘
                 │ publica mensaje
                 ▼
┌─────────────────────────────────────┐
│  SQS  (flow-execution-queue)        │  ← desacopla request de ejecución
└────────────────┬────────────────────┘
                 │ consume
                 ▼
┌─────────────────────────────────────┐
│  Orchestrator Workers (ECS Fargate) │  ← escala por profundidad de cola
│  Ejecuta flows, llama agentes       │
│  Lee config de S3                   │
│  Escribe estado en DynamoDB         │
└──────┬──────┬──────┬────────────────┘
       │      │      │  HTTP (Agent Protocol)
       ▼      ▼      ▼
  ┌────────┐ ┌───────────┐ ┌──────────────┐
  │ Triage │ │ Curator   │ │ Synthesizer  │
  │ Fargate│ │ Fargate   │ │ Fargate      │
  └────────┘ └───────────┘ └──────────────┘
    stateless    stateless    más CPU/RAM
    N réplicas   N réplicas   escala por SQS

Storage & State:
  DynamoDB       — run state (id, status, steps, gate info)
  S3             — flow YAMLs, vault documents
  OpenSearch     — búsqueda vectorial del vault
  Secrets Manager— API keys, LLM credentials
  CloudWatch     — logs, métricas, alertas
```

---

## Pattern async (vs. síncrono actual)

### Hoy (síncrono — orchestrator-gateway)
```
POST /run  →  espera 60-120s  →  200 { result }
```

### Target AWS (async)
```
POST /runs          →  202 { run_id, status: "running" }   ← inmediato
GET  /runs/:id      →  { status: "running" }                ← polling
GET  /runs/:id      →  { status: "waiting_gate", gate: {} } ← gate hit
POST /runs/:id/approve
GET  /runs/:id      →  { status: "completed", steps: [] }   ← done
```

El cliente hace polling (o conecta por WebSocket si necesita notificación inmediata).

---

## Cambios necesarios al código actual

| Componente | Implementación actual | Target AWS |
|---|---|---|
| Orchestrator transport | stdio (hijo del gateway) | HTTP propio `:3500` independiente |
| Run state | archivos `.json` en disco | DynamoDB |
| Flow config | YAML en disco local | S3 |
| Ejecución de flow | síncrona (bloquea HTTP) | Worker consume SQS |
| Gate notification | respuesta HTTP que espera | DynamoDB Streams → WebSocket/SSE |
| Vault search | archivos locales | OpenSearch (vectorial) |
| API response | espera el resultado completo | 202 Accepted + polling |

---

## Escalado por servicio

| Servicio | Contenedor | Métrica de escala | Rango réplicas |
|---|---|---|---|
| API Service | ECS Fargate | CPU / request rate | 2 – 10 |
| Orchestrator Worker | ECS Fargate | SQS queue depth | 1 – 20 |
| Triage Agent | ECS Fargate | CPU | 1 – 5 |
| Curator Agent | ECS Fargate | CPU / request rate | 1 – 5 |
| Synthesizer Agent | ECS Fargate | SQS depth / CPU | 1 – 10 |

---

## Roadmap de implementación

### Paso 1 — Orchestrator HTTP transport (bloqueante)
- Agregar modo HTTP al `orchestrator-mcp-agent` (expone `/tools/call`)
- Gateway pasa de `spawn()` a `fetch()`
- Orchestrator y gateway corren en contenedores separados

### Paso 2 — Estado en DynamoDB
- Reemplazar `RunStore` (archivos JSON) por cliente DynamoDB
- Permite múltiples réplicas del worker sin conflictos de estado

### Paso 3 — Async con SQS
- API Service publica `{ run_id, flow_id, input }` en SQS
- Orchestrator Worker consume la cola y ejecuta el flow
- API Service devuelve 202 inmediato; cliente hace polling sobre DynamoDB

### Paso 4 — Vault en S3 + OpenSearch
- Flow YAMLs y docs del vault en S3
- Búsqueda vectorial via OpenSearch para curator-codex

### Paso 5 — Containerización y CI/CD
- Dockerfile por servicio
- ECR para imágenes
- GitHub Actions → build → push ECR → deploy ECS
- Terraform o CDK para infraestructura como código

---

## Infraestructura como código (CDK sketch)

```typescript
// Servicios ECS
const cluster = new ecs.Cluster(this, 'AgentCluster', { vpc });

const apiService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'ApiService', {
    cluster,
    taskImageOptions: { image: ecs.ContainerImage.fromEcrRepository(apiRepo) },
    desiredCount: 2,
});

// Worker con auto-scaling por SQS
const workerService = new ecs.FargateService(this, 'OrchestratorWorker', { cluster, taskDefinition });
const scaling = workerService.autoScaleTaskCount({ maxCapacity: 20 });
scaling.scaleOnMetric('QueueDepth', {
    metric: queue.metricApproximateNumberOfMessagesVisible(),
    scalingSteps: [{ upper: 0, change: -1 }, { lower: 1, change: +1 }, { lower: 10, change: +5 }],
});

// DynamoDB para run state
const runsTable = new dynamodb.Table(this, 'RunsTable', {
    partitionKey: { name: 'run_id', type: dynamodb.AttributeType.STRING },
    billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'ttl',
});
```
