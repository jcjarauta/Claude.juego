# ADR-002 — Stack del MVP: Phaser + Colyseus + SQLite

**Estado:** PROPUESTA — pendiente de aprobación humana  
**Fecha:** 2026-10-09  
**Requisitos:** BL-02, RF-001, RF-002, RF-005, RF-009, RF-012, RF-014, NFR-01; decisiones Q058–Q060, Q132–Q135, Q143, Q144

## Contexto

El MVP necesita un mundo 2D cenital en navegador, 2–4 jugadores en local/LAN, servidor autoritativo, persistencia sin pérdida de lo confirmado y un reloj del mundo. Q135 pidió elegir el stack con un spike y un ADR.

## Opciones

1. Phaser + Colyseus + SQLite (probada en `spike/phaser-colyseus/`).
2. Godot con exportación web (no probada: solo era necesaria si la opción 1 fallaba).
3. Nakama + cliente web (descartada sin probar por peso operativo para un MVP local).

## Decisión propuesta

Adoptar para el MVP:

- **Cliente:** Phaser 4 empaquetado con esbuild.
- **Servidor:** `@colyseus/core` + `@colyseus/ws-transport` + `@colyseus/schema` (sin el meta-paquete `colyseus`), en un único proceso Node 24 (monolito modular, ADR-001).
- **Persistencia:** `node:sqlite` integrado, con escritura previa a la confirmación (write-through) y transacciones.
- **Lenguaje:** a decidir en M1 entre JavaScript con JSDoc (como el spike) y TypeScript.

Reglas derivadas del spike:

- El mundo persistente es **una sola sala** creada al arrancar (`autoDispose = false`); los clientes usan `join`, nunca `joinOrCreate`.
- Cada cambio de inventario o recursos se persiste en transacción **antes** de modificar el estado sincronizado.
- El reloj del mundo se calcula desde marcas de tiempo persistidas.
- El contenido del mundo (mapa, nodos y, después, proyectos y misiones) se carga desde configuración (Q144).
- Versiones exactas fijadas con `package-lock.json`.

## Evidencia

`spike/phaser-colyseus/README.md`: 5 pruebas automáticas, 15 de 15 ejecuciones correctas. Convergencia máxima de 92 ms con 4 clientes y 20 ms de latencia simulada (límite: 500 ms). Persistencia tras SIGKILL y regeneración sin jugadores verificadas. Cliente probado en Chromium.

## Consecuencias

- Todo el código en JavaScript/TypeScript: una sola cadena de herramientas y reglas compartibles entre cliente y servidor.
- Phaser aporta 414 KB gzip al cliente; aceptable para escritorio.
- Express entra como dependencia par de Colyseus.
- Escalar más allá de una sala o un proceso exigiría `presence`/`driver` de Colyseus (Redis); fuera del MVP.

## Pendiente antes de aprobar

- Prueba manual en Edge y Firefox.
- Prueba en LAN real con dos equipos (`HOST=0.0.0.0`).
