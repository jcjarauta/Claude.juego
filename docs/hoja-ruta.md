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
| M2 | Segundo cliente y sincronización mínima | M1 | Dos clientes observan el mismo estado sin inconsistencias — **CERRADA** 2026-10-09 (evidencia en `docs/pruebas.md` §5, incluida la red local real) |
| M3 | Recursos, inventario y persistencia transaccional | M2 | Recolección/reinicio no duplica ni pierde recursos confirmados — **CERRADA** 2026-10-09 (evidencia en `docs/pruebas.md` §5, incluida la prueba del usuario) |
| M4 | Comunidad inicial, proyecto y tareas | M3 | Tareas visibles y actualizadas para varios jugadores — **CERRADA** 2026-10-09 (evidencia en `docs/pruebas.md` §5; fusión autorizada sin prueba manual registrada) |
| M5 | Construcción taller, producción simple y cierre de misión | M4 | Ciclo completo probado de principio a fin — **CERRADA** (evidencia en `docs/pruebas.md` §5; probada por la persona responsable y fusionada) |
| M5b | Núcleo de proyectos y panel profesional (auditoría `docs/auditoria-engremiat-2026-10-09.md`, Q159–Q164) | M5 | Las 10 capacidades del incremento cubiertas por pruebas — **CERRADA** (evidencia en `docs/pruebas.md` §5; probada por la persona responsable y fusionada) |
| M6 | Endurecimiento: permisos, accesibilidad básica, fallos, pruebas integrales | M5b | Evidencias y aprobación formal del MVP — **CERRADA: MVP ACEPTADO el 2026-10-10** (`docs/aceptacion-mvp.md`; excepción: Firefox, Q169) |
| F1a | Proyectos y misiones configurables desde el panel (FUT-05, RF-017) | M6 | Un proyecto y su misión creados en el panel se juegan hasta completarse y persisten — **CERRADA** 2026-10-10 (evidencia en `docs/pruebas.md` §5; probada por la persona responsable) |
| F1b | Vistas de gestión: tablero, cronograma e indicadores; fechas objetivo y replanificación (RF-018, RF-019) | F1a | Las vistas muestran los mismos datos que la lista y el mundo, accesibles — **CERRADA** 2026-10-10 (evidencia en `docs/pruebas.md` §5; probada por la persona responsable) |
| F1c | Responsables, dependencias y comentarios (RF-020 a RF-022) | F1b | Un proyecto con dependencias se juega en orden; responsables y comentarios en vivo y persistentes — **CERRADA** 2026-10-10 (evidencia en `docs/pruebas.md` §5; probada por la persona responsable) |
| F2a | Editor de construcciones: edificios con solar, objetos y recetas desde el panel (RF-023, RF-024; FUT-04 en pequeño) | F1c | Una construcción, un objeto y una receta creados en el panel se construyen y fabrican en el mundo y persisten — **CERRADA** 2026-10-10 (evidencia en `docs/pruebas.md` §5; probada por la persona responsable) |
| F2b | Cadenas de producción: entradas de objetos, verbo, edificios extra, subproductos, límites configurables y vista de cadenas (RF-025) | F2a | Una cadena de dos edificios con objeto intermedio y subproducto se crea en el panel, se construye y se fabrica, y persiste — **CERRADA** 2026-10-10 (evidencia en `docs/pruebas.md` §5; probada por la persona responsable) |
| F2c | Habilidades: niveles que se practican, se conceden o se enseñan; recetas que las exigen (RF-026) | F2b | Una habilidad creada en el panel se gana por las tres vías y abre una receta que la exige, y persiste — **CERRADA** 2026-10-11 (evidencia en `docs/pruebas.md` §5; probada por la persona responsable) |
| G3a | Fundamentos visuales y de accesibilidad: documento de arquitectura visual, tokens de diseño, componentes reutilizables accesibles, guía de estilo `/estilo`, `npm.cmd run a11y` (Q200–Q205) | F2c | Pantallas actuales con los mismos tokens, componentes en `ui/` y comprobación automática de contraste — **CERRADA** 2026-10-11 (evidencia en `docs/pruebas.md` §5; probada por la persona responsable) |
| G3b | Marco de pantalla del juego: zonas, panel con pestañas, fuente única de eventos con consola (Importantes e Historial), anunciador con prioridades, preferencias de accesibilidad y regla de actividad (RF-027, Q206–Q214) | G3a | Pantalla del juego en zonas con los mismos ids, avisos unificados y pruebas T1–T4 con dos sesiones — **CERRADA** 2026-10-11 (evidencia en `docs/pruebas.md` §5; pendiente de la prueba de la persona responsable y de la fusión) |
| G3c | Objetivo actual, marcadores y Guía: modelo del siguiente paso con estados y planificador de cadenas, zona C con objetivo elegido, marcadores y etiquetas del mapa, pestaña «Guía» con «Qué hay cerca» (RF-028, Q215–Q226) | G3b | Zona C, marcadores, Guía y modelo probado con servidor real — **CERRADA** 2026-10-11 (evidencia en `docs/pruebas.md` §5; pendiente de la prueba de la persona responsable y de la fusión) |
| G3d | Logros y reconocimiento cooperativo: modelo de logros verificables y catálogo versionado, pestaña «Logros», almacén local versionado, celebraciones desactivables y reconocimientos locales aparte (RF-029, Q227–Q236) | G3c | Logros derivados del estado, reconocimiento por papeles sin clasificaciones, celebraciones por preferencia y probado con servidor real — **CERRADA** 2026-10-11 (evidencia en `docs/pruebas.md` §5; pendiente de la prueba de la persona responsable y de la fusión) |
| G1 | Arreglos de diseño: límites de diseño editables con techos más altos y límites del planificador, escalas de niveles y archivo de definiciones con restaurar (RF-030, Q237–Q241) | G3d | Límites vigentes editables, escalas en desplegable y archivar sin borrar, probado con servidor real y con dos sesiones — **CERRADA** 2026-10-12 (evidencia en `docs/pruebas.md` §5; pendiente de la prueba de la persona responsable y de la fusión) |

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

- F1: comunidades múltiples, progreso, región procedural, gobernanza y economía configurable. **F1a** (proyectos y misiones configurables) hecha.
- F2: editores/nodos, automatización, simulación ambiental, investigación, vistas de grafos.
- F3: subsistema documental, RAG, IA local/externa, agentes controlados.
- F4: mundo real/sistemas externos y simulación de procesos con permisos estrictos.
- F5: offline LAN pleno, federación entre servidores, identidad/migración y economía federada.

Estos grupos son una **propuesta de orden**, no aprobaciones de entregas ni una obligación de implementar todo.

## 7. Regla de continuación

Una vez aprobado G0, avanzar dentro del alcance aprobado y detenerse en el siguiente gate humano o `NO_GO` real; nunca interpretar este documento como autorización para ejecutar acciones.

**Gate 0 cerrado el 2026-10-09:** BL-01–BL-04 resueltos y BL-05 suficiente para empezar. Siguen como PROPUESTA revisable las cifras del bucle, los umbrales y la reclasificación de decisiones.

**NEXT:** prueba y fusión de G1 por la persona responsable; después, planificar la siguiente etapa por preguntas entre G2 (biblioteca y versiones), F2d (conversación y objetivos de equipo) y F2e (bots).

## 8. Mejoras futuras anotadas (no planificadas)

Surgidas de la valoración de cierre de G3c (`docs/pruebas.md`); se retoman al planificar la etapa que se indica.

| # | Mejora | Cuándo |
|---|---|---|
| M8 | Límites del planificador de rutas (profundidad 8, 24 rutas) configurables desde el panel | **HECHA en G1** (Q238) |
| M9 | Guardar el objetivo activo en el servidor para seguirlo entre dispositivos (servidor, migración y privacidad; hoy es local por Q224) | Si se decide revisar Q224 |
| M10 | Objetivos de equipo (el de la comunidad, compartido) | G3d o F2d |

Surgidas de la valoración de cierre de G3d (`docs/pruebas.md`):

| # | Mejora | Cuándo |
|---|---|---|
| N3 | Cobertura en sala real de retirar un elemento y de los niveles de habilidad (hoy en pruebas de tabla) | G2; G1 añadió el archivo y las habilidades en sala real, pero «retirar» sigue pendiente |
| N4 | Catálogo de logros definido por datos desde el panel profesional | G2 |
| N5 | Logros y reconocimientos en el servidor (mismo resultado en cualquier dispositivo, sin «primera visita» por navegador) | Solo si se revisa Q227 |
| N6 | Logros de equipo con objetivo compartido («Usar como mi objetivo») | F2d / M10 |
| N9 | Que la tarjeta de logro no desplace el mapa tampoco al apilar (hoy queda en el flujo por no tapar controles) | Si se detecta molestia |

