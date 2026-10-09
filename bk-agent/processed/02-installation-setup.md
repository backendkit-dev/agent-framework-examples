# 02 - Installation & Setup

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 20 | Required for execution |
| npm | ≥ 9 | Package manager |
| Git | ≥ 2.30 | Version control (for /spec and workflows) |
| API Key | DeepSeek | Required for LLM access |

## Installation

### Option 1: Global npm (Recommended)

```bash
npm install -g @backendkit-labs/agent
```

This creates commands:
- `bk-agent` — Main command
- `deepseek-code` — Alternative alias

Verify:
```bash
bk-agent --version
# → 1.0.0
```

### Option 2: From Repository

```bash
git clone https://github.com/backendkit-labs/agent-framework-examples.git
cd agent-framework-examples/bk-agent
npm install
npm run build
npm link
```

### Option 3: Docker (if available)

```bash
docker run -it --rm \
  -e DEEPSEEK_API_KEY="sk-..." \
  -v $(pwd):/workspace \
  backendkit-labs/bk-agent
```

## API Key Configuration

### Step 1: Get API Key

1. Go to https://api.deepseek.com
2. Create account / login
3. Generate API key
4. Copy the key (format: `sk-...`)

### Step 2: Set Environment Variable

#### Windows (PowerShell)
```powershell
$env:DEEPSEEK_API_KEY = "sk-your-key-here"
```

#### Windows (Command Prompt)
```cmd
set DEEPSEEK_API_KEY=sk-your-key-here
```

#### Linux / macOS
```bash
export DEEPSEEK_API_KEY="sk-your-key-here"
```

#### Permanent (Linux/macOS)
Add to `~/.bashrc` or `~/.zshrc`:
```bash
export DEEPSEEK_API_KEY="sk-your-key-here"
```

### Step 3: Verify

```bash
echo $DEEPSEEK_API_KEY    # Should show your key
bk-agent                  # Should start without error
```

## First Run

### Launch the Agent

```bash
cd /path/to/your/project
bk-agent
```

You should see:
```
╔════════════════════════════════════════════╗
║  BackendKit Agent v1.0.0                   ║
║  Model: deepseek-chat                      ║
║  Project: my-project                       ║
╚════════════════════════════════════════════╝

Type /help for commands
>
```

### First Commands

```bash
/help                    # View all commands
/status                  # Check system status
/context                 # View project context
/init                    # Analyze/initialize project
```

## Initial Configuration

### Set Your Model Preference

```bash
/models                  # List available models
/models deepseek-reasoner  # Switch to reasoning model
```

**Models Available:**

| Model | Badge | Use Case | Cost/M tokens |
|-------|-------|----------|---------------|
| deepseek-chat | ⚡ | General, code, fast tasks | $0.27/$1.10 (I/O) |
| deepseek-reasoner | 🧠 | Reasoning, complex problems | $0.55/$2.19 (I/O) |

### Project Initialization

Analyze your current project:

```bash
/init
```

This will:
1. Detect existing project files
2. Ask leveling questions if new project
3. Create/update specification.md and design.md
4. Set up memory context

### Choose Iteration Mode

Control how aggressively the agent executes:

```bash
/iteration                  # View current mode
# Then choose: interactive | step-by-step | auto
```

| Mode | Behavior | Use Case |
|------|----------|----------|
| **interactive** | Confirm each tool call | Maximum control, learning |
| **step-by-step** | Execute without confirmation | Default, good balance |
| **auto** | Fully autonomous | Maximum speed |

## Configuration File

Advanced users can configure via `~/.deepseek-code/config.yaml`:

```yaml
# Default provider
defaultProvider: "deepseek"

# Provider configuration
providers:
  deepseek:
    apiKey: "${DEEPSEEK_API_KEY}"  # Use env var
    model: "deepseek-chat"
    baseUrl: "https://api.deepseek.com/v1"

# Agent defaults
agents:
  defaultAgentId: "general"

# Skills configuration
skills:
  autoLoad: true
  vaultPath: "${OBSIDIAN_VAULT}"

# Context management
context:
  maxTokensPerMessage: 8000
  contextWindow: 64000
  summarizeAfterTokens: 32000

# QA automation
qa:
  enabled: true
  autoReview: true

# Sub-agent delegation
delegation:
  enabled: true
  maxDelegationDepth: 2

# Memory persistence
memory:
  persistCheckpoints: true
  checkpointRetention: 10
  auditReports: true
```

## Workspace Setup (Optional)

If working with multiple projects (monorepo), set up workspaces:

```bash
/workspace create my-workspace          # Create workspace
/workspace add /path/to/project         # Add project to workspace
/switch                                 # Switch workspace/project (picker)
```

## Vault Integration (Optional)

Connect Obsidian vault for knowledge:

```bash
OBSIDIAN_VAULT="/path/to/vault" bk-agent
```

Your vault should have structure:
```
vault/
├── 04-Recursos/
│   ├── Skills/
│   │   └── *.md
│   ├── Backend/
│   ├── Arquitectura/
│   └── ...
```

## Troubleshooting Setup

### "API key required"
```bash
# Check if key is set
echo $DEEPSEEK_API_KEY

# If empty:
export DEEPSEEK_API_KEY="sk-..."
```

### "Command not found: bk-agent"
```bash
# Try full path
npm list -g @backendkit-labs/agent

# If not installed:
npm install -g @backendkit-labs/agent

# Or use npx:
npx @backendkit-labs/agent
```

### "Project not found"
```bash
# Initialize the project
/init

# Or switch to correct directory
cd /path/to/project
bk-agent
```

### "Model not available"
```bash
# List available models
/models

# Ensure API key has access
# Check DeepSeek dashboard at https://api.deepseek.com
```

## Upgrading

### From npm

```bash
npm update -g @backendkit-labs/agent
```

### From Repository

```bash
cd agent-framework-examples/bk-agent
git pull origin master
npm install
npm run build
npm link
```

## Uninstalling

```bash
npm uninstall -g @backendkit-labs/agent
```

---

**Next Steps:**
- → [03-commands-slash.md](03-commands-slash.md) — Learn slash commands
- → [04-spec-driven-development.md](04-spec-driven-development.md) — Start first /spec workflow
- → [01-overview.md](01-overview.md) — Understand capabilities
