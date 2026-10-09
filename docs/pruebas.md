# Plan de pruebas — BORRADOR / NO EJECUTADO

Antiguo `07_PLAN_PRUEBAS`. La trazabilidad requisito → evidencia → prueba está en `docs/especificacion.md` §2.

## 1. Clasificación

- **Unitarias:** validación de reglas de acción, costes y permisos.
- **Integración:** servicios del mundo, proyecto, inventarios y sesiones.
- **Funcionales/E2E:** bucle cooperativo de exploración a misión concluida.
- **Seguridad:** operaciones no autorizadas, inyección/manipulación de comandos, duplicaciones.
- **Accesibilidad:** navegación por teclado, etiquetas, contraste, claridad cognitiva, alternativas sensoriales según interfaz escogida.
- **Recuperación:** reinicio de servicio y restauración de datos con pruebas reales.
- **Multijugador:** sincronización, concurrencia, reconexión y rechazo de estados obsoletos.

## 2. Catálogo de casos propuestos

| ID | Escenario | Resultado esperado |
|---|---|---|
| TP-01 | Abrir juego desde navegador de escritorio | Mundo 2D cargado, navegación posible |
| TP-02 | Dos clientes actúan en la misma sesión | Ambos ven estado confirmado, sin divergencia permanente |
| TP-03 | Cliente sin permiso intenta modificar recurso | Rechazo y estado sin cambios |
| TP-04 | Jugador recolecta recurso disponible | Inventario aumenta y recurso disponible disminuye según regla |
| TP-05 | Dos acciones intentan gastar el mismo recurso | Solo operaciones válidas consuman recursos, sin saldo inválido |
| TP-06 | Equipo crea/aporta a un proyecto/tarea | Avances coherentes y auditables |
| TP-07 | Requisitos de construcción del taller | No construir sin materiales; construir al cumplir reglas |
| TP-08 | Misión concluye tras producción | Resultado persistido y visible |
| TP-09 | Reiniciar servidor y reconectar | Estado confirmado recuperado sin duplicación |
| TP-10 | Alternar mundo/panel de proyectos | Contexto preservado; datos idénticos |
| TP-11 | Navegación accesible y ayuda básica | Usuarios pueden completar acciones esenciales sin barreras críticas constatadas |
| TP-12 | Paquetes duplicados, fuera de orden o malformados | Rechazo/idempotencia según reglas y estado íntegro |
| TP-13 | Un jugador aporta al proyecto estando solo; después se conecta otro | El segundo ve el avance y el autor del aporte; sin pérdida ni duplicado |
| TP-14 | Agotar un nodo y dejar pasar tiempo de mundo con y sin clientes conectados (reloj controlable en pruebas) | El nodo recupera unidades según la regla, sin superar su máximo |
| TA-01 | Cambiar contrato entre módulos | Pruebas de integración detectan incompatibilidad |
| TA-02 | Forzar caída de servicio durante operación | Errores registrados; ninguna falsa confirmación de éxito |
| TA-03 | Intentar integración sin gate humano | Proceso de integración queda bloqueado |
| TA-04 | Revisar docs/versiones | Referencias reales y ausencia de hashes inventados |

## 3. Umbrales y plataforma

Decididos (Q134, Q143): 2–4 clientes simultáneos en local/LAN; Chrome, Edge y Firefox recientes de escritorio; acciones esenciales con teclado.

Umbrales **PROPUESTA** (pendientes de revisión humana, ajustables tras el spike):

| Umbral | Propuesta |
|---|---|
| Convergencia | Una acción confirmada es visible en todos los clientes en ≤ 500 ms en LAN |
| Reconexión | Un cliente que pierde la conexión recupera el estado actual en ≤ 5 s al volver |
| Persistencia | Tras reiniciar el servidor no se pierde ningún cambio confirmado (RPO = 0 para lo confirmado) |
| Recuperación | Servidor operativo de nuevo en ≤ 30 s tras un reinicio |
| Carga | 4 clientes jugando 15 min sin divergencias ni errores |

**NO VERIFICADO:** pérdida de paquetes tolerable, RTO/backups en producción (BL-09) y hardware de referencia. No declarar pruebas `OK` por diseño de casos.

## 4. Formato de evidencia

`ID de prueba | versión/código real | entorno real | precondición | comando/procedimiento autorizado | resultado observado | evidencia verificable | OK/WARN/ERR/NO_GO | revisor | fecha`.

Los fallos críticos deben reproducirse, diagnosticar causa, corregirse dentro del permiso y repetirse antes del cierre. Pruebas de recuperación y consistencia tienen prioridad sobre extensiones de funcionalidades.

## 5. Evidencias registradas

### M1 — 2026-10-09 (rama `m1-mundo`)

| ID | Versión | Entorno | Procedimiento | Resultado observado | Estado |
|---|---|---|---|---|---|
| TP-01 | `m1-mundo` (commit `1fc23d7`) | Windows 11, Node 24.18, navegador integrado (Chromium) | `npm.cmd run build`, `npm.cmd start`, abrir `http://127.0.0.1:2567/?name=ana` y recorrer el mundo con teclado | Mapa 40×30 cargado; recorrido Aldea → Bosque → Camino → Cantera → Pradera con flechas y WASD; cada pulsación da un paso; la cámara sigue; la zona se anuncia en el HUD; un árbol y el borde superior bloquean con aviso; sin errores de consola | OK en Chromium y en Edge (prueba del usuario, 2026-10-09) |
| TP-01 (automática) | ídem | ídem | `npm.cmd test` — prueba de integración «el mundo del MVP se sirve…» | Configuración 40×30 servida y jugador en el punto de aparición | OK |
| TP-12 (parcial: movimiento) | ídem | ídem | `npm.cmd test` — «movimiento autoritativo…» | Borde, nodo, diagonal, salto, tipo inválido, mensaje desconocido y exceso de ritmo rechazados sin cambiar el estado | OK |
| Arranque con configuración inválida | ídem | ídem | `npm.cmd test` — «el servidor no arranca…» | Sale con código 1 y lista los motivos | OK |
| Unitarias `@juego/shared` | ídem | ídem | `npm.cmd test` | 15 pruebas de validación de configuración y regla de movimiento | OK |

Totales: `npm.cmd run typecheck` sin errores; `npm.cmd test` con 19 de 19 correctas.

Durante la demostración se corrigieron dos defectos del cliente: los toques muy breves de tecla se perdían, y la etiqueta del nombre quedaba fuera del mapa en la fila superior.

### M2 — 2026-10-09 (rama `m2-sincronizacion`)

| ID | Procedimiento | Resultado observado | Estado |
|---|---|---|---|
| TP-02 | `npm.cmd test`: 2 y 4 clientes caminando a la vez 25 pasos cada uno | Al detenerse, todos ven la misma posición y conexión de todos | OK |
| Convergencia (umbral ≤ 500 ms) | `npm.cmd test`: 10 movimientos observados por 4 clientes | Máximo 58 ms sin latencia añadida; 109 ms con `COLYSEUS_LATENCY=20` | OK |
| TP-09 (parcial: reconexión) | `npm.cmd test`: corte no consentido y `client.reconnect(token)` | Los demás lo ven desconectado; vuelve en 61 ms a su posición (umbral ≤ 5 s); si no vuelve, se retira al vencer el plazo; recuperar el personaje por nombre libera la plaza reservada | OK |
| Presencia | `npm.cmd test` y navegador integrado con 2–3 pestañas | Llegadas, salidas, desconexiones y vueltas visibles y anunciadas (`aria-live`), también con la pestaña en segundo plano; recargar = salida voluntaria | OK |
| Carga (umbral: 4 clientes, 15 min) | `npm.cmd run soak` (15 min, comprobación cada 5 s) | 180 comprobaciones, 0 divergencias, 22 977 movimientos, 1 235 rechazos esperados (nodos/bordes), convergencia máxima en comprobación 17 ms, los 4 conectados al final | OK |
| Formulario de entrada | Navegador integrado | Nombre con espacio rechazado con mensaje, `aria-invalid` y foco; nombre en uso y mundo lleno con texto legible | OK |
| Red local real (Q145) | Persona responsable: servidor con `HOST=0.0.0.0` y acceso por la IP local del PC | Probado y aceptado por la persona responsable (2026-10-09) | OK |

Totales: `npm.cmd run typecheck` sin errores; `npm.cmd test` 29 de 29.

Defectos encontrados y corregidos durante la demostración:
- Los avisos de presencia se activaban antes de llegar el estado inicial, y no se activaban en pestañas en segundo plano (el bucle de Phaser se detiene).
- Recuperar un personaje dejaba ocupada la plaza de la sesión antigua, y varias recargas podían llenar el mundo.
