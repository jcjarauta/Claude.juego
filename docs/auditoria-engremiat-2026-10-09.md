# Auditoría ENGREMIAT — del juego cooperativo al núcleo de proyectos (2026-10-09)

> Auditoría de **solo lectura** pedida por la persona responsable el 2026-10-09 («PROMPT — ENGREMIAT — Auditoría técnica y evolución hacia un gestor de proyectos colaborativo»). No se ha modificado código, ejecutado pruebas, arrancado servidores, instalado dependencias ni accedido a servicios externos. Este documento es nuevo y está **sin confirmar en git** hasta que se apruebe.
>
> Categorías: `VERIFICADO` (fuente inspeccionada, con ruta y línea), `NO_VERIFICADO`, `INFERENCIA`, `PROPUESTA`, `SIMULACIÓN`.

## 1. Resumen ejecutivo

- El prototipo **no es solo visual**: el bucle completo del MVP (recolectar → aportar → construir → fabricar → misión) está implementado con servidor autoritativo, transacciones SQLite, eventos idempotentes, persistencia y reconexión, y está cubierto por 74 pruebas automáticas y un soak de 15 min con auditoría de conservación (`VERIFICADO`, ejecuciones registradas en `docs/pruebas.md` §5; no se han repetido en esta auditoría).
- De los 10 puntos del incremento objetivo, **6 ya se cumplen** (proyecto identificado, tareas con id estable, consulta y operación desde el mundo, validación en servidor, estado autoritativo, persistencia), **2 se cumplen en parte** (registro de resultado sin evidencia ni aprobación explícitas; rechazo de operaciones inválidas pero no de *no autorizadas*) y **2 faltan** (panel profesional; operaciones desde él).
- Problema estructural principal: la lógica de proyectos **no es un núcleo**: vive dentro de la sala del juego (`apps/server/src/rooms/WorldRoom.ts:248-350`, 494 líneas en total), mezclada con movimiento, recolección y fabricación.
- **Recomendación (`PROPUESTA`):** etapa **M5b** antes de M6 con la alternativa 2 — **extraer un módulo de proyectos en el mismo proceso** —, añadir estados de tarea, revisión con evidencia y permisos por rol, y un **panel profesional en forma de lista** conectado al mismo estado autoritativo. Sin servicio independiente, sin dependencias nuevas, sin Kanban/Gantt (post-MVP según la reclasificación de Q012).
- Bloqueo parcial: los permisos reales dependen de la identidad de M6 (RF-003). M5b los implementa **por nombre** (riesgo ya aceptado en Q151) con un punto de autorización único que M6 sustituirá.

## 2. Alcance de la auditoría

| Incluido | Excluido |
|---|---|
| Repositorio local `C:\Users\pc\Desktop\claude.proyectos\claude.juego`, rama `main` (`5ba3e89`), 67 archivos versionados | Repositorio remoto (GitHub), Obsidian, Graphify, servicios externos |
| Código de `packages/shared`, `apps/server`, `apps/client`, `scripts/`, `content/` | `spike/` (desechable, ADR-002) |
| Documentación de `docs/`, `CLAUDE.md`, `README.md`, `.claude/settings.json` (solo nombres de reglas) | `data/world.db` (datos de la persona; no se abrió) |
| Comandos de solo lectura: `git ls-files`, `git log`, `grep`, `sed`, `wc`, `ls` | Pruebas, servidores, `npm`, escritura en archivos existentes |

## 3. Fuentes y evidencias

| Fuente | Qué aporta |
|---|---|
| `package.json`, `apps/*/package.json`, `packages/shared/package.json` | Stack y versiones fijadas (§5) |
| `apps/server/src/index.ts` | Punto de entrada, red, rutas estáticas, `/config` |
| `apps/server/src/rooms/WorldRoom.ts` | Toda la lógica autoritativa, incluidos proyectos |
| `apps/server/src/store.ts` | Esquema SQLite (migraciones 1–3), transacciones, eventos, auditoría |
| `packages/shared/src/{contracts,state,projects,crafting,world-config}.ts` | Contratos de mensajes, estado sincronizado, reglas puras, validación de configuración |
| `content/world.json` | Definición del proyecto «Construir taller», estructura, receta y misión |
| `apps/client/src/{main,WorldScene,project-panel,hud}.ts`, `apps/client/public/index.html` | Interfaz del mundo y panel del proyecto dentro del juego |
| `apps/server/test/*.ts`, `packages/shared/test/*.ts`, `scripts/soak.ts` | Cobertura de pruebas |
| `docs/especificacion.md`, `docs/arquitectura.md`, `docs/hoja-ruta.md`, `docs/pruebas.md`, `docs/decisiones.md` | Requisitos, módulos previstos, decisiones Q001–Q158, evidencias M1–M5 |

**Documentos citados por el prompt que no existen como tales** (`VERIFICADO` por `git ls-files`): matriz de trazabilidad, protocolo multiagente, auditoría de consolidación y modelo conceptual separados. Fueron absorbidos el 2026-10-09 en `docs/especificacion.md` §2 y §4, `CLAUDE.md` §4 y §8 y `docs/hoja-ruta.md` §4–§5 (originales en el commit `b203e92`).

## 4. Inventario del prototipo

| Funcionalidad | Evidencia | Estado | Reutilizable | Cambio propuesto |
|---|---|---|---|---|
| Mundo 2D cenital, movimiento autoritativo | `WorldRoom.ts:152-174`, `shared/src/movement.ts`; TP-01/TP-02 | Existente y verificada | Sí | Ninguno |
| Recolección, regeneración por reloj | `WorldRoom.ts:176-213`, `433-453`; TP-04, TP-14 | Existente y verificada | Sí | Ninguno |
| Inventarios individual / comunidad / proyecto | `store.ts:10-16`, `109-111`; TP-05 | Existente y verificada | Sí | Ninguno |
| Proyecto con id estable `construir-taller` y tareas `madera`/`piedra`/`fibra` | `content/world.json`; `world-config.ts:33-46` | Existente y verificada | Sí | Añadir `reality`, criterio y roles |
| Aporte a tareas (desde inventario o comunidad), recorte Q153 | `projects.ts:23-38`, `WorldRoom.ts:248-296`; TP-06 | Existente y verificada | Sí (reglas) / **acoplado** (manejador) | Mover al núcleo |
| Estado de tarea | Implícito: progreso ≥ requerido; solo el proyecto tiene estado (`en-curso`/`listo`/`construido`, `WorldRoom.ts:408-412`) | Parcial | En parte | Estado explícito por tarea |
| Criterios de aceptación | Implícitos en `required` | Parcial | Sí | Hacerlos explícitos y mostrables |
| Evidencias | Eventos `contribute` con actor, hora y cantidad (`store.ts:189-191`); totales por autor | Parcial | Sí | Vincular evidencias a la revisión |
| Aprobación distinta de completado | — | Ausente | — | Revisión por rol |
| Construcción del taller (entregable) | `WorldRoom.ts:309-350`; TP-07 | Existente y verificada | Sí | Consumo de materiales vía núcleo |
| Fabricación y misión | `WorldRoom.ts:353-396`; TP-08 | Existente y verificada | Sí | Ninguno (es juego, no gestión) |
| Panel de proyecto en el juego (tecla P) | `project-panel.ts:37`, `WorldScene.ts:158`; TP-10 | Existente y verificada | Sí | Mostrar estado de tarea y revisión |
| Panel profesional separado | — | Ausente | — | Página `/panel` en lista |
| Registro de actividad y novedades asíncronas | `store.ts:132-139`, `WorldRoom.ts:299-306`; TP-13 | Existente y verificada | Sí | Ninguno |
| Persistencia y reconexión | `store.ts:77-98`, `WorldRoom.ts:113-133`; TP-09 | Existente y verificada | Sí | Migración v4 |
| Idempotencia | `UNIQUE (actor, request_id)`, `store.ts:53`; TP-12 | Existente y verificada | Sí | Extender a revisión |
| Rechazo de operaciones inválidas | `contracts.ts:118-142`; TP-12 | Existente y verificada | Sí | Añadir «sin permiso» |
| Identidad y permisos | Identidad = nombre (Q151); sin roles | Ausente (planificado M6, RF-003) | — | Roles por nombre en M5b; cuentas en M6 |
| VIRTUAL / SIMULACIÓN / REAL | Solo en documentación (`CLAUDE.md` §9, AUD-05) | Ausente | — | Campo `reality` validado |
| Auditoría de conservación | `store.ts:196-205`; soak M5 | Existente y verificada | Sí | Ninguno |
| Kanban, Gantt, grafos, BPMN, IA, conectores | — | No aplicable al incremento | — | Post-MVP (Q012 reclasificada, FUT-01..05) |
| Obsidian / Graphify | `docs/.obsidian/` no existe; Graphify no instalado (registro del 2026-10-09) | No verificado / no aplicable | — | Ninguno (Q141) |

## 5. Arquitectura actual verificada

**Stack** (`VERIFICADO`, versiones fijadas): Node ≥ 24 ejecutando TypeScript directo (ADR-003), TypeScript 7.0.2 solo para tipos, esbuild 0.28.2; servidor Colyseus 0.18.18 + ws-transport 0.18.4 + schema 5.0.36; cliente Phaser 4.2.1 + @colyseus/sdk 0.18.5; persistencia `node:sqlite` (WAL, `synchronous = FULL`). Monorepo npm workspaces: `packages/shared`, `apps/server`, `apps/client`.

**Flujo de una operación** (ej. aporte, `WorldRoom.ts:248-296`):

```text
Cliente (panel en el juego) ── mensaje "contribute" {requestId, projectId, taskId, from, amount} ──▶ WorldRoom
  WorldRoom: jugador conectado? requestId válido?
  BEGIN IMMEDIATE
    ¿requestId ya registrado? → sin efecto
    checkContribution(...)  ← regla pura en @juego/shared, con saldos leídos de SQLite
    inventarios −/+ ; INSERT event('contribute', actor, requestId, datos)
  COMMIT
  → muta WorldState (progreso, autores, actividad, estado) → Colyseus sincroniza a todos los clientes
  (si se rechaza: mensaje "rejected" solo a quien lo pidió; nada se escribe)
```

| Pregunta | Respuesta | Evidencia |
|---|---|---|
| ¿Quién conserva el estado? | SQLite es la fuente de verdad; `WorldState` es una proyección en memoria reconstruida al arrancar | `WorldRoom.ts:46-85`, `415-431` |
| ¿Quién autoriza? | El servidor, con reglas puras compartidas; **no hay autorización por rol**, solo validez | `projects.ts:23-38` |
| ¿Cómo se actualizan las interfaces? | Sincronización de estado de Colyseus tras el COMMIT | `WorldRoom.ts:280-295` |
| ¿Cómo se registran las acciones? | Solo las **confirmadas**, como filas de `event`; los rechazos no se guardan | `store.ts:46-54`, `189-191` |
| ¿Cómo se evitan duplicados? | `UNIQUE (actor, request_id)` y comprobación previa en la misma transacción | `store.ts:53`, `WorldRoom.ts:257` |
| ¿Definición de proyectos? | Configuración (`content/world.json`) validada al arrancar (Q144) | `world-config.ts:118`, `186-200` |
| ¿Progreso? | Derivado de los eventos `contribute`, no del inventario del proyecto | `store.ts:124-125`, `207-209` |

## 6. Diferencias respecto a la arquitectura objetivo

| Objetivo (prompt) | Estado actual | Brecha |
|---|---|---|
| Núcleo de proyectos como fuente de verdad, interfaces como representaciones | Fuente de verdad única (SQLite + configuración), pero la lógica está en la sala del juego | Extraer el módulo; el juego y el panel lo consumen |
| Tarea ≠ acción ≠ evento ≠ evidencia ≠ aprobación | Acción = mensaje con `requestId`; evento = fila confirmada; tarea implícita; sin evidencia ni aprobación | Estado de tarea, revisión, evidencia referenciada |
| Mundo 2D, Kanban, Gantt, grafo… | Solo mundo + panel dentro del juego | Panel profesional **en lista** (Q012: Kanban/Gantt post-MVP) |
| Validar identidad, permisos, estado y condiciones | Estado y condiciones sí; identidad débil (nombre); permisos no | Punto de autorización único; roles por nombre hasta M6 |
| VIRTUAL / SIMULACIÓN / REAL | No modelado | Campo validado; solo `VIRTUAL` admitido en el MVP |
| APIs, eventos, WebSockets | WebSocket (Colyseus) + HTTP mínimo (`/config`); sin bus | Suficiente para el incremento; sin broker (ADR-001) |
| Integraciones externas de solo lectura | Ninguna | Fuera del incremento |

## 7. Riesgos, contradicciones y bloqueos

| Id | Tipo | Descripción | Estado |
|---|---|---|---|
| R-01 | Contradicción | El prompt usa **ENGREMIAT** como nombre del producto; en el repositorio es el nombre del formato de informe (Q142, PEND-05) | WARN — decisión D-1 |
| R-02 | Contradicción | El prompt menciona Kanban y Gantt; la reclasificación de Q012 los deja post-MVP («lista de tareas con estado y avance») | WARN — el panel será una lista (D-2) |
| R-03 | Bloqueo parcial | Permisos reales requieren identidad (RF-003, M6). Roles por nombre son suplantables mientras no haya cuentas (riesgo ya aceptado en Q151/Q155) | WARN — D-4 |
| R-04 | Riesgo | El panel necesita conexión a la sala: hoy `maxClients = MAX_PLAYERS = 4` (`contracts.ts:7`, `WorldRoom.ts:24`); un panel no debe ocupar plaza de jugador ni crear personaje | WARN — diseño §9 |
| R-05 | Riesgo | Cambiar `WorldState` (contrato compartido) afecta a cliente, pruebas y soak | WARN — análisis de impacto §14 |
| R-06 | Riesgo | La aprobación puede romper la jugabilidad asíncrona (RF-013) si bloquea construir y el coordinador no está conectado | WARN — D-3 |
| R-07 | Límite | Las acciones rechazadas no quedan registradas (solo se responden); el prompt pide no confundir solicitado y confirmado, lo que se cumple, pero no hay traza de intentos fallidos | WARN — opcional |
| R-08 | Límite | `contribute`, `build` y `craft` no tienen límite de frecuencia (solo `move` y `collect`); un cliente malicioso podría inundar de peticiones | WARN — M6 |
| R-09 | Prohibición | Proyectos `REAL` y conectores con escritura: NO_GO (AUD-05, Q055–Q057) | NO_GO para el incremento |
| R-10 | No verificado | Obsidian: `docs/.obsidian/` no existe, no consta que se haya abierto el vault; Graphify no instalado | NO_VERIFICADO, no bloquea |

## 8. Componentes reutilizables

- **Reglas puras** `checkContribution`, `projectStatus` (`packages/shared/src/projects.ts`) y patrón de resultado `{ok, reason}`.
- **Almacén** `store.ts`: `transaction`, `event`, `hasRequest`, `contributedAmount`, `contributionTotals`, `recentContributions`, migraciones con copia previa `VACUUM INTO`.
- **Validación de configuración** (`world-config.ts`) para añadir campos de proyecto con errores legibles.
- **Estado sincronizado** `ProjectState` y la sincronización de Colyseus (también para el panel).
- **Cliente:** conexión, reconexión y `pagehide` (`main.ts`), botones `aria-disabled`, avisos `aria-live`, `project-panel.ts` como base de la vista de tareas.
- **Pruebas:** `test/helpers.ts` (`startServer`, `tempDb`, `joinWorld`, `waitFor`), fixture `regen-world.json`, `scripts/soak.ts`.

## 9. Propuesta de arquitectura mínima (`PROPUESTA`)

```text
 Mundo 2D (Phaser + panel P)          Panel profesional (/panel, lista accesible)
          │  join {name}                         │  join {name, view:"panel"}  (sin personaje)
          └──────────────┐          ┌────────────┘
                         ▼          ▼
                 WorldRoom (transporte, sesión, juego: mover, recolectar, fabricar)
                         │  delega todo lo de proyectos
                         ▼
          Núcleo de proyectos  apps/server/src/projects/
          · autoriza (rol) · valida (reglas puras) · transacción + evento
          · deriva estado de tareas · devuelve un resultado que la sala aplica
                         │
                         ▼
                 store.ts / SQLite (única fuente de verdad)
```

Responsabilidades:

- **Núcleo de proyectos** (nuevo módulo, mismo proceso): `contribute`, `review`, `readyForBuild`, `consumeForBuild`, `snapshot`. No conoce Colyseus ni el mapa; recibe el actor y el mensaje y devuelve `done | duplicate | rejected`.
- **WorldRoom**: sesión, presencia, mundo y fabricación; traduce mensajes al núcleo y aplica sus resultados al estado sincronizado. `build` sigue en la sala (depende del mapa) pero consume vía núcleo.
- **Panel profesional**: segunda página servida por el mismo servidor (lista blanca de `index.ts`), segunda entrada de esbuild (sin dependencias nuevas). Se une a la sala como **observador**: no crea personaje, no cuenta para los 4 jugadores y solo puede enviar operaciones de proyecto.
- **Permisos**: un único punto `authorize(actor, operación, proyecto)` en el núcleo. Roles por proyecto en configuración (`coordinators: [nombres]`); cualquier miembro aporta; solo coordinadores revisan. En M6 el actor pasa de nombre a cuenta sin cambiar las llamadas.

## 10. Modelo de datos y contratos propuestos (`PROPUESTA`)

**Configuración** (`ProjectDef`, retrocompatible):

```json
{ "id": "construir-taller", "reality": "VIRTUAL", "coordinators": ["ana"], "buildRequiresApproval": false,
  "tasks": [{ "id": "madera", "title": "Aportar madera", "resource": "madera", "required": 20,
              "acceptance": "Se han aportado 20 de madera al proyecto" }] }
```

- `reality`: solo `"VIRTUAL"` válido en el MVP; `SIMULACION`/`REAL` se rechazan al arrancar (AUD-05).
- `acceptance`: texto legible; el criterio verificable sigue siendo `resource` + `required`.

**Estados de tarea** (derivados + revisión persistida):

```text
pendiente ──aporte──▶ en-curso ──aportado ≥ requerido──▶ completada ──revisión(coordinador)──▶ aprobada
                                                              │                              
                                                              └──revisión──▶ rechazada ──nueva revisión──▶ aprobada
```

Completar es automático por criterio; aprobar es una decisión humana. Rechazar no mueve recursos: deja constancia y exige una nueva revisión.

**Persistencia** (migración v4, con copia `*.v3.bak`):

```sql
CREATE TABLE task_review (
  project_id TEXT NOT NULL, task_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('aprobada','rechazada')),
  reviewed_by TEXT NOT NULL, reviewed_at INTEGER NOT NULL, note TEXT NOT NULL,
  PRIMARY KEY (project_id, task_id)
);
```

Historial completo en `event` (`type = 'task-review'`), con la evidencia referenciada: `{project, task, decision, note, evidence: {contributions, lastEventId}}`.

**Mensajes** (`contracts.ts`):

| Mensaje | Carga | Quién | Rechazos nuevos |
|---|---|---|---|
| `contribute` (existente) | igual | jugador o panel (miembro) | `sin-permiso` |
| `review` (nuevo) | `{requestId, projectId, taskId, decision, note}` | coordinador | `sin-permiso`, `tarea-sin-completar`, `nota-invalida` (vacía o > 500) |
| `move`/`collect`/`transfer`/`build`/`craft` desde el panel | — | — | `sin-personaje` |

**Estado sincronizado:** `ProjectState` añade `reality`, `coordinators` y `tasks: map<TaskState{status, decision, reviewedBy, reviewedAt, note}>`.

## 11. Plan incremental (M5b)

| Paso | Capacidad completa y verificable | Gate |
|---|---|---|
| 1 | Configuración (`reality`, `acceptance`, `coordinators`, `buildRequiresApproval`) y reglas puras (`taskStatus`, `checkReview`, `authorize`) con unitarias | — |
| 2 | Extraer el núcleo de proyectos sin cambiar comportamiento: las 74 pruebas siguen pasando | Refactor verificado |
| 3 | Migración v4 + revisión de tareas en el núcleo + estado sincronizado; integración | — |
| 4 | Observadores en la sala (`view: "panel"`), límites de plazas, `sin-personaje` | — |
| 5 | Página `/panel`: lista de tareas, criterio, progreso, evidencias, revisión; aportar desde el panel | — |
| 6 | Panel del juego muestra estado de tarea y revisión | — |
| 7 | Soak con un cliente panel; demostración en navegador (mundo + panel) | — |
| 8 | Documentación, decisiones Q159+ , prueba de la persona responsable | Fusión |

## 12. Matriz de trazabilidad

| # | Capacidad del incremento | Hoy | Requisito | Componente | Prueba |
|---|---|---|---|---|---|
| 1 | Identificar un proyecto del taller | Sí | RF-006 | `content/world.json` | existente TP-06 |
| 2 | Tarea con id estable | Sí | RF-006 | `ProjectDef.tasks[].id` | existente + unitarias de estado |
| 3 | Consultar la tarea desde el mundo | Sí (sin estado de tarea) | RF-010 | `project-panel.ts` | TP-10 ampliada |
| 4 | Consultarla desde el panel profesional | No | RF-010 / **RF-015 (nuevo, PROPUESTA)** | `/panel` | TP-15 (nueva) |
| 5 | Operar desde ambas interfaces | Solo mundo | RF-006, RF-015 | núcleo + panel | TP-15 |
| 6 | Validar en el núcleo | En la sala | NFR-01 | `apps/server/src/projects/` | regresión 74 + unitarias |
| 7 | Registrar resultado y evidencias | Resultado sí, evidencia parcial | RF-012, **RF-016 (nuevo, PROPUESTA)** | `task_review`, evento `task-review` | TP-16 (nueva) |
| 8 | Actualizar desde estado autoritativo | Sí | RF-002 | `WorldState` | TP-15 (dos interfaces convergen) |
| 9 | Conservar tras recarga o reconexión | Sí | RF-009 | migración v4 | TP-09 ampliada |
| 10 | Rechazar no autorizadas | Solo inválidas | RF-003 (parcial), RF-012 | `authorize` | TP-03 parcial + TP-12 ampliada |

## 13. Plan de pruebas

| Tipo | Caso |
|---|---|
| Unitarias | `taskStatus` (pendiente/en-curso/completada/aprobada/rechazada); `checkReview` (no coordinador, tarea sin completar, nota vacía o larga, decisión inválida); `authorize`; validación de `reality` (rechaza `REAL`) y de `coordinators` |
| Regresión | Las 74 pruebas actuales tras extraer el núcleo, sin cambios en ellas |
| TP-15 (panel) | Un panel y un jugador: el aporte desde el panel aparece en el mundo y viceversa; el panel no crea personaje ni ocupa plaza (4 jugadores + panel); `move`/`collect`/`build`/`craft` desde el panel → `sin-personaje` |
| TP-16 (revisión) | Coordinador aprueba una tarea completada con nota; todos lo ven; no coordinador → `sin-permiso`; tarea incompleta → `tarea-sin-completar`; rechazar y volver a aprobar; `requestId` repetido sin efecto; la evidencia del evento coincide con los aportes |
| TP-09 ampliada | SIGKILL tras revisar: decisión, autor, hora y nota persisten |
| `buildRequiresApproval` | Con `true` en un fixture: construir sin aprobaciones → rechazo; con aprobaciones → construye |
| Migración v3 → v4 | Datos conservados, copia `*.v3.bak` |
| Carga | Soak de 15 min con un cliente panel que aporta y revisa; 0 divergencias; auditoría cuadrada |
| Navegador | Mundo y panel en dos pestañas; teclado y lector de pantalla en la lista (tabla con encabezados, `aria-live`) |

## 14. Análisis de impacto y reversibilidad

| Cambio | Impacto | Reversión |
|---|---|---|
| Extraer el núcleo | Interno al servidor; cubierto por las 74 pruebas | Revertir commits del paso 2 |
| `ProjectDef` con campos nuevos | Campos opcionales con valores por defecto: `world.json` y fixtures actuales siguen siendo válidos | Quitar campos |
| `WorldState` ampliado | Contrato compartido: cliente, pruebas y soak deben actualizarse en la misma rama | Revertir rama |
| Migración v4 | Solo añade una tabla; el código de M5 puede leer una base v4 | Copia `*.v3.bak` |
| `maxClients` y observadores | Cambia el control de plazas: se comprueba el número de jugadores en `onJoin` | Revertir; prueba de 4 + 1 |
| Nueva ruta `/panel` | Amplía la lista blanca de archivos estáticos | Quitar la entrada |
| Dependencias | **Ninguna nueva** (segunda entrada de esbuild en el script `build`) | — |

## 15. Decisiones pendientes

| Id | Decisión | Recomendación |
|---|---|---|
| D-1 | ¿«ENGREMIAT» pasa a ser el nombre del producto? | Mantenerlo como formato de informe hasta decidir el nombre; no afecta al código |
| D-2 | Forma del panel profesional | Lista/tabla accesible (Q012 reclasificada); Kanban post-MVP |
| D-3 | ¿La aprobación bloquea construir? | Configurable; `false` en `world.json` para no romper RF-013; `true` probado en fixture |
| D-4 | Roles por nombre hasta M6 | Sí, con un único punto `authorize` y el riesgo documentado (extiende Q151) |
| D-5 | Clasificación de realidad | Solo `VIRTUAL` admitido en el MVP |
| D-6 | Coordinador inicial del taller | Un nombre en `world.json` que elija la persona responsable |
| D-7 | Nuevos requisitos RF-015 (panel profesional) y RF-016 (revisión con evidencia) y decisiones Q159+ | Requiere gate (cambian requisitos) |
| D-8 | ¿Registrar acciones rechazadas? | No en M5b (R-07); valorar en M6 |

## 16. Gate humano y siguiente acción

```text
ENGREMIAT_PACKAGE_BEGIN
OK | Bucle completo del MVP implementado con servidor autoritativo, transacciones y eventos idempotentes (WorldRoom.ts, store.ts; 74 pruebas y soak M5 registrados en docs/pruebas.md §5)
OK | Fuente de verdad única: configuración validada + SQLite; el estado sincronizado es una proyección reconstruible (WorldRoom.ts:46-85)
OK | 6 de 10 capacidades del incremento ya presentes; 2 parciales; 2 ausentes (§12)
WARN | La lógica de proyectos está acoplada a la sala del juego (WorldRoom.ts:248-350)
WARN | Sin estados de tarea, evidencia vinculada ni aprobación distinta de completado
WARN | Sin permisos por rol; identidad por nombre hasta M6 (Q151); roles por nombre serían suplantables
WARN | Kanban/Gantt fuera del MVP según la reclasificación de Q012; el panel propuesto es una lista
WARN | «ENGREMIAT» como nombre de producto contradice su uso actual como formato de informe (Q142)
WARN | Pruebas no repetidas en esta auditoría (solo lectura); se citan ejecuciones registradas
NO_GO | Proyectos REAL y conectores con escritura (AUD-05, Q055–Q057)
NO_GO | Implementación de M5b hasta aprobar el plan y las decisiones D-1..D-8
NEXT | Aprobar el plan de M5b (alternativa 2: módulo de proyectos en el mismo proceso + panel profesional en lista)
ENGREMIAT_PACKAGE_END
```

**Resolución del gate (2026-10-09):** la persona responsable aprobó el plan de M5b con la alternativa 2 y decidió: coordinadores en lista configurable (D-4, D-6), aprobación configurable y desactivada en el taller (D-3) y **ENGREMIAT como nombre del producto** (D-1). D-2, D-5, D-7 y D-8 siguen la recomendación. Se registran como Q159–Q164.

### Anexo — Alternativas (fase E)

| Criterio | 1. Adaptar la sala actual | **2. Extraer módulo (recomendada)** | 3. Servicio independiente |
|---|---|---|---|
| Reutilización | Máxima | Alta (reglas, almacén, estado y pruebas intactos) | Baja (nuevo transporte, nueva API, sincronización) |
| Complejidad | Baja ahora, creciente | Moderada | Alta (dos procesos, coordinación de transacciones) |
| Acoplamiento | Alto: juego y gestión mezclados | Bajo: la sala delega | Muy bajo |
| Seguridad | Permisos dispersos por manejador | Un punto de autorización | Un punto, pero nueva superficie de red |
| Mantenimiento | Empeora con cada operación | Bueno | Costoso para un equipo pequeño |
| Riesgo de migración | Bajo | Bajo (regresión de 74 pruebas) | Alto (consistencia entre servicios, doble escritura) |
| Reversibilidad | Alta | Alta | Media |
| Evolución futura | Obliga a extraer más tarde (en M6, con permisos encima) | Frontera lista para convertirse en servicio si hace falta | Preparada, pero prematura (ADR-001, AUD-01) |

**Justificación:** la alternativa 2 cumple el principio «el núcleo es la fuente de verdad» sin infraestructura distribuida (ADR-001, `CLAUDE.md` §7), conserva todo lo verificado y deja un punto de autorización donde M6 conectará la identidad real.
