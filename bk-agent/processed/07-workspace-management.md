# 07 - Workspace Management

Workspaces let you manage multiple projects (monorepo) with independent context and memory.

## Concept

A **workspace** contains multiple projects. Each project has:
- Independent specification, design, roadmap
- Separate memory and context
- Own checkpoints and history
- Isolated skill configurations

## Quick Start

### Create Workspace

```bash
/workspace create my-workspace
```

Creates workspace folder structure in `~/.deepseek-code/workspaces/my-workspace/`

### Add Projects

```bash
/workspace add /path/to/project-1
/workspace add /path/to/project-2
```

Each project tracked independently.

### View Workspace Status

```bash
/workspace list
```

Output:
```
Workspaces:

1. my-workspace
   ├─ project-1 (backend)
   ├─ project-2 (frontend)
   └─ project-3 (admin)

2. another-workspace
   ├─ project-a
   └─ project-b
```

### Switch Workspace/Project

```bash
/switch              # Open interactive picker
/switch my-workspace project-1
```

---

## Workspace Structure

```
~/.deepseek-code/workspaces/
└── my-workspace/
    ├── .bk-workspace/
    │   ├── workspaces.yaml        # Workspace metadata
    │   └── workspace-memory.yaml
    ├── project-1/
    │   ├── specification.md
    │   ├── design.md
    │   ├── roadmap.md
    │   ├── .bk-project/
    │   │   └── memory.yaml
    │   └── src/
    ├── project-2/
    │   ├── specification.md
    │   ├── design.md
    │   └── ...
    └── project-3/
        ├── specification.md
        └── ...
```

---

## Managing Workspaces

### Create

```bash
/workspace create frontend-workspace
/workspace create backend-workspace
/workspace create devops-workspace
```

### Add Project to Workspace

```bash
/workspace add ~/projects/auth-service
/workspace add ~/projects/api-gateway
```

Detects project type (NestJS, React, etc.) and adds to workspace.

### List Workspaces

```bash
/workspace list
```

Shows all workspaces and projects in each.

### Remove Workspace

```bash
/workspace remove frontend-workspace
```

⚠️ Note: Doesn't delete projects, only removes from workspace tracking.

### Delete Workspace

```bash
/workspace remove frontend-workspace --delete
```

⚠️ Permanently deletes workspace memory and tracking.

---

## Using Workspaces

### Switch Context

```bash
/switch
# Opens TUI picker
# Select workspace → Select project
```

Or directly:
```bash
/switch backend-workspace auth-service
```

### Header Shows Context

```
╔════════════════════════════════════════════╗
║ backend-workspace · auth-service           ║
║ Model: deepseek-chat                       ║
║ Status: Ready                              ║
╚════════════════════════════════════════════╝
```

### Independent Workflows

Each project can be at different `/spec` phase:

```
backend-workspace · api-gateway:
  /spec.run          # Running phase 2

backend-workspace · auth-service:
  /spec.qa           # QA phase 1

frontend-workspace · dashboard:
  /init              # Just initialized
```

### Check Current Context

```bash
/context
```

Shows current workspace, project, stack, memory loaded.

---

## Workspace Memory

Each workspace maintains:

### Shared Memory (Workspace Level)
- Common conventions
- Shared decisions
- Cross-project patterns

### Project Memory (Project Level)
- Project-specific context
- Lessons learned for this project
- Checkpoints and history

### View Workspace Memory

```bash
/memory              # Current project memory
/status              # Workspace + project info
```

---

## Monorepo Patterns

### Pattern 1: Microservices Workspace

```
microservices-workspace/
├── auth-service/
│   ├── specification.md
│   ├── roadmap.md
│   └── src/
├── api-gateway/
│   ├── specification.md
│   ├── roadmap.md
│   └── src/
├── users-service/
│   ├── specification.md
│   └── src/
└── notifications-service/
    ├── specification.md
    └── src/
```

Usage:
```bash
/switch microservices-workspace auth-service
/spec.run                    # Generate auth service

/switch microservices-workspace api-gateway
/spec.run                    # Generate gateway
```

### Pattern 2: Frontend/Backend Split

```
full-stack-workspace/
├── backend/
│   ├── api/
│   │   ├── specification.md
│   │   └── src/
│   ├── admin-service/
│   │   └── src/
├── frontend/
│   ├── web-app/
│   │   ├── specification.md
│   │   └── src/
│   └── mobile-app/
│       ├── specification.md
│       └── src/
```

### Pattern 3: Multi-tenant SaaS

```
saas-workspace/
├── platform/
│   ├── specification.md
│   └── src/
├── customer-portal/
│   ├── specification.md
│   └── src/
├── admin-dashboard/
│   ├── specification.md
│   └── src/
└── mobile-app/
    ├── specification.md
    └── src/
```

---

## Context Sharing

### Share Skills Across Workspace

Skills in `~/.deepseek-code/skills/` are **globally available**.

All projects in all workspaces access same skills.

### Share Custom Agents

Custom agents in `~/.deepseek-code/agents/` are **globally available**.

### Project-Specific Skills

Can't do yet, but workaround:

1. Create vault-based skills
2. Store in `Vault/04-Recursos/Skills/`
3. Each project can reference own vault path

---

## Advanced: Workspace Configuration

### Workspace Config File

```yaml
# ~/.deepseek-code/workspaces/my-workspace/.bk-workspace/config.yaml

name: "my-workspace"
description: "Microservices workspace"

projects:
  auth-service:
    path: "/home/user/projects/auth-service"
    type: "nestjs"
    conventions:
      - "Use Result<T> for errors"
      - "Add observability to all services"
  
  api-gateway:
    path: "/home/user/projects/api-gateway"
    type: "nestjs"
    dependencies:
      - auth-service

# Shared workspace policies
policies:
  database: "PostgreSQL"
  cache: "Redis"
  messageQueue: "RabbitMQ"
  monitoring: "DataDog"

# Shared conventions
conventions:
  - "All services use BackendKit patterns"
  - "Document API with OpenAPI spec"
  - "Min 80% test coverage"
```

---

## Tips & Best Practices

### 1. Organize by Business Domain

```bash
/workspace create payments
/workspace create inventory
/workspace create fulfillment
```

One workspace per business domain.

### 2. Save Checkpoints Per Project

```bash
/switch payments payment-service
/checkpoint save "phase-1-complete"

/switch inventory inventory-api
/checkpoint save "phase-1-complete"
```

### 3. Use Consistent Naming

```bash
# Good
/workspace create user-management-workspace
/workspace add ~/projects/user-service
/workspace add ~/projects/user-api

# Avoid
/workspace create ws1
/workspace add ~/projects/project1
```

### 4. Document Workspace Purpose

When creating, take note:

```
payment-workspace:
  Purpose: Handle payment processing and transactions
  Services: payment-api, payment-worker, payment-dashboard
  Stack: NestJS, PostgreSQL, RabbitMQ
  Owner: Finance team
```

### 5. Regular Checkpoints

```bash
# Before major changes
/checkpoint save "before-refactor"
/switch workspace project
/spec.run      # Make changes
/switch workspace project
/checkpoint load "before-refactor"  # If needed
```

---

## Troubleshooting

### Project Not Found in Workspace

**Problem:** Added project but `/switch` doesn't show it

**Solution:**
```bash
/workspace list          # Verify it's there
/workspace add /path/to/project  # Re-add if needed
```

### Wrong Memory Loaded

**Problem:** Project memory doesn't match project

**Solution:**
```bash
/memory                  # Check current memory
/switch workspace project # Verify correct project
```

### Can't Switch Workspace

**Problem:** `/switch` doesn't work

**Solution:**
```bash
/workspace list         # Verify workspace exists
bk-agent                # Restart agent
/switch                 # Try again
```

---

**Next Steps:**
- → [08-reflection-learning.md](08-reflection-learning.md) — Learning across projects
- → [09-memory-persistence.md](09-memory-persistence.md) — Memory per workspace
- → [04-spec-driven-development.md](04-spec-driven-development.md) — Spec workflow per project
