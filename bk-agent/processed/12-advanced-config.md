# 12 - Advanced Configuration

Fine-tune bk-agent for your workflow.

## Configuration File

Location: `~/.deepseek-code/config.yaml`

```yaml
# API & Models
defaultProvider: "deepseek"

providers:
  deepseek:
    apiKey: "${DEEPSEEK_API_KEY}"
    model: "deepseek-chat"
    baseUrl: "https://api.deepseek.com/v1"

  anthropic:
    apiKey: "${ANTHROPIC_API_KEY}"
    model: "claude-opus-4-8"
    baseUrl: "https://api.anthropic.com"

  openai:
    apiKey: "${OPENAI_API_KEY}"
    model: "gpt-4"
    baseUrl: "https://api.openai.com/v1"

# Agents
agents:
  defaultAgentId: "general"
  autoSwitch: true

# Skills
skills:
  autoLoad: true
  vaultPath: "${OBSIDIAN_VAULT}"
  reloadInterval: 30000  # ms

# Execution
execution:
  maxIterations: 100
  commandTimeout: 0  # 0 = no limit
  iterationMode: "step-by-step"  # interactive | auto | step-by-step

# Streaming
streaming:
  enabled: true
  formatMarkdown: true

# QA
qa:
  enabled: true
  autoReview: true
  reviewMode: "comprehensive"  # quick | balanced | comprehensive

# Delegation
delegation:
  enabled: true
  maxDelegationDepth: 2
  trackSubAgentCosts: true

# Context
context:
  maxTokensPerMessage: 8000
  contextWindow: 64000
  summarizeAfterTokens: 32000

# Memory
memory:
  persistCheckpoints: true
  checkpointRetention: 10
  auditReports: true
  autoCompact: true

# Terminal
terminal:
  colorEnabled: true
  theme: "dark"  # dark | light
  width: 120
```

## Environment Variables

Override config or pass secrets:

```bash
export DEEPSEEK_API_KEY="sk-..."
export DEEPSEEK_API_BASE_URL="https://custom.api.com"
export BK_ITERATION_MODE="auto"
export BK_MAX_ITERATIONS="50"
export OBSIDIAN_VAULT="/home/user/vault"
```

## CLI Flags

Override config for single run:

```bash
bk-agent \
  --api-key "sk-..." \
  --model "deepseek-reasoner" \
  --iteration-mode auto \
  --max-iterations 50 \
  --command-timeout 30 \
  --no-stream \
  --no-qa \
  --no-delegation \
  --headless
```

## Project-Level Config

Override per-project in `.bk-project/config.yaml`:

```yaml
# .bk-project/config.yaml
projectName: "my-api"

# Override defaults for this project
execution:
  iterationMode: "interactive"
  maxIterations: 200

qa:
  enabled: true
  autoReview: false  # Manual QA for this project

memory:
  checkpointRetention: 20  # Keep more checkpoints
```

## Performance Tuning

### For Slow Connection

```yaml
execution:
  commandTimeout: 30  # 30s timeout
context:
  contextWindow: 32000  # Smaller window
```

### For Fast Iteration

```yaml
execution:
  iterationMode: "auto"
  maxIterations: 150
qa:
  reviewMode: "quick"
```

### For Cost Control

```yaml
execution:
  maxIterations: 50
qa:
  enabled: false  # Disable auto QA
delegation:
  enabled: false  # No sub-agents
```

## Provider Configuration

### DeepSeek (Default)

```yaml
providers:
  deepseek:
    apiKey: "${DEEPSEEK_API_KEY}"
    model: "deepseek-reasoner"
    baseUrl: "https://api.deepseek.com/v1"
```

### Anthropic (High Quality)

```yaml
providers:
  anthropic:
    apiKey: "${ANTHROPIC_API_KEY}"
    model: "claude-opus-4-8"
    baseUrl: "https://api.anthropic.com"
```

### Ollama (Local)

```yaml
providers:
  ollama:
    baseUrl: "http://localhost:11434/v1"
    model: "qwen2.5-coder:7b"
```

## Logging Configuration

Control log verbosity:

```yaml
logging:
  level: "info"  # debug | info | warn | error
  format: "text"  # text | json
  includeTimestamps: true
  colorEnabled: true
```

Environment variable override:

```bash
export BK_LOG_LEVEL=debug
bk-agent
```

## Plugin Configuration

Configure plugins:

```yaml
plugins:
  enabled: true
  directory: "~/.deepseek-code/plugins"
  autoLoad: true

  curator:
    enabled: true
    vaultPath: "${OBSIDIAN_VAULT}"

  git:
    enabled: true
    requireSignedCommits: true
```

## Vault Integration

```yaml
skills:
  vaultPath: "${OBSIDIAN_VAULT}"
  searchPaths:
    - "04-Recursos/Skills"
    - "04-Recursos/Patterns"
  cacheEnabled: true
  cacheTTL: 3600  # 1 hour
```

## Headless Mode Configuration

For CI/CD or external frontends:

```bash
bk-agent --headless
```

Output JSON-Lines to stdout:

```json
{"type":"user_input","text":"generate a service"}
{"type":"block_start","agent_id":"code-generator"}
{"type":"token","content":"Generating..."}
{"type":"tool_call","tool":"write_file",...}
{"type":"block_end","status":"ok"}
{"type":"done"}
```

## Debug Mode

Enable detailed logging:

```bash
export BK_DEBUG=true
export BK_LOG_LEVEL=debug
bk-agent
```

Shows:
- API requests/responses
- Tool execution details
- Memory loading
- Router decisions

---

**Next Steps:**
- → [13-troubleshooting.md](13-troubleshooting.md) — Common issues
- → [02-installation-setup.md](02-installation-setup.md) — Basic setup
