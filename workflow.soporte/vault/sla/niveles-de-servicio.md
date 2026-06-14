---
title: Niveles de Servicio (SLA)
tags: [sla, prioridad, tiempos, soporte, acuerdo]
description: Definición de prioridades, tiempos de respuesta y resolución por plan y tier de soporte
---

# Niveles de Servicio (SLA)

## Definición de Prioridades

### P1 — Crítico
**Definición:** Sistema o servicio completamente caído. Sin workaround disponible. Impacto en producción.

**Ejemplos:**
- Plataforma inaccesible para todos o gran parte de los usuarios
- Pérdida de datos en producción
- Brecha de seguridad activa
- Funcionalidad de pago o facturación no disponible

### P2 — Alto
**Definición:** Funcionalidad core degradada. Hay workaround pero es significativamente limitante.

**Ejemplos:**
- Módulo principal con rendimiento muy degradado (> 5x más lento de lo normal)
- Feature crítica del negocio no disponible para un segmento de usuarios
- Integraciones clave caídas (pagos, autenticación)

### P3 — Medio
**Definición:** Bug o problema que afecta una feature no crítica. Hay workaround razonable.

**Ejemplos:**
- Error en un reporte o export que tiene alternativa
- UI con comportamiento incorrecto pero funcional
- Notificaciones no enviándose pero datos disponibles en la plataforma

### P4 — Bajo
**Definición:** Consulta, mejora sugerida, cosmético o comportamiento no esperado sin impacto operativo.

**Ejemplos:**
- Pregunta de "cómo hacer X"
- Solicitud de nueva funcionalidad
- Texto o label incorrecto en la interfaz

---

## Tiempos de Respuesta y Resolución por Plan

### Plan Enterprise

| Prioridad | Primera respuesta | Actualización de progreso | Resolución objetivo |
|-----------|-------------------|--------------------------|---------------------|
| P1 | 15 minutos | Cada 30 minutos | 4 horas |
| P2 | 1 hora | Cada 2 horas | 8 horas hábiles |
| P3 | 4 horas hábiles | Diaria si está abierto | 3 días hábiles |
| P4 | 1 día hábil | Semanal | 10 días hábiles |

**Horario de cobertura P1/P2:** 24/7/365

### Plan Professional

| Prioridad | Primera respuesta | Resolución objetivo |
|-----------|-------------------|---------------------|
| P1 | 1 hora | 8 horas hábiles |
| P2 | 4 horas hábiles | 2 días hábiles |
| P3 | 1 día hábil | 5 días hábiles |
| P4 | 2 días hábiles | 15 días hábiles |

**Horario de cobertura:** Lunes a viernes 9:00-18:00 (zona horaria del cliente)

### Plan Starter

| Prioridad | Primera respuesta | Resolución objetivo |
|-----------|-------------------|---------------------|
| P1 | 4 horas hábiles | 2 días hábiles |
| P2 | 1 día hábil | 5 días hábiles |
| P3 | 2 días hábiles | 10 días hábiles |
| P4 | 5 días hábiles | Best effort |

**Horario de cobertura:** Lunes a viernes 9:00-18:00 ART

---

## Cómputo del SLA

- El reloj del SLA **empieza cuando el ticket se recibe**, no cuando es asignado
- El SLA se **pausa** cuando esperamos información del cliente (estado: "Esperando cliente")
- El SLA se **reanuda** cuando el cliente responde
- El SLA **se cumple** cuando el cliente confirma resolución o cuando han pasado 48hs sin respuesta tras nuestra solución
- Los **días feriados** del país del cliente no cuentan en planes Professional y Starter (sí cuentan en Enterprise P1/P2)

---

## Escalación por Incumplimiento de SLA

Si el SLA está en riesgo (>75% del tiempo consumido sin resolución):
1. Notificar al Team Lead de Soporte
2. Escalar automáticamente a L2 si está en L1
3. Notificar proactivamente al cliente con actualización de estado y nuevo ETA

Si el SLA se incumple:
1. Notificar al Director de Customer Success
2. Registrar el breach en el sistema de métricas
3. Analizar en la reunión semanal de soporte
4. Evaluar compensación según política de créditos
