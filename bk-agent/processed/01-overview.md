# 01 - BackendKit Agent Overview

BackendKit Agent (`bk-agent`) is an autonomous AI coding assistant specialized in **Node.js and NestJS backend development**. It's not a generic chat — it understands your real project, executes tools natively, and orchestrates specialized agents to automate entire development workflows.

## 🎯 What is bk-agent?

**bk-agent** is a multi-agent system that:
1. **Understands your project** — Reads code, configuration, and architectural documentation
2. **Executes tools** — Reads/writes files, runs commands, searches code patterns
3. **Routes to specialists** — Selects the best agent for each task (code generator, QA engineer, architect, etc.)
4. **Automates workflows** — Implements complete development cycles from requirements to deployment
5. **Learns from patterns** — Detects recurring issues and promotes them to automatic rules

## ⚡ Key Capabilities

| Capability | Description |
|-----------|-------------|
| **Spec-Driven Development** | Complete `/spec` workflow: requirements → spec → design → implementation → QA → deployment |
| **Multi-Agent Routing** | Automatically selects the best agent (Code Generator, QA Engineer, Architect, etc.) |
| **Workspace Management** | Handle monorepos with independent context per project |
| **Dynamic Skills** | Extend capabilities with YAML skills or Obsidian vault knowledge |
| **QA Automation** | Automatic code review and validation |
| **Reflection Engine** | Learn from failures: 3+ similar errors → automatic prevention rules |
| **Memory Persistence** | Project context survives between sessions |
| **BackendKit Integration** | Native support for Result, Circuit Breaker, Bulkhead, Observability, Pipeline, etc. |
| **Checkpoints** | Save and restore session snapshots |

## 🏗️ How It Works

### Basic Flow

```
User Input (terminal)
    ↓
Intent Detection (command or message?)
    ↓
[If command] → Command Registry (execute /command)
[If message] → LLM Router (select agent + model)
    ↓
Agent Selection (choose specialized agent)
    ↓
Skill Activation (load relevant skills)
    ↓
Tool Execution Loop
    ├─ Generate response + tool calls
    ├─ Execute tools (read_file, write_file, etc.)
    ├─ Collect results
    └─ Iterate until done
    ↓
Output Display
    ↓
Reflection Engine (capture patterns, lessons)
    ↓
Memory Persistence (save to project memory)
    ↓
Done
```

### Spec-Driven Development Cycle

```
1. SPECIFY PHASE
   /spec.prompt "requirements"     → requirements in prompt.md
   /spec.specify                   → generate specification.md
   /spec.plan                      → generate design.md
   /spec.init                      → create roadmap
    
2. IMPLEMENT PHASE (repeat for each feature)
   /spec.next                      → show current task
   /spec.run                       → generate code
   /checkpoint save                → save progress
    
3. VERIFY PHASE (QA)
   /spec.qa                        → evaluate code
   /spec.advance --passed          → move to next phase
    
4. INTEGRATE PHASE
   Integration with main branch
    
5. DEPLOY PHASE
   Deployment to production
```

## 👥 Specialized Agents

The agent automatically selects specialists based on your message:

| Agent | Triggers | Role |
|-------|----------|------|
| **General** | Default | Fallback, general tasks |
| **Project Manager** | project, init, setup, analysis | Project understanding and setup |
| **Code Generator** | implement, generate, code, feature | Code generation |
| **QA Engineer** | test, qa, coverage, validate | Testing and validation |
| **Architecture Reviewer** | architecture, design, adr, pattern | Architecture and design review |
| **Performance Analyst** | performance, optimize, benchmark | Performance optimization |

## 🔌 Skills System

Skills extend agent capabilities. Two types:

### YAML Skills
```yaml
name: "NestJS Module Generator"
version: "1.0.0"
triggers: ["nestjs", "module"]
systemPromptAddition: "Generate NestJS modules with..."
tools:
  - name: "generate_module"
    description: "..."
```

### Vault Skills
Store `.md` files in Obsidian vault `04-Recursos/Skills/` — they're loaded as skills automatically.

## 💾 Memory & Context

bk-agent maintains persistent memory:

- **Session Memory** — Current feature, progress, issues, decisions
- **Project Context** — Stack, architecture, conventions, key files
- **Lessons Learned** — Patterns detected and lessons extracted
- **Checkpoints** — Snapshots you create to save progress

Memory survives between sessions — reconnect later and continue where you left off.

## 🎓 Learning System (Reflection Engine)

The Reflection Engine learns from your work:

1. **Incident Detection** — Catches errors, test failures, architecture issues
2. **Catalog** — Stores in failure catalog
3. **Pattern Detection** — Identifies when same error appears 3+ times
4. **Policy Promotion** — Converts repeated errors into automatic rules
5. **Prevention** — Future tasks automatically avoid the pattern

**Example:**
- Error 1: Missing error handling → cataloged
- Error 2: Missing error handling → cataloged
- Error 3: Missing error handling → Pattern detected
- Policy created: "Always add error handling to async functions"
- Future /spec.run: System blocks code without error handling

## 🚀 Installation & First Steps

### Installation
```bash
npm install -g @backendkit-labs/agent
```

### First Run
```bash
bk-agent
```

### First Command
```
/help                    # See all commands
/init                    # Analyze current project
/spec.prompt "desc"      # Start a spec workflow
/status                  # Check system status
```

## 🔧 Configuration

### API Key
```bash
export DEEPSEEK_API_KEY="sk-..."
```

### Models
- **DeepSeek V3** (deepseek-chat) — Fast, general tasks, $0.27/$1.10 per M tokens
- **DeepSeek R1** (deepseek-reasoner) — Reasoning, complex problems, $0.55/$2.19 per M tokens

### Modes
- **interactive** — Confirm each tool call (maximum control)
- **step-by-step** — Execute without confirmation (default, good balance)
- **auto** — Fully autonomous (maximum speed)

## 📊 Use Cases

### Backend Developer
Use `/spec` workflow to generate NestJS modules with BackendKit Labs patterns.

### Team Lead
Use `/init` to analyze project, `/status` to track progress, memory to maintain team conventions.

### Architect
Use `/spec.plan` to generate design documents, `/init` to review existing architecture.

### DevOps
Use skills to standardize cloud configurations, MCP plugins to extend functionality.

## 🔐 Security & Safety

- **Code Review** — Automatic QA gates before changes
- **Pattern Prevention** — Blocks anti-patterns after 3 occurrences
- **Controlled Delegation** — Sub-agent calls are monitored and logged
- **Memory Isolation** — Each project has independent memory/context

---

**Next Steps:**
- → [02-installation-setup.md](02-installation-setup.md) — Get started
- → [04-spec-driven-development.md](04-spec-driven-development.md) — Learn the main workflow
- → [03-commands-slash.md](03-commands-slash.md) — Explore all commands
