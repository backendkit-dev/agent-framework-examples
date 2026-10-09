# 03 - Complete Slash Commands Reference

All `/` commands available in bk-agent interactive mode.

## Control Commands

### /help
Display all available commands and active skills.

**Usage:**
```
/help
```

**Output:** Shows all slash commands + active skills with their triggers

---

### /clear
Clear the terminal screen.

**Usage:**
```
/clear
```

---

### /reset-context
Restart conversation while keeping system prompt and project memory.

**Usage:**
```
/reset-context
```

**Note:** Clears message history but preserves learned patterns and memory.

---

## Status & Information Commands

### /status
Display complete system status panel.

**Usage:**
```
/status
```

**Shows:**
- Active model and agent
- Token usage and estimated cost
- Project memory status
- Workspace information
- Active skills
- Reflection engine statistics

---

### /context
Display active project context.

**Usage:**
```
/context
```

**Shows:**
- Project name and location
- Technology stack
- Architectural patterns
- Key files and directories
- Active workspace
- Loaded project memory

---

### /tokens
Show token usage for current session.

**Usage:**
```
/tokens
```

**Displays:**
- Input tokens used
- Output tokens used
- Context window usage
- Estimated cost in USD

---

### /usage
Show detailed token usage of sub-agents.

**Usage:**
```
/usage
```

**Shows:**
- Per-agent token consumption
- Sub-agent calls and costs
- Delegation statistics

---

### /memory
Display persistent memory of active project.

**Usage:**
```
/memory
```

**Shows:**
- Current project context
- Lessons learned
- Detected patterns
- Recent decisions
- Next steps

---

## Agent & Model Commands

### /agent
List agents or change active agent.

**Usage:**
```
/agent                    # List all agents
/agent code-generator     # Switch to code-generator
```

**Available agents:**
- `general` — General multipurpose
- `project-manager` — Project analysis and setup
- `code-generator` — Code generation
- `qa-engineer` — Testing and validation
- `architecture-reviewer` — Architecture review
- `performance-analyst` — Performance optimization

---

### /models
List models or change active model.

**Usage:**
```
/models                   # List available models
/models deepseek-reasoner # Switch to reasoning model
```

**Available models:**
- `deepseek-chat` ⚡ — Fast, general tasks
- `deepseek-reasoner` 🧠 — Reasoning and complex problems

---

### /iteration
Display or change iteration mode.

**Usage:**
```
/iteration                # Show current mode
/iteration auto           # Change to auto mode
```

**Modes:**
- `interactive` — Confirm each tool call
- `step-by-step` — Default, execute without confirmation
- `auto` — Fully autonomous

---

## Skill Commands

### /skills
View, install, or manage skills.

**Usage:**
```
/skills                   # List active skills
/skills install skill-name # Install from vault
/skills --reload          # Reload all skills
```

**Skill sources:**
- YAML files in `~/.deepseek-code/skills/`
- Obsidian vault at `Vault/04-Recursos/Skills/`

---

## Workspace & Project Commands

### /switch
Change active workspace or project.

**Usage:**
```
/switch                          # Open picker TUI
/switch workspace-name proj-name # Switch specific
```

**Note:** Opens interactive picker to choose workspace and project.

---

### /workspace
Manage workspaces.

**Usage:**
```
/workspace create my-workspace   # Create new workspace
/workspace add /path/project     # Add existing project
/workspace list                  # List all workspaces
/workspace remove my-workspace   # Remove workspace
```

**Workspace contains:** Multiple projects with independent context.

---

### /init
Initialize or analyze project.

**Usage:**
```
/init
```

**If new project:**
1. Asks 4 setup questions
2. Creates specification.md
3. Creates design.md
4. Initializes memory

**If existing project:**
1. Detects project type
2. Analyzes current state
3. Updates documentation
4. Identifies gaps

---

## Checkpoint Commands

### /checkpoint
Manage session checkpoints (snapshots).

**Usage:**
```
/checkpoint save name                # Create checkpoint
/checkpoint list                     # List all checkpoints
/checkpoint load name                # Restore checkpoint
/checkpoint compact                  # Compress session memory
```

**Checkpoints contain:**
- Current state
- Message history (optional)
- Memory snapshot
- Token usage

**Use case:** Save progress before experiments, restore if needed.

---

## Spec-Driven Development Commands

### /spec.prompt
Save initial requirements to prompt.md.

**Usage:**
```
/spec.prompt "API REST for user management with JWT"
/spec.prompt --file /path/to/requirements.txt
```

**Output:** Creates `prompt.md` with structured requirements.

---

### /spec.specify
Generate specification.md from prompt.md.

**Usage:**
```
/spec.specify
```

**Process:**
1. Reads prompt.md
2. Generates detailed specification
3. Saves to specification.md

**Output:** Complete functional requirements document.

---

### /spec.plan
Generate design.md (architecture) from specification.

**Usage:**
```
/spec.plan
```

**Process:**
1. Reads specification.md + prompt.md
2. Generates architecture design
3. Saves to design.md

**Output:** System architecture and component design.

---

### /spec.init
Create roadmap with implementation phases.

**Usage:**
```
/spec.init
```

**Phases created:**
1. SPECIFY — Refine requirements
2. IMPLEMENT — Code generation
3. VERIFY — Testing/QA
4. INTEGRATE — Integration
5. DEPLOY — Deployment

---

### /spec.show.prompt
Display prompt.md content.

**Usage:**
```
/spec.show.prompt
```

---

### /spec.show.specify
Display specification.md content.

**Usage:**
```
/spec.show.specify
```

---

### /spec.show.plan
Display design.md content.

**Usage:**
```
/spec.show.plan
```

---

### /spec.show.roadmap
Display roadmap and phases.

**Usage:**
```
/spec.show.roadmap          # Show all phases
/spec.show.roadmap 1        # Show phase 1 only
```

---

### /spec.revise.prompt
Update prompt.md with feedback.

**Usage:**
```
/spec.revise.prompt "add OAuth2 support"
```

---

### /spec.revise.specify
Update specification.md with feedback.

**Usage:**
```
/spec.revise.specify "add rate limiting requirements"
```

---

### /spec.revise.plan
Update design.md with feedback.

**Usage:**
```
/spec.revise.plan "use event-driven architecture"
```

---

### /spec.next
Show current phase instructions and activate driving mode.

**Usage:**
```
/spec.next
```

**Displays:**
- Current phase (IMPLEMENT, VERIFY, etc.)
- Task description
- Requirements
- Next action

---

### /spec.run
Generate code for current phase. Orchestrates specialized agents.

**Usage:**
```
/spec.run
```

**Process:**
1. Reads specification.md + design.md
2. Sends to appropriate specialist agents
3. Generates code
4. QA reviews automatically
5. Shows results

**Important:** User must call `/spec.advance` to move to next phase.

---

### /spec.qa
QA Engineer evaluates current phase.

**Usage:**
```
/spec.qa
```

**Evaluation includes:**
- Code quality
- Test coverage
- Pattern adherence
- Security review
- Performance checks

**Output:** Saved to `qa-phase{N}.md`

---

### /spec.advance
Move to next phase.

**Usage:**
```
/spec.advance --passed "notes"   # Phase successful
/spec.advance --failed "issues"  # Needs rework
```

**Passed:** Move to next phase
**Failed:** Return to IMPLEMENT, next `/spec.next` injects QA findings

---

### /spec.go
Execute all phases autonomously.

**Usage:**
```
/spec.go
```

**Executes all phases** without human intervention until complete.

**Warning:** Use only when you trust the specification and design.

---

### /spec.context
Display all design documents and execution status.

**Usage:**
```
/spec.context
```

---

### /spec.overview
View all projects with active designs.

**Usage:**
```
/spec.overview
```

---

## Prompt Generation Commands

### /prompt
Generate structured prompt from brief description.

**Usage:**
```
/prompt new "API for e-commerce platform"
```

**Output:** Creates `prompt.md` with structured prompt.

---

## Command Syntax Reference

### Placeholders

```
<name>          Required argument (literal value)
[name]          Optional argument
<n>             Number argument
<mode>          Choice from fixed set
"text"          Quoted text (multiple words)
--flag          Command flag/option
```

### Examples

```bash
/checkpoint save my-feature           # Required: my-feature
/checkpoint load                      # Optional arguments
/spec.advance --passed "all tests ok" # Flag + quoted text
/models deepseek-reasoner             # Required: model name
/iteration                            # No args, shows current
```

---

**Next Steps:**
- → [04-spec-driven-development.md](04-spec-driven-development.md) — Complete /spec workflow guide
- → [05-agents-specialization.md](05-agents-specialization.md) — Understand agent selection
