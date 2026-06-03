# Infra Agent

A multi-agent infrastructure assistant built on [@bk/agent-core](https://github.com/backendkit-dev/agent-framework). It understands natural language requests and routes them to the right specialist agent — Docker, Compose, Swarm, Kubernetes, builds, registries, secrets, and more.

## Architecture

```
User / MCP Client
       │
       ▼
┌─────────────────────┐
│  infra-orchestrator │  ← routes every request to the right specialist
└──────────┬──────────┘
           │ delegates via ask_agent
   ┌───────┴────────────────────────────────────────────┐
   │                                                    │
   ▼           ▼           ▼           ▼           ▼   │
docker-agent  compose-agent  swarm-agent  k8s-agent  ...│
                                                        │
build-agent  monitor-agent  registry-agent  secret-agent│
```

Each specialist agent has a fixed set of tools and never delegates further. The orchestrator aggregates their responses into a single structured reply.

## Setup

### Prerequisites
- Node.js 18+
- Docker Desktop or Docker Engine running
- For Kubernetes tools: `kubectl` configured
- For containerd tools: `nerdctl` or `ctr` installed
- For Vault tools: `vault` CLI + `VAULT_ADDR` / `VAULT_TOKEN` env vars

### Install

```bash
# From the agent-framework-examples root
cd docker-agent
npm install
```

### Configure

Copy `.env.example` to `.env` and set your LLM provider:

```bash
# OpenAI (default)
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Anthropic
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-opus-4-8

# DeepSeek or any OpenAI-compatible endpoint
LLM_PROVIDER=openai
LLM_API_KEY=...
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# Docker socket (optional — auto-detected on Linux/Mac/Windows)
DOCKER_HOST=npipe:////./pipe/dockerDesktopLinuxEngine
```

## Usage

### CLI (interactive)

Send a single prompt and get a response:

```bash
# Using ts-node (development)
npm run dev "List all running containers and show system info"

# Using compiled output (production)
npm run build
node dist/index.js "Deploy nginx on port 8080"
```

### MCP Server

Expose the agent as an MCP server for Claude Desktop, Claude Code, or any MCP client:

```bash
# HTTP mode (default when TTY is detected)
npm run mcp

# Stdio mode (for MCP clients that launch subprocesses)
node dist/mcp.js
```

MCP tools exposed:

| Tool | Description |
|---|---|
| `infra_execute` | Run any infrastructure task in natural language |
| `infra_deploy` | Deploy a service (Docker, Compose, Swarm, or Kubernetes) |
| `infra_status` | Get infrastructure status across platforms |

**Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "infra-agent": {
      "command": "node",
      "args": ["/absolute/path/to/docker-agent/dist/mcp.js"]
    }
  }
}
```

---

## Agents

### infra-orchestrator

The routing layer. Analyzes every incoming request and delegates to the right specialist. For requests spanning multiple technologies, it delegates to several agents in parallel and merges their responses.

**You never call this agent directly** — it is the default entry point.

**Example requests:**
```
"Deploy a Redis + API service stack and check that both are healthy"
"Build my Node.js app, push it to Docker Hub, and deploy to Swarm"
"Show me the status of everything: running containers, Swarm services, and disk usage"
```

---

### 🐳 docker-agent

Manages individual Docker containers, images, and networks.

**Tools:** `container_list`, `container_create`, `container_exec`, `container_stop`, `container_remove`, `container_logs`, `container_inspect`, `image_pull`, `image_build`, `image_list`, `image_remove`, `image_tag`, `image_push`, `network_create`, `network_list`, `network_inspect`, `network_remove`, `network_connect`

**Example requests:**
```
"List all running containers"
"Start an nginx container named web on port 80"
"Show the last 100 lines of logs from the api container"
"Pull postgres:16 and create a container with the POSTGRES_PASSWORD env var"
"Create a bridge network called backend and connect the api and db containers to it"
"Build a Docker image from /app with the tag myapp:v2.1.0"
"Tag myapp:latest as registry.mycompany.com/myapp:v2.1.0 and push it"
```

---

### 🧩 compose-agent

Manages multi-service applications defined with Docker Compose.

**Tools:** `compose_up`, `compose_down`, `compose_build`, `compose_ps`, `compose_logs`

**Example requests:**
```
"Start the services defined in ./docker-compose.yml"
"Bring down the staging stack and remove its volumes"
"Rebuild the api service image without cache"
"Show the status of all services in /projects/myapp/docker-compose.yml"
"Show the last 200 lines of logs from the worker service"
"Restart only the api and redis services without touching the database"
```

---

### ⚙️ swarm-agent

Manages Docker Swarm clusters: services, stacks, and nodes.

**Tools:** `swarm_service_create`, `swarm_service_list`, `swarm_service_inspect`, `swarm_service_logs`, `swarm_service_update`, `swarm_service_remove`, `swarm_stack_deploy`, `swarm_stack_list`, `swarm_stack_remove`, `swarm_node_list`

**Example requests:**
```
"List all Swarm services and their replica status"
"Create a service called api using myapp:v2 with 3 replicas on port 3000"
"Scale the worker service to 5 replicas"
"Deploy the stack defined in docker-stack.yml with the name production"
"Show the last 50 log lines from the api service"
"List all Swarm nodes and their availability"
"Remove the staging stack"
```

---

### 💾 volume-agent

Manages Docker volumes.

**Tools:** `volume_create`, `volume_list`, `volume_inspect`, `volume_remove`

**Example requests:**
```
"List all Docker volumes"
"Create a volume named postgres-data with the local driver"
"Inspect the postgres-data volume and show its mount point"
"Remove all volumes whose names start with test-"
```

---

### 📦 containerd-agent

Manages containers directly via the containerd runtime using `nerdctl` or `ctr`.

**Tools:** `containerd_run`, `containerd_list`, `containerd_stop`, `containerd_remove`, `containerd_logs`, `containerd_pull`

**Example requests:**
```
"List all containers managed by containerd"
"Pull alpine:3.18 via nerdctl"
"Run a containerd container with the nginx image on port 8080"
"Show logs from the containerd container named proxy"
```

---

### ☸️ k8s-agent

Manages Kubernetes cluster resources.

**Tools:** `k8s_apply`, `k8s_get`, `k8s_describe`, `k8s_logs`, `k8s_exec`, `k8s_delete`

**Example requests:**
```
"Apply the manifest at ./k8s/deployment.yaml"
"Get all pods in the payments namespace"
"Describe the api deployment in production"
"Show logs from the api pod in the default namespace, last 100 lines"
"Exec into the api-7d9f8b-xkp2q pod and run 'env | grep DB'"
"Delete all pods with the label app=stale-worker"
```

---

### 🖥️ system-agent

Provides Docker daemon diagnostics and resource cleanup.

**Tools:** `system_info`, `system_prune`

**Example requests:**
```
"Show Docker system info: version, resources, and container counts"
"How much disk space is Docker using?"
"Clean up all unused containers, images, and networks"
"Prune everything including volumes to free up space"
```

---

### 📊 monitor-agent

Observes container health and resource usage in real time.

**Tools:** `container_stats`, `container_top`, `container_health`, `events_tail`

**Example requests:**
```
"Show CPU and memory usage for all running containers"
"What processes are running inside the api container?"
"Check the health status of the postgres container"
"Show Docker events from the last 15 minutes"
"Which container is consuming the most memory right now?"
"Show only container events from the last 5 minutes"
"The api container is slow — show its stats and recent events"
```

---

### 📦 registry-agent

Manages Docker image registries: search, tags, authentication, and publishing.

**Tools:** `registry_login`, `registry_logout`, `registry_search`, `registry_tags`, `image_tag`, `image_push`, `image_pull`

**Example requests:**
```
"Search Docker Hub for official PostgreSQL images"
"What tags are available for the nginx image?"
"List the last 10 tags for myorg/myapp on Docker Hub"
"Log in to registry.mycompany.com with username deploy"
"Tag myapp:latest as registry.mycompany.com/myapp:v3.0.0 and push it"
"What tags exist for myapp in our private registry at registry.mycompany.com?"
"Log out from Docker Hub"
```

---

### 🔐 secret-agent

Manages secrets across Docker Swarm and HashiCorp Vault.

**Tools:** `swarm_secret_create`, `swarm_secret_list`, `swarm_secret_inspect`, `swarm_secret_remove`, `vault_kv_read`, `vault_kv_write`, `vault_kv_list`, `vault_kv_delete`

> Secret values are always passed via stdin — they never appear in process arguments or agent responses.

**Example requests:**
```
"Create a Swarm secret called db_password"
"List all Swarm secrets"
"Read the database credentials from Vault at secret/data/myapp/db"
"Write a new API key to Vault at secret/data/myapp/stripe"
"List all secrets under secret/data/myapp"
"Rotate the db_password Swarm secret: create db_password_v2, then remove v1"
"Delete the Vault secret at secret/data/myapp/old-key"
```

> **Vault prerequisites:** `VAULT_ADDR` and `VAULT_TOKEN` must be set in the environment. Vault KV v2 paths follow the pattern `secret/data/{app}/{key}`.

---

### 🔨 build-agent

Compiles and packages applications before containerization. Covers the full pipeline from source code to pushed image.

**Tools:** `build_detect`, `build_node`, `build_python`, `build_go`, `image_build`, `image_tag`, `image_push`

**Example requests:**
```
"What kind of project is in /workspace/myapp?"
"Build the Node.js app in /workspace/api using npm ci"
"Build the Python service in /workspace/worker and install its dependencies"
"Build the Go binary in /workspace/service for Linux amd64"
"Build, containerize, and push the app in /workspace/api to registry.io/myorg/api:v2.0.0"
"Run a production build of the Next.js app in /workspace/frontend with NODE_ENV=production"
"Cross-compile the Go service for linux/amd64 and build a Docker image tagged myservice:latest"
```

**Full pipeline example:**
```
"Build the Node.js app in /workspace/api, create a Docker image tagged myorg/api:v1.5.0,
 and push it to Docker Hub"
```
This triggers: `build_detect` → `build_node` → `image_build` → `image_tag` → `image_push`

---

## Configuration reference

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `openai` | Provider: `openai`, `anthropic` |
| `LLM_API_KEY` | — | API key (also reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Base URL for OpenAI-compatible APIs |
| `LLM_MODEL` | `gpt-4o` | Model ID |
| `DOCKER_HOST` | auto | Docker socket path or TCP URL |
| `DOCKER_SOCKET_PATH` | auto | Explicit socket path |
| `KUBECONFIG` | `~/.kube/config` | Kubernetes config file |
| `K8S_NAMESPACE` | `default` | Default Kubernetes namespace |
| `CONTAINERD_RUNTIME` | `nerdctl` | `nerdctl` or `ctr` |
| `CONTAINERD_NAMESPACE` | `default` | containerd namespace |
| `MCP_PORT` | `3100` | HTTP MCP server port |
| `MCP_HOST` | `127.0.0.1` | HTTP MCP server host |
| `DEFAULT_TIMEOUT` | `30000` | Default tool timeout in ms |
| `VAULT_ADDR` | — | HashiCorp Vault server URL |
| `VAULT_TOKEN` | — | Vault authentication token |
