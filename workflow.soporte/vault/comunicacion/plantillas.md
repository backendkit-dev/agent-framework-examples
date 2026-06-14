---
title: Plantillas de Comunicación con Clientes
tags: [plantillas, comunicacion, email, respuesta, cierre, escalacion, empatia]
description: Templates reutilizables para las situaciones más frecuentes de soporte
---

# Plantillas de Comunicación con Clientes

Usar estas plantillas como base y personalizar siempre con el nombre del cliente
y los detalles específicos del caso. Una respuesta genérica es peor que una tardía.

---

## Respuesta inicial — Acuse de recibo

```
Asunto: Re: [Asunto original] — Ticket #[ID]

Hola [Nombre],

Recibimos tu ticket y ya lo tenemos en cola.

Prioridad asignada: [P1/P2/P3/P4]
Tiempo estimado de primera respuesta: [X horas/minutos]

[Si es P1/P2]: Un miembro de nuestro equipo se está asignando ahora mismo a este caso.

[Si necesitamos info adicional]: Para poder ayudarte más rápido, ¿podrías enviarnos:
- [dato específico 1]
- [dato específico 2]

Seguimos en contacto.

[Nombre del agente]
Equipo de Soporte
```

---

## Respuesta con solución — L1

```
Asunto: Re: [Asunto original] — Ticket #[ID] [Resuelto]

Hola [Nombre],

Investigamos el problema que reportaste y encontramos la causa.

**¿Qué estaba pasando?**
[Explicación breve en términos del cliente, sin jerga técnica]

**Cómo resolverlo:**
1. [Paso 1]
2. [Paso 2]
3. [Paso 3]

**Cómo verificar que funciona:**
[Describir qué debe ver el cliente si la solución funcionó]

Si seguís teniendo problemas o la solución no funciona en tu caso, respondé a este email
y lo revisamos juntos.

[Nombre del agente]
Equipo de Soporte
```

---

## Escalación a L2 — Notificación al cliente

```
Asunto: Re: [Asunto original] — Ticket #[ID] [Actualización]

Hola [Nombre],

Quisimos darte una actualización sobre tu caso.

Revisamos el problema y determinamos que requiere una investigación técnica más profunda
por parte de nuestro equipo de ingeniería de soporte.

**Próximo paso:** Un técnico especializado tomará el caso.
**Tiempo estimado de respuesta:** [según SLA del plan]

Mientras tanto, [si hay workaround: "podés usar este workaround temporal: [descripción]"].

Te mantendremos informado de cada avance.

[Nombre del agente]
Equipo de Soporte
```

---

## Pedido de información adicional

```
Asunto: Re: [Asunto original] — Ticket #[ID] [Necesitamos más info]

Hola [Nombre],

Estamos investigando el problema. Para poder reproducirlo y encontrar la solución
más rápido, necesitamos que nos ayudes con esta información:

1. **[Dato específico 1]:** [explicar por qué lo necesitamos si no es obvio]
2. **[Dato específico 2]:** [explicar por qué]
3. **Pasos exactos para reproducir el problema:** [si no los tenemos]

[Opcional: "Podés enviarnos capturas de pantalla o los logs de la consola del navegador
(F12 → Console) si hay errores visibles."]

Una vez que tengamos esta info, continuamos la investigación de inmediato.

[Nombre del agente]
Equipo de Soporte
```

---

## Actualización de incidente — Status update (template periódico)

```
Asunto: [INCIDENTE #ID] Actualización de estado — [HH:MM]

Hola [Nombre / Lista de clientes afectados],

Les compartimos una actualización del incidente que está afectando [descripción breve].

**Estado actual:** [Investigando / Identificada la causa / Aplicando fix / En monitoreo]

**Qué hicimos desde la última actualización:**
- [Acción 1]
- [Acción 2]

**Próximos pasos:**
- [Paso 1] — responsable: [rol]
- [Paso 2]

**Tiempo estimado de resolución:** [ETA actualizado o "Sin ETA confirmado aún, próxima actualización en X minutos"]

Seguimos trabajando en esto. Próxima actualización: [hora].

[Nombre]
Equipo de Soporte / Operaciones
```

---

## Cierre de ticket

```
Asunto: Re: [Asunto original] — Ticket #[ID] [Cerrado]

Hola [Nombre],

Confirmamos que el problema fue resuelto y cerramos el ticket.

**Resumen de lo que pasó:**
[2-3 líneas explicando el issue y la causa]

**Cómo lo resolvimos:**
[1-2 líneas con la solución aplicada]

**Para que no vuelva a ocurrir:**
[Si aplica: qué cambió o qué puede hacer el cliente para evitarlo]

Si el problema vuelve a aparecer o tenés alguna pregunta adicional, respondé a este email
y reabrimos el caso de inmediato.

¿Pudimos ayudarte bien? Nos ayudaría mucho conocer tu opinión: [link encuesta CSAT]

[Nombre del agente]
Equipo de Soporte
```

---

## Comunicado de apertura de incidente (público / status page)

```
**[INCIDENTE] Problemas con [nombre del servicio/módulo]**
[Fecha] — [HH:MM] (UTC-3)

Estamos investigando un problema que afecta a [descripción del impacto al usuario].
Los usuarios pueden experimentar [síntomas concretos: errores, lentitud, etc.].

Nuestro equipo está trabajando activamente en la resolución.
Próxima actualización: [hora].
```

---

## Comunicado de cierre de incidente (público / status page)

```
**[RESUELTO] Incidente en [nombre del servicio/módulo]**
[Fecha] — [HH:MM] (UTC-3)

El incidente fue resuelto a las [hora]. El servicio está funcionando con normalidad.

**Duración total:** [X horas Y minutos]
**Clientes afectados:** [descripción sin números exactos si es sensible]

**Qué pasó:** [Descripción técnica accesible, sin exponer vulnerabilidades]

**Qué hicimos:** [Acciones de resolución]

**Para que no vuelva a ocurrir:** [Medidas preventivas]

Pedimos disculpas por el inconveniente. Estamos comprometidos con [uptime objetivo].
Si tenés preguntas, contactá a soporte: [email/portal].
```
