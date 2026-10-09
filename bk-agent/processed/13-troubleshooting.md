# 13 - Troubleshooting Guide

Common issues and solutions.

## Installation & Startup

### "Command not found: bk-agent"

```bash
# Check if installed
npm list -g @backendkit-labs/agent

# If not:
npm install -g @backendkit-labs/agent

# Or use with npx:
npx @backendkit-labs/agent
```

### "API key required"

```bash
# Check if set
echo $DEEPSEEK_API_KEY

# If empty:
export DEEPSEEK_API_KEY="sk-..."

# Or pass flag:
bk-agent --api-key "sk-..."
```

### Port already in use

```bash
# Kill process using port
lsof -i :3000
kill -9 <PID>

# Or use different port
bk-agent --port 3001
```

---

## Project & Context

### "Project not found"

```bash
# Switch to correct directory
cd /path/to/project

# Or initialize:
bk-agent
/init
```

### "Empty memory" / No context loading

```bash
# Reinitialize project
/init

# Or check memory exists
ls ~/.deepseek-code/projects/[hash]/memory/

# If missing:
/init    # Will recreate
```

### Wrong memory loading

```bash
# Verify correct project
/context

# Switch if needed
/switch
```

---

## Commands & Execution

### Command not recognized

```bash
/help    # List all commands

# Check spelling: /spec.run (not /spec run)
```

### Spec workflow not progressing

```bash
# Check current phase
/spec.show.roadmap

# Verify spec exists
/spec.context

# If missing specification.md:
/spec.prompt "requirements"
/spec.specify
```

### Checkpoint not saving/loading

```bash
# List checkpoints
/checkpoint list

# Verify directory exists
ls ~/.deepseek-code/projects/[hash]/checkpoints/

# If empty:
/checkpoint save new-name
```

---

## Agent & Model Issues

### Wrong agent selected

```bash
# Force specific agent
/agent qa-engineer
"your message here"

# Or switch back to auto:
/agent general
```

### Model not available

```bash
# List models
/models

# Check API key has access
# Visit https://api.deepseek.com

# Verify config
cat ~/.deepseek-code/config.yaml | grep model
```

### "Agent not found"

```bash
# Reload agents
/agent reload

# List available
/agent list
```

---

## Skills Issues

### Skill not activating

```bash
# Check if loaded
/skills

# Reload
/skills --reload

# Check YAML syntax
# File: ~/.deepseek-code/skills/my-skill.yaml
```

### Conflicting skills

```bash
# List active skills
/skills

# Disable one temporarily
# Remove from ~/.deepseek-code/skills/

# Test
/skills --reload
```

### Vault skills not loading

```bash
# Verify vault path
echo $OBSIDIAN_VAULT

# Set if needed:
export OBSIDIAN_VAULT="/path/to/vault"

# Check structure
ls $OBSIDIAN_VAULT/04-Recursos/Skills/

# Reload
/skills --reload
```

---

## Performance Issues

### Slow responses

```bash
# Reduce context
bk-agent --help | grep context

# Edit config
# Set contextWindow: 32000 (smaller)

# Or use faster model
/models deepseek-chat

# Disable QA
bk-agent --no-qa
```

### High token usage

```bash
# Check usage
/usage

# Reduce iterations
bk-agent --max-iterations 50

# Disable delegation
bk-agent --no-delegation

# Use cheaper model
/models deepseek-chat
```

### Memory issues

```bash
# Clear old checkpoints
ls ~/.deepseek-code/projects/[hash]/checkpoints/ | wc -l

# Keep only latest:
rm ~/.deepseek-code/projects/[hash]/checkpoints/old-*

# Or auto-compact
/checkpoint compact
```

---

## Workspace Issues

### Project not in workspace

```bash
# Check workspace
/workspace list

# Add project
/workspace add /path/to/project

# Switch
/switch workspace-name project-name
```

### Can't switch workspace

```bash
# Restart agent
exit
bk-agent

# Try again
/switch
```

---

## API & Network

### "Connection refused"

```bash
# Check API endpoint
cat ~/.deepseek-code/config.yaml | grep baseUrl

# Test connection
curl https://api.deepseek.com/v1/models

# Check network
ping google.com

# Try with different URL
bk-agent --base-url "https://api.deepseek.com/v1"
```

### "Rate limited" (HTTP 429)

```bash
# Wait before retrying
# Or reduce maxIterations
bk-agent --max-iterations 10

# Use cheaper model (cheaper=faster)
/models deepseek-chat
```

### "Model overloaded" (HTTP 503)

```bash
# Wait a moment and retry
/status    # Check status

# Switch to different model
/models deepseek-chat
```

---

## Output & Display

### Garbled output / special characters

```bash
# Disable colors
bk-agent --no-color

# Set terminal width
export COLUMNS=120
bk-agent
```

### Missing output / truncated

```bash
# Check buffer size
bk-agent --help | grep buffer

# Increase terminal lines
# Or redirect to file:
bk-agent > output.log 2>&1
```

---

## Debug Mode

Enable verbose logging:

```bash
export BK_DEBUG=true
export BK_LOG_LEVEL=debug
bk-agent
```

Shows:
- API requests
- Tool execution
- Router decisions
- Memory operations

---

## Getting Help

### Reproduce issue

```bash
# Collect info:
bk-agent --version
/status
/context
echo $DEEPSEEK_API_KEY | wc -c  # Should be >30 chars

# Save to file
bk-agent >> debug.log 2>&1
```

### Check logs

```bash
cat ~/.deepseek-code/logs/latest.log
```

### Common resources

- GitHub Issues: https://github.com/backendkit-labs/agent-framework-examples/issues
- Documentation: `/help` command
- Config validation: `bk-agent --validate-config`

---

**Still stuck?**
- → [01-overview.md](01-overview.md) — Start from basics
- → [02-installation-setup.md](02-installation-setup.md) — Reinstall fresh
- → [12-advanced-config.md](12-advanced-config.md) — Configure correctly
