# Juego cooperativo multijugador

**Estado:** diseño `PROPUESTA / PENDIENTE_GATE_HUMANO`. Sin código del juego. No es `GO_IMPLEMENTACIÓN`.

Juego cooperativo web con mundo persistente, comunidades, proyectos y misiones. El primer objetivo es un MVP vertical 2D: varios jugadores exploran, recolectan, construyen un taller y completan una misión, con persistencia.

## Estructura

| Archivo | Propósito |
|---|---|
| `CLAUDE.md` | Reglas de trabajo para Claude Code: autoridad, gates, ciclo por tarea, evidencia, formato |
| `.claude/settings.json` | Permisos técnicos de Claude (permitir / preguntar / denegar) |
| `docs/especificacion.md` | Requisitos con trazabilidad, casos de uso, modelo conceptual, visión futura |
| `docs/arquitectura.md` | Módulos, comunicación, persistencia, seguridad, herramientas, ADR |
| `docs/hoja-ruta.md` | Etapas, bloqueos, tensiones y pendientes de decisión |
| `docs/pruebas.md` | Estrategia y catálogo de pruebas (no ejecutadas) |
| `docs/decisiones.md` | Registro de las 143 decisiones (Q001–Q143) y reclasificación de las marcadas MVP |

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

Abre `http://127.0.0.1:2567`, escribe tu nombre y entra (también vale `?name=ana` en la URL).

**Red local (2–4 jugadores):** en PowerShell, `$env:HOST="0.0.0.0"; npm.cmd start`. Windows pedirá permiso de firewall para Node: concédelo solo para redes privadas. Los demás abren `http://<IP-del-PC>:2567` (la IP aparece con `ipconfig`, en «Dirección IPv4» del adaptador conectado a la red local).

Comprobaciones: `npm.cmd run typecheck` y `npm.cmd test` (las pruebas usan bases de datos temporales). Prueba de carga de 15 min: `npm.cmd run soak`. El contenido del mundo está en `content/world.json`.

**Datos:** el estado del mundo (nodos, inventarios, posiciones y registro de eventos) se guarda en `data/world.db`, que no está bajo control de versiones. Para empezar un mundo nuevo, detén el servidor y borra ese archivo.

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

M1–M5 cerradas: el bucle completo del MVP funciona (recolectar → aportar → construir el taller → fabricar la herramienta → misión completada), con persistencia y 2–4 jugadores en red local. Siguiente: M6 (endurecimiento), con una posible etapa previa de núcleo de proyectos.

Para leer la documentación en Obsidian: *Open folder as vault* → carpeta `docs/` del repositorio.
