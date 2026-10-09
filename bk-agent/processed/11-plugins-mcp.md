# 11 - Plugins & MCP Integration

Extend bk-agent with custom plugins and MCP servers.

## Plugins Overview

Plugins add new:
- Commands
- Tools
- Skills
- Custom handlers

## MCP Servers

bk-agent integrates with **Model Context Protocol** servers for:
- Git operations (via MCP git plugin)
- External APIs
- Custom tools
- Knowledge sources

### Configure MCP in Claude

For `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "git": {
      "command": "npx",
      "args": ["-y", "@backendkit-labs/mcp-git-plugin"]
    },
    "curator": {
      "command": "npx",
      "args": ["-y", "@backendkit-labs/curator-agent"],
      "env": {
        "CURATOR_VAULT_PATH": "/path/to/vault",
        "CURATOR_API_KEY": "sk-..."
      }
    }
  }
}
```

## Creating Custom Plugins

### Plugin Structure

```
my-plugin/
├── manifest.yaml
├── src/
│   ├── handlers/
│   │   ├── command-handler.ts
│   │   └── tool-handler.ts
│   └── index.ts
├── skills/
│   └── my-skill.yaml
└── README.md
```

### Manifest Example

```yaml
# manifest.yaml
id: "my-plugin"
version: "1.0.0"
name: "My Plugin"
description: "What this plugin does"

dependencies:
  "@backendkit-labs/agent-core": ">=0.22.0"

handlers:
  - type: "command"
    name: "/my-command"
    path: "./src/handlers/command-handler.ts"
  
  - type: "tool"
    name: "my_tool"
    path: "./src/handlers/tool-handler.ts"

skills:
  - "./skills/my-skill.yaml"
```

### Command Handler

```typescript
// src/handlers/command-handler.ts
import { CommandHandler, CommandContext } from '@backendkit-labs/agent-core';

export const myCommandHandler: CommandHandler = async (ctx: CommandContext) => {
  const { args, emit, agents } = ctx;
  
  emit(`Hello ${args || 'World'}!`);
  
  return true;  // Handled
};
```

### Tool Handler

```typescript
// src/handlers/tool-handler.ts
import { ToolHandler, ToolCall } from '@backendkit-labs/agent-core';

export const myToolHandler: ToolHandler = async (call: ToolCall) => {
  const { name, input } = call;
  
  if (name === 'my_custom_tool') {
    return {
      status: 'success',
      output: `Processed: ${input.param1}`
    };
  }
  
  return { status: 'error', output: 'Unknown tool' };
};
```

## Git Plugin (MCP)

The git plugin handles version control:

```bash
@commit "fix: resolve auth bug"
```

This triggers the MCP git plugin to:
1. Stage changes
2. Create commit
3. Run pre-commit hooks
4. Push (optional)

### Installation

```bash
# Add to config
export MCP_GIT_PLUGIN="@backendkit-labs/mcp-git-plugin"

# Or add to claude_desktop_config.json
```

### Usage

```
/commit "type(scope): message"
```

The plugin handles Git operations.

## Publishing Plugins

### npm Package

```bash
npm init
npm publish
```

### Make it installable

In `package.json`:

```json
{
  "name": "@myorg/bk-agent-my-plugin",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "mcp-my-plugin": "dist/cli.js"
  }
}
```

### Register with BackendKit

Submit PR to:
https://github.com/backendkit-labs/plugins-registry

## Example: Slack Notifier Plugin

```yaml
# manifest.yaml
id: "slack-notifier"
version: "1.0.0"
name: "Slack Notifier"
description: "Send notifications to Slack"

handlers:
  - type: "command"
    name: "/notify"
    path: "./src/notify-handler.ts"

skills:
  - "./skills/slack-skill.yaml"
```

```typescript
// src/notify-handler.ts
import axios from 'axios';

export const notifyHandler = async (ctx) => {
  const { args } = ctx;
  
  await axios.post(process.env.SLACK_WEBHOOK_URL, {
    text: args,
    channel: '#dev-notifications'
  });
  
  ctx.emit(`✓ Notified Slack: ${args}`);
  return true;
};
```

```yaml
# skills/slack-skill.yaml
name: "Slack Notifications"
triggers:
  - "slack"
  - "notify"
systemPromptAddition: |
  When user mentions Slack:
  1. Suggest /notify command
  2. Format message nicely
  3. Include relevant context
```

## Best Practices

### 1. Clear Documentation

Every plugin needs:
- README with usage examples
- Parameter descriptions
- Error handling docs

### 2. Dependency Management

```json
{
  "peerDependencies": {
    "@backendkit-labs/agent-core": ">=0.22.0"
  }
}
```

### 3. Error Handling

```typescript
try {
  // Plugin logic
} catch (error) {
  return {
    status: 'error',
    output: `Plugin error: ${error.message}`
  };
}
```

### 4. Configuration

Allow environment variables:

```typescript
const apiKey = process.env.MY_PLUGIN_API_KEY;
if (!apiKey) throw new Error('MY_PLUGIN_API_KEY required');
```

---

**Next Steps:**
- → [06-skills-system.md](06-skills-system.md) — Skills vs Plugins
- → [14-architecture.md](14-architecture.md) — Internal architecture
