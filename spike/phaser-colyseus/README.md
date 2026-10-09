# Spike BL-02 — Phaser + Colyseus + SQLite

**Código desechable.** Sirve para decidir el stack (ADR-002); no se reutiliza en el MVP.

## Qué hace

Mundo cenital de 20 × 15 casillas definido en `config/world.json` (principio Q144: el mundo es configuración). De 2 a 4 jugadores mueven un personaje con teclado y recolectan madera de un árbol compartido. El servidor valida todo, persiste cada cambio confirmado en SQLite antes de mostrarlo y regenera el árbol con un reloj basado en marcas de tiempo, que sigue avanzando sin jugadores y con el servidor parado.

| Pieza | Elección | Versión exacta |
|---|---|---|
| Cliente | Phaser (ESM, empaquetado con esbuild) | phaser 4.2.1, esbuild 0.28.2 |
| Servidor | Colyseus, solo el núcleo (sin auth, monitor ni Redis) | @colyseus/core 0.18.18, @colyseus/ws-transport 0.18.4, @colyseus/schema 5.0.36 |
| Cliente de red | SDK de Colyseus | @colyseus/sdk 0.18.5 |
| Persistencia | `node:sqlite` integrado en Node (sin dependencia nativa) | Node 24.18, SQLite 3.53.1 |

## Uso

```bash
npm install
npm run build
npm start
```

Abrir `http://127.0.0.1:2567/?name=ana` y, en otra pestaña, `?name=bea`. Para jugar en LAN: `HOST=0.0.0.0 npm start` (Windows pedirá permiso de firewall). Pruebas: `npm test`.

## Resultados (2026-10-09, Windows 11, Node 24.18)

### Criterios eliminatorios

| Criterio | Resultado | Evidencia |
|---|---|---|
| Servidor autoritativo | OK | `npm test` — recolección lejana, teletransporte, tipos inválidos, nodo inexistente y mensaje desconocido rechazados sin cambiar el estado; modificar la copia local del cliente no afecta al servidor ni a otros |
| Convergencia ≤ 500 ms con 4 clientes | OK en localhost | Máximo observado 35–43 ms sin latencia añadida y 40–92 ms con 20 ms de latencia simulada (`COLYSEUS_LATENCY`), en 3 ejecuciones. Dominado por el `patchRate` de 50 ms |
| Persistencia sin pérdida tras caída | OK | Servidor matado con SIGKILL tras dos recolecciones; al reiniciar, inventario y nodo intactos |
| Reloj del mundo | OK | Regenera en vivo, sin jugadores conectados y con el servidor parado |
| Chrome, Edge y Firefox | OK en Chrome y Edge | Navegador integrado (Chromium) y prueba manual del usuario con Edge y Chrome a la vez: movimiento, recolección, estado idéntico en ambas ventanas y regeneración observada en vivo. Registro del servidor: 3 recolecciones y 6 rechazos correctos (casilla bloqueada, árbol agotado, demasiado lejos), sin errores. **Firefox: NO VERIFICADO** (no instalado); prueba aceptada sin él (Q145) |

Suite: 5 pruebas, 15 de 15 ejecuciones correctas (3 rondas).

### Hallazgo de diseño

Con `joinOrCreate`, un quinto jugador no era rechazado: Colyseus creaba **otra copia de la sala**, con dos instancias escribiendo los mismos registros en SQLite. Corregido creando la sala del mundo una sola vez al arrancar (`autoDispose = false`) y usando `join` en los clientes. El MVP debe tratar el mundo persistente como una instancia única con autoridad de escritura exclusiva.

### Criterios comparativos

| Criterio | Observación |
|---|---|
| Simplicidad | 403 líneas de servidor y cliente en JavaScript sin compilación de servidor; API de salas y mensajes directa |
| Madurez y licencias | Todo MIT; Colyseus 0.18 y Phaser 4 activos (publicaciones en 2026); `npm audit`: 0 vulnerabilidades |
| Documentación | Correcta para lo básico; la del paquete `colyseus` asume el meta-paquete completo, hubo que leer los tipos de `@colyseus/core` |
| Pruebas automáticas | Sencillas: el SDK funciona en Node, los servidores se lanzan como procesos y la latencia se simula por variable de entorno |
| Dependencias | 98 paquetes en total (Express entra como dependencia par de Colyseus); 153 MB en disco, de ellos 116 MB de Phaser (distribuciones múltiples). Bundle del cliente: 1,5 MB minificado, 414 KB gzip |
| Avisos | npm 11 bloquea los scripts de instalación de `esbuild` y `msgpackr-extract`; ambos funcionan sin ellos (binario por dependencia opcional y codificador en JS) |

## No verificado

- Firefox (no instalado en el equipo de pruebas).
- LAN real entre dos equipos (solo localhost y latencia simulada).
- Rendimiento con más de 4 clientes o sesiones largas (criterio de carga de 15 min no ejecutado).

Godot no se ha probado: según el plan, solo si esta opción incumplía algún criterio eliminatorio.
