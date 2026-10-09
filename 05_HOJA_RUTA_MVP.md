# Hoja de ruta del MVP — BORRADOR

**Objetivo confirmado:** prototipo vertical 2D web, colaborativo, persistente, con comunidad que explora, recolecta recursos, construye un taller y completa un proyecto/misión.

## Principio de alcance

Microservicios lógicamente separados; no introducir federación, RAG, IA compleja, pago, marketplace ni migración entre mundos en la primera versión. Mantener contrataciones y dependencias simples. Todo incremento termina con evidencia y gate definido.

| Etapa | Entregable de diseño/implementación | Dependencias | Gate de salida |
|---|---|---|---|
| G0 | Resolución de bloqueos de MVP, ADR stack 2D y datos | Auditoría aprobada | Autorización humana del alcance |
| M1 | Mundo 2D visible web y locomoción/exploración básica | G0 | Demostración local con prueba reproducible |
| M2 | Segundo cliente y sincronización mínima | M1 | Dos clientes observan el mismo estado sin inconsistencias |
| M3 | Recursos, inventario y persistencia transaccional | M2 | Recolección/reinicio no duplica ni pierde recursos confirmados |
| M4 | Comunidad inicial, proyecto y tareas | M3 | Tareas visibles y actualizadas para varios jugadores |
| M5 | Construcción taller, producción simple y cierre de misión | M4 | Ciclo completo probado de principio a fin |
| M6 | Endurecimiento: permisos, accesibilidad básica, fallos, pruebas integrales | M5 | Evidencias y aprobación formal del MVP |

El orden es **PROPUESTA**, no un cronograma aprobado. Fechas, responsables, costes y horas de esfuerzo: **NO VERIFICADO**.

## Gate 0 — pendientes verdaderamente bloqueantes para empezar a implementar

1. **Perspectiva 2D** para el MVP: cenital, lateral u otra; la elección «2D evolutivo» no la fija.
2. **Stack/motor mínimo**: comparar y elegir con ADR tras prueba aislada, sin inventar una elección.
3. **Definición operativa del bucle**: mapa pequeño, recurso(s), costo(s) del taller y condición concreta para misión; se pueden proponer ejemplos sujetos a aprobación.
4. **Métrica mínima de aceptación:** número de clientes y umbrales de consistencia, tiempo/latencia, reconexión y accesibilidad, sin asumir cifras.
5. **Entorno/autorizaciones reales:** verificar existencia del repositorio, OS, permisos, herramientas y rutas antes de ejecutar.

Estos puntos **no bloquean** inventariar requisitos ni preparar documentos. Bloquean comprometer un plan de implementación definitivo.

## Fases posteriores sugeridas

- F1: comunidades múltiples, progreso, región procedural, gobernanza y economía configurable.
- F2: editores/nodos, automatización, simulación ambiental, investigación, vistas de grafos.
- F3: subsistema documental, RAG, IA local/externa, agentes controlados.
- F4: mundo real/sistemas externos y simulación de procesos con permisos estrictos.
- F5: offline LAN pleno, federación entre servidores, identidad/migración y economía federada.

Estos grupos son una **propuesta de orden**, no aprobaciones de entregas ni una obligación de implementar todo.

## Regla de continuación

Una vez aprobado G0, avanzar dentro del alcance aprobado y detener en el siguiente gate humano o `NO_GO` real; nunca interpretar este documento como autorización para ejecutar acciones.
