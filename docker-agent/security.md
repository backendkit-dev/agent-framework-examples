# Security Document — Docker Agent

> Generado por el Project Manager durante el flujo de init.
> Fecha: 2026-06-01

## Threat Model

### Assets Protegidos

| Asset | Descripción | Criticidad |
|---|---|---|
| Docker Daemon socket | Acceso al socket Unix `/var/run/docker.sock` | Alta |
| Contenedores en ejecución | Procesos con acceso a red y sistema de archivos | Alta |
| Volúmenes Docker | Datos persistentes de bases de datos y servicios | Alta |
| Redes Docker | Aislamiento de red entre contenedores | Media |
| Imágenes Docker | Código y configuraciones empaquetadas | Media |
| Configuración del agente | Variables de entorno con credenciales | Alta |

### Threat Actors

| Actor | Motivación | Capacidad |
|---|---|---|
| Agente solicitante malicioso | Ejecutar comandos arbitrarios en contenedores | Media — solo puede usar las tools expuestas |
| Atacante externo | Escapar del contenedor, acceder al host | Baja — el agente corre en entorno controlado |
| Usuario no autorizado | Acceder a datos de otros proyectos | Media — si comparte el mismo daemon Docker |

### Threat Scenarios

| ID | Amenaza | Impacto | Probabilidad | Mitigación |
|---|---|---|---|---|
| T-01 | Inyección de comandos vía parámetros de tools | Alto | Media | Validación estricta de parámetros, escape de shell en subprocess |
| T-02 | Acceso no autorizado al socket Docker | Alto | Baja | El agente solo se comunica vía backendkit, no expone socket directamente |
| T-03 | Container escape desde contenedor malicioso | Alto | Baja | El agente no ejecuta imágenes no verificadas; solo imágenes públicas conocidas |
| T-04 | Denegación de servicio (crear contenedores infinitos) | Medio | Media | Límite de contenedores por sesión, timeout en operaciones |
| T-05 | Exposición de secretos en logs/env | Alto | Media | Sanitizar logs, no loguear variables de entorno completas |
| T-06 | Mount de directorios sensibles del host | Alto | Media | Restringir volúmenes montables a una lista blanca de paths |

## Auth Design

### Modelo de Autenticación

El Docker Agent no implementa autenticación propia. La autenticación es responsabilidad del backendkit-agent-framework, que provee:

- Identificación del agente solicitante (agent_id único)
- Verificación de que el agente está registrado en el sistema
- Firma de mensajes entre agentes (si el framework lo soporta)

### Modelo de Autorización

Para la fase Beta, se implementa un modelo simple basado en **lista blanca de agentes**:

```python
# config.py
ALLOWED_REQUESTER_AGENTS: list[str] = [
    "backend-agent",
    "frontend-agent",
    "data-agent",
    "devops-agent",
]
```

Si un agente no está en la lista blanca, la tool devuelve:

```json
{
  "status": "error",
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Agent 'unknown-agent' is not authorized to use Docker Agent"
  }
}
```

### Permisos por Tool (fase Beta)

| Tool | Agentes Permitidos |
|---|---|
| `container.create` | backend, frontend, data, devops |
| `container.exec` | backend, devops |
| `container.stop` | backend, devops |
| `container.remove` | devops |
| `container.logs` | backend, frontend, data, devops |
| `container.inspect` | backend, frontend, data, devops |
| `compose.up` | backend, devops |
| `compose.down` | devops |
| `compose.logs` | backend, frontend, data, devops |
| `compose.ps` | backend, frontend, data, devops |
| `system.prune` | devops |
| `system.info` | backend, frontend, data, devops |

### Principio de Mínimo Privilegio

- Cada tool solo expone los parámetros estrictamente necesarios
- No se permite `privileged=True` ni `cap_add` en contenedores
- Los volúmenes montados se restringen a paths predefinidos
- No se permite bind mount de `/var/run/docker.sock` dentro de contenedores creados por el agente

## OWASP Checklist

### A01 — Broken Access Control
- [x] Lista blanca de agentes solicitantes
- [x] Permisos granulares por tool
- [ ] ~~RBAC completo~~ (pospuesto para fase GA)
- [ ] ~~Audit logging de todas las operaciones~~ (pospuesto para fase GA)

### A02 — Cryptographic Failures
- [x] No se almacenan credenciales en el agente
- [x] Las variables de entorno sensibles se pasan directamente a Docker, no se persisten
- [ ] ~~Cifrado de datos en tránsito entre agentes~~ (responsabilidad del framework)

### A03 — Injection
- [x] Validación de parámetros de tools (tipos, rangos, formatos)
- [x] Escape de shell en subprocess (uso de `shlex.quote()`)
- [x] No se permite `eval` ni `exec` de strings arbitrarios
- [x] Los comandos de `container.exec` se pasan como lista, no como string

### A04 — Insecure Design
- [x] Timeouts en todas las operaciones
- [x] Límite de contenedores concurrentes por agente solicitante
- [x] No se permite modo privilegiado en contenedores

### A05 — Security Misconfiguration
- [x] Configuración vía environment variables con valores por defecto seguros
- [x] El socket Docker se conecta por defecto a `unix:///var/run/docker.sock`
- [ ] ~~Healthcheck de configuración al arrancar~~ (pospuesto)

### A06 — Vulnerable and Outdated Components
- [x] Dependencias fijadas en `pyproject.toml` con versiones exactas
- [x] Docker SDK versión estable (docker-py >= 7.0)
- [ ] ~~Escaneo automático de vulnerabilidades en dependencias~~ (pospuesto para CI)

### A07 — Identification and Authentication Failures
- [x] Identificación del agente solicitante vía backendkit framework
- [ ] ~~Autenticación mutua entre agentes~~ (depende del framework)

### A08 — Software and Data Integrity Failures
- [x] Las imágenes Docker se tiran con digest o tag fijo (no `latest`)
- [x] Los templates de compose-files/ están versionados en el repo

### A09 — Security Logging and Monitoring Failures
- [ ] ~~Logs estructurados de todas las operaciones~~ (pospuesto para GA)
- [ ] ~~Alertas en caso de errores repetidos~~ (pospuesto)

### A10 — Server-Side Request Forgery (SSRF)
- [x] El agente solo se conecta al socket Docker local
- [x] No se permiten URLs arbitrarias en parámetros de tools

## Security Requirements

### Funcionales

| ID | Requisito | Prioridad |
|---|---|---|
| SEC-F-01 | El agente debe validar que el agente solicitante está en la lista blanca antes de ejecutar cualquier tool | Alta |
| SEC-F-02 | El agente debe rechazar parámetros que contengan caracteres de shell no permitidos | Alta |
| SEC-F-03 | El agente debe limitar el número de contenedores concurrentes por agente solicitante (por defecto: 5) | Media |
| SEC-F-04 | El agente debe sanitizar logs para no exponer variables de entorno | Alta |
| SEC-F-05 | El agente debe rechazar monturas de volúmenes que accedan a paths sensibles del host (`/etc`, `/var/run`, `/proc`, `/sys`) | Alta |

### No Funcionales

| ID | Requisito | Prioridad |
|---|---|---|
| SEC-NF-01 | Todas las operaciones deben tener un timeout configurable | Alta |
| SEC-NF-02 | El agente debe registrar intentos de acceso no autorizados | Media |
| SEC-NF-03 | Las dependencias deben escanearse con `pip-audit` o similar en CI | Media |
| SEC-NF-04 | El socket Docker debe conectarse por defecto vía Unix socket (no TCP) | Alta |

### Configuración Segura por Defecto

```python
# Valores por defecto en config.py
DOCKER_SOCKET = "unix:///var/run/docker.sock"  # No TCP
MAX_CONTAINERS_PER_AGENT = 5
EXEC_TIMEOUT_SECONDS = 30
COMPOSE_UP_TIMEOUT_SECONDS = 300
ALLOWED_BIND_PATHS = ["./data", "./tmp"]       # Solo subdirectorios del proyecto
BLOCKED_BIND_PATHS = ["/etc", "/var/run", "/proc", "/sys", "/dev"]
```
