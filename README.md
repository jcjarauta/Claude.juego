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
| `docs/decisiones.md` | Registro histórico de las 130 decisiones (Q001–Q130) |

## Cómo se trabaja

Cada tarea sigue el ciclo de `CLAUDE.md` §4: Claude propone un plan, una persona lo aprueba, Claude implementa en una rama con pruebas, y una persona revisa y fusiona. Ningún documento autoriza por sí mismo escribir código, instalar dependencias, sincronizar Obsidian/Graphify, contactar sistemas remotos ni desplegar.

## Convenciones de evidencia

`VERIFICADO` (con evidencia citable; en `docs/decisiones.md` significa *decidido*, no *implementado*), `NO VERIFICADO`, `INFERENCIA`, `PROPUESTA`, `SIMULACIÓN`. Estados operativos: `OK`, `WARN`, `ERR`, `NO_GO` (bloquea solo la operación indicada).

## Historia

El commit inicial `b203e92` conserva íntegro el paquete original del 2026-10-09 (14 documentos y manifiesto SHA-256, extraídos de `JUEGO_COOPERATIVO_DISENO_PROVISIONAL_20261009.zip`). La consolidación posterior fusionó documentos solapados sin eliminar decisiones; `git log --follow` muestra el origen de cada archivo.

Equivalencias: 00→`README.md`; 02, 08, 11, 12→`CLAUDE.md`; 03, 06, 13→`docs/especificacion.md`; 04→`docs/arquitectura.md`; 05, 09→`docs/hoja-ruta.md`; 07→`docs/pruebas.md`; 10→`docs/decisiones.md`; manifiesto→historial git.

## Próximo gate

Decisión humana sobre BL-01 (perspectiva 2D) y los pendientes PEND-01–05 de `docs/hoja-ruta.md`.
