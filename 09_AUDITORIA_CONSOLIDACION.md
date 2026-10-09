# Auditoría de consolidación — 2026-10-09

**Estado:** `AUDITORIA_DOCUMENTAL_REALIZADA / BORRADOR_NO_APROBADO`. Esta auditoría revisa **solo las decisiones de la conversación y la fuente del esquema de prompt**. No inspecciona ni verifica el código real, un repositorio Git, Graphify, Obsidian ni pruebas de ejecución.

## 1. Inventario y fidelidad

- Q1–Q130: 130 registros en `10_REGISTRO_DECISIONES.md`.
- Q1–Q102: visión, juego, proyecto, simulación, documentación, infraestructura y entregables.
- Q103: **no resolvió nivel de detalle** (A/B/C/D); el usuario cambió el diseño para separar `CLAUDE.md` y prompt. No inferir «D» para Q103.
- Q104–Q120: jerarquía de prompts, contexto, Obsidian/Graphify, CI, calidad y versionado.
- Q121–Q130: auditoría, gates, protocolos operativos y autorización para la secuencia actual.
- Q40: la respuesta ajena al tiempo se rectificó explícitamente al elegir **modelo temporal híbrido**; registrar solo la última decisión confirmada.
- Q107: **B (sincronización unidireccional)** aunque hubiera propuesta anterior de integración bidireccional; no reinterpretar como D.
- Q111: **C (grafo/enlaces)** aunque se propusiera D; mantener la elección C.

## 2. Tensiones y resolución recomendada

| ID | Evidencia / tensión | Tratamiento de auditoría | Nivel |
|---|---|---|---|
| AUD-01 | Microservicios distribuidos (Q58) versus MVP local pequeño (Q18,Q36) | Compatibles si servicios independientes **lógicamente** y despliegue en un host. No exige orquestación remota inicial | WARN |
| AUD-02 | Identidad global (Q20,Q69–71) versus servidores autónomos offline (Q92–94) | Requiere diseño de identidad federada con claves/confianza y conflictos; **diferir implementación** | NO_GO solo para federación |
| AUD-03 | Tiempo persistente (Q40) versus pausas por actividad y desconexión (Q41) | Definir reloj del mundo y reloj de instancia; prohibir pausa global accidental | WARN |
| AUD-04 | Actividad automatizada/IA (Q21–26,Q39) versus aprobación humana y privacidad (Q22,Q34,Q53,Q126) | Limitar autonomía por recurso y riesgo; IA no requerida en MVP | WARN |
| AUD-05 | Proyectos reales (Q55–57) versus simulaciones y juego (Q83) | Separación VIRTUAL/SIMULACIÓN/REAL; ninguna acción real sin autorización concreta | NO_GO para conectores con escritura |
| AUD-06 | Mundo procedural reproducible (Q24,Q42) versus IA generativa no determinista (Q24,Q83) | Registrar semilla/versión procedural; persistir outputs IA aprobados, no prometer reproducibilidad perfecta de la IA | WARN |
| AUD-07 | Una sola fuente repositorio (Q107–110) versus notas manuales Obsidian (Q106,Q110–111) | Sincronización unidireccional, notas manuales protegidas; fuentes del conocimiento humano explícitas | WARN |
| AUD-08 | Costes/monedas del juego (Q73) versus financiación real (Q74) | Subsistemas separados; no tratar monedas virtuales como pagos reales | WARN |
| AUD-09 | Expansión 2D→3D (Q16) | Portabilidad de la lógica no garantiza reutilizar motor/activos; promesa condicionada a evaluación futura | WARN |
| AUD-10 | Demanda «asunto/preencabezado/cuerpo» en prompt.base.txt | Aplicar a tareas de mensajes, no a documentación técnica; respetar el resto del esquema | WARN |
| AUD-11 | Error original de Q40 y respuestas «D» breves | Resolver por el contexto inmediato y última confirmación; no atribuir acuerdos no formulados | OK documental |

## 3. Vacíos materiales (NO VERIFICADO)

| ID | Dato pendiente | Cuándo bloquea |
|---|---|---|
| BL-01 | 2D **cenital o lateral** y estilo de interacción exacto | Antes de elegir/implementar presentación del MVP |
| BL-02 | Stack de motor, backend, base de datos y despliegue comprobado | Antes de crear estructura o instalar dependencias |
| BL-03 | Detalle medible de primera misión: mapa, materiales, receta, construcción, resultado | Antes de implementar mecánicas y tests E2E |
| BL-04 | Umbrales del MVP: clientes/concurrencia, latencia, reconexión, accesibilidad, recuperación | Antes del gate de aceptación; valores no inventados |
| BL-05 | Estado físico del proyecto: repositorio, rutas, permisos, entorno y herramientas instaladas | Antes de cualquier comando o cambio en sistema |
| BL-06 | Nivel de profundidad documental de Q103 | Antes de aprobar un estándar de detallado definitivo |
| BL-07 | Titularidad/licencias concretas de dependencias y contenidos | Antes de distribuir/publicar |
| BL-08 | Protocolo de identidad sin Internet y transferencias entre servidores | Antes de implementar federación, NO MVP |
| BL-09 | RPO/RTO, backups y restauración | Antes de certificar recuperación y producción |
| BL-10 | Derechos sobre documentos y acceso de IA a fuentes privadas | Antes de integrar datos externos o publicar derivaciones |

## 4. Clasificación de fases

- **MVP:** una vertical jugable 2D local web con 2+ clientes como caso funcional mínimo, exploración y recurso simple, taller, proyecto, misión, permisos mínimos, persistencia, pruebas y documentación. Q36–37 explicitan esta frontera.
- **Arquitectura desde el diseño:** límites de servicio, IDs, contratos, seguridad, trazas y separación de datos. No equivalen a despliegue pleno de todas las funcionalidades.
- **Posterior:** federación, mundos autónomos offline, interoperabilidad económica, IA avanzada, grafo/RAG documental, editores extensibles, procesos reales, economía federada, física/producción avanzada.

## 5. Alcance del análisis realizado

Se han redactado documentos coherentes con decisiones explícitas y se han etiquetado las propuestas. **No hay evidencia de una implementación, de compatibilidad técnica de las herramientas citadas o de pruebas ejecutadas.** Por tanto, el estado no es `GO_IMPLEMENTACIÓN`.

## 6. Gate humano de consolidación

**Pendiente:** aprobación o correcciones del paquete provisional. Los bloqueos BL-01–BL-05 requieren resolución antes de código/implementación; BL-06 antes de normalizar el detalle documental definitivo; BL-07–BL-10 ante las fases correspondientes.

**NEXT:** Revisión humana de este informe y decisión sobre el primer bloqueo de MVP (BL-01). No avanzar a implementación sin autorización explícita.
