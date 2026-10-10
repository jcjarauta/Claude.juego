# ENGREMIAT — juego cooperativo multijugador

**Estado:** **MVP aceptado** el 2026-10-10 (M1–M6 cerradas; `docs/aceptacion-mvp.md`). Fases posteriores F1a, F1b y F1c cerradas; F2a (editor de construcciones) hecha en rama.

Juego cooperativo web con mundo persistente, comunidades, proyectos y misiones. El primer objetivo es un MVP vertical 2D: varios jugadores exploran, recolectan, construyen un taller y completan una misión, con persistencia.

## Estructura

| Archivo | Propósito |
|---|---|
| `CLAUDE.md` | Reglas de trabajo para Claude Code: autoridad, gates, ciclo por tarea, evidencia, formato |
| `.claude/settings.json` | Permisos técnicos de Claude (permitir / preguntar / denegar) |
| `docs/especificacion.md` | Requisitos con trazabilidad, casos de uso, modelo conceptual, visión futura |
| `docs/arquitectura.md` | Módulos, comunicación, persistencia, seguridad, herramientas, ADR |
| `docs/hoja-ruta.md` | Etapas, bloqueos, tensiones y pendientes de decisión |
| `docs/pruebas.md` | Catálogo de pruebas y evidencias de cada etapa |
| `docs/decisiones.md` | Registro de decisiones (Q001–Q164) y reclasificación de las marcadas MVP |
| `docs/auditoria-engremiat-2026-10-09.md` | Auditoría de solo lectura que dio origen a M5b |
| `docs/aceptacion-mvp.md` | Matriz requisito → prueba → evidencia, umbrales medidos y firma del MVP |

## Arranque (Windows)

Requisitos: Node 24 o superior. En PowerShell usa `npm.cmd` (la política de ejecución puede bloquear `npm`).

```bash
npm.cmd install
```
```bash
npm.cmd run build
```
```bash
npm.cmd start
```

Abre `http://127.0.0.1:2567`. La primera vez elige «Crear una cuenta nueva» (nombre, contraseña de 8 a 128 caracteres y declaración de mayoría de edad); después basta con «Entrar». La sesión dura 30 días en ese navegador; «Salir de la cuenta» la cierra.

**Panel de proyectos:** `http://127.0.0.1:2567/panel` (o el enlace del panel del proyecto). Muestra tareas, criterios, evidencias y revisiones del mismo estado que el mundo, sin crear personaje. Para aprobar o rechazar tareas hay que entrar con una cuenta cuyo nombre esté en `coordinators` del proyecto. La **administración** (lista `admins` de `content/world.json`, por defecto `coordinacion`) ve además los formularios «Nuevo proyecto» y «Nueva misión» y puede cerrar proyectos creados en el panel; los jugadores eligen el proyecto en el panel del juego (P). Las pestañas **Tablero**, **Cronograma** e **Indicadores** del panel muestran los mismos datos de otra forma (flechas para cambiar de pestaña); la coordinación aprueba desde las tarjetas y replanifica fechas desde el cronograma.

**Red local (2–4 jugadores):** en PowerShell, `$env:HOST="0.0.0.0"; npm.cmd start`. Windows pedirá permiso de firewall para Node: concédelo solo para redes privadas. Los demás abren `http://<IP-del-PC>:2567` (la IP aparece con `ipconfig`, en «Dirección IPv4» del adaptador conectado a la red local).

Comprobaciones: `npm.cmd run typecheck` y `npm.cmd test` (las pruebas usan bases de datos temporales). Prueba de carga de 15 min: `npm.cmd run soak`. El contenido del mundo está en `content/world.json`.

**Datos:** el estado del mundo (nodos, inventarios, posiciones, cuentas y registro de eventos) se guarda en `data/world.db`, que no está bajo control de versiones. Para empezar un mundo nuevo, detén el servidor y borra ese archivo.

| Carpeta | Contenido |
|---|---|
| `packages/shared` | Contratos cliente↔servidor, validación de la configuración y reglas puras |
| `apps/server` | Servidor Colyseus autoritativo |
| `apps/client` | Cliente Phaser |
| `content` | Datos del mundo (Q144) |
| `spike/` | Prototipo desechable de BL-02 (solo evidencia) |

## Cómo se trabaja

Cada tarea sigue el ciclo de `CLAUDE.md` §4: Claude propone un plan, una persona lo aprueba, Claude implementa en una rama con pruebas, y una persona revisa y fusiona. Ningún documento autoriza por sí mismo escribir código, instalar dependencias, sincronizar Obsidian/Graphify, contactar sistemas remotos ni desplegar.

## Convenciones de evidencia

`VERIFICADO` (con evidencia citable; en `docs/decisiones.md` significa *decidido*, no *implementado*), `NO VERIFICADO`, `INFERENCIA`, `PROPUESTA`, `SIMULACIÓN`. Estados operativos: `OK`, `WARN`, `ERR`, `NO_GO` (bloquea solo la operación indicada).

## Historia

El commit inicial `b203e92` conserva íntegro el paquete original del 2026-10-09 (14 documentos y manifiesto SHA-256, extraídos de `JUEGO_COOPERATIVO_DISENO_PROVISIONAL_20261009.zip`). La consolidación posterior fusionó documentos solapados sin eliminar decisiones; `git log --follow` muestra el origen de cada archivo.

Equivalencias: 00→`README.md`; 02, 08, 11, 12→`CLAUDE.md`; 03, 06, 13→`docs/especificacion.md`; 04→`docs/arquitectura.md`; 05, 09→`docs/hoja-ruta.md`; 07→`docs/pruebas.md`; 10→`docs/decisiones.md`; manifiesto→historial git.

## Próximo gate

M1–M5 cerradas: el bucle completo del MVP funciona (recolectar → aportar → construir el taller → fabricar la herramienta → misión completada), con persistencia y 2–4 jugadores en red local. M5b cerrada: núcleo de proyectos separado, estados de tarea, revisión con evidencia y permisos, y panel profesional. M6 cerrada: cuentas locales, límite de frecuencia, robustez ante fallos, logs, accesibilidad y umbrales medidos. **MVP aceptado el 2026-10-10** (excepción: Firefox sin probar). F1a cerrada: la administración crea proyectos y misiones desde el panel sin programar ni reiniciar. F1b cerrada: el panel tiene pestañas Lista, Tablero, Cronograma e Indicadores, y los proyectos admiten fechas objetivo y replanificación con motivo. F1c cerrada: responsables por tarea, dependencias que bloquean aportes hasta terminar los requisitos (con cadena crítica en el cronograma) y comentarios por tarea. F2a hecha en la rama `f2a-editor-construcciones`: la administración crea desde el panel construcciones (un proyecto con su edificio y solar en el mapa, con previsualización), objetos y recetas, que los jugadores construyen y fabrican en el mundo. Pendiente: tu prueba y la fusión.

Para leer la documentación en Obsidian: *Open folder as vault* → carpeta `docs/` del repositorio.
