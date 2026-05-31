# agent-framework-examples

Example applications built with [@bk/agent-framework](https://github.com/backendkit-dev/agent-framework).

## Prerequisites

Clone both repos side by side:

```bash
git clone https://github.com/backendkit-dev/agent-framework
git clone https://github.com/backendkit-dev/agent-framework-examples
```

Build the framework packages first:

```bash
cd agent-framework/packages/core   && npm install && npm run build
cd agent-framework/packages/coding && npm install && npm run build
cd agent-framework/packages/mcp-server && npm install && npm run build
```

## Examples

| Example | Description |
|---|---|
| [coding-assistant](./coding-assistant/) | Interactive REPL — the reference implementation of a coding agent |
| [git-analyst](./git-analyst/) | MCP server that analyzes git history and diffs |
| [code-explainer](./code-explainer/) | MCP server that explains and reviews code |
| [pg-dev-server](./pg-dev-server/) | MCP server that spins up PostgreSQL via Docker |

## Running an example

```bash
cd coding-assistant
npm install
npm run dev
```
