# 14 - Internal Architecture

Understanding bk-agent's design.

## System Layers

```
┌─────────────────────────────────────────────┐
│         Terminal / CLI Interface            │
│  (User input, output formatting)            │
└────────────┬────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│      Command Registry & Routing             │
│  (Parse /, delegate to handlers)            │
└────────────┬────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│      Intent Detection & Analysis            │
│  (Is it /command or LLM message?)           │
└────────────┬────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│      LLM Router & Agent Selection           │
│  (Choose agent + model based on triggers)   │
└────────────┬────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│     Agent Loop & Tool Execution             │
│  (Generate → Execute → Iterate)             │
└────────────┬────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│      Memory & Persistence Layer             │
│  (Save context, checkpoints, lessons)       │
└────────────┬────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│      Reflection Engine                      │
│  (Learn patterns, create rules)             │
└─────────────────────────────────────────────┘
```

## Key Components

### 1. CLI Entry Point (`bin/cli.ts`)

**Responsibility:**
- Parse command-line arguments
- Initialize agent and engine
- Handle headless vs TUI mode

**Main flow:**
```
args → Commander.js → action handlers → engine.run()
```

### 2. Command Registry

**Responsibility:**
- Register `/` commands
- Route commands to handlers
- Handle command execution

**Structure:**
```typescript
registry.register('/help', 'Show help', handler);
registry.register('/init', 'Initialize', handler);
registry.register('/spec.*', '...', handler);
```

### 3. Intent Detector

**Responsibility:**
- Determine if input is command or message
- Extract intent from message

**Flow:**
```
Input → starts with '/'? 
  → YES: Command path
  → NO: LLM Router
```

### 4. LLM Router

**Responsibility:**
- Analyze message for agent triggers
- Select best agent
- Choose optimal model

**Process:**
```
Message keywords
  ↓
Score each agent
  ↓
Select highest scorer
  ↓
Check model requirements
  ↓
Execute with agent + model
```

### 5. Agent Loop

**Responsibility:**
- Generate LLM response
- Execute tool calls
- Handle iteration

**Cycle:**
```
User message
  ↓
LLM generates response + tool calls
  ↓
Execute tools
  ↓
Collect results
  ↓
More iterations? → YES: feed back to LLM
  → NO: return result
```

### 6. Memory System

**Responsibility:**
- Load project context
- Save checkpoints
- Persist lessons

**Locations:**
```
~/.deepseek-code/projects/[hash]/
├── memory.yaml
├── lessons.md
└── checkpoints/
```

### 7. Reflection Engine

**Responsibility:**
- Detect failure patterns
- Extract lessons
- Create prevention rules

**Process:**
```
Failure detected
  ↓
Record in catalog
  ↓
>=3 same failures?
  → YES: Pattern detected
  → Create rule
  → Add to policies
```

## Data Flow: Complete Example

```
User: "generate a NestJS service"
  │
  ▼ (CommandRegistry)
  Is it a command? No
  │
  ▼ (IntentDetector)
  Intent: IMPLEMENT
  │
  ▼ (LLMRouter)
  Analyze keywords:
  - "generate" → code-generator (+2)
  - "NestJS" → code-generator (+2)
  - "service" → code-generator (+1)
  
  Selected: code-generator
  Model: deepseek-reasoner
  │
  ▼ (SkillActivation)
  Active triggers:
  - NestJS Module Generator
  - Error Handling Patterns
  │
  ▼ (AgentLoop)
  LLM prompt = base + skills + context
  │
  LLM generates:
  {
    message: "Generating service...",
    toolCalls: [
      { name: "write_file", path: "src/users/users.service.ts", ... }
    ]
  }
  │
  ▼ (ToolExecutor)
  Execute write_file
  │
  ▼ (AgentLoop)
  More iterations needed? No
  │
  ▼ (QAReview)
  Run QA on generated code
  │
  ▼ (Memory)
  Save to project memory
  │
  ▼ (Reflection)
  Extract lessons
  Record success pattern
  │
  ▼ (Output)
  Display result to user
```

## Module Dependencies

```
bin/cli.ts
├── src/ui/terminal          (Terminal I/O)
├── src/ui/formatters        (Output formatting)
├── src/ui/spinner           (Progress indicator)
├── src/orchestrator         (Orchestration)
│   ├── intent-detector      (Parse intent)
│   ├── domain-detector      (Detect domains)
│   ├── policy-engine        (Apply policies)
│   └── audit-reporter       (Audit findings)
├── src/agent/routing        (Agent selection)
│   ├── llm-router           (Route to agent)
│   ├── text-scorer          (Score messages)
│   └── weights-store        (Trigger weights)
├── src/agent/loop           (Main agent loop)
│   ├── iteration-manager    (Control iterations)
│   ├── tool-executor        (Run tools)
│   └── qa/qa-service        (QA review)
├── src/skills/              (Skills loading)
│   ├── loader               (Load YAML/Vault)
│   └── handlers             (Specialized handlers)
├── src/reflection/          (Learning engine)
│   ├── failure-catalog      (Record failures)
│   ├── pattern-detector     (Detect patterns)
│   └── policy-promoter      (Create policies)
└── src/memory/              (Persistence)
    ├── memory-loader        (Load context)
    └── updater              (Save state)
```

## Configuration Flow

```
Defaults (hardcoded)
  ↓
File config (~/.deepseek-code/config.yaml)
  ↓
Environment variables
  ↓
CLI flags (highest priority)
```

## Extensibility Points

### 1. Custom Commands

```typescript
registry.register('/my-command', 'Description', handler);
```

### 2. Custom Agents

```
~/.deepseek-code/agents/my-agent.yaml
```

### 3. Custom Skills

```
~/.deepseek-code/skills/my-skill.yaml
OR
Vault/04-Recursos/Skills/
```

### 4. Custom Tools (via plugins)

Plugin system for new tools.

### 5. Custom Memory

Override memory loader for different backends.

## Performance Characteristics

| Operation | Typical Time |
|-----------|--------------|
| Startup | 1-2 seconds |
| LLM call | 5-30 seconds (model dependent) |
| Tool execution | 0.1-1 second |
| Memory load | 0.1-0.5 seconds |
| Pattern detection | < 0.1 seconds |

## Token Usage Model

```
System Prompt: ~2000 tokens (constant)
Project Context: ~1000 tokens (variable)
Conversation History: ~3000 tokens (variable)
Skills Injected: ~500 tokens (variable)

Total Context: ~6500 tokens (typical)
Remaining: ~57500 tokens (in 64k model)
```

## Security Architecture

```
Input Validation
  ↓
Tool Whitelist
  ↓
Path Allowlist
  ↓
Execution Sandbox
  ↓
Output Filtering
```

---

**Next Steps:**
- → [01-overview.md](01-overview.md) — Understand concepts
- → [04-spec-driven-development.md](04-spec-driven-development.md) — See architecture in action
