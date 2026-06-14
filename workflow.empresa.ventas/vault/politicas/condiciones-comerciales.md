---
title: Condiciones Comerciales Estándar
tags: [contratos, clausulas, legal, condiciones, sla, nda]
description: Términos y condiciones estándar para contratos de servicios profesionales
---

# Condiciones Comerciales Estándar

Estas son las condiciones que aplican por defecto en todos los contratos de servicios. El equipo legal puede adaptar cláusulas específicas según el perfil del cliente, pero los límites mínimos aquí establecidos no son negociables sin aprobación de Dirección.

---

## Responsabilidad y Limitación de Daños

### Posición estándar
La responsabilidad máxima de la empresa frente al cliente está limitada al **monto total del contrato** en el período en que ocurrió el incidente.

### Exclusiones de responsabilidad
No somos responsables por:
- Pérdida de datos si el cliente no mantiene backups según las recomendaciones provistas
- Daños indirectos, lucro cesante o pérdida de negocios del cliente
- Fallas causadas por integraciones de terceros fuera de nuestro scope
- Modificaciones realizadas por el cliente o terceros sin nuestra autorización

### Límite mínimo aceptable
Nunca aceptar responsabilidad ilimitada. Si el cliente insiste, escalar a Director Comercial + Legal.

---

## SLA — Niveles de Servicio

### Desarrollo de proyectos
- No aplicamos SLA de disponibilidad en proyectos de desarrollo (no hay "uptime" que garantizar)
- Los SLA de tiempos de respuesta aplican a la etapa de soporte post-launch

### Soporte Tier 1 (Mantenimiento correctivo)
| Prioridad | Definición | Tiempo de respuesta | Tiempo de resolución |
|-----------|-----------|--------------------|--------------------|
| P1 Crítico | Sistema caído o sin funcionar | 2 horas | 8 horas hábiles |
| P2 Alto | Funcionalidad core degradada | 4 horas | 24 horas hábiles |
| P3 Medio | Bug que impacta pero tiene workaround | 8 horas | 72 horas hábiles |
| P4 Bajo | Mejora menor o cosmético | 24 horas | Próximo sprint |

### Soporte Tier 3 (24/7)
- P1: respuesta en 15 minutos, resolución en 2 horas
- Disponibilidad garantizada: 99.5% mensual (permite ~3.6h de downtime/mes)
- **No ofrecer 99.9% o más sin validación del equipo de infraestructura**

### Importante
Los SLA aplican solo a incidentes reportados correctamente por el canal oficial (sistema de tickets). Reportes por WhatsApp, email personal o Slack no inician el conteo de SLA.

---

## Confidencialidad (NDA)

### Alcance del NDA
Toda información intercambiada durante el proceso de venta, propuesta y ejecución del proyecto es confidencial, incluyendo:
- Información técnica, de arquitectura y código fuente
- Datos de negocio, financieros y estratégicos del cliente
- Información de clientes finales del cliente
- Metodologías y procesos propietarios de ambas partes

### Duración
- Durante la vigencia del contrato
- **2 años adicionales** post-terminación del contrato

### Excepciones a la confidencialidad
No aplica NDA a información que:
- Era de dominio público antes del acuerdo
- El receptor desarrolló independientemente sin acceso a la información confidencial
- Fue compartida por un tercero legítimamente sin restricción

### NDA Unilateral vs Mutuo
- **NDA mutuo** (recomendado): protege a ambas partes, más fácil de negociar
- **NDA unilateral del cliente**: aceptable si el cliente lo requiere por política interna
- **NDA que prohíbe referencias**: consultar con Director Comercial (impacta portfolio)

---

## Propiedad Intelectual

### Posición estándar para proyectos de desarrollo
- **El código desarrollado específicamente para el cliente es del cliente** al completar el pago total
- El cliente recibe licencia perpetua sobre el código desde la entrega de cada hito

### Propiedad de la empresa (siempre retenida)
- Frameworks, librerías y componentes pre-existentes desarrollados por la empresa
- Know-how, metodologías y patrones de desarrollo
- Herramientas internas de desarrollo y testing

### Código open source
- Cualquier dependencia open source mantiene su licencia original
- El cliente es responsable de verificar compatibilidad con su uso comercial

### Proyectos de investigación o IA
- Los modelos de ML entrenados con datos del cliente: **el cliente es dueño del modelo**
- Las arquitecturas y pipelines de entrenamiento: son know-how de la empresa

---

## Terminación del Contrato

### Terminación por parte del cliente
- **Preaviso mínimo:** 30 días corridos por escrito
- **Liquidación:** trabajo realizado hasta la fecha de terminación efectiva se factura íntegramente
- **Entregables pendientes:** se entregan en el estado en que se encuentren al momento de terminación

### Terminación por parte de la empresa
- **Preaviso mínimo:** 30 días corridos (excepto causas graves)
- **Causas de terminación inmediata:** falta de pago > 60 días, violación de NDA, solicitud de actividades ilegales

### Terminación por causa grave (sin preaviso)
- Falta de pago acumulada > 2 meses
- Violación comprobada de confidencialidad
- Conducta abusiva hacia el equipo de trabajo

---

## Jurisdicción y Ley Aplicable

- **Ley aplicable:** ley local donde está constituida la empresa (Argentina)
- **Jurisdicción:** tribunales ordinarios de la Ciudad Autónoma de Buenos Aires
- **Resolución de disputas:** se intentará mediación por 30 días antes de iniciar acciones judiciales

---

## Cláusulas Que No Aceptamos

Las siguientes cláusulas requieren aprobación explícita de Dirección + Legal antes de aceptarse:

1. Responsabilidad ilimitada o que supere el monto del contrato
2. Cláusulas de no competencia que limiten a qué otros clientes podemos servir
3. SLA de disponibilidad > 99.5% sin validación de infraestructura
4. Propiedad del cliente sobre frameworks y herramientas pre-existentes
5. Penalidades por retraso > 10% del valor del contrato por mes
6. Cláusulas que otorguen al cliente el derecho de auditoría ilimitada de nuestros sistemas
