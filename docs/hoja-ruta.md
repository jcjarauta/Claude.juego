# Hoja de ruta del MVP y estado de consolidación — BORRADOR

**Objetivo confirmado:** prototipo vertical 2D web, colaborativo, persistente, con comunidad que explora, recolecta recursos, construye un taller y completa un proyecto/misión.

Consolida los antiguos `05_HOJA_RUTA_MVP` y `09_AUDITORIA_CONSOLIDACION` (auditoría documental del 2026-10-09 sobre las decisiones de la conversación; no inspeccionó código, Graphify, Obsidian ni pruebas). Estado global: **no es `GO_IMPLEMENTACIÓN`**.

## 1. Principio de alcance

Microservicios lógicamente separados; no introducir federación, RAG, IA compleja, pago, marketplace ni migración entre mundos en la primera versión. Mantener dependencias simples. Todo incremento termina con evidencia y gate definido.

- **MVP:** una vertical jugable 2D local web con 2+ clientes como caso funcional mínimo, exploración y recurso simple, taller, proyecto, misión, permisos mínimos, persistencia, pruebas y documentación (Q36–37).
- **Arquitectura desde el diseño:** límites de servicio, IDs, contratos, seguridad, trazas y separación de datos. No equivalen a desplegar todas las funcionalidades.
- **Posterior:** federación, mundos autónomos offline, interoperabilidad económica, IA avanzada, grafo/RAG documental, editores extensibles, procesos reales, economía federada, física/producción avanzada.

## 2. Etapas

| Etapa | Entregable de diseño/implementación | Dependencias | Gate de salida |
|---|---|---|---|
| G0 | Resolución de bloqueos BL-01–BL-05, ADR stack 2D y datos | Consolidación aprobada | Autorización humana del alcance |
| M1 | Mundo 2D visible web y locomoción/exploración básica | G0 | Demostración local con prueba reproducible — **CERRADA** 2026-10-09 (evidencia en `docs/pruebas.md` §5; prueba en Edge del usuario) |
| M2 | Segundo cliente y sincronización mínima | M1 | Dos clientes observan el mismo estado sin inconsistencias |
| M3 | Recursos, inventario y persistencia transaccional | M2 | Recolección/reinicio no duplica ni pierde recursos confirmados |
| M4 | Comunidad inicial, proyecto y tareas | M3 | Tareas visibles y actualizadas para varios jugadores |
| M5 | Construcción taller, producción simple y cierre de misión | M4 | Ciclo completo probado de principio a fin |
| M6 | Endurecimiento: permisos, accesibilidad básica, fallos, pruebas integrales | M5 | Evidencias y aprobación formal del MVP |

El orden es **PROPUESTA**, no un cronograma aprobado. Fechas, responsables, costes y horas de esfuerzo: **NO VERIFICADO**.

## 3. Bloqueos (vacíos materiales)

BL-01–BL-05 forman el **Gate 0**: no bloquean inventariar requisitos ni preparar documentos; bloquean comprometer un plan de implementación definitivo.

| ID | Dato pendiente | Cuándo bloquea | Estado |
|---|---|---|---|
| BL-01 | Perspectiva 2D y estilo de interacción | Antes de elegir/implementar presentación | **CERRADO** — cenital (Q132) |
| BL-02 | Stack de motor, backend, base de datos y despliegue, comparado y elegido con ADR tras spike aislado | Antes de crear estructura o instalar dependencias | **CERRADO** — Phaser + Colyseus + SQLite con TypeScript (ADR-002, Q146–Q147), tras spike y prueba manual (Q145) |
| BL-03 | Bucle concreto: mapa, recursos, costes del taller, receta, condición de misión | Antes de implementar mecánicas y tests E2E | **DECIDIDO** el diseño (Q133, Q136–Q139); cifras PROPUESTA en `docs/especificacion.md` §3.1 pendientes de revisión |
| BL-04 | Umbrales: clientes/concurrencia, latencia, reconexión, accesibilidad, recuperación | Antes del gate de aceptación | **DECIDIDO** escala y navegadores (Q134, Q143); umbrales numéricos PROPUESTA en `docs/pruebas.md` §3 pendientes de revisión |
| BL-05 | Estado físico: repositorio, rutas, permisos, entorno y herramientas | Antes de cualquier comando o cambio en sistema | PARCIAL — ver nota |
| BL-06 | Nivel de profundidad documental de Q103 | Antes de normalizar el detalle documental definitivo | ABIERTO |
| BL-07 | Titularidad/licencias de dependencias y contenidos | Antes de distribuir/publicar | ABIERTO |
| BL-08 | Protocolo de identidad sin Internet y transferencias entre servidores | Antes de implementar federación (no MVP) | ABIERTO |
| BL-09 | RPO/RTO, backups y restauración | Antes de certificar recuperación y producción | ABIERTO |
| BL-10 | Derechos sobre documentos y acceso de IA a fuentes privadas | Antes de integrar datos externos o publicar derivaciones | ABIERTO |

**Nota BL-05 (VERIFICADO 2026-10-09):** repositorio git creado en `claude.juego` (rama `main`); Windows 11 Pro; disponibles git 2.54, Node 24.18, npm 11.16, Python 3.12, uv 0.12, Docker 29.6, VS Code; Obsidian de escritorio instalado (fuera del PATH); Graphify no instalado. Permisos de Claude definidos en `.claude/settings.json`. Navegadores objetivo decididos (Q143). Pendiente: si Docker se usará en el MVP (Q065 lo deja como post-MVP).

## 4. Tensiones de diseño

| ID | Evidencia / tensión | Tratamiento | Nivel |
|---|---|---|---|
| AUD-01 | Microservicios distribuidos (Q58) frente a MVP local pequeño (Q18,Q36) | Compatibles si los servicios son independientes **lógicamente** y se despliegan en un host. Formalizar en ADR-001 | WARN |
| AUD-02 | Identidad global (Q20,Q69–71) frente a servidores autónomos offline (Q92–94) | Identidad federada con claves/confianza y conflictos; **diferir implementación** | NO_GO solo para federación |
| AUD-03 | Tiempo persistente (Q40) frente a pausas por actividad y desconexión (Q41) | MVP: reloj del mundo continuo sin pausas (Q138, RF-014). Relojes de instancia y pausas por actividad: post-MVP | OK para el MVP |
| AUD-04 | Actividad automatizada/IA (Q21–26,Q39) frente a aprobación humana y privacidad (Q22,Q34,Q53,Q126) | Limitar autonomía por recurso y riesgo; IA no requerida en MVP | WARN |
| AUD-05 | Proyectos reales (Q55–57) frente a simulaciones y juego (Q83) | Separación VIRTUAL/SIMULACIÓN/REAL; ninguna acción real sin autorización concreta | NO_GO para conectores con escritura |
| AUD-06 | Mundo procedural reproducible (Q24,Q42) frente a IA generativa no determinista (Q24,Q83) | Registrar semilla/versión procedural; persistir outputs IA aprobados | WARN |
| AUD-07 | Repositorio como fuente única (Q107–110) frente a notas manuales en Obsidian (Q106,Q110–111) | Obsidian abre `docs/` como vault (Q141): no hay copia que sincronizar; las ediciones en Obsidian son cambios del repositorio revisables con `git diff` | OK |
| AUD-08 | Monedas del juego (Q73) frente a financiación real (Q74) | Subsistemas separados; monedas virtuales no son pagos reales | WARN |
| AUD-09 | Expansión 2D→3D (Q16) | Portar la lógica no garantiza reutilizar motor/activos; promesa condicionada | WARN |
| AUD-10 | Formato «asunto/preencabezado/cuerpo» de `prompt.base.txt` | Solo para redactar mensajes, no para documentación técnica | WARN |
| AUD-11 | Error original de Q40 y respuestas «D» breves | Resolver por contexto inmediato y última confirmación (ver `docs/decisiones.md`) | OK documental |

## 5. Pendientes detectados en la consolidación del 2026-10-09

Todos resueltos por decisión humana el 2026-10-09.

| ID | Pendiente | Resolución |
|---|---|---|
| PEND-01 | RF-012: los documentos originales citaban Q59 o Q57 | RF-012 cita Q59 (Q140) |
| PEND-02 | 52 decisiones marcadas «MVP» frente a 12 RF | Reclasificadas en `docs/decisiones.md` (22 MVP funcional, 29 principio, 1 post-MVP); clasificación PROPUESTA pendiente de revisión (Q140) |
| PEND-03 | Q014 y Q040 marcadas MVP sin RF | Añadidos RF-013 (colaboración asíncrona) y RF-014 (reloj del mundo) con TP-13 y TP-14 (Q140) |
| PEND-04 | Uso de Obsidian y Graphify | Obsidian abre `docs/` como vault (Q141); Graphify post-MVP |
| PEND-05 | Alcance del bloque ENGREMIAT | Auditorías y cierres de tarea o fase (Q142) |

**Revisión pendiente (no bloquea el spike):** cifras del bucle (`docs/especificacion.md` §3.1), umbrales técnicos (`docs/pruebas.md` §3) y reclasificación de decisiones (`docs/decisiones.md`).

## 6. Fases posteriores sugeridas

- F1: comunidades múltiples, progreso, región procedural, gobernanza y economía configurable.
- F2: editores/nodos, automatización, simulación ambiental, investigación, vistas de grafos.
- F3: subsistema documental, RAG, IA local/externa, agentes controlados.
- F4: mundo real/sistemas externos y simulación de procesos con permisos estrictos.
- F5: offline LAN pleno, federación entre servidores, identidad/migración y economía federada.

Estos grupos son una **propuesta de orden**, no aprobaciones de entregas ni una obligación de implementar todo.

## 7. Regla de continuación

Una vez aprobado G0, avanzar dentro del alcance aprobado y detenerse en el siguiente gate humano o `NO_GO` real; nunca interpretar este documento como autorización para ejecutar acciones.

**Gate 0 cerrado el 2026-10-09:** BL-01–BL-04 resueltos y BL-05 suficiente para empezar. Siguen como PROPUESTA revisable las cifras del bucle, los umbrales y la reclasificación de decisiones.

**NEXT:** plan de M2 (segundo cliente, sincronización y red local real) para aprobación humana.
