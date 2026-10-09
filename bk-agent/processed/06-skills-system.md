# 06 - Skills System: Extending Agent Capabilities

Skills are specialized knowledge modules that extend agent capabilities. They activate dynamically based on message context.

## Overview

Skills allow you to:
- Add domain-specific knowledge
- Create team conventions
- Package reusable patterns
- Extend without modifying core code

## Types of Skills

### 1. YAML Skills (Programmatic)

Stored in `~/.deepseek-code/skills/`

```yaml
# example-skill.yaml
name: "NestJS Module Generator"
version: "1.0.0"
description: "Generates complete NestJS modules"

# Words that trigger this skill
triggers:
  - "nestjs"
  - "module"
  - "controller"
  - "service"

# Which agents always have this skill
agents:
  - "code-generator"

# Text added to agent's system prompt
systemPromptAddition: |
  When generating NestJS modules, always:
  1. Use @Module() decorator
  2. Implement services with Result<T> error handling
  3. Add request logging with observability module
  4. Export DTOs for type safety
  5. Include comprehensive tests

# Custom tools available to this skill
tools:
  - name: "generate_nestjs_module"
    description: "Generates complete NestJS module"
    parameters:
      type: "object"
      properties:
        moduleName:
          type: "string"
          description: "Module name (e.g., 'users')"
        hasAuth:
          type: "boolean"
          description: "Add JWT guards?"
```

### 2. Vault Skills (Knowledge)

Stored in `Vault/04-Recursos/Skills/` in Obsidian

```markdown
---
name: "Circuit Breaker Pattern"
version: "1.0.0"
description: "Resilient HTTP client with @backendkit-labs/circuit-breaker"
tags:
  - "backend"
  - "resilience"
  - "http-client"
---

# Circuit Breaker Pattern

## When to Use
- External API calls
- Service-to-service communication
- Operations that might fail temporarily

## Implementation

Use @backendkit-labs/circuit-breaker:

```typescript
import { CircuitBreaker } from '@backendkit-labs/circuit-breaker';

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000,
  monitoringInterval: 10000,
});

const response = await breaker.execute(async () => {
  return httpClient.get('/external-service');
});
```

## Error Classification

- HTTP 4xx (except 429, 503) = Business error, circuit stays CLOSED
- HTTP 5xx = Service error, circuit opens
- Network timeout = Service error, circuit opens

## Best Practices

1. Use with Bulkhead for concurrency control
2. Always implement retry logic
3. Log failures for monitoring
4. Test circuit break scenarios
```

---

## Managing Skills

### View Active Skills

```bash
/skills
```

Output:
```
Skills installed (7):

  NestJS Module Generator v1.0.0
    Generates complete NestJS modules with decorators

  Circuit Breaker Pattern v1.0.0
    Resilient HTTP client with fallback

  ... (5 more skills)
```

### Install Skill from Vault

```bash
/skills install "Circuit Breaker Pattern"
```

This:
1. Finds skill in Obsidian vault
2. Extracts system prompt addition
3. Registers triggers
4. Makes it available to agents

### Reload Skills

After modifying YAML files or vault:

```bash
/skills --reload
```

---

## Creating YAML Skills

### Location

```
~/.deepseek-code/skills/my-skill.yaml
```

### Minimal Example

```yaml
name: "My Skill"
version: "1.0.0"
description: "What this skill does"
triggers:
  - "keyword1"
  - "keyword2"
systemPromptAddition: |
  Instructions for the agent when this skill activates.
```

### Complete Example

```yaml
name: "Event-Driven Architecture"
version: "1.0.0"
description: "Guide for event-driven systems"

triggers:
  - "event"
  - "event-driven"
  - "message-broker"
  - "rabbitmq"
  - "kafka"

# Always active for these agents
agents:
  - "architecture-reviewer"
  - "code-generator"

systemPromptAddition: |
  When discussing event-driven architecture:
  
  ## Core Principles
  - Async communication via message brokers
  - Loosely coupled services
  - Event sourcing for state management
  
  ## Tech Stack Recommendations
  - Broker: RabbitMQ or Kafka
  - Patterns: Saga, CQRS
  - Monitoring: Track message flow
  
  ## Implementation Checklist
  - Define events (name, schema, versioning)
  - Implement publishers and subscribers
  - Add error handling and dead letter queues
  - Document event contracts
  - Add observability/tracing
  
  ## Common Patterns
  - Choreography: Services react to events
  - Orchestration: Central service coordinates
  - Saga: Distributed transactions

# Custom tools (optional)
tools:
  - name: "generate_event_handler"
    description: "Generates event handler boilerplate"
    handler: "generate-event-handler"
    parameters:
      type: "object"
      properties:
        eventName:
          type: "string"
          description: "Event name"
        serviceName:
          type: "string"
          description: "Service handling event"
```

### Best Practices

**1. Clear, Specific Triggers**
```yaml
triggers:
  - "kubernetes"
  - "k8s"
  - "deployment"
  - "orchestration"
```

**2. Comprehensive Instructions**
```yaml
systemPromptAddition: |
  Include:
  - What this is for
  - When to use it
  - Implementation steps
  - Common gotchas
  - Team conventions
```

**3. Link Related Skills**
```yaml
systemPromptAddition: |
  See also:
  - Circuit Breaker Pattern
  - Async Queuing
  - Observability Setup
```

**4. Include Examples**
```yaml
systemPromptAddition: |
  Example implementation:
  
  ```typescript
  // Code example here
  ```
```

---

## Creating Vault Skills

### Location

```
Vault/04-Recursos/Skills/[Category]/SKILL.md
```

### Example Structure

```
Vault/04-Recursos/Skills/
├── Backend/
│   ├── Result-Monad-Pattern.md
│   ├── Error-Handling.md
│   └── Database-Patterns.md
├── Architecture/
│   ├── DDD-Aggregates.md
│   ├── CQRS.md
│   └── Event-Sourcing.md
├── DevOps/
│   ├── Docker-Best-Practices.md
│   └── Kubernetes-Deployment.md
└── Testing/
    ├── Integration-Testing.md
    └── E2E-Testing.md
```

### Vault Skill Template

```markdown
---
name: "Aggregate Root Pattern"
version: "1.0.0"
description: "Domain-Driven Design aggregate boundaries"
tags:
  - "ddd"
  - "domain-driven"
  - "aggregates"
  - "backend"
---

# Aggregate Root Pattern

## What is an Aggregate?

An aggregate is a cluster of domain objects (entities and values) that can be treated as a single unit.

## When to Use

- Complex domain logic
- Multiple related entities
- Need transaction boundaries
- Modeling real-world concepts

## Guidelines

1. **One Root Per Aggregate** — The aggregate root is the only entry point
2. **Protect Invariants** — Ensure business rules are always valid
3. **Eventual Consistency** — Other aggregates update through events
4. **Small Aggregates** — Keep them focused and manageable

## Example: Order Aggregate

```typescript
// Order is the root — only way to access order data
export class Order extends AggregateRoot {
  private orderId: OrderId;
  private customerId: CustomerId;
  private items: OrderItem[] = [];
  private status: OrderStatus = OrderStatus.PENDING;

  // Business logic in the root
  addItem(item: OrderItem): Result<void> {
    if (this.status !== OrderStatus.PENDING) {
      return err('CANNOT_ADD_TO_SHIPPED_ORDER');
    }
    this.items.push(item);
    return ok(undefined);
  }

  confirm(): Result<void> {
    if (this.items.length === 0) {
      return err('EMPTY_ORDER');
    }
    this.status = OrderStatus.CONFIRMED;
    this.addEvent(new OrderConfirmedEvent(this.orderId));
    return ok(undefined);
  }
}
```

## Boundary Rules

- Only the root is public
- Items within aggregate are private
- Other aggregates reference only the root ID
- Events maintain eventual consistency

## Anti-patterns

❌ Don't expose internal items publicly  
❌ Don't allow direct modification from outside  
❌ Don't violate invariants for convenience  
✓ Do enforce business rules in the root  
✓ Do use value objects for identity  
✓ Do publish events for synchronization
```

---

## Skill Activation

### How Activation Works

1. **User Message** → System analyzes for trigger keywords
2. **Skill Matching** → Finds skills with matching triggers
3. **Context Injection** → Adds skill's systemPromptAddition to agent
4. **Execution** → Agent uses enhanced prompt + custom tools

### Example

```
Message: "generate a NestJS module for orders aggregate"

Trigger Detection:
  - "NestJS" → NestJS Module Generator skill ✓
  - "aggregate" → Aggregate Root Pattern skill ✓
  - "module" → NestJS Module Generator skill ✓

Active Skills: 2
1. NestJS Module Generator
   → Adds: "Use decorators, Result<T>, tests, etc."
   
2. Aggregate Root Pattern
   → Adds: "Protect invariants, publish events, etc."

Execution: Code Generator + 2 skills
```

---

## Tips & Best Practices

### 1. Organize by Domain
```
skills/
├── nestjs-skills.yaml
├── ddd-patterns.yaml
├── devops-skills.yaml
└── testing-skills.yaml
```

### 2. Version Your Skills
```yaml
version: "1.0.0"  # Semantic versioning
```

### 3. Link to External Resources
```yaml
systemPromptAddition: |
  See: https://docs.example.com/pattern
```

### 4. Include Team Context
```yaml
systemPromptAddition: |
  Our team conventions:
  - Use PostgreSQL for persistence
  - Cache with Redis
  - Monitor with DataDog
```

### 5. Regular Updates
Update skills as:
- New patterns emerge
- Team conventions change
- Technology evolves

---

## Troubleshooting Skills

### Skill Not Activating

**Problem:** Skill triggers aren't working

**Solution:**
```bash
/skills                    # Check if skill loaded
/skills --reload          # Reload from disk
```

### Conflicting Skills

**Problem:** Multiple skills giving conflicting advice

**Solution:**
```yaml
systemPromptAddition: |
  When both patterns apply, prefer Option A because...
```

### Skill Not Available to Agent

**Problem:** Added skill but agent doesn't use it

**Solution:**
```yaml
agents:
  - "code-generator"    # Specify which agents
  - "qa-engineer"       # should have it
```

---

**Next Steps:**
- → [05-agents-specialization.md](05-agents-specialization.md) — How agents use skills
- → [07-workspace-management.md](07-workspace-management.md) — Share skills across projects
