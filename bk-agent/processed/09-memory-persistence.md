# 09 - Memory & Persistence

Project memory survives between sessions, maintaining context and history.

## What Gets Saved

### Project Memory

```yaml
projectName: "my-api"
projectRoot: "/home/user/projects/my-api"

stack:
  language: "TypeScript"
  framework: "NestJS"
  database: "PostgreSQL"
  cache: "Redis"
  messageQueue: "RabbitMQ"

architecture: "Microservices with event-driven communication"

conventions:
  - "Use Result<T, E> for errors"
  - "Add BkLogger to all services"
  - "Minimum 80% test coverage"
  - "Document all APIs with OpenAPI"

keyFiles:
  - "src/domain/"
  - "src/application/"
  - "src/infrastructure/"

relatedProjects:
  - "auth-service"
  - "api-gateway"

lastModified: "2026-06-13T15:30:00Z"
```

### Session Memory

- Current feature being worked on
- Progress percentage
- Issues encountered
- Decisions made
- Next steps

### Lessons Learned

- Common mistakes in this project
- Patterns that worked
- Tools and techniques
- Team conventions

### Checkpoints

Save points you can restore:

```bash
/checkpoint save "phase-1-complete"
/checkpoint list
/checkpoint load "phase-1-complete"
```

---

## Accessing Memory

### View Current Memory

```bash
/memory
```

Shows:
- Project context
- Lessons learned
- Detected patterns
- Last session summary

### View Context

```bash
/context
```

Shows active project information.

### View Status

```bash
/status
```

Shows everything: memory, stats, agents, skills.

---

## Memory Structure

```
~/.deepseek-code/projects/[project-hash]/
├── memory/
│   ├── memory.yaml              # Project context
│   ├── lessons.md               # Lessons learned
│   ├── patterns.yaml            # Detected patterns
│   └── checkpoints/
│       ├── checkpoint-1.json
│       └── checkpoint-2.json
├── audit-reports/
│   ├── phase-1.md
│   └── qa-findings.yaml
└── reflection/
    └── failures.json            # Failure catalog
```

---

## Checkpoint System

### Create Checkpoint

```bash
/checkpoint save feature-name
```

Creates snapshot of:
- Current state
- Message history (optional)
- Memory snapshot
- Token usage

### List Checkpoints

```bash
/checkpoint list
```

Shows all saved checkpoints for project.

### Restore Checkpoint

```bash
/checkpoint load feature-name
```

Restores exact state — continue where you left off.

### Checkpoint Retention

By default keeps last 10 checkpoints.

Configure in `config.yaml`:
```yaml
memory:
  checkpointRetention: 10
```

---

## Lessons Learned

The agent extracts lessons from each session.

### Example Lessons

```markdown
# Lessons Learned - MyAPI Project

## Error Handling Pattern
- Always use Result<T, E> in domain layer
- Map errors at application boundary
- Log with BkLogger + context

## Database Patterns
- Use migrations for schema changes
- Index frequently-queried fields
- Connection pooling config: max 20

## Testing Strategy
- Integration tests for domain logic
- Unit tests for services
- E2E tests for API contracts

## Performance Notes
- Redis cache for user lookups
- Database indexes on user_id, email
- Pagination for list endpoints

## Team Conventions
- All PRs must have 80%+ coverage
- All APIs documented with OpenAPI
- Conventional commits only
```

### Update Lessons

Lessons are updated automatically. Manual edits:

```bash
# Edit directly
~/.deepseek-code/projects/[hash]/memory/lessons.md
```

---

## Isolated Context Per Project

Each project has independent memory.

### Switch Projects

```bash
/switch workspace project-2
```

Loads project-2's memory automatically.

### No Context Bleed

Project-1's conventions don't affect project-2.

```bash
Project-1 convention: "Use REST API"
↓
Switch to Project-2
↓
Project-2 convention: "Use GraphQL"
```

---

## Memory Best Practices

### 1. Use /context Frequently

Before starting work:
```bash
/context    # Load project context
```

### 2. Save Checkpoints Strategically

```bash
# Before risky changes
/checkpoint save "before-refactor"

/spec.run    # Make changes

# If needed
/checkpoint load "before-refactor"
```

### 3. Review Lessons Before Tasks

```bash
/memory

# Read "Lessons Learned"
# Follow conventions
```

### 4. Update Memory Manually

If something changes:

```bash
# Edit memory.yaml
~/.deepseek-code/projects/[hash]/memory/memory.yaml

# Update lessons
~/.deepseek-code/projects/[hash]/memory/lessons.md
```

---

## Troubleshooting Memory

### Memory Not Loading

**Problem:** Projects shows empty memory

**Solution:**
```bash
/init                  # Initialize project
/context               # Verify memory loaded
```

### Wrong Memory Loaded

**Problem:** See different project's memory

**Solution:**
```bash
/switch              # Open picker
# Select correct project
/context             # Verify
```

### Need to Clear Memory

**Problem:** Want fresh start

**Solution:**
```bash
# Back up current memory
cp ~/.deepseek-code/projects/[hash]/memory ~/.deepseek-code/projects/[hash]/memory.backup

# Delete current
rm -rf ~/.deepseek-code/projects/[hash]/memory

# Reinitialize
/init
```

---

**Next Steps:**
- → [08-reflection-learning.md](08-reflection-learning.md) — How learning works
- → [07-workspace-management.md](07-workspace-management.md) — Memory across workspaces
