---
title: Protocolo de Escalación
tags: [escalacion, l1, l2, l3, incidente, protocolo, guardia]
description: Cuándo y cómo escalar tickets e incidentes, con responsables y canales
---

# Protocolo de Escalación

## Niveles de escalación

### L1 → L2: Escalación Técnica

**Cuándo:** ver criterios en manejo-de-tickets.md

**Cómo:**
1. Actualizar el ticket con todo el contexto recopilado
2. Cambiar estado a ESCALADO_L2
3. Asignar al equipo técnico (o al técnico de guardia si es P1/P2)
4. Notificar al cliente: "Escalamos tu caso a nuestro equipo técnico especializado. Te contactaremos en [tiempo según SLA]"
5. Hacer handoff verbal (Slack/Teams) para P1/P2

**Información obligatoria en el handoff:**
- Resumen del problema en 3 líneas
- Pasos ya intentados y resultados
- Información del entorno del cliente
- Historial de tickets relacionados del mismo cliente
- Nivel de urgencia y SLA restante

---

### L2 → L3: Escalación a Ingeniería

**Cuándo:**
- Bug confirmado en el código (no configuración)
- Requiere acceso a producción con permisos de ingeniería
- Issue de seguridad de cualquier tipo
- Pérdida de datos confirmada
- L2 lleva más de 2 horas sin avance en un P1

**Cómo:**
1. Crear un bug report en el sistema de issues de ingeniería (Jira/Linear/GitHub Issues)
2. Incluir: steps to reproduce, expected vs actual, logs relevantes, impacto al cliente
3. Vincular el bug al ticket de soporte
4. Notificar al Engineering Manager con el bug report
5. Mantener el ticket de soporte abierto y actualizar al cliente
6. No cerrar el ticket hasta que ingeniería confirme el fix deployado

---

### Escalación a Dirección

**Cuándo:**
- Cliente Enterprise amenaza con churn o acciones legales
- SLA incumplido por más de 2x el tiempo prometido
- Incident P1 que afecta a más del 10% de la base de clientes
- Issue de seguridad con posible exposición de datos de clientes
- Segunda reapertura del mismo ticket por el mismo cliente

**Quién notificar:**
- Customer Success Manager (siempre)
- Director de Customer Experience (si es Enterprise o impacto > 5 clientes)
- CEO (solo si hay impacto reputacional, legal o de seguridad significativo)

---

## Guardia de incidentes P1/P2

### Roles en guardia

| Rol | Responsabilidad | Contacto |
|-----|-----------------|----------|
| Ingeniero de Guardia | Diagnóstico técnico y fix | [definir en tu empresa] |
| CS Manager de Guardia | Comunicación con cliente y coordinación | [definir en tu empresa] |
| Engineering Manager | Decisiones de arquitectura o rollback | [definir en tu empresa] |

### Cómo activar la guardia (fuera de horario)
1. Llamar al número de emergencias del Ingeniero de Guardia
2. Si no responde en 5 minutos, llamar al Engineering Manager
3. Abrir el canal de War Room en Slack: `#incident-[fecha]-[descripción-breve]`
4. Invitar a CS Manager, Ingeniero de Guardia, y Engineering Manager

### War Room — reglas
- Un solo responsable de comunicación con el cliente (CS Manager)
- Un solo responsable técnico de coordinar el fix (Ingeniero de Guardia)
- Actualizar el canal cada 15 minutos con estado
- No hacer cambios en producción sin anunciarlo en el canal con al menos 2 minutos de anticipación
- Documentar todo en tiempo real (se usa para el postmortem)

---

## Postmortem

### Cuándo es obligatorio
- Todo incidente P1
- Incidentes P2 que duraron más de 4 horas
- Cualquier incidente donde el SLA fue incumplido significativamente
- Bugs que causaron pérdida de datos aunque sea parcial

### Cuándo realizarlo
- Draft del postmortem: dentro de las 24 horas post-resolución
- Review con el equipo: dentro de los 3 días hábiles post-resolución
- Publicación (versión resumida para clientes): opcional, según impacto y política

### Principio: postmortem blameless
El objetivo es entender los sistemas y procesos, nunca culpar personas.
Preguntar "¿por qué el sistema permitió que esto pasara?" en lugar de "¿quién cometió el error?".
