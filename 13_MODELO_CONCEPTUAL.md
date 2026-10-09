# Modelo conceptual y contratos iniciales — BORRADOR

## 1. Entidades (no tablas ni clases implementadas)

| Entidad propuesta | Identificador estable | Responsabilidad / relaciones |
|---|---|---|
| Usuario | `user_id` | Identidad de acceso local, permisos; futura identidad global |
| Personaje | `character_id` | Presencia de usuario en mundo, futuro perfil por mundo |
| Mundo | `world_id` | Estado persistente; uno en MVP |
| Zona / celda | `area_id` | Región/coordenadas del mundo 2D |
| Comunidad | `community_id` | Grupo inicial, membresías y derechos |
| Proyecto | `project_id` | Objetivo comunitario, tareas, recursos aportados |
| Tarea | `task_id` | Condición y progreso |
| Recurso | `resource_type_id` | Tipo, origen/propiedades (cantidades en inventarios) |
| Inventario | `inventory_id` | Saldo por recurso y propietario/ámbito |
| Construcción | `structure_id` | Taller construido y sus condiciones |
| Misión | `mission_id` | Objetivo, estado y resultado |
| Evento | `event_id` | Tipo, actor, ámbito, hora de servidor, correlación y resultado |

Todos los nombres son **PROPUESTA**. No existen en código verificado.

## 2. Invariantes preliminares

- Una acción de cliente no modifica directamente saldos; pasa por validación en servidor.
- Una contribución al proyecto y la deducción del inventario deben ser coherentes.
- No puede construirse taller sin requisitos satisfechos.
- Las operaciones duplicadas con el mismo identificador no deben producir doble efecto.
- El evento de éxito solo se confirma después de persistir el resultado requerido.
- Los cambios en sistemas externos, documentación real o federación quedan fuera del MVP.

## 3. Flujos propuestos

**Recolección:** intención cliente → permiso/regla → validación de recurso → transacción inventario/mundo → persistencia → emisión de cambio.  
**Proyecto:** aporte → validación de propietario y saldo → asignación a proyecto → estado de tarea → visibilidad compartida.  
**Taller:** comprobar condición de construcción → consumir recursos previstos → crear estructura → persistir → notificar.  
**Misión:** constatar productos/objetivo → registrar logro → persistir → mostrar resultado.

## 4. Contratos y riesgos

API/eventos/WebSocket elegidos como estilos de comunicación; formatos, endpoints, mensajes, autenticación, versiones y semántica de reintentos todavía **NO VERIFICADOS**. Cada servicio debe documentar una autoridad de escritura por entidad y políticas de consistencia. Para el MVP, diseñar contratos mínimos antes de programar.

## 5. Extensibilidad futura

Entidades de documentos/fuentes/licencias, relaciones tipadas, simulaciones, agentes, mundos federados y transferencias de recursos se definirán cuando corresponda a su fase; no sobrecargar ahora el modelo inicial.
