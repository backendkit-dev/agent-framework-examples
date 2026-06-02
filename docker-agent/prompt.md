# Docker Agent — Agente Inteligente para Infraestructura Docker

## Purpose / Objetivo

Crear un agente inteligente que otros agentes del sistema puedan invocar para gestionar infraestructura Docker. Este agente debe ser capaz de crear, ejecutar y desplegar contenedores, servicios y entornos completos usando Docker y Docker Compose, exponiendo una interfaz clara y reutilizable para otros agentes.

Resuelve el problema de que los agentes especializados (backend, frontend, data, etc.) no tengan acceso directo a comandos Docker ni conocimiento de infraestructura, centralizando toda la interacción con Docker en un único agente experto.

## Core Features

- **Creación de contenedores**: Levantar contenedores Docker a partir de imágenes públicas o personalizadas.
- **Gestión de Docker Compose**: Ejecutar `docker-compose up`, `down`, `build`, `logs`, `ps` y otros comandos esenciales.
- **Despliegue de infraestructura**: Montar entornos multi-servicio (bases de datos, cachés, colas, APIs) con un solo comando.
- **Inspección y diagnóstico**: Obtener logs, estado de contenedores, redes, volúmenes y recursos.
- **Limpieza y reciclaje**: Eliminar contenedores, imágenes, volúmenes y redes no utilizados.
- **Interfaz para agentes**: Exponer una API o protocolo de comunicación para que otros agentes soliciten operaciones Docker sin ejecutar comandos directamente.

## Out of Scope (v1)

- Orquestación Kubernetes (k8s) — solo Docker nativo y Docker Compose.
- Despliegue en producción real (cloud providers) — solo entornos locales y de desarrollo.
- Monitoreo y alerting avanzado (Prometheus, Grafana).
- Construcción de imágenes Docker personalizadas desde cero (solo uso de Dockerfiles existentes o imágenes públicas).
- Seguridad avanzada de contenedores (escaneo de vulnerabilidades, políticas de red complejas).

## Tech Stack

- **Lenguaje**: Python 3.11+ o TypeScript (según el ecosistema del framework de agentes)
- **Framework de agentes**: `backendkit-agent-framework` — librería open-source en [GitHub](https://github.com/BackendKit-labs/backendkit-agent-framework)
- **Docker SDK**: `docker-py` (Python) o `dockerode` (Node.js) para interactuar con el daemon de Docker mediante API
- **Docker Compose**: Subprocesos para ejecutar comandos `docker compose` directamente
- **CLI wrapper**: Subprocess con parsing de salida para comandos Docker no cubiertos por SDK
- **Testing**: Pytest (Python) o Jest (TypeScript) con testcontainers para integración real

## Users & Roles

| Actor | Descripción | Permisos |
|---|---|---|
| **Agente solicitante** | Otro agente del sistema (backend, frontend, data, etc.) | Solicitar operaciones Docker vía interfaz definida |
| **Administrador del sistema** | Desarrollador humano que configura el agente | Definir redes, volúmenes, límites de recursos |
| **Docker Agent** | El agente mismo | Ejecutar comandos Docker, gestionar ciclo de vida de contenedores |

## Key Flows

### Flow 1: Levantar un entorno de desarrollo

1. Agente solicitante envía petición: `"levantar postgres + redis para proyecto X"`
2. Docker Agent recibe la solicitud y parsea los servicios requeridos
3. Busca o genera un `docker-compose.yml` adecuado
4. Ejecuta `docker compose up -d`
5. Espera a que los servicios estén saludables (healthcheck)
6. Devuelve al agente solicitante: `{ status: "ok", services: [{ name: "postgres", port: 5432 }, { name: "redis", port: 6379 }] }`

### Flow 2: Ejecutar un comando dentro de un contenedor

1. Agente solicitante envía: `"ejecutar npm test en contenedor app"`
2. Docker Agent localiza el contenedor por nombre o etiqueta
3. Ejecuta `docker exec <container_id> npm test`
4. Captura stdout/stderr y código de salida
5. Devuelve resultado al agente solicitante

### Flow 3: Limpieza de recursos

1. Agente solicitante envía: `"limpiar entorno de desarrollo"`
2. Docker Agent ejecuta `docker compose down -v` (elimina volúmenes)
3. Opcional: elimina imágenes no utilizadas con `docker image prune -a`
4. Confirma la limpieza al agente solicitante

## Definition of Done

- [ ] El agente puede recibir una solicitud de otro agente y ejecutar una operación Docker exitosamente.
- [ ] Soporta los comandos esenciales: `up`, `down`, `build`, `logs`, `ps`, `exec`, `prune`.
- [ ] Los errores de Docker se capturan y devuelven con mensajes claros al agente solicitante.
- [ ] El agente funciona con `docker-py` o `dockerode` como SDK principal.
- [ ] Existe al menos un test de integración que levanta un contenedor real y verifica su estado.
- [ ] La documentación de la interfaz entre agentes está definida (formato de solicitud/respuesta).
- [ ] El código sigue las convenciones del framework de agentes y está en el directorio correspondiente.
