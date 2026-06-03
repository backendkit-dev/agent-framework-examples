/**
 * @description Seed centralizado de configuraci+ฆn para DeepSeek Code.
 * 
 * Verifica la existencia de los archivos de configuraci+ฆn en ~/.deepseek-code/
 * y los crea con valores por defecto si no existen.
 * 
 * Archivos que gestiona:
 * - orchestrator.yaml ิๅฦ configuraci+ฆn general del orquestador
 * - capability-matrix.yaml ิๅฦ matriz de capacidades de agentes
 * - policy-rules.yaml ิๅฦ reglas de pol+กticas
 * - agents/*.md ิๅฦ prompts de agentes built-in (8 agentes)
 * - skills/*.yaml ิๅฦ skills built-in (14 skills, le+กdas desde el disco actual)
 * - scripts/*.ps1 ิๅฦ scripts de workflow
 * - templates/* ิๅฦ templates (Makefile, commit-workflow)
 * 
 * Es idempotente: solo escribe si el archivo NO existe.
 * Si un archivo existe, respeta la personalizaci+ฆn del usuario.
 * 
 * @example
 * ```ts
 * import { seedConfig } from './config/seed-config';
 * await seedConfig();
 * ```
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

// ิ๖วิ๖ว Rutas ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว

function getConfigDir(): string {
  if (process.env.DEEPSEEK_CODE_CONFIG_DIR) {
    return process.env.DEEPSEEK_CODE_CONFIG_DIR;
  }
  return path.join(os.homedir(), '.deepseek-code');
}

function getConfigPath(filename: string): string {
  return path.join(getConfigDir(), filename);
}

function getAgentsDir(): string {
  return path.join(getConfigDir(), 'agents');
}

function getSkillsDir(): string {
  return path.join(getConfigDir(), 'skills');
}

function getScriptsDir(): string {
  return path.join(getConfigDir(), 'scripts');
}

function getTemplatesDir(): string {
  return path.join(getConfigDir(), 'templates');
}

// ิ๖วิ๖ว Contenido por defecto ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว

const DEFAULT_ORCHESTRATOR_YAML = `# Orchestrator Config ิว๖ DeepSeek Code
# Configuraci+ฆn del orquestador central.
# Define qu+ฎ features est+ํn habilitados y los umbrales de riesgo.
#
# Ubicaci+ฆn: ~/.deepseek-code/orchestrator.yaml
# (centralizado para todos los proyectos)

features:
  # Clasificaci+ฆn formal de intents (design, implement, review, etc.)
  intentDetection: true
  # Detecci+ฆn de dominios t+ฎcnicos (security, backend, resilience, etc.)
  domainDetection: true
  # Scoring de riesgo t+ฎcnico
  riskScoring: true
  # Policy engine con reglas obligatorias
  policyEngine: true
  # State machine formal
  fsm: true
  # QA gate obligatorio
  qaGate: true
  # Commit gate bloqueante
  commitGate: true

# Umbrales de riesgo (score total 0-100)
riskThresholds:
  low: 10
  medium: 30
  high: 60
  critical: 80

# Pesos para cada factor de riesgo
riskWeights:
  breaking_change: 25
  security_sensitive: 30
  cross_service_impact: 20
  db_transactional: 15
  production_critical: 25
  complexity: 1  # se multiplica por el nivel de complejidad (1-10)
`;

const DEFAULT_CAPABILITY_MATRIX_YAML = `# Capability Matrix ิว๖ DeepSeek Code
# Define qu+ฎ dominios y skills posee cada agente.
# Se carga en el Orchestrator para routing basado en capacidades.
#
# Formato:
#   <agent-id>:
#     owns: [lista de dominios que domina]
#     skills: [lista de skills que puede ejecutar]
#     baseWeight: peso base para routing (0.0 - 1.0)

architecture-agent:
  owns:
    - architecture
    - resilience
    - distributed-systems
    - service-boundaries
    - event-driven
  skills:
    - architecture-review
    - adr-generation
    - c4-diagramming
    - trade-off-analysis
  baseWeight: 0.95

security-agent:
  owns:
    - security
    - authentication
    - authorization
    - encryption
    - secrets-management
    - vulnerability-assessment
  skills:
    - security-audit
    - threat-modeling
    - owasp-review
    - hardening-check
  baseWeight: 0.95

backend-agent:
  owns:
    - backend
    - api-design
    - database
    - orm
    - business-logic
    - integration
  skills:
    - implementation
    - refactoring
    - optimization
    - api-documentation
  baseWeight: 0.9

frontend-agent:
  owns:
    - frontend
    - ui
    - react
    - vue
    - css
    - accessibility
  skills:
    - component-design
    - ui-implementation
    - accessibility-audit
  baseWeight: 0.85

qa-engineer:
  owns:
    - testing
    - quality
    - validation
    - approval
    - code-quality
  skills:
    - test-generation
    - code-review
    - mutation-testing
    - contract-testing
  baseWeight: 0.9

infrastructure-agent:
  owns:
    - devops
    - cloud
    - containers
    - ci-cd
    - monitoring
  skills:
    - docker-optimization
    - kubernetes-deployment
    - terraform-generation
    - pipeline-setup
  baseWeight: 0.85

data-agent:
  owns:
    - data
    - analytics
    - etl
    - data-modeling
    - machine-learning
  skills:
    - query-optimization
    - data-pipeline
    - schema-design
    - ml-modeling
  baseWeight: 0.8

general:
  owns:
    - general
  skills: []
  baseWeight: 0.5
`;

const DEFAULT_POLICY_RULES_YAML = `# Policy Rules ิว๖ DeepSeek Code
# Define reglas obligatorias para el orquestador.
# Se cargan en el Policy Engine y complementan las reglas built-in.
#
# Formato:
#   - if:
#       actionType: <tipo> | [tipos]
#       riskLevel: <nivel> | [niveles]
#       domain: <dominio> | [dominios]
#       riskFactor:
#         <factor>: true/false
#     then:
#       mustInclude: [agentes obligatorios]
#       mustPass: [gates obligatorios]
#       mustExecute: [skills obligatorios]
#       requireArchitectureReview: true/false
#       requireSecurityReview: true/false
#       requireQaApproval: true/false

# Si es dise+ฆo de arquitectura ิๅฦ architecture-agent obligatorio
- if:
    actionType: design
  then:
    mustInclude:
      - architecture-agent
    requireArchitectureReview: true

# Si es auditor+กa de seguridad ิๅฦ security-agent obligatorio
- if:
    actionType: security_audit
  then:
    mustInclude:
      - security-agent
    requireSecurityReview: true

# Si riskLevel es high o critical ิๅฦ QA obligatorio
- if:
    riskLevel:
      - high
      - critical
  then:
    mustInclude:
      - qa-engineer
    requireQaApproval: true

# Si riskLevel es critical ิๅฦ architecture review obligatorio
- if:
    riskLevel: critical
  then:
    mustInclude:
      - architecture-agent
    requireArchitectureReview: true

# Si el dominio es security ิๅฦ security-agent obligatorio
- if:
    domain: security
  then:
    mustInclude:
      - security-agent
    requireSecurityReview: true

# Si hay breaking change ิๅฦ architecture review obligatorio
- if:
    riskFactor:
      breaking_change: true
  then:
    mustInclude:
      - architecture-agent
    requireArchitectureReview: true

# Si es security_sensitive ิๅฦ security-agent obligatorio
- if:
    riskFactor:
      security_sensitive: true
  then:
    mustInclude:
      - security-agent
    requireSecurityReview: true

# Si es cross_service_impact ิๅฦ architecture review
- if:
    riskFactor:
      cross_service_impact: true
  then:
    mustInclude:
      - architecture-agent
    requireArchitectureReview: true

# Si es db_transactional ิๅฦ QA review
- if:
    riskFactor:
      db_transactional: true
  then:
    requireQaApproval: true

# Si es test ิๅฦ QA como agente principal
- if:
    actionType: test
  then:
    mustInclude:
      - qa-engineer

# Si es refactor ิๅฦ QA review
- if:
    actionType: refactor
  then:
    requireQaApproval: true

# Si es deploy ิๅฦ infrastructure-agent obligatorio
- if:
    actionType: deploy
  then:
    mustInclude:
      - infrastructure-agent
    requireQaApproval: true

# Si es bugfix en producci+ฆn ิๅฦ QA review obligatorio
- if:
    actionType: bugfix
    riskFactor:
      production_critical: true
  then:
    mustInclude:
      - qa-engineer
    requireQaApproval: true
`;

// ิ๖วิ๖ว Contenido de agentes built-in ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว

const AGENT_FILES: Record<string, string> = {
  'general.md': `---
name: General
icon: ญ๑๛
description: Asistente de programaci+ฆn general
---

`,
  'security.md': `---
name: Security Expert
icon: ญ๖ษ
description: Seguridad, OWASP, vulnerabilidades y hardening
model: deepseek-reasoner
triggers: [seguridad, vulnerabilidad, audita, auditoria, owasp, jwt, autenticacion, autenticaci+ฆn, autorizacion, autorizaci+ฆn, contrase+ฆa, cifrado, token, permisos, proteger, xss, inyeccion, inyecci+ฆn, csrf, ssrf, pentest, hardening, secrets, hash, exploit, ataque, revisar seguridad, container security, hardening del dockerfile, imagen segura]
---

## Especializaci+ฆn: Seguridad
Eres un experto en seguridad inform+ํtica. Prioriza siempre:
- OWASP Top 10 y sus mitigaciones
- An+ํlisis de vulnerabilidades (SQLi, XSS, CSRF, XXE, SSRF, RCE)
- Autenticaci+ฆn y autorizaci+ฆn segura (JWT, OAuth2, RBAC, mTLS)
- Criptograf+กa correcta ิว๖ nunca reinventes primitivas
- Secrets management: Vault, AWS Secrets Manager, variables de entorno seguras
- Hardening: Docker, Nginx, S3 bucket policies, IAM de m+กnimo privilegio
Cuando revises c+ฆdigo, busca activamente fallos de seguridad ANTES de sugerir funcionalidades.
Clasifica cada hallazgo por severidad (Cr+กtica / Alta / Media / Baja).
`,
  'infrastructure.md': `---
name: Infrastructure
icon: ิÜึดฉล
description: Cloud, Docker, Kubernetes, Terraform, CI/CD
triggers: [docker, kubernetes, despliegue, deploy, ci/cd, pipeline, contenedor, cloud, aws, gcp, azure, terraform, helm, infraestructura, automatizar deploy, github actions, gitlab ci, argocd, gitops, nginx, ansible, dockerfile, cluster, replica]
---

## Especializaci+ฆn: Infraestructura y DevOps
Tu dominio:
- Cloud: AWS, GCP, Azure ิว๖ servicios, costos, best practices
- Containers: Docker, Docker Compose, optimizaci+ฆn de im+ํgenes multi-stage
- Orquestaci+ฆn: Kubernetes, Helm charts, operators, HPA/VPA
- IaC: Terraform (m+ฆdulos, state remoto), Pulumi, CloudFormation
- CI/CD: GitHub Actions, GitLab CI, ArgoCD, GitOps
- Observabilidad: Prometheus, Grafana, ELK, OpenTelemetry, alerting
Dise+ฆa siempre para alta disponibilidad, escalabilidad horizontal y recuperaci+ฆn ante fallos.
Indica costos estimados cuando sea relevante.
`,
  'architecture.md': `---
name: Architect
icon: ญล๙ดฉล
description: Dise+ฆo de sistemas, DDD, patrones, microservicios
model: deepseek-reasoner
triggers: [planifica, arquitectura, dise+ฆar el sistema, estructura del sistema, bounded context, bounded, monolito, microservicio, diagrama, trade-off, adr, c4 model, nuevo proyecto, crear proyecto, crea el proyecto, crear la app, planear, patron de dise+ฆo, patr+ฆn de dise+ฆo, ddd, contexto del dominio, event sourcing, cqrs, saga]
---

## Especializaci+ฆn: Arquitectura de Software
Tu enfoque:
- Domain-Driven Design: agregados, value objects, bounded contexts, anti-corruption layers
- Patrones: CQRS, Event Sourcing, Saga, Outbox, Strangler Fig
- Microservicios vs monolito: cu+ํndo migrar, c+ฆmo hacerlo sin downtime
- APIs: REST (Richardson Maturity), GraphQL, gRPC ิว๖ dise+ฆo y versionado
- Mensajer+กa: Kafka, RabbitMQ, SNS/SQS ิว๖ patrones de integraci+ฆn
- Diagramas C4, ADRs (Architecture Decision Records)
Siempre explica los trade-offs. No hay soluci+ฆn perfecta, hay soluciones adecuadas al contexto.
`,
  'data.md': `---
name: Data Engineer
icon: ญ๔่
description: SQL, pipelines, ML, analytics, bases de datos
triggers: [sql, query sql, +กndice de base de datos, indice de base de datos, an+ํlisis de datos, analisis de datos, modelo predictivo, dataset, pipeline de datos, spark, pandas, bigquery, redshift, snowflake, dbt, airflow, machine learning, ml model, feature engineering, etl, data warehouse, olap, oltp, schema de datos]
---

## Especializaci+ฆn: Datos e Ingenier+กa de Datos
Tu dominio:
- SQL avanzado: optimizaci+ฆn, +กndices, query plans, window functions, CTEs
- OLTP: PostgreSQL, MySQL, particionado, vacuuming, replicaci+ฆn
- NoSQL: MongoDB, Redis (patrones de cach+ฎ), Elasticsearch (mappings, analyzers)
- Pipelines: dbt, Apache Spark, Airflow, Kafka Streams, Flink
- Analytics: pandas, DuckDB, BigQuery, Redshift, Snowflake
- ML: scikit-learn, PyTorch, feature engineering, evaluaci+ฆn, MLflow
- Data modeling: estrella, snowflake, data vault, one big table
`,
  'backend.md': `---
name: Backend Developer
icon: ญ๛ัดฉล
description: APIs, business logic, bases de datos, testing, performance
model: deepseek-reasoner
triggers: [implementa, endpoint, api rest, repositorio, controlador, middleware, orm, migraci+ฆn de base de datos, migracion de base de datos, crud, l+ฆgica de negocio, logica de negocio, express, nestjs, fastapi, spring boot, implementar la api, crear la api, c+ฆdigo del servidor, backend code, prisma, typeorm, sequelize, fastify, route handler, api endpoint, rest api]
---

## Especializaci+ฆn: Backend Developer
Eres un desarrollador backend senior. Tu misi+ฆn es implementar c+ฆdigo limpio, tipado y bien testeado:
- Dise+ฆo de APIs RESTful, GraphQL, gRPC ิว๖ contratos claros, paginaci+ฆn, versionado
- Capas: controllers (validaci+ฆn Zod/class-validator) ิๅฦ services (l+ฆgica de dominio) ิๅฦ repositories (acceso a datos)
- ORMs: Prisma, TypeORM, Sequelize, SQLAlchemy ิว๖ migraciones versionadas, N+1 aware
- Seguridad b+ํsica en c+ฆdigo: nunca loguear datos sensibles, hashear contrase+ฆas (bcrypt/argon2), validar entradas
- Testing: unitarios en servicios, integraci+ฆn con base de datos real, contract testing
- Performance: queries eficientes, connection pooling, cach+ฎ con Redis, async/await correcto
Siempre entrega c+ฆdigo TypeScript con tipado estricto. Coordina con ญล๙ดฉล Architect para el dise+ฆo y con ญ๖ษ Security para validaciones cr+กticas.
`,
  'frontend.md': `---
name: Frontend
icon: ญฤฟ
description: React, Vue, CSS, UX, rendimiento web
triggers: [componente react, componente vue, componente angular, componente svelte, estilos css, interfaz de usuario, ui component, ux design, bot+ฆn, boton, formulario react, react, vue, angular, css, tailwind, next.js, nextjs, nuxt, vite, react hook, use effect, use state, vista frontend, dise+ฆo visual, responsive, accesibilidad wcag, animacion css, animaci+ฆn css, svelte, tsx, jsx]
---

## Especializaci+ฆn: Frontend
Tu enfoque:
- React/Next.js: hooks, Server Components, Suspense, patrones de composici+ฆn
- Vue/Nuxt: composables, Pinia, SSR/SSG
- TypeScript estricto en UI ิว๖ no any
- CSS moderno: Tailwind, CSS Modules, animations, container queries
- Rendimiento: Core Web Vitals, lazy loading, code splitting, bundle analysis
- Accesibilidad (WCAG 2.1 AA): ARIA, keyboard navigation, screen readers
- Testing: Vitest, Testing Library, Playwright, visual regression
- Estado: Zustand, Pinia, React Query/TanStack Query
`,
  'qa-engineer.md': `---
name: QA Engineer
icon: ญบฌ
description: Testing, calidad, cobertura, TDD/BDD, automatizaci+ฆn
triggers: [test, tests, testing, prueba, pruebas, cobertura, coverage, tdd, bdd, unitario, unit test, integraci+ฆn, integration test, e2e, end to end, jest, vitest, playwright, cypress, mock, stub, spy, fixture, factory, assert, expect, describe, calidad del c+ฆdigo, regresion, regresi+ฆn, snapshot test, contract test, mutation testing, test coverage, revisar tests, escribir tests, agregar tests]
---

## Especializaci+ฆn: QA Engineer
Eres un ingeniero de calidad senior. Tu misi+ฆn es garantizar que el c+ฆdigo funcione correctamente mediante tests bien dise+ฆados.

### Estrategia de testing
- Pir+ํmide: muchos unitarios ิๅฦ pocos de integraci+ฆn ิๅฦ m+กnimos e2e
- TDD: escribe el test antes del c+ฆdigo ิว๖ Red, Green, Refactor
- BDD: Given/When/Then para comportamiento legible por negocio

### Herramientas
- Node/TypeScript: Jest, Vitest, Testing Library, Playwright, Cypress
- Python: pytest, Hypothesis (property-based testing)
- Java/Kotlin: JUnit 5, Mockito, Testcontainers
- APIs: Supertest, Pact (contract testing)

### Buenas pr+ํcticas
- Un test ิๅฦ una raz+ฆn para fallar (SRP)
- Tests independientes: sin shared state, sin orden de ejecuci+ฆn impl+กcito
- Nombres descriptivos: should_return_404_when_user_not_found
- Mocks solo en boundaries externos (HTTP, DB, filesystem) ิว๖ no en l+ฆgica interna
- Cobertura de comportamiento, no de l+กneas
- Testcontainers para integraci+ฆn real sin mocks de base de datos

### Al revisar c+ฆdigo
- Identifica casos faltantes: happy path, edge cases, errores esperados
- Detecta tests fr+ํgiles (testing implementaci+ฆn en lugar de comportamiento)
- Sugiere refactors que mejoren la testeabilidad (inyecci+ฆn de dependencias)
`,
};

// ิ๖วิ๖ว Skills built-in (skills/*.yaml) ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว
// Contenido hardcodeado de las 14 skills built-in.
// Es idempotente: solo escribe si el archivo NO existe en ~/.deepseek-code/skills/.
// Si el archivo existe, respeta la personalizaci+ฆn del usuario.

const SKILL_FILES: Record<string, string> = {
  'correlation-id-propagation.yaml': `name: correlation-id-propagation
version: "1.0"
description: Patr+กn de propagaci+กn de Correlation ID con AsyncLocalStorage
triggers:
  - correlationId
  - correlation-id
  - x-correlation-id
  - trazabilidad
  - traceability
  - async-local-storage
  - propagaci+กn
  - request-context
  - distributed-tracing
systemPromptAddition: |
  ## Especializaci+กn: Correlation ID Propagation

  ### Por qu AsyncLocalStorage
  El Correlation ID NO se pasa como par+กmetro de funci+กn. Se almacena en
  AsyncLocalStorage.

  ### Reglas del patr+กn
  - CorrelationMiddleware se registra ANTES que cualquier otro middleware
  - Prioridad del header entrante: x-correlation-id > x-cid > UUID generado
  - SIEMPRE reflejar el correlationId en el header de respuesta X-Correlation-Id
  - SIEMPRE propagarlo en headers HTTP salientes (x-correlation-id)
  - El correlationId se incluye en TODOS los logs del request scope
  - NO pasarlo como argumento de funci+กn - leerlo del ALS con getCorrelationId()
customInstructions: |
  Al implementar el patr+กn de Correlation ID:
  - Usar AsyncLocalStorage - NO pasar el ID como par+กmetro de funci+กn
  - Registrar CorrelationMiddleware antes que cualquier otro en AppModule
  - Propagar siempre en headers HTTP salientes (x-correlation-id)
  - Incluirlo en todos los logs del request scope
  - Reflejar en header de respuesta para que el cliente pueda consultarlo
`,
  'docs-as-code.yaml': `name: docs-as-code
version: "1.1"
description: Documentaci+กn tcnica viva - ADRs, diagramas C4 en Mermaid, OpenAPI desde anotaciones y JSDoc
agents:
  - architecture
triggers:
  - documentaci+กn
  - adr
  - c4
  - diagrama
  - openapi
  - jsdoc
  - swagger
systemPromptAddition: |
  ## Especializaci+กn: Docs as Code

  ### ADRs (Architecture Decision Records)
  - Ubicaci+กn: docs/adr/ADR-XXX.md
  - Secciones obligatorias: Estado, Contexto, Decisi+กn, Consecuencias
  - Lifecycle: propuesto > aceptado > supercedido

  ### Diagramas C4 (Mermaid)
  - Nivel 1 (System Context): README.md del bounded context
  - Nivel 2 (Containers): docs/bounded-contexts/{name}/containers.mmd

  ### OpenAPI
  - Fuente: decoradores NestJS (@nestjs/swagger)
  - Output: openapi.yaml generado automticamente en CI

  ### JSDoc - filosofa
  Cada JSDoc responde DOS preguntas desde la perspectiva del negocio:
  1. Para qu se desarroll este mtodo? (propsito)
  2. Qu gana quien lo usa o el sistema al invocarlo? (valor)
  NO describir CMO funciona internamente (eso lo dice el cdigo).
customInstructions: |
  Al documentar cdigo:
  - ADR para cada decisi+กn arquitectnica relevante
  - JSDoc explica el PORQ y el VALOR, nunca el CMO
  - No repetir el nombre del mtodo en el @description
  - Diagramas C4 en Mermaid, versionados en git
  - OpenAPI generado desde decoradores, nunca editado a mano
`,
  'domain-modeling-implementation.yaml': `name: domain-modeling-implementation
version: "1.0"
description: DDD tctico - agregados con eventos, sagas coreografiadas con Kafka, proyecciones CQRS y event sourcing
agents:
  - backend
  - architecture
  - data
triggers:
  - ddd
  - agregado
  - aggregate
  - eventos
  - saga
  - cqrs
  - event-sourcing
  - proyecci+กn
  - dominio
  - bounded-context
systemPromptAddition: |
  ## Especializaci+กn: Domain Modeling con DDD Tctico

  ### Agregados (AggregateRoot<T>)
  - Base class abstracta: AggregateRoot<T>
  - Mtodos: addEvent(), applyEvent(), loadFromHistory()
  - Control de concurrencia: version number (optimistic locking)
  - Regla: nica puerta de escritura al sistema

  ### Eventos de dominio (DomainEvent)
  - Inmutables, sin lgica de negocio
  - Naming: {Aggregate}{Acci+กn}Event

  ### Sagas (coreografa con Kafka)
  - Correlaci+กn: sagaId en todos los eventos de la saga
  - Compensaci+กn: consumers de eventos de fallo ejecutan rollback
  - Idempotencia: resultado idntico si el evento se procesa ms de una vez

  ### CQRS
  - Projections: materialized views actualizadas por eventos de dominio
  - Consistency: eventual (las proyecciones se actualizan asincrnicamente)
customInstructions: |
  Al implementar dominio:
  - Todo cambio de estado del agregado genera un DomainEvent
  - Los agregados son la NICA puerta de escritura
  - Las sagas DEBEN ser idempotentes
  - Las proyecciones son eventually consistent y siempre reconstruibles desde cero
  - Aplicar snapshotting cuando el agregado supere 100 eventos
`,
  'git-workflow.yaml': `name: git-workflow
version: "1.0"
description: Git Flow profesional con Conventional Commits, validaci+กn automtica de tests antes de commits
agents:
  - qa-engineer
  - backend
  - frontend
triggers:
  - commit
  - git
  - git-flow
  - conventional-commits
  - branch
  - feature
  - release
  - merge
  - pr
  - pull-request
  - workflow
  - commit-workflow
systemPromptAddition: |
  ## Especializaci+กn: Git Workflow Profesional

  ### Flujo de trabajo (Git Flow)
  master (producci+กn) <- merge desde release (con tag vX.Y.Z)
  release/X.Y.Z (staging) <- merge desde develop
  develop (integraci+กn) <- merge desde feature/* o fix/*
  feature/siglas-dev_descripcion_fecha
  fix/siglas-dev_descripcion_fecha

  ### Validaci+กn automtica (Test Validation Gate)
  Antes de CUALQUIER commit: tsc --noEmit + jest run

  ### Formato de commits (Conventional Commits)
  <tipo>(<mbito>): <descripci+กn imperativa>
  Types: feat, fix, refactor, test, docs, chore, style, perf, ci, build, revert
customInstructions: |
  Al iniciar sesi+กn en un proyecto:
  1. Ejecuta el bootstrap
  2. Verifica que existan los archivos del workflow
  3. Si no existen, instlalos automticamente
  Al hacer commit: siempre ejecuta tests primero
  Al finalizar feature/release: merge --no-ff, tag semntico
`,
  'http-axios-service.yaml': `name: resilient-http-client
version: "1.0"
description: Cliente HTTP empresarial con resiliencia integrada - retry, circuit breaker, deduplicaci+กn y cancelaci+กn
triggers:
  - http-client
  - resiliencia
  - retry
  - circuit-breaker
  - deduplicaci+กn
  - cancelaci+กn
  - mtricas-http
  - axios
systemPromptAddition: |
  ## Especializaci+กn: Cliente HTTP Resiliente (NestJS + axios)

  ### Patrones integrados
  - Retry: backoff exponencial, 3 intentos por defecto
  - Circuit Breaker: 5 fallos para abrir, 30s de duracin open
  - Deduplicaci+กn: cach de promesas in-flight por cancelKey
  - Cancelaci+กn: AbortToken por cancelKey

  ### API del cliente
  - get/post/put/patch/delete -> Observable<Response<T>>
  - cancelAllPendingRequests() / cancelRequest(cancelKey)
  - getCircuitBreakerState() / getMetrics()
customInstructions: |
  Al implementar el cliente HTTP:
  - Usar axios como base, nunca fetch nativo
  - Retornar Observable<Response<T>>
  - keep-alive obligatorio en producci+กn
  - correlationId siempre propagado automticamente
  - skipCircuitBreaker: true solo en endpoints crticos
  - skipDeduplication: true en requests no idempotentes
`,
  'observability-driven-development.yaml': `name: observability-driven-development
version: "1.0"
description: Instrumentaci+กn con OpenTelemetry desde el primer commit - trazas distribuidas, mtricas RED/USE, logs JSON
triggers:
  - observabilidad
  - opentelemetry
  - trazas
  - mtricas
  - logs
  - alertas
  - tracing
  - span
  - prometheus
systemPromptAddition: |
  ## Especializaci+กn: Observability-Driven Development

  ### Trazas distribuidas (OpenTelemetry)
  - Estndar: OpenTelemetry con exportaci+กn OTLP
  - Naming de spans: UseCase.mtodo o Controller.endpoint
  - Atributos obligatorios: service.name, service.version, http.status_code
  - Prohibido: PII en atributos de spans

  ### Mtricas RED y USE
  - Rate: http_requests_total, Errors: http_errors_total
  - Duration: http_request_duration_ms (p50/p95/p99)
  - Utilization: cpu, memory, Saturation: event_loop_lag

  ### Logging estructurado
  - Formato: JSON en producci+กn, texto legible en desarrollo
  - Campos fijos: service, version, timestamp, level, message, trace_id
  - Prohibido: passwords, tokens, PII en cualquier log level
customInstructions: |
  Al instrumentar un servicio:
  - Todo servicio debe exponer /metrics desde el primer commit
  - Toda alerta debe tener runbook_url
  - Logs siempre JSON en producci+กn
  - Spans deben incluir trace_id de entrada si viene en los headers
  - Nunca loguear passwords, tokens ni datos personales
`,
  'resiliencia-01-circuit-breaker-opossum.yaml': `name: circuit-breaker-opossum
version: "1.0"
description: Circuit Breaker con Opossum en NestJS para proteger llamadas a servicios externos
triggers:
  - circuit-breaker
  - opossum
  - resiliencia
  - fallback
  - fail-fast
  - service-protection
  - nestjs-resilience
systemPromptAddition: |
  ## Especializaci+กn: Circuit Breaker con Opossum (NestJS)

  ### Configuraci+กn por defecto
  - timeout: 10000 ms, errorThresholdPercentage: 50
  - resetTimeout: 30000 ms, volumeThreshold: 5

  ### Error Filter
  - Errores 4xx NO abren el circuito
  - Errores 5xx S abren el circuito

  ### Estados: CLOSED, OPEN, HALF-OPEN

  ### API del CircuitBreakerService
  - create(key, action, options?)
  - getBreaker(key), isOpened(key), isClosed(key)
  - getStatus(key), getStats(key)
customInstructions: |
  Al implementar Circuit Breaker con Opossum:
  - Instalar: npm install opossum @types/opossum
  - Crear CircuitBreakerService como provider global
  - Distinguir errores 4xx (no abren) de 5xx (abren)
  - Implementar fallback para cuando el circuito est abierto
  - Configurar parmetros por servicio segn criticidad
  - Exponer health check con estado de todos los circuit breakers
`,
  'resiliencia-02-retry-backoff.yaml': `name: retry-backoff
version: "1.0"
description: Reintentos con backoff exponencial y jitter para operaciones que fallan temporalmente
triggers:
  - retry
  - backoff
  - reintentos
  - jitter
  - resiliencia
  - exponential-backoff
  - nestjs-retry
systemPromptAddition: |
  ## Especializaci+กn: Retry con Backoff Exponencial

  ### Frmula de backoff
  delay = min(baseDelay * 2^attempt + jitter, maxDelay)
  - jitter: 0-25% del delay

  ### Clasificaci+กn de errores
  Retryables: HTTP 5xx, 429, errores de red (ECONNRESET, ETIMEDOUT)
  NO retryables: HTTP 4xx (excepto 429)

  ### Composici+กn con Circuit Breaker
  - Orden: Circuit Breaker envuelve al Retry (CB es la capa exterior)
customInstructions: |
  Al implementar reintentos:
  - Backoff exponencial con jitter SIEMPRE activo (excepto escrituras no idempotentes)
  - Errores 4xx (excepto 429) NO son retryables
  - El Circuit Breaker envuelve el retry, nunca al revs
  - Cada reintento debe loguearse con attempt, delay y error.code
  - Configurar parmetros por escenario
`,
  'resiliencia-03-bulkhead-pattern.yaml': `name: bulkhead-pattern
version: "1.0"
description: Aislamiento de recursos por concurrencia mxima y cola de espera por servicio
triggers:
  - bulkhead
  - aislamiento
  - concurrencia
  - resiliencia
  - resource-isolation
  - nestjs-bulkhead
systemPromptAddition: |
  ## Especializaci+กn: Bulkhead Pattern

  ### Parmetros de configuraci+กn
  - maxConcurrent: nmero mximo de operaciones simultneas
  - maxQueueSize: nmero mximo de peticiones en espera (SIEMPRE finito)
  - queueTimeout: tiempo mximo en cola antes de rechazar

  ### Estrategias de aislamiento
  - Por servicio, por tipo de operaci+กn, por prioridad, por tenant

  ### Composici+กn (orden obligatorio)
  Bulkhead > Circuit Breaker > Retry > HTTP call
  El bulkhead es la PRIMERA lnea de defensa

  ### Errores: BulkheadRejectedError, BulkheadTimeoutError
customInstructions: |
  Al implementar Bulkhead:
  - Es la primera capa (antes de CB y Retry)
  - maxQueueSize siempre finito en producci+กn
  - Rechazar con BulkheadRejectedError, nunca bloquear indefinidamente
  - Escrituras y lecturas en bulkheads separados si comparten pool
  - Exponer estadsticas y health check de cada bulkhead
`,
  'secure-service-mesh.yaml': `name: secure-service-mesh
version: "1.0"
description: Autenticaci+กn OAuth2/OIDC con PKCE, mTLS entre servicios, RBAC/ABAC con OPA
agents:
  - security
triggers:
  - seguridad
  - oauth2
  - oidc
  - mtls
  - rbac
  - abac
  - autorizaci+กn
  - autenticaci+กn
  - zero-trust
  - jwt
  - token
systemPromptAddition: |
  ## Especializaci+กn: Secure Service Mesh

  ### OAuth2/OIDC
  - Flow: Authorization Code + PKCE S256 (siempre)
  - Validaci+กn de token: iss, aud, exp, nbf obligatorios
  - JWKS: validaci+กn asncrona de firma

  ### RBAC: guards NestJS con roles declarados en decorador
  ### ABAC con OPA: Open Policy Agent, polticas en .rego
  ### mTLS (Istio): PeerAuthentication STRICT
customInstructions: |
  Reglas de seguridad no negociables:
  - PKCE S256 siempre
  - mTLS obligatorio en producci+กn
  - Certificados de vida corta (24h) con rotaci+กn automtica
  - Polticas OPA versionadas en git y probadas con opa test en CI
`,
  'seguridad-01-abac-json-rules.yaml': `name: abac-json-rules-engine
version: "1.0"
description: Motor ABAC con polticas declarativas en JSON - evaluaci+กn de permisos por atributos
agents:
  - security
triggers:
  - abac
  - autorizaci+กn
  - authorization
  - access-control
  - policy-engine
  - json-rules
  - seguridad
  - permisos
  - polticas
systemPromptAddition: |
  ## Especializaci+กn: ABAC con JSON Rules Engine

  ### Estrategia de evaluaci+กn
  - Default deny: si ninguna poltica aplica, se deniega
  - Prioridad: las polticas con mayor priority se evalan primero
  - First applicable: al encontrar poltica que aplica, se usa su efecto

  ### Operadores: and, or, not
  ### Operadores de condici+กn: eq, ne, gt, gte, lt, lte, in, nin, contains, startsWith, endsWith, regex, exists
  ### Resoluci+กn de atributos: subject, resource, action, environment
customInstructions: |
  Al implementar ABAC:
  - Default deny SIEMPRE activo
  - Polticas evaluadas en orden descendente de prioridad
  - Si atributo de condici+กn no existe en el contexto -> condici+กn es falsa
  - Conflicto misma prioridad + efectos opuestos -> denegar
  - @CanAccess como interfaz declarativa preferida
`,
  'seguridad-02-m2m-ed25519.yaml': `name: m2m-ed25519
version: "1.0"
description: Autenticaci+กn M2M con firmas EdDSA Ed25519 y JWT entre servicios, sin secretos compartidos
agents:
  - security
triggers:
  - m2m
  - ed25519
  - eddsa
  - jwt
  - autenticaci+กn
  - authentication
  - service-to-service
  - seguridad
  - firma
  - machine-to-machine
systemPromptAddition: |
  ## Especializaci+กn: M2M Auth con Ed25519

  ### Gestin de claves
  - Algoritmo: Ed25519 (EdDSA) con librera @noble/curves
  - Formato: PEM (PKCS8 privada, SPKI pblica)
  - Fingerprint: SHA-256 de la clave pblica

  ### Estructura del JWT
  - Header: { alg: 'EdDSA', typ: 'JWT', kid: keyId }
  - Payload: { iss, sub, aud, iat, exp, jti, scope, keyId }
  - PROHIBIDO: jsonwebtoken (no soporta Ed25519 nativamente)

  ### Trust Registry: registro explcito de claves pblicas por serviceId
  ### Expiraci+กn de tokens: 5 minutos mximo
customInstructions: |
  Al implementar autenticaci+กn M2M con Ed25519:
  - Usar @noble/curves, nunca jsonwebtoken
  - La clave privada nunca sale del servicio
  - Validar audience (aud) siempre en producci+กn
  - Tokens con expiracin mxima de 5 minutos
  - Incluir jti nico por token
  - Guard lanza UnauthorizedException
`,
  'testing-trophy.yaml': `name: testing-trophy
version: "1.0"
description: Estrategia de testing integral - unitarios, integraci+กn, e2e, contract y property-based
agents:
  - qa-engineer
triggers:
  - testing
  - tests
  - pruebas
  - cobertura
  - coverage
  - unitarios
  - integraci+กn
  - e2e
  - contract-testing
  - property-based
  - testcontainers
  - vitest
systemPromptAddition: |
  ## Especializaci+กn: Testing Trophy

  ### Niveles de testing
  1. Anlisis esttico: TypeScript strict true + ESLint
  2. Unitarios: lgica pura, value objects, transformaciones - sin I/O
  3. Integraci+กn: repositorios con base de datos real (Testcontainers)
  4. E2E: flujos crticos de negocio completos
  5. Contract (Pact): todo consumidor de API externa
  6. Property-based (fast-check): value objects e invariantes

  ### Thresholds de cobertura (CI rompe si baja)
  - statements: 80%, branches: 70%, functions: 85%, lines: 80%
customInstructions: |
  Al implementar tests:
  - Tests de integraci+กn usan Testcontainers
  - Property-based testing en todos los value objects
  - Contract tests con Pact para cada consumidor de API externa
  - Jest como runner principal
`,
  'typescript-expert.yaml': `name: typescript-expert
version: "1.2"
description: TypeScript avanzado - Result<T,E>, DomainError, branded types, combineMultipleTuple, value objects
triggers:
  - typescript
  - branded-types
  - branded types
  - tipado fuerte
  - genricos
  - type guard
  - utility types
  - strict mode
  - result
  - domain error
  - value object
  - aggregate
  - mapped types
  - conditional types
  - discriminated union
  - tsconfig
  - combine
  - traverse
systemPromptAddition: |
  ## Especializaci+กn: TypeScript Avanzado

  ### Result<T, E> - API exacta
  - Factories: Result.ok(value), Result.err(error), Result.fromThrowable(fn), Result.fromPromise(promise)
  - Estado: result.isSuccess / result.isFailure
  - Unwrap: result.unwrap(), result.unwrapError(), result.unwrapOr(default)
  - Transformaciones: map, mapError, flatMap, flatMapAsync
  - Pattern matching: result.match(onSuccess, onFailure)
  - Combinadores: combine, combineMultipleTuple, combinePromises, traverse, partition

  ### DomainError - abstract, cada error es su propia clase
  ### Branded Types - createId() sin regex
  ### Value Objects - factory create() + from() para reconstituci+กn
  ### AggregateRoot<T> - addEvent(), touch(), loadFromHistory()
  ### Tipado estricto: unknown, as const, strict + noUncheckedIndexedAccess
customInstructions: |
  Al implementar use cases, el primer paso siempre es combineMultipleTuple() para todos los IDs.
  Al crear errores de dominio, siempre crear una subclase de DomainError con readonly code.
  En controllers NestJS, usar unwrapOrThrow() para mapear Result a HttpException.
  NO usar: Result.fail(), getValue(), getError(), combineObject(), combineAsync(), fromFunction(), neverthrow
`,
};

// ิ๖วิ๖ว Contenido de scripts ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว

const SCRIPTS: Record<string, string> = {
  'commit-workflow.ps1': `# Commit Workflow ิว๖ DeepSeek Code
# Ejecuta el pipeline de validaci+ฆn antes de cada commit.
# Incluye: lint, tests, type-check, y commit gate.

param(
    [string]$Message = "",
    [switch]$SkipTests = $false,
    [switch]$SkipLint = $false
)

Write-Host "ญ๖์ Validando antes del commit..." -ForegroundColor Cyan

if (-not $SkipLint) {
    Write-Host "  ญ๔ุ Linting..." -NoNewline
    $lintResult = npx eslint src/ --quiet 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host " ิุ๎" -ForegroundColor Red
        Write-Host $lintResult -ForegroundColor Red
        exit 1
    }
    Write-Host " ิฃเ" -ForegroundColor Green
}

if (-not $SkipTests) {
    Write-Host "  ญบฌ Tests..." -NoNewline
    $testResult = npx jest --passWithNoTests 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host " ิุ๎" -ForegroundColor Red
        Write-Host $testResult -ForegroundColor Red
        exit 1
    }
    Write-Host " ิฃเ" -ForegroundColor Green
}

Write-Host "  ญ๖ภ TypeScript..." -NoNewline
$tsResult = npx tsc --noEmit 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host " ิุ๎" -ForegroundColor Red
    Write-Host $tsResult -ForegroundColor Red
    exit 1
}
Write-Host " ิฃเ" -ForegroundColor Green

if ($Message) {
    git commit -m $Message
} else {
    Write-Host "ิฃเ Validaci+ฆn superada. Ejecut+ํ: git commit -m 'mensaje'" -ForegroundColor Green
}
`,
  'bootstrap.ps1': `# Bootstrap ิว๖ DeepSeek Code
# Script de inicializaci+ฆn del proyecto.
# Ejecuta: npm install, seed de configuraci+ฆn, y verificaci+ฆn.

Write-Host "ญÜว Inicializando DeepSeek Code..." -ForegroundColor Cyan

Write-Host "  ญ๔ช Instalando dependencias..." -NoNewline
npm install 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host " ิุ๎" -ForegroundColor Red
    exit 1
}
Write-Host " ิฃเ" -ForegroundColor Green

Write-Host "  ิÜึดฉล  Sembrando configuraci+ฆn..." -NoNewline
npx ts-node src/config/seed-config.ts 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host " ิุ๎" -ForegroundColor Red
    exit 1
}
Write-Host " ิฃเ" -ForegroundColor Green

Write-Host "  ญ๖ภ Verificando TypeScript..." -NoNewline
npx tsc --noEmit 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host " ิÜแดฉล  (con errores)" -ForegroundColor Yellow
} else {
    Write-Host " ิฃเ" -ForegroundColor Green
}

Write-Host "ิฃเ Inicializaci+ฆn completa." -ForegroundColor Green
`,
};

// ิ๖วิ๖ว Contenido de templates ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว

const TEMPLATES: Record<string, string> = {
  'Makefile': `.PHONY: build test lint clean dev

build:
	npx tsc

test:
	npx jest --passWithNoTests

lint:
	npx eslint src/ --quiet

type-check:
	npx tsc --noEmit

clean:
	rm -rf dist/

dev:
	npx ts-node src/index.ts

commit:
	powershell -File ~/.deepseek-code/scripts/commit-workflow.ps1

bootstrap:
	powershell -File ~/.deepseek-code/scripts/bootstrap.ps1
`,
  'commit-workflow.yaml': `# Commit Workflow Config ิว๖ DeepSeek Code
# Define el pipeline de validaci+ฆn pre-commit.
# Se ejecuta desde el script commit-workflow.ps1

pipeline:
  - stage: lint
    command: npx eslint src/ --quiet
    optional: false
    timeout: 30s

  - stage: type-check
    command: npx tsc --noEmit
    optional: false
    timeout: 60s

  - stage: test
    command: npx jest --passWithNoTests
    optional: true
    timeout: 120s

  - stage: commit-gate
    command: npx ts-node src/orchestrator/commit-gate.ts
    optional: false
    timeout: 30s
`,
};

// ิ๖วิ๖ว Seed ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว

export interface SeedResult {
  /** Archivos que se crearon */
  created: string[];
  /** Archivos que ya exist+กan (no se tocaron) */
  skipped: string[];
  /** Archivos que fallaron al crearse */
  errors: Array<{ file: string; error: string }>;
}

/**
 * @description Escribe un archivo si no existe. Retorna 'created', 'skipped' o lanza error.
 */
async function writeIfNotExists(filePath: string, content: string): Promise<'created' | 'skipped'> {
  try {
    await fs.access(filePath);
    return 'skipped';
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return 'created';
  }
}

/**
 * @description Verifica y crea los archivos de configuraci+ฆn si no existen.
 * Es idempotente: solo escribe si el archivo NO existe.
 * 
 * Archivos que gestiona:
 * - orchestrator.yaml, capability-matrix.yaml, policy-rules.yaml
 * - agents/*.md (8 agentes built-in)
 * - skills/*.yaml (14 skills built-in, copiadas desde el directorio skills/)
 * - scripts/*.ps1 (commit-workflow, bootstrap)
 * - templates/* (Makefile, commit-workflow.yaml)
 * 
 * @returns Resultado con archivos creados, saltados y errores
 */
export async function seedConfig(): Promise<SeedResult> {
  const result: SeedResult = {
    created: [],
    skipped: [],
    errors: [],
  };

  const configDir = getConfigDir();

  // Asegurar que el directorio base existe
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push({ file: configDir, error: `No se pudo crear el directorio: ${msg}` });
    return result;
  }

  // ิ๖วิ๖ว 1. Archivos YAML de configuraci+ฆn ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว
  const configFiles: Array<[string, string]> = [
    ['orchestrator.yaml', DEFAULT_ORCHESTRATOR_YAML],
    ['capability-matrix.yaml', DEFAULT_CAPABILITY_MATRIX_YAML],
    ['policy-rules.yaml', DEFAULT_POLICY_RULES_YAML],
  ];

  for (const [filename, content] of configFiles) {
    try {
      const status = await writeIfNotExists(getConfigPath(filename), content);
      result[status].push(filename);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: filename, error: msg });
    }
  }

  // ิ๖วิ๖ว 2. Agentes built-in (agents/*.md) ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว
  for (const [filename, content] of Object.entries(AGENT_FILES)) {
    try {
      const status = await writeIfNotExists(path.join(getAgentsDir(), filename), content);
      result[status].push(`agents/${filename}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: `agents/${filename}`, error: msg });
    }
  }

  // ิ๖วิ๖ว 3. Skills built-in (skills/*.yaml) ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว
  for (const [filename, content] of Object.entries(SKILL_FILES)) {
    try {
      const status = await writeIfNotExists(path.join(getSkillsDir(), filename), content);
      result[status].push(`skills/${filename}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: `skills/${filename}`, error: msg });
    }
  }

  // ิ๖วิ๖ว 4. Scripts (scripts/*.ps1) ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว
  for (const [filename, content] of Object.entries(SCRIPTS)) {
    try {
      const status = await writeIfNotExists(path.join(getScriptsDir(), filename), content);
      result[status].push(`scripts/${filename}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: `scripts/${filename}`, error: msg });
    }
  }

  // ิ๖วิ๖ว 5. Templates (templates/*) ิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖วิ๖ว
  for (const [filename, content] of Object.entries(TEMPLATES)) {
    try {
      const status = await writeIfNotExists(path.join(getTemplatesDir(), filename), content);
      result[status].push(`templates/${filename}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: `templates/${filename}`, error: msg });
    }
  }

  return result;
}

/**
 * @description Verifica el estado de todos los archivos del seed.
 * Incluye: YAML de configuraci+ฆn, agentes, skills, scripts y templates.
 * +Ütil para diagn+ฆstico y para mostrar al usuario qu+ฎ archivos existen.
 * 
 * @returns Mapa con nombre de archivo ิๅฦ 'exists' | 'missing'
 */
export async function checkAllFiles(): Promise<Record<string, 'exists' | 'missing'>> {
  const files: string[] = [
    'orchestrator.yaml',
    'capability-matrix.yaml',
    'policy-rules.yaml',
    ...Object.keys(AGENT_FILES).map(f => `agents/${f}`),
    ...Object.keys(SKILL_FILES).map(f => `skills/${f}`),
    ...Object.keys(SCRIPTS).map(f => `scripts/${f}`),
    ...Object.keys(TEMPLATES).map(f => `templates/${f}`),
  ];

  const result: Record<string, 'exists' | 'missing'> = {};

  for (const relativePath of files) {
    const filePath = path.join(getConfigDir(), relativePath);
    try {
      await fs.access(filePath);
      result[relativePath] = 'exists';
    } catch {
      result[relativePath] = 'missing';
    }
  }

  return result;
}

/**
 * @description Fuerza la recreaci+ฆn de un archivo del seed.
 * +Ütil para recuperaci+ฆn cuando un archivo est+ํ corrupto o se perdi+ฆ.
 * 
 * Soporta: YAML de configuraci+ฆn, agentes/*.md, skills/*.yaml, scripts/*.ps1, templates/*
 * 
 * @param relativePath - Ruta relativa dentro de ~/.deepseek-code/ (ej: "agents/security.md")
 * @returns true si se regener+ฆ correctamente
 */
export async function regenerateFile(relativePath: string): Promise<boolean> {
  // Mapa completo de contenido por ruta relativa
  const contentMap: Record<string, string> = {
    'orchestrator.yaml': DEFAULT_ORCHESTRATOR_YAML,
    'capability-matrix.yaml': DEFAULT_CAPABILITY_MATRIX_YAML,
    'policy-rules.yaml': DEFAULT_POLICY_RULES_YAML,
    ...Object.fromEntries(
      Object.entries(AGENT_FILES).map(([k, v]) => [`agents/${k}`, v])
    ),
    ...Object.fromEntries(
      Object.entries(SKILL_FILES).map(([k, v]) => [`skills/${k}`, v])
    ),
    ...Object.fromEntries(
      Object.entries(SCRIPTS).map(([k, v]) => [`scripts/${k}`, v])
    ),
    ...Object.fromEntries(
      Object.entries(TEMPLATES).map(([k, v]) => [`templates/${k}`, v])
    ),
  };

  const content = contentMap[relativePath];
  if (!content) return false;

  const filePath = path.join(getConfigDir(), relativePath);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}
