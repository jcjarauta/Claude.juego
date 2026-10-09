# Arquitectura técnica — BORRADOR

Antiguo `04_ARQUITECTURA_TECNICA`, ampliado con los contratos del antiguo `13_MODELO_CONCEPTUAL` y el registro de ADR. Entidades, invariantes y flujos: `docs/especificacion.md` §4.

## 1. Decisiones respaldadas

Arquitectura objetivo de **microservicios y ejecución distribuida** (Q58), protocolos **API + eventos + WebSocket** (Q59), despliegue inicial **local autoalojado** (Q18), **monorepositorio modular** (Q64), configuración por entornos y contenedores futuros (Q65). Preferencia por tecnologías maduras, preferentemente libres y autoalojables (Q60). Stack **NO VERIFICADO**; no se han seleccionado frameworks, bases de datos, brokers ni proveedores.

## 2. Módulos / límites propuestos

| Servicio o módulo | Responsabilidad | MVP | Estado |
|---|---|---|---|
| Gateway web | Entrada y distribución de peticiones, autenticación de sesión | Mínimo | PROPUESTA |
| Identidad y permisos | Cuenta local inicial y ACL | Sí | PROPUESTA |
| Sesión multijugador | Conexiones/acciones, sincronización de clientes, servidor autoritativo | Sí | PROPUESTA |
| Estado del mundo | Mapa 2D, recursos, construcción, persistencia | Sí | PROPUESTA |
| Proyectos | Comunidad inicial, proyecto/tareas, misión y logros | Sí | PROPUESTA |
| Registro de eventos | Evidencia de cambios de estado y operaciones | Mínimo | PROPUESTA |
| Documentos/conocimiento | Ingesta, clasificación, RAG, grafo | No | VISIÓN FUTURA |
| IA y agentes | Proveedores, herramientas, memoria, presupuestos | No | VISIÓN FUTURA |
| Federación | Intercambio entre mundos/servidores | No | VISIÓN FUTURA |
| Simulación avanzada | Clima, procesos, probabilística y agentes | No | VISIÓN FUTURA |

**NOTA:** el diseño por servicios no obliga a procesos/deploys separados desde la primera iteración. Compartir host y entorno de pruebas mientras se respetan límites de responsabilidades.

## 3. Comunicación y autoridad de datos

- HTTP/API: consultas, comandos controlados, estado administrativo.
- WebSocket: interacción multijugador y eventos de estado cercanos al tiempo real.
- Bus/eventos asíncronos: procesos desacoplados; **no imprescindible un broker externo en el primer prototipo**.
- Estado del mundo e inventarios: una autoridad de escritura por entidad; validación del lado servidor.
- Cada comando requiere: identidad de emisor, alcance/permiso, identificador, versión esperada cuando aplique y resultado.
- Eventos propuestos: `ResourceCollected`, `ResourceContributed`, `TaskCompleted`, `WorkshopBuilt`, `MissionCompleted`. Nombres **de diseño**, no código existente.
- Formatos, endpoints, mensajes, autenticación, versiones y semántica de reintentos: **NO VERIFICADOS**. Cada servicio debe documentar una autoridad de escritura por entidad y sus políticas de consistencia. Para el MVP, diseñar contratos mínimos antes de programar.

### 3.1 Sesión y presencia (implementado en M2)

- **Contratos** en `@juego/shared`: mensajes (`contracts.ts`), esquema del estado sincronizado (`state.ts`) y reglas puras (`movement.ts`).
- **Salida voluntaria** (botón, cerrar o recargar la pestaña mediante `pagehide`): el jugador se retira al momento y su plaza queda libre.
- **Corte de red:** el jugador queda en el mundo con `connected = false` durante `session.reconnectSeconds` (10 s). Los demás lo ven semitransparente y «reconectando», y no puede moverse. El SDK reconecta solo; si vuelve, conserva la posición; si el plazo vence, se retira.
- **Mismo nombre durante el plazo:** quien entra con el nombre de un jugador desconectado recupera su personaje, y el plazo de la sesión antigua se cancela para liberar su plaza. Sin cuentas no hay propiedad de nombres: esto se revisará con la identidad de M6 (RF-003).
- **Colisión:** los jugadores no se bloquean entre sí (Q148).

## 4. Persistencia y consistencia

Mantener transacciones en cambios de inventario/recursos, evitar doble consumo, considerar idempotencia de comandos. Guardado/reinicio verificables para MVP. Registro de eventos y versionado se ampliarán después. Las copias de seguridad requieren **prueba real de restauración** antes de etiquetar el control como OK.

## 5. Autenticación, privacidad y seguridad

Cuentas locales al inicio (adultos); autorización por acción/recurso; mínimos datos; secretos fuera del código; validación del input del cliente; logs redactados sin datos sensibles. No trasladar credenciales ni documentos privados a IA externa sin consentimiento específico y evaluación de riesgos.

## 6. Red local y federación (futuro)

Requisito aspiracional: funcionamiento autónomo offline y federación voluntaria, con identidad estable. **Tensión abierta:** una «identidad global» no puede depender incondicionalmente de un servicio central cuando cada servidor opera sin Internet. Diseñar negociación de confianza, resolución de conflictos y políticas de migración antes de implementar federación. Ninguna transferencia de recursos únicos por mera copia.

## 7. Obsidian y Graphify (futuro o acompañamiento no bloqueante)

Repositorio fuente; sincronización unidireccional y filtrada hacia bóveda/grafo, primero DRY_RUN. El MVP no debe depender de esa integración para arrancar.

**Decisión (Q141):** Obsidian abre `docs/` del repositorio como vault; no hay sincronización. Su configuración (`docs/.obsidian/`) está excluida de git. Las ediciones hechas en Obsidian son cambios normales del repositorio y se revisan con `git diff`. Graphify queda para después del MVP.

Investigación del 2026-10-09 (fuentes públicas; **no probado en este entorno**):

- **Obsidian:** un vault es una carpeta de archivos Markdown con configuración en `.obsidian/`; puede abrir directamente `docs/` del repositorio sin sincronizar nada. El CLI oficial (1.12+) controla una instancia de escritorio en ejecución; la sincronización con git solo existe mediante plugins de la comunidad. VERIFICADO localmente: Obsidian de escritorio instalado.
- **Graphify** (`github.com/Graphify-Labs/graphify`, paquete PyPI `graphifyy`): analiza código en local con tree-sitter, sin llamadas a IA; documentos, PDF e imágenes requieren una pasada semántica con el modelo del asistente (consume tokens). Genera `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`, `graph.html`); actualización incremental; hooks de git y de Claude Code; `--obsidian-dir` escribe en un vault sin tocar notas manuales. No aporta valor sin código. VERIFICADO localmente: no instalado.

## 8. Alternativas tecnológicas todavía sin decisión

Motor 2D web, protocolo de tiempo real, almacenamiento relacional/documental, contenedorización, sistema de colas, observabilidad, automatización y tests: establecer un *spike* comparativo y decisión ADR antes de programar. No atribuir elecciones al usuario ni comprometer versiones no evaluadas.

Candidatos para el spike de BL-02 (**PROPUESTA**, ninguno elegido):

| Opción | Encaje | Riesgos |
|---|---|---|
| Phaser (cliente) + Colyseus (servidor) + SQLite | TypeScript en ambos extremos; salas con estado autoritativo sincronizado por WebSocket; un solo proceso local; licencias MIT | Escalado más allá de pocos jugadores no probado aquí |
| Godot con exportación web | Editor completo, 2D maduro | Tamaño de exportación web y red multijugador en navegador a evaluar |
| Nakama + cliente web | Cuentas, almacenamiento y tiempo real incluidos | Más pesado de operar para un MVP local |

El bucle del MVP (recolectar, aportar, construir) no exige reflejos; no se prevé netcode avanzado (predicción, rollback).

**Definición del spike (Q135) — PROPUESTA, requiere autorización:**

- **Alcance:** código desechable en `spike/<opción>/`, que nunca se reutiliza en el MVP. Mapa cenital pequeño; 2–4 clientes en el navegador mueven un personaje con teclado; un nodo de recurso compartido que cualquiera puede recolectar; el estado persiste tras reiniciar el servidor; el reloj del servidor regenera el nodo.
- **Orden:** primero Phaser + Colyseus + SQLite. Godot solo si la primera opción incumple algún criterio eliminatorio.
- **Criterios eliminatorios:** servidor autoritativo (el cliente no puede alterar el nodo); convergencia ≤ 500 ms en LAN con 4 clientes; persistencia sin pérdida de lo confirmado tras reiniciar; funciona en Chrome, Edge y Firefox.
- **Criterios comparativos:** simplicidad del código, madurez y licencias (Q060), calidad de la documentación, facilidad de pruebas automáticas, tamaño de las dependencias.
- **Evidencia:** salida de pruebas, registro de una sesión con 4 clientes, versiones exactas de las dependencias. Resultado en ADR-002.

## 9. Criterios no funcionales pendientes

Concurrencia esperada, latencia tolerable, límites de memoria/CPU/GPU, plataforma de pruebas, RPO/RTO, duración de sesión, tasa de sincronización, seguridad aplicable y política de datos. Deben concretarse antes del correspondiente gate técnico, sin bloquear la redacción del borrador.

## 10. Registro de ADR

Los ADR se guardan en `docs/adr/NNN-titulo.md` (contexto, opciones, decisión, consecuencias, requisitos afectados) y solo se marcan como aprobados con gate humano. La carpeta se crea con el primer ADR.

| ADR | Título | Estado |
|---|---|---|
| ADR-001 | Monolito modular para el MVP: servicios lógicamente separados en un único proceso, satisfaciendo Q58 sin operar servicios distribuidos (AUD-01) | APROBADO a través de ADR-002, que lo incluye (Q146); sin documento propio |
| ADR-002 | Stack del MVP: Phaser + Colyseus + SQLite ([`docs/adr/002-stack-mvp.md`](adr/002-stack-mvp.md)), tras el spike de §8 | APROBADO (Q146), con TypeScript (Q147) |
| ADR-003 | Herramientas TypeScript: npm workspaces, ejecución directa de `.ts` en Node 24, `tsc` solo para tipos, esbuild en el cliente ([`docs/adr/003-herramientas-typescript.md`](adr/003-herramientas-typescript.md)) | APROBADO con el plan de M1 |
