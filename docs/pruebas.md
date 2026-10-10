# Plan de pruebas y evidencias

Antiguo `07_PLAN_PRUEBAS`. La trazabilidad requisito → evidencia → prueba está en `docs/especificacion.md` §2; el resumen para aceptar el MVP, en `docs/aceptacion-mvp.md`.

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
| TP-15 | Panel profesional y jugador a la vez; plazas | Aportes cruzados visibles en ambas vistas; el panel no crea personaje ni ocupa plaza; acciones de mundo desde el panel rechazadas |
| TP-16 | Revisar tareas con y sin rol, completas e incompletas | Solo la coordinación revisa tareas completas; nota obligatoria; decisión y evidencia persisten; aprobación obligatoria configurable |
| TP-17 | Crear, jugar y cerrar proyectos desde el panel | Solo la administración crea y cierra; definiciones inválidas rechazadas con detalle; todos lo ven al momento; se completa con aportes; cerrado no admite aportes; límite de abiertos |
| TP-18 | Misión configurable «proyecto completado» | Se completa en la misma transacción que el aporte o la aprobación que completa el proyecto, con autor; persiste tras caída |
| TA-01 | Cambiar contrato entre módulos | Pruebas de integración detectan incompatibilidad |
| TA-02 | Forzar caída de servicio durante operación | Errores registrados; ninguna falsa confirmación de éxito |
| TA-03 | Intentar integración sin gate humano | Proceso de integración queda bloqueado |
| TA-04 | Revisar docs/versiones | Referencias reales y ausencia de hashes inventados |

## 3. Umbrales y plataforma

Decididos (Q134, Q143): 2–4 clientes simultáneos en local/LAN; Chrome, Edge y Firefox recientes de escritorio; acciones esenciales con teclado.

Umbrales **PROPUESTA** (Q168: se fijan con lo medido al firmar la aceptación; medidas en `docs/aceptacion-mvp.md` §3):

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

### M3 — 2026-10-09 (rama `m3-recursos`)

| ID | Procedimiento | Resultado observado | Estado |
|---|---|---|---|
| TP-04 | `npm.cmd test` | Recolectar suma al inventario y resta al nodo; los demás clientes lo ven | OK |
| Rechazos de recolección | `npm.cmd test` | Demasiado rápido, inventario lleno, nodo agotado y nodo lejos, con motivo legible | OK |
| TP-05 (última unidad) | `npm.cmd test`: dos jugadores a por la última piedra | Solo uno la obtiene; el otro recibe «nodo agotado»; nodo a 0 | OK |
| TP-05 (doble gasto) | `npm.cmd test`: 3 transferencias simultáneas de 2 con saldo 3 | Pasa una; dos rechazadas por saldo insuficiente; nunca negativos | OK |
| TP-12 (duplicados e inválidos) | `npm.cmd test` | El mismo `requestId` en recolectar o transferir cuenta una vez; cantidad negativa, recurso o destino desconocido y falta de `requestId` se rechazan sin cambios | OK |
| TP-09 (caída) | `npm.cmd test`: SIGKILL tras recolectar y depositar | Inventarios, comunidad y nodos intactos tras reiniciar; posición restaurada (guardado cada 5 s); auditoría 3 = 3 | OK |
| TP-14 (reloj del mundo) | `npm.cmd test` con regeneración de 1 s | Regenera en vivo, sin jugadores y con el servidor parado, sin superar el máximo | OK |
| Almacén | `npm.cmd test` (5 pruebas) | Migración versionada, `CHECK` contra negativos con reversión completa, `requestId` único, auditoría | OK |
| Carga con recursos (umbral: 4 clientes, 15 min) | `npm.cmd run soak` | 173 comprobaciones de estado completo (posiciones, inventarios, nodos, comunidad), 0 divergencias; 23 302 movimientos, 310 recolecciones y 27 depósitos enviados; **auditoría: recolectado = en inventarios (madera 120, piedra 80, fibra 100)** | OK |
| Demostración | Navegador integrado con servidor reiniciado bruscamente | Recolección, aviso de ritmo, depósito solo con teclado (el foco se conserva), vista desde otra pestaña, «Desconectado» con botón durante la caída y todo intacto al volver; auditoría 3 = 3 | OK |
| Prueba del usuario | Persona responsable, con dos jugadores en Edge | Recolección de madera y piedra, depósito en la comunidad y lista de jugadores correctos (captura del 2026-10-09) | OK |

Totales: `npm.cmd run typecheck` sin errores; `npm.cmd test` 51 de 51.

Defectos encontrados y corregidos:
- Con `INSERT … ON CONFLICT`, SQLite validaba el `CHECK` en la fila candidata, de modo que restar de un inventario fallaba siempre. Lo detectó la prueba de auditoría del almacén.
- `crypto.randomUUID` no existe en contextos no seguros (la IP de la red local): se usa `getRandomValues`.
- Con la pestaña oculta, los movimientos dependían del bucle de fotogramas: ahora un toque se envía al pulsar.


### M4 — 2026-10-09 (rama `m4-proyecto`)

| ID | Procedimiento | Resultado observado | Estado |
|---|---|---|---|
| TP-06 | `npm.cmd test` | Aportes desde el inventario y desde la comunidad; ambos jugadores ven progreso, quién aportó y actividad; recorte del sobrante (Q153); «tarea completa» al pasarse; proyecto «listo» con las tres tareas | OK |
| TP-05 (última unidad) | `npm.cmd test`: dos aportes simultáneos con 1 unidad pendiente | Uno pasa y el otro recibe «tarea completa»; el progreso no supera lo requerido | OK |
| TP-12 | `npm.cmd test` | `requestId` repetido sin efecto; tarea o proyecto desconocidos, origen no permitido, cantidad inválida, saldo insuficiente y falta de `requestId` rechazados sin cambios | OK |
| TP-13 (asíncrono) | `npm.cmd test` y navegador integrado | Quien entra después ve el avance y los autores; al volver se reciben las novedades («bea aportó 1 de madera»); una sola vez por sesión | OK |
| TP-09 | `npm.cmd test`: SIGKILL con el proyecto a medias | Progreso, autores, actividad y almacén intactos; auditoría 3 = 3 en todos los ámbitos | OK |
| TP-10 | Navegador integrado | P lleva al panel del proyecto y M vuelve al mapa; posición e inventario se conservan; aportes con teclado y foco conservado | OK |
| Migración v1 → v2 | `npm.cmd test` | Datos conservados y copia `*.v1.bak` creada antes de migrar | OK |
| Carga (4 clientes, 15 min) | `npm.cmd run soak` | 173 comprobaciones del estado completo (incluido el proyecto), 0 divergencias; 316 recolecciones, 28 aportes y 23 depósitos enviados; proyecto completado (20/15/5) sin superar lo requerido; **auditoría: recolectado = jugadores + comunidad + proyecto (madera 120, piedra 80, fibra 100)** | OK |
| Prueba del usuario | — | Fusión autorizada por la persona responsable el 2026-10-09 sin prueba manual registrada | NO VERIFICADO |

Totales: `npm.cmd run typecheck` sin errores; `npm.cmd test` 63 de 63.

### M5 — 2026-10-09 (rama `m5-taller-mision`)

| ID | Procedimiento | Resultado observado | Estado |
|---|---|---|---|
| Unitarias | `npm.cmd test` | `isNextTo`, `checkBuild` (Q156), `checkCraft` (Q157), `missionSatisfied` (Q158) y validación de estructuras, objetos, recetas y misiones (huella sobre la aparición, referencias desconocidas) | OK |
| TP-07 | `npm.cmd test` | Rechazos «proyecto sin terminar», «lejos del solar» y «solar ocupado»; dos órdenes simultáneas: una construye y la otra recibe «ya construido»; el inventario del proyecto queda a 0, el progreso se conserva, el taller bloquea el paso y ya no admite aportes; auditoría cuadrada | OK |
| TP-08 | `npm.cmd test` | Rechazos «taller sin construir», «faltan materiales» y «lejos del taller»; al fabricar se consumen las entradas del almacén común, aparece 1 herramienta y la misión queda completada con autor y hora; el otro jugador lo ve | OK |
| TP-12 | `npm.cmd test` | Estructura o receta desconocidas y `requestId` ausente o inválido rechazados sin cambios; `build` repetido con el mismo `requestId` sin efecto ni rechazo | OK |
| Ciclo completo (gate) y TP-09 | `npm.cmd test` | Dos jugadores de cero a misión completada (recolectar → depositar → aportar → construir → fabricar); SIGKILL; tras reiniciar, un tercer jugador ve el taller (con su bloqueo), el proyecto «construido», la misión completada y la herramienta; auditoría `balanced`, fabricado `{herramienta: 1}` | OK |
| Migración v2 → v3 | `npm.cmd test` | Datos conservados, copia `*.v2.bak`; no se construye ni se completa dos veces; auditoría con consumos y objetos | OK |
| Navegador | Navegador integrado, dos pestañas | Ciclo completo con reinicio del servidor; auditoría de la base de demostración cuadrada (madera 7 = 2 + 5 consumidas; piedra 2 = 2 consumidas; herramienta 1 = 1) | OK |
| Carga (4 clientes, 15 min) | `npm.cmd run soak` | 173 comprobaciones del estado completo (incluidos estructuras y misiones), 0 divergencias, convergencia máx. 1 ms; 317 recolecciones, 31 aportes, 76 depósitos, 1 construcción y 29 órdenes de fabricar; proyecto «construido» (20/15/5), misión completada, 28 herramientas; **auditoría: recolectado + fabricado = inventarios + consumido** (madera 120 = 16 + 104; piedra 79 = 8 + 71; fibra 100 = 39 + 61; herramienta 28 = 28) | OK |
| Prueba del usuario | Persona responsable | «ya está probado» (2026-10-09); fusión autorizada | OK |

Totales: `npm.cmd run typecheck` sin errores; `npm.cmd test` 74 de 74.

### M5b — 2026-10-09 (rama `m5b-nucleo-proyectos`)

| ID | Procedimiento | Resultado observado | Estado |
|---|---|---|---|
| Unitarias | `npm.cmd test` | `authorize`, `taskStatus` (todas las transiciones), `checkReview` (permiso, decisión, nota 1–500, tarea incompleta), `checkBuild` con `tareas-sin-aprobar`; validación de `reality` (rechaza `REAL` y `SIMULACION`), `coordinators`, `buildRequiresApproval`, `acceptance` y valores por defecto | OK |
| Regresión tras extraer el núcleo | `npm.cmd test` antes de añadir funciones | 80 de 80 (74 anteriores + 6 unitarias nuevas) sin cambiar ninguna prueba existente | OK |
| TP-16 | `npm.cmd test` | No coordinador → `sin-permiso`; tarea incompleta → `tarea-sin-completar`; nota vacía → `nota-invalida`; rechazar y volver a aprobar; `requestId` repetido sin efecto; evento `task-review` con evidencia `{contributions: 2, lastEventId}` igual al último aporte; tras SIGKILL y reinicio la revisión persiste (TP-09) | OK |
| Aprobación obligatoria (Q162) | `npm.cmd test` con `approval-world.json` | Construir sin aprobaciones o con una tarea rechazada → `tareas-sin-aprobar`; con todas aprobadas, construye | OK |
| TP-15 | `npm.cmd test` | El panel no crea personaje; `move`, `collect`, `transfer`, `build` y `craft` desde el panel → `sin-personaje`; aportes del panel visibles en el mundo y viceversa; un panel con el nombre de un jugador aporta desde su inventario y su personaje lo ve; con 4 jugadores el 5.º recibe `mundo-lleno` y los paneles siguen entrando hasta 4 | OK |
| Migración v3 → v4 | `npm.cmd test` | Datos conservados, copia `*.v3.bak`, una revisión por tarea, decisión inválida rechazada por `CHECK` | OK |
| Navegador | Navegador integrado: mundo (ana) + panel (luis) + panel (ana) | Aporte desde el panel visible en el mundo; aprobación con teclado desde el panel de la coordinadora visible en el mundo y en el otro panel; tras reiniciar el servidor la aprobación sigue | OK |
| Carga (4 clientes + 1 panel, 15 min) | `npm.cmd run soak` | 173 comprobaciones del estado completo en los 5 clientes (incluidos estados y revisiones de tareas), 0 divergencias, convergencia máx. 1 ms; 6 revisiones del panel (todas las tareas aprobadas por `coordinacion`); proyecto construido, misión completada, 28 herramientas; auditoría cuadrada (madera 120 = 16 + 104; piedra 79 = 8 + 71; fibra 100 = 39 + 61; herramienta 28 = 28) | OK |
| Aportes del panel en carga | `npm.cmd run soak` | 0 aportes del panel: el proyecto se completa en menos de un minuto y el almacén común está vacío en esa fase. Los aportes desde el panel están cubiertos por TP-15 y la demostración en el navegador | WARN |
| Clon limpio | `npm.cmd ci`, `typecheck`, `test`, `build` | Sin errores; 85 de 85 | OK |
| Prueba del usuario | Persona responsable | «ya está probado» (2026-10-09); fusión autorizada | OK |

Totales: `npm.cmd run typecheck` sin errores; `npm.cmd test` 85 de 85.

### M6 — 2026-10-09 (rama `m6-endurecimiento`)

| ID | Procedimiento | Resultado observado | Estado |
|---|---|---|---|
| Unitarias de cuentas | `npm.cmd test` | Nombre, contraseña de 8 a 128 caracteres y declaración de edad obligatorias; nombre único sin distinguir mayúsculas; bloqueo tras 5 fallos durante 30 s; cierre de sesión; caducidad a los 30 días; token inventado rechazado | OK |
| Secretos en reposo | `npm.cmd test` | La contraseña y el token no aparecen en claro en la base ni en el WAL; solo se guarda el hash SHA-256 del token | OK |
| TP-03 | `npm.cmd test` | Sin token, con token inventado o tras cerrar sesión no se entra (`sesion-invalida`), tampoco al panel; un `name` enviado por el cliente se ignora; una contraseña equivocada no da acceso a la cuenta de la coordinadora; un no coordinador recibe `sin-permiso` | OK |
| Endpoints de cuentas | `npm.cmd test` | 400 (edad, contraseña, JSON inválido, cuerpo > 4 KB), 409 (nombre ocupado, también con otras mayúsculas), 401 y 429 tras 5 fallos | OK |
| Logs | `npm.cmd test` | Líneas JSON de arranque, registro, inicio de sesión y sesión inválida; sin contraseñas ni tokens en la salida | OK |
| Límite de frecuencia (Q167) | `npm.cmd test`: 50 aportes en ráfaga | ≥ 40 rechazados con `demasiadas-solicitudes`; solo cuentan los 3 con saldo; auditoría cuadrada | OK |
| TA-02 | `npm.cmd test` | Fallo inyectado a mitad de un aporte o de la construcción: no cambia ningún saldo, no queda evento ni estructura y el mismo `requestId` se puede reintentar | OK |
| Migración v4 → v5 | `npm.cmd test` | Datos conservados, copia `*.v4.bak`; la primera cuenta con un nombre antiguo recupera su inventario (Q166) | OK |
| Reconexión (umbral ≤ 5 s) | `npm.cmd test` | 64 ms | OK |
| Recuperación (umbral ≤ 30 s) | `npm.cmd test` con 50 000 eventos | Arranque y primera entrada en 402 ms | OK |
| Regresión | `npm.cmd test` | Todas las pruebas anteriores con cuentas automáticas en los helpers | OK |
| TP-11 (Chromium) | Navegador integrado, solo teclado | Crear cuenta (el error de edad se anuncia y pone el foco en la casilla) → el foco pasa al mapa → recolectar → P → aportar → M → depositar → construir → fabricar → misión completada, con todos los avisos; recarga con sesión guardada; salir de la cuenta. Orden de tabulación lógico | OK |
| Contraste | Navegador integrado, medición por script de todo el texto HTML visible | Mundo: 53 textos, mínimo 9,99:1. Panel: mínimo 8,64:1 (estados, etiquetas, errores). Umbral WCAG AA 4,5:1. No se mide el texto dentro del lienzo, cuya información también está en HTML | OK |
| TP-11 (Chrome y Edge) | Persona responsable, 2026-10-10 | Probado y aceptado; captura del panel con el mundo real (`coordinacion` aprueba las tres tareas) | OK |
| TP-11 (Firefox) | — | No instalado; excepción aceptada (Q169) | NO VERIFICADO (excepción aceptada) |
| Carga (4 clientes + 1 panel con cuentas, 15 min) | `npm.cmd run soak` | 173 comprobaciones, 0 divergencias, convergencia máx. 1 ms; proyecto construido, tareas aprobadas por `coordinacion`, misión completada, 28 herramientas; auditoría cuadrada (madera 120 = 16 + 104; piedra 78 = 7 + 71; fibra 100 = 39 + 61; herramienta 28 = 28) | OK |
| Clon limpio | `npm.cmd ci`, `typecheck`, `test`, `build` | Sin errores; 98 de 98 | OK |

Totales: `npm.cmd run typecheck` sin errores; `npm.cmd test` 98 de 98.

Defectos encontrados y corregidos:
- `fetch` se niega a conectar con ciertos puertos (por ejemplo, el 3659). Las pruebas elegían puertos al azar entre 3600 y 4000 y fallaban de vez en cuando; ahora usan 42000–43999.
- Tras entrar, el foco se quedaba en la página y había que buscar el mapa con el teclado; ahora pasa al mapa.
