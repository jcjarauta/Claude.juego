## Dependencias que el inventario automático no ve (manual)

### Sitios de avisos (unificados en la consola, P3)

Todos los avisos pasan por `apps/client/src/feed.ts` (bus único → historial y notificaciones) y los lee el anunciador (`#anuncio-alerta` con `role="alert"` y `#anuncio-educado` con `aria-live="polite"`, creados en `#partida`). La consola se monta en `#zona-consola`.

| Antes | Ahora |
|---|---|
| `#aviso`, `#acciones`, `#presencia`, `#proyecto-aviso`, `#habilidades-aviso` | **Eliminados**; sus mensajes son eventos (`hud.notify/announceAction/announcePresence` y `say` ya no existen) |
| `#conexion` | Se mantiene como estado en la barra (sin región viva); la pérdida de conexión emite una crítica con clave `conexion` que se resuelve al reconectar |
| `#zona` | Sin región viva; el cambio de zona es un evento de mundo |
| `#proyecto-novedades` | Texto de la pestaña Comunidad (sin región viva); además entra en el historial |

### Dependencias de comportamiento entre código y estructura

- `hud.setInventory` crea las filas de `#inventario` una vez (`tr[data-resource]`) y luego solo cambia sus textos para no perder el foco; **no se pueden recrear esas filas al mover la tabla**.
- `main.ts` mueve el foco a `#game` solo cuando se acaba de rellenar el formulario de entrada (si la sesión ya estaba guardada no se mueve; así el primer Tab llega al enlace de salto).
- `project-panel.ts` oculta y muestra `#construir`, `#taller` y `#taller-recetas` según el estado del proyecto y reconstruye los bloques de receta dentro de `#taller-recetas`; `#cadenas-juego`, `#misiones`, `#proyecto-aportes` y `#proyecto-actividad` se rellenan por sustitución de hijos.
- `skills-panel.ts` oculta `#habilidades-seccion` si no hay habilidades; `#ensenar-opciones` y `#ensenar-boton` se actualizan sin recrearse.
- `WorldScene.ts` usa `#proyecto-selector` (cambio de proyecto), `#jugadores` (lista de personas) y los atajos **P** (foco al panel del proyecto: `#proyecto-titulo`) y **M** (foco al mapa: `#game`). El panel P no puede dejar de ser enfocable.
- `#game` es el contenedor del lienzo de Phaser (`parent: "game"`): debe seguir siendo un contenedor con tamaño propio.
- `account.ts` (formulario de entrada) usa `#entrada`, `#nombre`, `#contrasena`, `#edad`, `#edad-bloque`, `#nombre-error`, `#entrada-boton` en **las dos páginas**; deben existir en `index.html` y `panel.html`.

### Selectores CSS que dependen de la estructura (T4)

Coincidencias en la línea base del juego (con el mundo de prueba sembrado, ancho 570 px; ver `scripts/dom-baseline.json`):

| Selector | Coincidencias | Qué depende de él |
|---|---|---|
| `#proyecto p` | 12 | Ajuste de palabras largas (`overflow-wrap`) en el panel |
| `#proyecto h2` | 1 | Tamaño del título del proyecto |
| `.juego > *` | 2 | `min-width: 0` de las dos columnas de la rejilla (si falta, el mapa fuerza desplazamiento horizontal) |
| `.tareas li`, `.tareas progress` | 2 y 2 | Rejilla de cada tarea y su barra |
| `.tarea-acciones button` | 6 | Tamaño de los botones de aportar |
| `.recursos section`, `.recursos table`, `.recursos th`, `.recursos td`, `.recursos td button` | 2, 2, 13, 11, 6 | Tablas de inventario y almacén, y su desplazamiento propio con texto ampliado |
| `fieldset label`, `#edad-bloque label` | 2 y 1 | Etiquetas normales (no en negrita) del formulario de entrada |
| `#cadenas-juego li`, `#habilidades-lista` | 3 y 1 | Lista de cadenas y de habilidades |
| `button[aria-disabled="true"]` | 9 | Aspecto de los botones desactivados |
| `.pestanas [role="tab"]`, `.progreso-tarjeta progress` | 0 | Reglas de `base.css` aún sin uso en el juego (las usará G3b) |

### Línea base de la pantalla actual (puerta P0, 2026-10-11)

Mundo de prueba (`apps/server/test/fixtures/ui-world.json` + `scripts/ui-seed.ts`), cuenta de prueba `ana`.

- **Diseño:** a 1280 px, rejilla de dos columnas `800px 413px`; el panel de proyecto mide **1117 px de alto**, el inventario y el almacén quedan en **y = 1108** (bajo el panel) y la página mide **1660 px**; sin desplazamiento horizontal. A 570 px, una sola columna y 19 enfocables repartidos en más de 2000 px de página.
- **T1 (visibilidad):** 61 ids, 41 visibles; el juego no tiene pestañas (el panel `/panel` tiene cuatro: Lista, Tablero, Cronograma e Indicadores; con flechas, Inicio y Fin se activa exactamente un panel, `aria-selected` y `tabindex` coherentes, ningún panel vacío).
- **T2 (controles y efectos):** 27 controles (19 enfocables visibles); los únicos sin manejador propio son `#volver` (lo asigna `offerRejoin` al perder la conexión) y `#ensenar-opciones` (un `select` que no necesita manejador). Efectos medidos: depositar 1 de madera → inventario 3→2 y almacén 3→4 con aviso en `#acciones`; depositar todo de piedra → inventario 2→0 y almacén 2→4; fabricar la herramienta → almacén madera −2, piedra −1, herramienta +1, aviso en `#proyecto-aviso` y misión «Primera herramienta» completada por `ana`.
- **T3 (foco):** el recorrido real con 24 pulsaciones de Tab coincide con el orden del documento: enlace de salto → `#game` → «Salir de la cuenta» → selector de proyecto → enlace al panel → aportar (seis botones) → fabricar → depositar (seis botones) → «Ofrecer enseñar» → vuelta al enlace de salto. Sin `tabindex` positivo ni trampas.
- **T4 (CSS):** 35 selectores estructurales (tabla anterior) y estilos calculados de muestra (tamaño, peso, `display`, márgenes y relleno de `#game`, `#proyecto`, `#proyecto-titulo`, `#inventario`, `#jugadores`, `.recursos th`, `.tareas li`, `h1`, `h2`, `h3`…) en `scripts/dom-baseline.json`.

### Marco de pantalla (puerta P2, 2026-10-11)

`index.html` se reorganiza en zonas **conservando todos los ids** (los elementos se han movido enteros; solo se han añadido contenedores y los cinco botones de pestaña con sus paneles):

| Zona | Contenedor | Contenido (ids que alberga) |
|---|---|---|
| A. Barra superior | `header.zona-barra` | `zona`, `posicion`, `conexion`, `salir` |
| B. Mundo | `section.zona-mundo` | `game`, `aviso`, `acciones`, `volver` |
| C. Objetivo actual | `section#objetivo.zona-objetivo` (G3c, P1) | `objetivo-titulo`, `objetivo-nombre`, `objetivo-estado`, `objetivo-texto`, `objetivo-porque`, `objetivo-progreso`, `objetivo-requisitos`, `objetivo-alternativas`, `objetivo-rutas`, `objetivo-avisos`, `objetivo-accion`, `objetivo-destino`, `objetivo-mostrar`, `objetivo-volver`, `objetivo-elegir`, `objetivo-avisos-ir` |
| G. Conversación | `section#conversacion` (reservada, oculta) | — (F2d) |
| F. Recursos | `section.zona-recursos` | `.recursos`: `inventario`, `comunidad` |
| D. Panel contextual | `section#proyecto.zona-panel` | Pestañas `tab-proyecto`, `tab-taller`, `tab-habilidades`, `tab-cadenas`, `tab-comunidad` y sus paneles |

Paneles de pestañas: **Proyecto** (`proyecto-selector`, `proyecto-titulo`, `proyecto-comunidad`, `proyecto-descripcion`, `proyecto-estado`, `proyecto-fecha`, `proyecto-tareas`, `construir`, `proyecto-aviso`); **Taller y recetas** (`taller`, `taller-titulo`, `taller-construido`, `taller-recetas`); **Habilidades** (`habilidades-seccion` y sus hijos); **Cadenas** (`cadenas-juego`); **Comunidad** (`misiones`, `proyecto-novedades`, `proyecto-aportes`, `proyecto-actividad`, `jugadores`, `presencia`).

Cambios de comportamiento necesarios por el movimiento (los únicos de código):
- `main.ts` activa las pestañas con `ui/tabs.ts`, recuerda la última (`localStorage`, con `try/catch`) y escucha el evento `mostrar-pestana` para cambiar de pestaña **a petición de quien actúa** (no sola).
- La tecla **P** envía `mostrar-pestana: proyecto` y enfoca `#proyecto-titulo` (antes bastaba enfocarlo; ahora puede estar en otra pestaña).
- Al construir un edificio, si el botón de construir tenía el foco, se envía `mostrar-pestana: taller` y se enfoca `#taller-titulo`.

Selectores estructurales tras el marco: sin ninguno huérfano. Cambian solo las cifras por la nueva estructura y el estado: `[hidden]` 5→11 (paneles ocultos), `.pestanas [role="tab"]` 0→5 y su variante seleccionada 0→1 (reglas de `base.css` ya en uso), `.juego > *` 2→6 (zonas), `#proyecto p` 12→18 (contenido que ahora vive dentro del panel), `button[aria-disabled="true"]` 9→11 (estado de la sesión).

Orden real de Tab tras el marco (22 pulsaciones, ana): enlace de salto → `salir` → `game` → seis botones de depositar → `tab-proyecto` → `panel-proyecto` (región con desplazamiento, `tabindex="0"`) → selector de proyecto → enlace al panel → seis botones de aportar → vuelta al enlace de salto. Solo la pestaña activa está en el orden del foco. El orden visual coincide con el del documento (barra, mundo, recursos, panel).

Diseño medido (mundo de prueba): a 1280 px, rejilla `800px 428px`, página de **900 px de alto** (antes 1660 px), zonas barra y=102, mundo y=166, recursos y=601 y panel a la derecha (y=166, 373 px de alto); a 800 px las cuatro zonas se apilan; con el texto al 200 % no hay desplazamiento horizontal en ninguno de los dos anchos.

### Marco: actividad, diálogos y atajos (puerta P4, 2026-10-11)

- Nuevos ids en la barra superior: `ayuda-boton` y `accesibilidad-boton` (los lee `frame.ts`); los diálogos son `<dialog>` creados al abrir (se eliminan al cerrar).
- Eventos de documento: `sugerir-pestana` (detalle `{tab, key, text}`, lo emite `WorldScene` al recibir una oferta), `mostrar-ayuda` (tecla `?`), `enfocar-consola` (tecla `C`), además de `mostrar-pestana`.
- Cada insignia de pestaña se añade dentro del botón `tab-*` (`.insignia`); por eso la etiqueta accesible de la pestaña incluye «N novedades» mientras haya sugerencias.
- `isEditable` (`WorldScene.ts`) incluye ahora pestañas, paneles con desplazamiento, registros y diálogos: en ellos las flechas y las letras no mueven al personaje (KEY-01).

### Zona C — Objetivo actual (puerta P1 de G3c, 2026-10-11)

- `#objetivo` deja de estar reservada y oculta: ocupa toda la anchura bajo la barra (`grid-template-areas`: barra, **objetivo**, mundo y panel, recursos y panel, consola; apilada: barra, objetivo, mundo, recursos, panel, consola). Su esqueleto está en `index.html` y lo rellena `objective-panel.ts`; **no es región viva** (los cambios se anuncian por el bus de eventos, una vez por cambio de identidad).
- Se crea desde `WorldScene.create()` (necesita la sala): recalcula con `room.onStateChange` (agrupado 250 ms) y cada 500 ms (para que la histéresis de 800 ms avance sin cambios de estado). El objetivo activo vive en `localStorage` con la clave `engremiat.objetivo.<mundo>.<cuenta>`.
- `WorldScene` pasa al panel el rechazo del servidor (`noteRejection`) y la acción del paso (`perform`, que reutiliza `contribute`, `deposit`, `panelActions.build/craft` y `sendCollect`: la decisión sigue siendo del servidor).
- Orden real de Tab: enlace de salto → Ayuda → Accesibilidad → Salir → **Elegir objetivo** → (**Ir a la consola** si hay avisos) → mapa → recursos → pestañas → contenido → consola.
- El diálogo «Elegir objetivo» se crea al abrirlo (`<dialog>` nativo con foco devuelto al botón).

### Marcadores del mapa (puerta P2 de G3c, 2026-10-11)

- Nuevos ids en la zona C: `objetivo-destino` (alternativa textual: «Destino: Madera, a 21 casillas al oeste y 2 casillas al norte»), `objetivo-mostrar` («Mostrar en el mapa», visible solo si el paso tiene destino) y `objetivo-volver` («Volver a mi personaje», visible solo con la cámara separada). Orden de Tab en la zona C: Mostrar en el mapa → (Volver a mi personaje) → Elegir objetivo → (Ir a la consola).
- `map-markers.ts` dibuja el anillo y la flecha del borde en la escena de Phaser (no hay DOM); `ui/label-layout.ts` es el modelo puro de colocación de etiquetas. `WorldScene` coloca las etiquetas cada 250 ms (nunca por fotograma) por prioridad: tu personaje > destino > edificios > personas > cantidades de recursos; la que choca con otra ya colocada se oculta.
- **La cámara nunca se mueve sola.** Solo «Mostrar en el mapa» la separa del personaje; vuelve al moverse, con Escape o con «Volver a mi personaje». Con `data-movimiento="reducido"` el anillo no pulsa y la cámara salta sin animación.
- Evento de documento nuevo: `preferencias-cambiadas` (detalle: las preferencias; lo emite `frame.ts` y lo escucha `WorldScene` para las etiquetas y el movimiento). Preferencia nueva `mapLabels` (*todas*, *edificios*, *ninguna*) en el diálogo de Accesibilidad.
- El anillo y la flecha usan doble contorno (blanco y negro) y no dependen del color; no añaden pares de color nuevos a `npm.cmd run a11y`.

### Pestaña «Guía» y atajo O (puerta P3 de G3c, 2026-10-11)

- Sexta pestaña del panel: `tab-guia` / `panel-guia` (al final de la lista; el orden de Tab y las flechas, Inicio y Fin la incluyen; `main.ts` la añade a `TABS` para recordarla). Ids nuevos del panel: `guia-objetivo`, `guia-estado`, `guia-paso`, `guia-porque`, `guia-bloqueos` (+ `guia-bloqueos-vacio`), `guia-alternativas` (+ `guia-alternativas-vacio`), `guia-destino`, `guia-cerca` (+ `guia-cerca-vacio`), `guia-consejos`, `guia-estados`.
- La rellena `guide-panel.ts` con los datos del paso mostrado (la zona C se los pasa en cada recálculo mediante `onRender`); si la pestaña no se ve solo guarda el último estado y lo pinta al abrirla (evento `pestana-guia`). **No es región viva.**
- Modelos puros en `@juego/shared` (`objective-guide.ts`): `nearby` (≤ 8 casillas, por cercanía, con el destino del objetivo siempre arriba aunque esté fuera del radio) y `tipsFor` (consejos por situación).
- Atajo **O**: evento de documento `enfocar-objetivo` → foco en `#objetivo-nombre` (`tabindex="-1"`); se ignora en campos, pestañas, registros y diálogos, igual que `?` y `C`. La Ayuda lo lista.
- A-3: el botón de receta no repite el verbo si el nombre ya empieza por él («Moler a mano», no «Moler: Moler a mano») y se describe con su texto de ayuda (`aria-describedby` → `receta-ayuda-<id>`).

### Mejoras de cierre de G3c (M1–M6, 2026-10-11)

- **Zona C compacta (M4):** el porqué, la barra de progreso, el destino en texto y los avisos pendientes pasan a `details#objetivo-detalles` (plegado por omisión, estado recordado en `localStorage`). Quedan fuera del desplegable lo que exige atención: requisitos, alternativas y elección de ruta, el estado y el texto del paso y los botones. Un `summary` nuevo («Detalles del paso») entra en el orden de Tab justo después del texto del paso.
- **Obtener un objeto (M2):** el diálogo «Elegir objetivo» añade una lista de objetos y una cantidad (`select` y `input[type=number]` con etiqueta). El objeto elegido sustituye al de la lista.
- **Lo que hay cerca en voz (M5):** tecla **L** → evento `anunciar-cerca` → resumen anunciado por el bus de eventos (prioridad 1: el destino y los tres elementos más cercanos). La Ayuda la lista.
- **Botón de la acción (M1):** para fabricar usa el verbo de la receta («Moler», «Hornear»).
- **Guion de humo (M3):** `await s.g3c()` de `scripts/ui-smoke.js` devuelve 30 comprobaciones funcionales (zona C, pestañas, Guía, diálogo, medidas); la línea base está en `scripts/dom-baseline.json` (`marcoG3c`).

### Pestaña «Logros» (puerta P1 de G3d, 2026-10-11)

- Séptima pestaña del panel: `tab-logros` / `panel-logros` (al final; `main.ts` la añade a `TABS` y se recuerda como las demás). Insignia numérica dentro del botón de la pestaña (`.insignia`), con texto oculto «N logros nuevos»: cuenta **solo los nuevos no consultados**.
- Ids del panel: `logros-resumen`, `logros-nuevos` (+ `logros-nuevos-vacio`, `logros-marcar-nuevos`), `logros-preexistentes` (+ `logros-preexistentes-vacio`, `logros-marcar-preexistentes`), `logros-referencia`, `logros-referencia-progreso` (barra `logros-referencia-barra`), `logros-referencia-nota`, `logros-ir-objetivo`, `logros-insignias`, `logros-comunidad`, `logros-personal`, `logros-cooperacion`, `logros-registro` (+ `logros-registro-vacio`), `logros-libro`. No es región viva.
- La rellena `achievements-panel.ts`; `WorldScene` la recalcula cada segundo con la instantánea del estado (`achievementSnapshotFromState`) y las insignias de nivel (`skillBadgesFromState`). **Nunca cambia de pestaña por sí sola** y abrirla no marca nada como consultado.
- Almacén local `engremiat.logros.<mundo>.<cuenta>` (`achievement-store.ts`): `schemaVersion`, `vistos`, `notificados`, `consultados`, `preexistentes`, `retirados` y `libro`. Primera visita: lo existente va a `preexistentes` (notificado, **no** consultado) y no cuenta en la insignia. Una versión posterior a la conocida se lee sin escribir encima.
- Guion de humo: `await s.g3d()` de `scripts/ui-smoke.js` (17 comprobaciones de la pestaña). `s.g3c()` acepta seis o siete pestañas.

### Celebración de logros (puerta P2 de G3d, 2026-10-11)

- **Tarjeta única** en la zona C: `#logro-tarjeta` (`logro-tarjeta-texto`, `logro-tarjeta-mas`, `logro-tarjeta-ver`, `logro-tarjeta-cerrar`), oculta por omisión, **no es región viva** (el anuncio lo hace el bus de eventos). Una sola; se reutiliza («Logro conseguido: X» y «y N más»). «Ver logros nuevos» abre la pestaña «Logros» (acción explícita; foco en `tab-logros`); «Cerrar» devuelve el foco a `objetivo-elegir`. Cerrarla **no marca nada como consultado**.
- Tipo de evento nuevo `logro` (consola: grupo de filtro «Logros»). Una tanda → un resumen relevante y anunciado (prioridad 1) y, si son varios, una línea por logro en el historial.
- **Destello:** `createFlash` en `map-markers.ts` (anillo de doble contorno que crece y se desvanece en 600 ms, uno por tanda); con `data-movimiento="reducido"` no se dibuja.
- Preferencia nueva **«Celebraciones de logros»** (*Todas / Solo texto / Ninguna*, por omisión *Todas*) en el diálogo de Accesibilidad; la lee `achievements-panel.ts` y reacciona al evento `preferencias-cambiadas`.
- Libro local: `WorldScene` cuenta los `teach-result` aceptados (`recordLocal`) en el almacén de este navegador; no crea logros ni celebraciones.
- `s.g3d()` suma 3 comprobaciones de la tarjeta (una sola, fuera de las regiones vivas, con sus dos botones y tamaño suficiente).

