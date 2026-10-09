# 05 - Agents & Specialization

The agent system automatically selects the best specialist for each task. Understanding how routing works helps you get better results.

## 🎯 How Agent Routing Works

### Automatic Selection

When you send a message, the system:
1. **Analyzes** your message for keywords
2. **Scores** each agent based on trigger matches
3. **Selects** highest-scoring agent
4. **Switches models** if needed (e.g., reasoning model)
5. **Executes** with selected agent + model

### Example

```
You: "generate a NestJS module with auth guards"

Router analysis:
  - "generate" → code-generator (+2)
  - "module" → code-generator (+1)
  - "auth" → code-generator (+1)
  - "NestJS" → code-generator (+2)
  
Selected: code-generator (deepseek-reasoner)
```

---

## Built-in Agents

### 1. General
- **ID:** `general`
- **Triggers:** Default (everything)
- **Model:** deepseek-chat
- **Use:** Fallback for unmatched messages, general questions

**Example triggers:**
```
"explain the project"
"what's the current status"
"how do I...?"
```

---

### 2. Project Manager
- **ID:** `project-manager`
- **Triggers:** `project`, `init`, `setup`, `analysis`, `structure`
- **Model:** deepseek-chat
- **Use:** Project understanding, analysis, initialization

**Example triggers:**
```
"analyze the project structure"
"what's the project about?"
/init    # Automatically uses project-manager
```

---

### 3. Code Generator
- **ID:** `code-generator`
- **Triggers:** `implement`, `generate`, `code`, `feature`, `module`, `service`, `controller`
- **Model:** deepseek-reasoner
- **Use:** Generate code, create modules, implement features

**Example triggers:**
```
"generate a NestJS service"
"implement the authentication module"
"create the user controller"
/spec.run    # Uses code-generator
```

---

### 4. QA Engineer
- **ID:** `qa-engineer`
- **Triggers:** `test`, `qa`, `coverage`, `validate`, `verify`, `check`
- **Model:** deepseek-chat
- **Use:** Testing, validation, code review

**Example triggers:**
```
"write tests for this"
"validate the implementation"
"check code quality"
/spec.qa    # Uses qa-engineer
```

---

### 5. Architecture Reviewer
- **ID:** `architecture-reviewer`
- **Triggers:** `architecture`, `design`, `adr`, `pattern`, `refactor`, `structure`
- **Model:** deepseek-reasoner
- **Use:** Design review, architecture decisions, patterns

**Example triggers:**
```
"review the architecture"
"suggest an architecture pattern"
"create an ADR for this decision"
/spec.plan    # Uses architecture-reviewer
```

---

### 6. Performance Analyst
- **ID:** `performance-analyst`
- **Triggers:** `performance`, `optimize`, `benchmark`, `slow`, `memory`, `bottleneck`
- **Model:** deepseek-chat
- **Use:** Optimization, performance analysis

**Example triggers:**
```
"optimize this function"
"benchmark the API"
"find performance bottlenecks"
```

---

## Changing Active Agent

### View Current Agent

```bash
/agent
```

Output:
```
Active Agent: code-generator 💻
Default:     general 🤖

All agents:
  general 🤖 - General multipurpose
  project-manager 📊 - Project analysis
  code-generator 💻 - Code generation
  qa-engineer 🧪 - Testing & validation
  architecture-reviewer 🏛️ - Architecture review
  performance-analyst 📈 - Performance
```

### Force Different Agent

```bash
/agent project-manager
```

Now all your messages use project-manager until you switch back.

### Force Back to General

```bash
/agent general
```

---

## Model Switching

When an agent needs a stronger model, it switches automatically.

### View Current Model

```bash
/models
```

Output:
```
Available Models:
  deepseek-chat ⚡ Fast, general tasks
    $0.27 input / $1.10 output per M tokens
  
  deepseek-reasoner 🧠 Reasoning, complex problems
    $0.55 input / $2.19 output per M tokens
```

### Force Specific Model

```bash
/models deepseek-reasoner
```

Now all agent calls use reasoning model (slower, more expensive, better quality).

---

## Custom Agents

Create specialized agents for your team.

### File Location

```
~/.deepseek-code/agents/my-expert.yaml
```

### Agent Definition

```yaml
id: "my-expert"
name: "My Team Expert"
icon: "⚡"
description: "Specialized in our domain-specific patterns"
triggers:
  - "my-pattern"
  - "domain-specific"
  - "custom-logic"
profile:
  model: "deepseek-reasoner"
  temperature: 0.7
  maxTokens: 8000
systemPrompt: |
  You are a specialist in our team's domain.
  
  Our patterns:
  - Use custom library X for pattern Y
  - Follow decision Z in architecture
  - Always include documentation
  
  When asked about our domain:
  1. Reference existing patterns
  2. Suggest improvements
  3. Explain tradeoffs
```

### Activate Custom Agent

```bash
# Reload agents from disk
/agent reload

# Switch to custom agent
/agent my-expert
```

### Tips for Custom Agents

**1. Be Specific in Triggers**
```yaml
triggers:
  - "kubernetes"
  - "helm"
  - "devops"
  - "infrastructure"
```

**2. Include Team Context in System Prompt**
```yaml
systemPrompt: |
  Team conventions:
  - Use PostgreSQL for persistence
  - Implement caching with Redis
  - Document all APIs
```

**3. Use Reasoning Model for Complex Domains**
```yaml
profile:
  model: "deepseek-reasoner"  # For complex decisions
```

**4. Set Appropriate Temperature**
```yaml
profile:
  temperature: 0.7  # Balanced: 0=deterministic, 1=creative
```

---

## Agent Delegation

Agents can delegate to sub-agents for specialized tasks.

### Enable/Disable Delegation

```bash
bk-agent --no-delegation    # Disable (faster, less cost)
bk-agent                    # Enable (default, better results)
```

### How It Works

```
code-generator receives task
  ↓
Detects need for security review
  ↓
Delegates to security specialist sub-agent
  ↓
Security agent analyzes code
  ↓
Returns findings to code-generator
  ↓
Code-generator incorporates feedback
  ↓
Final code to user
```

### Monitor Delegation

```bash
/usage    # Shows all sub-agent calls and costs
```

---

## Agent Profile System

Each agent has a profile controlling behavior.

### Default Profiles

```
Code Generator:
  model: deepseek-reasoner
  temperature: 0.5         (balanced)
  maxTokens: 8000

QA Engineer:
  model: deepseek-chat
  temperature: 0.3         (strict)
  maxTokens: 4000

Architecture Reviewer:
  model: deepseek-reasoner
  temperature: 0.7         (creative)
  maxTokens: 6000
```

### Temperature Explained

| Value | Behavior | Use Case |
|-------|----------|----------|
| 0.0 | Deterministic, repetitive | Code generation, validation |
| 0.3-0.5 | Balanced, consistent | Most tasks |
| 0.7-0.9 | Creative, diverse | Ideation, design |

---

## Best Practices

### 1. Let Router Do Its Job
```bash
# Good: Let router detect agent
"generate a NestJS service for users"

# Unnecessary: You choose agent
/agent code-generator
"generate a service"   # Router already knew this
```

### 2. Use Keywords Matching Triggers
```bash
# Good: Clear keywords
"implement authentication feature"

# Unclear: Vague wording
"make the login work"
```

### 3. Force Agent Only When Needed
```bash
/agent qa-engineer
"review this code"    # Only when you specifically need QA focus
```

### 4. Monitor Agent Usage
```bash
/status    # See which agents are active
/usage     # See cost per agent
```

### 5. Create Domain Agents for Specialized Teams
```yaml
# Example: Cloud Infrastructure Team
id: "cloud-expert"
triggers: ["terraform", "aws", "kubernetes", "infrastructure"]
```

---

## Agent Scoring System

Agents are scored based on trigger matches:

```
Message: "implement user authentication service"

Scoring:
  general              : 1 point (default)
  project-manager      : 0 points (no triggers match)
  code-generator       : 4 points
    - "implement" (+2)
    - "service" (+1)
    - "user" (+1)
  qa-engineer          : 1 point (no triggers match)
  architecture-reviewer: 0 points
  performance-analyst  : 0 points

Winner: code-generator (4 points)
```

---

## Troubleshooting Agent Selection

### Wrong Agent Selected

**Problem:** "I wanted QA but got code-generator"

**Solution:** Be explicit:
```bash
/agent qa-engineer
"review this code for security issues"
```

### Agent Not Available

**Problem:** Custom agent not showing

**Solution:**
```bash
/agent reload          # Reload from disk
/agent list           # List all agents
```

### Model Keeps Switching

**Problem:** Agent keeps changing to reasoning model

**Solution:**
```bash
/models deepseek-chat   # Force cheaper model
```

---

**Next Steps:**
- → [06-skills-system.md](06-skills-system.md) — Extend agent capabilities
- → [04-spec-driven-development.md](04-spec-driven-development.md) — See agents in action
- → [03-commands-slash.md](03-commands-slash.md) — Agent commands reference
