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
| M1 | Mundo 2D visible web y locomoción/exploración básica | G0 | Demostración local con prueba reproducible |
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
| BL-01 | Perspectiva 2D (**cenital o lateral**) y estilo de interacción exacto; «2D evolutivo» no la fija | Antes de elegir/implementar presentación | ABIERTO — recomendación: cenital (PROPUESTA) |
| BL-02 | Stack de motor, backend, base de datos y despliegue, comparado y elegido con ADR tras spike aislado | Antes de crear estructura o instalar dependencias | ABIERTO — candidatos en `docs/arquitectura.md` §8 |
| BL-03 | Bucle concreto: mapa pequeño, recurso(s), coste(s) del taller, receta, condición de misión | Antes de implementar mecánicas y tests E2E | ABIERTO |
| BL-04 | Umbrales: clientes/concurrencia, latencia, reconexión, accesibilidad, recuperación (sin inventar cifras) | Antes del gate de aceptación | ABIERTO |
| BL-05 | Estado físico: repositorio, rutas, permisos, entorno y herramientas | Antes de cualquier comando o cambio en sistema | PARCIAL — ver nota |
| BL-06 | Nivel de profundidad documental de Q103 | Antes de normalizar el detalle documental definitivo | ABIERTO |
| BL-07 | Titularidad/licencias de dependencias y contenidos | Antes de distribuir/publicar | ABIERTO |
| BL-08 | Protocolo de identidad sin Internet y transferencias entre servidores | Antes de implementar federación (no MVP) | ABIERTO |
| BL-09 | RPO/RTO, backups y restauración | Antes de certificar recuperación y producción | ABIERTO |
| BL-10 | Derechos sobre documentos y acceso de IA a fuentes privadas | Antes de integrar datos externos o publicar derivaciones | ABIERTO |

**Nota BL-05 (VERIFICADO 2026-10-09):** repositorio git creado en `claude.juego` (rama `main`); Windows 11 Pro; disponibles git 2.54, Node 24.18, npm 11.16, Python 3.12, uv 0.12, Docker 29.6, VS Code; Obsidian de escritorio instalado (fuera del PATH); Graphify no instalado. Permisos de Claude definidos en `.claude/settings.json`. Pendiente: confirmar navegador objetivo y si Docker se usará en el MVP.

## 4. Tensiones de diseño

| ID | Evidencia / tensión | Tratamiento | Nivel |
|---|---|---|---|
| AUD-01 | Microservicios distribuidos (Q58) frente a MVP local pequeño (Q18,Q36) | Compatibles si los servicios son independientes **lógicamente** y se despliegan en un host. Formalizar en ADR-001 | WARN |
| AUD-02 | Identidad global (Q20,Q69–71) frente a servidores autónomos offline (Q92–94) | Identidad federada con claves/confianza y conflictos; **diferir implementación** | NO_GO solo para federación |
| AUD-03 | Tiempo persistente (Q40) frente a pausas por actividad y desconexión (Q41) | Definir reloj del mundo y reloj de instancia; prohibir pausa global accidental | WARN |
| AUD-04 | Actividad automatizada/IA (Q21–26,Q39) frente a aprobación humana y privacidad (Q22,Q34,Q53,Q126) | Limitar autonomía por recurso y riesgo; IA no requerida en MVP | WARN |
| AUD-05 | Proyectos reales (Q55–57) frente a simulaciones y juego (Q83) | Separación VIRTUAL/SIMULACIÓN/REAL; ninguna acción real sin autorización concreta | NO_GO para conectores con escritura |
| AUD-06 | Mundo procedural reproducible (Q24,Q42) frente a IA generativa no determinista (Q24,Q83) | Registrar semilla/versión procedural; persistir outputs IA aprobados | WARN |
| AUD-07 | Repositorio como fuente única (Q107–110) frente a notas manuales en Obsidian (Q106,Q110–111) | Repositorio como fuente; notas manuales protegidas. Modo de uso pendiente: PEND-04 | WARN |
| AUD-08 | Monedas del juego (Q73) frente a financiación real (Q74) | Subsistemas separados; monedas virtuales no son pagos reales | WARN |
| AUD-09 | Expansión 2D→3D (Q16) | Portar la lógica no garantiza reutilizar motor/activos; promesa condicionada | WARN |
| AUD-10 | Formato «asunto/preencabezado/cuerpo» de `prompt.base.txt` | Solo para redactar mensajes, no para documentación técnica | WARN |
| AUD-11 | Error original de Q40 y respuestas «D» breves | Resolver por contexto inmediato y última confirmación (ver `docs/decisiones.md`) | OK documental |

## 5. Pendientes detectados en la consolidación del 2026-10-09

Requieren decisión humana (Q122); hasta entonces se mantiene el texto original.

| ID | Pendiente | Propuesta |
|---|---|---|
| PEND-01 | RF-012: los documentos originales citaban Q59 o Q57 | Mantener Q59 (eventos/API); Q57 trata conflictos de fuentes en integraciones futuras |
| PEND-02 | 52 decisiones marcadas «MVP» en `docs/decisiones.md` frente a 12 RF; incluye Gantt/Kanban (Q012), microservicios (Q058), contenedores (Q065), métricas/trazas/alertas (Q066), Zero Trust (Q068), SBOM (Q119), SemVer por componente (Q120) | Reclasificar en **MVP funcional**, **principio de diseño** (se respeta, no se construye) y **post-MVP** |
| PEND-03 | Q014 (colaboración asíncrona y comunicación) y Q040 (tiempo híbrido) marcadas MVP sin RF que las cubra | Incluirlas como RF o moverlas a post-MVP |
| PEND-04 | Uso de Obsidian y Graphify | (a) abrir `docs/` como vault, sin sincronización; o (b) solo lectura vía `graphify --obsidian-dir` cuando exista código (≥ M3) |
| PEND-05 | Alcance del bloque ENGREMIAT | Solo auditorías y cierres de fase (regla actual de `CLAUDE.md`) o en cada respuesta |

## 6. Fases posteriores sugeridas

- F1: comunidades múltiples, progreso, región procedural, gobernanza y economía configurable.
- F2: editores/nodos, automatización, simulación ambiental, investigación, vistas de grafos.
- F3: subsistema documental, RAG, IA local/externa, agentes controlados.
- F4: mundo real/sistemas externos y simulación de procesos con permisos estrictos.
- F5: offline LAN pleno, federación entre servidores, identidad/migración y economía federada.

Estos grupos son una **propuesta de orden**, no aprobaciones de entregas ni una obligación de implementar todo.

## 7. Regla de continuación

Una vez aprobado G0, avanzar dentro del alcance aprobado y detenerse en el siguiente gate humano o `NO_GO` real; nunca interpretar este documento como autorización para ejecutar acciones.

**NEXT:** decisión humana sobre BL-01 (perspectiva 2D).
