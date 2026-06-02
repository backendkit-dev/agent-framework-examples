# Roadmap — Docker Agent

> Generado por el Project Manager durante el flujo de init.
> Fecha: 2026-06-01

## Phase 1 — MVP (Core Tools + Contenedores Individuales)

**Objetivo**: Implementar las tools base para crear, ejecutar, inspeccionar y eliminar contenedores individuales. El agente puede recibir solicitudes de otros agentes y operar sobre contenedores Docker.

### Entregables

- [ ] Proyecto Node.js/TypeScript configurado con package.json, tsconfig, Biome/ESLint, Jest
- [ ] DockerAgentProfile registrado en AgentRegistry (id: "docker-agent")
- [ ] Tool `container.create` — crear y arrancar contenedores vía dockerode
- [ ] Tool `container.exec` — ejecutar comandos en contenedores
- [ ] Tool `container.stop` — detener contenedores
- [ ] Tool `container.remove` — eliminar contenedores
- [ ] Tool `container.logs` — obtener logs
- [ ] Tool `container.inspect` — estado detallado
- [ ] Tool `system.info` — información del daemon
- [ ] Wrapper `docker/client.ts` sobre dockerode (singleton)
- [ ] Manejo de errores básico (ContainerNotFoundError, DockerConnectionError)
- [ ] Tests de integración con testcontainers-node (al menos 1 contenedor real)
- [ ] Lista blanca de agentes solicitantes (config vía env)

### Definition of Done

- [ ] Todas las tools de contenedor individual funcionan contra un daemon Docker real
- [ ] `container.exec` captura stdout, stderr y exit code correctamente
- [ ] Los errores de Docker se traducen a códigos de error del framework
- [ ] Test de integración: crear contenedor → exec → logs → stop → remove
- [ ] Cobertura de tests > 70%

### Tiempo estimado: 2 semanas

## Phase 2 — Docker Compose + Entornos Multi-Servicio

**Objetivo**: Soportar entornos multi-servicio con Docker Compose. El agente puede levantar entornos completos (postgres + redis, mysql + rabbitmq, etc.) con un solo comando.

### Entregables

- [ ] Tool `compose.up` — levantar servicios desde compose file o template
- [ ] Tool `compose.down` — detener y limpiar servicios
- [ ] Tool `compose.build` — construir imágenes del compose
- [ ] Tool `compose.logs` — obtener logs de servicios
- [ ] Tool `compose.ps` — listar servicios del compose
- [ ] Tool `system.prune` — limpiar recursos no usados
- [ ] Templates de compose en `compose-files/` (postgres-redis, mysql-rabbitmq, mongodb-elasticsearch)
- [ ] Selección automática de template según servicios solicitados
- [ ] Healthcheck y espera de servicios (timeout configurable)
- [ ] Tests de integración con compose real

### Definition of Done

- [ ] `compose.up` levanta un entorno multi-servicio desde template
- [ ] `compose.down` limpia todos los recursos (contenedores, redes, volúmenes)
- [ ] Los healthchecks se esperan correctamente antes de devolver respuesta
- [ ] Tests de integración con docker compose real

### Tiempo estimado: 2 semanas

## Phase 3 — Robustez, Seguridad y Observabilidad

**Objetivo**: Endurecer el agente para producción: seguridad, logging, manejo de errores avanzado, y documentación completa.

### Entregables

- [ ] Implementar lista blanca de agentes (solo agentes autorizados pueden invocar tools)
- [ ] Rate limiting por agente solicitante
- [ ] Logging estructurado (pino o winston) con niveles debug/info/warn/error
- [ ] Timeouts configurables por operación
- [ ] Manejo de errores completo (todos los códigos de error)
- [ ] Documentación de la interfaz entre agentes (formato request/response)
- [ ] README.md completo con ejemplos de uso
- [ ] Revisión de seguridad (OWASP top 10 aplicable a Docker)
- [ ] Pruebas de estrés: 10+ contenedores concurrentes

### Definition of Done

- [ ] La lista blanca de agentes funciona y rechaza agentes no autorizados
- [ ] Todos los errores tienen códigos y mensajes claros
- [ ] README.md documenta todas las tools con ejemplos
- [ ] Las pruebas de estrés pasan sin errores

### Tiempo estimado: 2 semanas
