# Specification Document — Docker Agent

> Generado por el Project Manager durante el flujo de init.
> Fecha: 2026-06-01

## API Contracts

### Interfaz entre Agentes (Protocolo de Comunicación)

El Docker Agent expone tools registradas en el AgentEngine del framework `@bk/agent-core`. Otros agentes invocan estas tools mediante el método `ask_agent` del DelegationBus.

#### Formato de Solicitud (desde agente solicitante vía ask_agent)

```json
{
  "agent_id": "docker-agent",
  "question": "Quiero levantar un contenedor postgres",
  "context": "proyecto: mi-app, entorno: dev"
}
```

El Docker Agent recibe la solicitud, la procesa con su system prompt, y ejecuta las tools correspondientes.

#### Formato de Respuesta (desde Docker Agent)

```json
{
  "status": "ok",
  "data": {
    "container_id": "abc123...",
    "name": "mydb",
    "ports": [{"container": 5432, "host": 5432}],
    "state": "running"
  }
}
```

En caso de error:

```json
{
  "status": "error",
  "error": {
    "code": "CONTAINER_CREATE_FAILED",
    "message": "No se pudo crear el contenedor: port 5432 already in use",
    "details": {}
  }
}
```

### Tools Registry

Cada tool es una `ToolDefinition` registrada en el `ToolRegistry` del AgentEngine.

| Tool Name | Descripción | Parámetros Clave |
|---|---|---|
| `container.create` | Crear y arrancar un contenedor | image, name?, ports?, env?, volumes?, network?, command? |
| `container.exec` | Ejecutar comando en contenedor existente | containerId, command, timeout? |
| `container.stop` | Detener un contenedor | containerId, timeout? |
| `container.remove` | Eliminar un contenedor | containerId, force?, removeVolumes? |
| `container.logs` | Obtener logs de un contenedor | containerId, tail?, since? |
| `container.inspect` | Obtener estado detallado | containerId |
| `compose.up` | Levantar servicios Compose | composeFile?, services?, detach? |
| `compose.down` | Detener y eliminar servicios Compose | composeFile?, volumes?, services? |
| `compose.build` | Construir imágenes del compose | composeFile?, services? |
| `compose.logs` | Obtener logs de servicios Compose | composeFile?, services?, tail? |
| `compose.ps` | Listar servicios del compose | composeFile? |
| `system.prune` | Limpiar recursos no usados | containers?, images?, volumes?, networks? |
| `system.info` | Información del daemon Docker | — |

## Data Models

### ContainerSpec

```typescript
interface ContainerSpec {
  image: string;                          // Requerido: imagen Docker (ej: "postgres:16")
  name?: string;                          // Nombre del contenedor
  command?: string | string[];            // Comando a ejecutar
  ports?: Record<string, number | string>; // Mapeo puertos: {"5432/tcp": 5432}
  env?: Record<string, string>;           // Variables de entorno
  volumes?: string[];                     // Volúmenes: ["src:dst", "named:/path"]
  network?: string;                       // Red Docker
  labels?: Record<string, string>;        // Etiquetas para metadata
  restartPolicy?: string;                 // "no", "always", "on-failure", "unless-stopped"
  detach?: boolean;                       // Por defecto true
}
```

### ComposeSpec

```typescript
interface ComposeSpec {
  composeFile?: string | null;            // Ruta al archivo YAML. null = usar template por defecto
  services?: string[];                    // Servicios específicos (omisión = todos)
  detach?: boolean;                       // Por defecto true
  build?: boolean;                        // Reconstruir imágenes antes de up
  removeOrphans?: boolean;                // Eliminar servicios no definidos en el compose
}
```

### ContainerInfo

```typescript
interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;                          // "running", "exited", "paused", etc.
  status: string;                         // "Up 2 hours", "Exited (0)", etc.
  ports: PortMapping[];
  created: Date;
  labels: Record<string, string>;
  networkSettings: Record<string, unknown>;
}

interface PortMapping {
  containerPort: number;
  hostPort: number | null;
  protocol: string;                       // "tcp" o "udp"
}
```

### ComposeServiceInfo

```typescript
interface ComposeServiceInfo {
  name: string;
  containerId: string;
  state: string;
  ports: PortMapping[];
  health: string | null;                  // "healthy", "unhealthy", null
}
```

### ExecResult

```typescript
interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  containerId: string;
}
```

## Business Logic

### Flujo 1: Levantar entorno de desarrollo

```
1. Recibir solicitud con servicios requeridos (postgres, redis, etc.)
2. Si se especifica un composeFile → usarlo
3. Si no → seleccionar template de compose-files/ según los servicios
4. Ejecutar `docker compose up -d` con el archivo seleccionado
5. Esperar healthchecks (hasta timeout configurable, por defecto 60s)
6. Recopilar información de cada servicio (puertos, estado)
7. Devolver respuesta con servicios y sus conexiones
```

### Flujo 2: Ejecutar comando en contenedor

```
1. Recibir containerId y comando a ejecutar
2. Verificar que el contenedor existe y está running
3. Ejecutar `docker exec` con el comando vía dockerode
4. Capturar stdout, stderr y exit code
5. Si timeout → matar el proceso y devolver error
6. Devolver ExecResult
```

### Flujo 3: Limpieza de recursos

```
1. Recibir solicitud de limpieza (con filtros opcionales)
2. Si compose → ejecutar `docker compose down -v` (elimina volúmenes)
3. Si prune containers → eliminar contenedores stopped
4. Si prune images → `docker image prune -a`
5. Si prune volumes → `docker volume prune`
6. Si prune networks → `docker network prune`
7. Devolver resumen de recursos liberados
```

### Resolución de nombres de contenedor

- Si el agente solicitante pasa un nombre, se busca por nombre exacto
- Si no se encuentra, se busca por prefijo (containers cuyo nombre empiece con el string)
- Si hay múltiples coincidencias, se devuelve error con la lista de candidatos
- El agente solicitante puede pasar containerId directamente (UUID)

## Error Handling

### Jerarquía de errores

```
DockerAgentError (base class)
├── ContainerError
│   ├── ContainerNotFoundError
│   ├── ContainerNotRunningError
│   ├── ContainerCreateError
│   └── ContainerExecError
├── ComposeError
│   ├── ComposeFileNotFoundError
│   ├── ComposeServiceError
│   └── ComposeTimeoutError
├── DockerConnectionError      // Daemon no accesible
├── DockerPermissionError      // Sin permisos para la operación
└── DockerTimeoutError         // Operación excedió el tiempo límite
```

### Códigos de error estándar

| Código | Significado | HTTP-like |
|---|---|---|
| `CONTAINER_NOT_FOUND` | Contenedor no existe | 404 |
| `CONTAINER_NOT_RUNNING` | Contenedor existe pero no está running | 409 |
| `CONTAINER_CREATE_FAILED` | Error al crear contenedor (puerto ocupado, imagen no encontrada) | 400 |
| `COMPOSE_FILE_NOT_FOUND` | Archivo compose YAML no existe | 404 |
| `COMPOSE_COMMAND_FAILED` | Error al ejecutar comando compose | 500 |
| `DOCKER_DAEMON_UNREACHABLE` | No se puede conectar al daemon Docker | 503 |
| `EXEC_TIMEOUT` | Comando excedió el tiempo límite | 408 |
| `INVALID_PARAMS` | Parámetros de entrada inválidos | 400 |

### Timeouts

| Operación | Timeout por defecto | Configurable |
|---|---|---|
| `container.create` | 120s | Sí |
| `container.exec` | 30s | Sí (por llamada) |
| `compose.up` | 300s | Sí |
| `compose.down` | 60s | Sí |
| `system.prune` | 120s | No |
