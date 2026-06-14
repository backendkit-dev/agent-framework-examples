---
title: Proceso de Manejo de Tickets de Soporte
tags: [proceso, tickets, atencion, workflow, l1, l2, l3]
description: Guía completa del proceso de atención desde la recepción hasta el cierre del ticket
---

# Proceso de Manejo de Tickets

## Ciclo de vida de un ticket

```
NUEVO → EN_TRIAGE → EN_ATENCIÓN → ESPERANDO_CLIENTE → RESUELTO → CERRADO
                          ↓
                    ESCALADO_L2 → ESCALADO_L3 → RESUELTO
```

### Estados y sus significados

| Estado | Significado | Quién puede cambiarlo |
|--------|-------------|----------------------|
| NUEVO | Ticket recibido, sin asignar | Sistema (automático) |
| EN_TRIAGE | Siendo clasificado por triage-agent | Sistema / L1 |
| EN_ATENCIÓN | Asignado y trabajando activamente | L1, L2, L3 |
| ESPERANDO_CLIENTE | Pedimos info, esperamos respuesta | L1, L2 |
| ESCALADO_L2 | Requiere investigación técnica | L1 |
| ESCALADO_L3 | Requiere ingeniería o es incidente crítico | L2 |
| RESUELTO | Solución entregada, pendiente confirmación del cliente | L1, L2, L3 |
| CERRADO | Confirmado resuelto o 48hs sin respuesta tras resolución | Sistema / cliente |

---

## Canales de entrada y prioridad default

| Canal | Prioridad default | Notas |
|-------|------------------|-------|
| Teléfono de emergencias | P1 automático | Solo Enterprise, fuera de horario |
| Chat en vivo | P2 | Si el cliente dice que es urgente |
| Email directo al CS Manager | P2 | Escalar a L2 inmediato |
| Portal de soporte | Según formulario | El cliente selecciona la prioridad |
| Email de soporte general | P3 | Default para consultas |
| Redes sociales | P3 | Mover al portal oficial |

---

## Cuándo escalar a L2

Escalar inmediatamente a L2 cuando:
- El issue requiere acceso a logs del servidor o base de datos
- La solución de KB no funcionó después de 2 intentos documentados
- El cliente reporta pérdida de datos (aunque sea parcial)
- El bug no está documentado y no hay workaround conocido
- El cliente tiene plan Enterprise y lleva más de 1 hora sin solución para P2

**Al escalar a L2:** incluir siempre en el ticket:
1. Pasos ya intentados y sus resultados
2. Información del entorno del cliente (versión, OS, navegador, etc.)
3. Mensajes de error completos (no solo capturas de pantalla)
4. Horario en que el cliente puede ser contactado

---

## Cuándo escalar a L3 / activar protocolo de incidente

Activar el protocolo de incidente crítico cuando:
- El issue afecta a más de 1 cliente simultáneamente con el mismo síntoma
- Hay pérdida de datos confirmada o sospechada
- El sistema está completamente caído (no solo degradado)
- El issue tiene potencial impacto en seguridad
- L2 lleva más de 2 horas sin encontrar el root cause en un P1

---

## Buenas prácticas de atención

### Apertura del ticket
- Responder siempre dentro del SLA aunque no tengamos solución
- Si necesitamos tiempo para investigar, confirmarlo: "Recibimos tu ticket, estamos investigando y te respondemos en [tiempo]"
- No decir "revisaremos tu caso" sin un tiempo concreto

### Durante la investigación
- Actualizar el ticket con cada hallazgo aunque no sea la solución
- Si el cliente pregunta el estado, responder en menos de 1 hora durante horario hábil
- Si el SLA está por vencerse, notificar proactivamente con un nuevo ETA

### Cierre del ticket
- Siempre preguntar si la solución resolvió el problema antes de cerrar
- Esperar 48 horas la respuesta del cliente tras marcar como RESUELTO
- Incluir siempre un resumen de qué pasó y cómo se resolvió (útil para la KB)
- Invitar a completar la encuesta de satisfacción

---

## Métricas de calidad

| Métrica | Objetivo | Crítico |
|---------|----------|---------|
| First Response Time (FRT) | Dentro del SLA 95% de los tickets | < 90% |
| Resolution Time | Dentro del SLA 85% de los tickets | < 75% |
| CSAT (Customer Satisfaction) | > 4.2 / 5.0 promedio mensual | < 3.8 |
| First Contact Resolution (FCR) | > 70% de tickets L1 | < 60% |
| Reapertura de tickets | < 5% | > 10% |
