# Dependencias del DOM del cliente

> Generado por `node scripts/dom-inventory.ts` (G3b, puerta P0, Q212). **No editar a mano**: las notas manuales están en `docs/dependencias-dom.manual.md`. La comprobación estática es `npm.cmd run dom`; la regresión funcional son las pruebas T1–T4 (`scripts/ui-smoke.js`).

Cada fila es un `id` de la página. «Código» son los archivos que lo buscan por `byId`/`getElementById`/`querySelector("#…")`; «ARIA» son las relaciones del HTML que lo apuntan (`for`, `aria-labelledby`, `aria-describedby`, `aria-controls`, `href="#…"`); «CSS» son las reglas de la hoja de la página que lo nombran. **Regla de movimiento:** un elemento se mueve entero, con su `id` y sus relaciones; ningún `id` se renombra.

## index.html (67 ids)

| id | Código | ARIA (quién lo apunta) | CSS |
|---|---|---|---|
| `contenido` | — | href | — |
| `entrada` | main.ts, account.ts | — | — |
| `entrada-titulo` | — | aria-labelledby | — |
| `nombre` | account.ts | for | — |
| `nombre-ayuda` | — | aria-describedby | — |
| `contrasena` | account.ts | for | — |
| `contrasena-ayuda` | — | aria-describedby | — |
| `edad-bloque` | account.ts | — | `fieldset label, #edad-bloque label` |
| `edad` | account.ts | — | `fieldset label, #edad-bloque label` |
| `nombre-error` | account.ts | aria-describedby | — |
| `entrada-boton` | account.ts | — | — |
| `partida` | main.ts | — | — |
| `zona` | hud.ts | — | `#zona` |
| `posicion` | hud.ts | — | — |
| `conexion` | hud.ts | — | `#conexion` |
| `salir` | main.ts | — | — |
| `game` | main.ts, WorldScene.ts | — | `#game`, `#game canvas` |
| `volver` | hud.ts | — | — |
| `objetivo` | — | — | — |
| `conversacion` | — | — | — |
| `inventario-titulo` | — | aria-labelledby | — |
| `inventario` | hud.ts | — | — |
| `comunidad-titulo` | hud.ts | aria-labelledby | — |
| `comunidad` | hud.ts | — | — |
| `proyecto` | main.ts | — | `#proyecto p`, `#proyecto`, `#proyecto h2`, `#proyecto-estado`, `#proyecto-aviso`, `#proyecto-aportes, #proyecto-actividad, #misiones, #cadenas-juego, #habilidades-lista` |
| `tab-proyecto` | — | aria-labelledby | — |
| `tab-taller` | — | aria-labelledby | — |
| `tab-habilidades` | — | aria-labelledby | — |
| `tab-cadenas` | — | aria-labelledby | — |
| `tab-comunidad` | — | aria-labelledby | — |
| `panel-proyecto` | — | aria-controls | — |
| `proyecto-selector` | WorldScene.ts | for | — |
| `proyecto-titulo` | project-panel.ts | — | — |
| `proyecto-comunidad` | project-panel.ts | — | — |
| `proyecto-descripcion` | project-panel.ts | — | — |
| `proyecto-estado` | project-panel.ts | — | `#proyecto-estado` |
| `proyecto-fecha` | project-panel.ts | — | — |
| `proyecto-tareas` | project-panel.ts | — | — |
| `construir` | project-panel.ts | — | — |
| `construir-boton` | project-panel.ts | — | — |
| `construir-ayuda` | project-panel.ts | — | — |
| `panel-taller` | — | aria-controls | — |
| `taller` | project-panel.ts | — | — |
| `taller-titulo` | project-panel.ts | aria-labelledby | — |
| `taller-construido` | project-panel.ts | — | — |
| `taller-recetas` | project-panel.ts | — | — |
| `panel-habilidades` | — | aria-controls | — |
| `habilidades-seccion` | skills-panel.ts | — | — |
| `habilidades-titulo` | — | aria-labelledby | — |
| `habilidades-lista` | skills-panel.ts | — | `#proyecto-aportes, #proyecto-actividad, #misiones, #cadenas-juego, #habilidades-lista` |
| `habilidades-ofertas` | skills-panel.ts | — | — |
| `ensenar-titulo` | — | — | — |
| `ensenar-opciones` | skills-panel.ts | for | — |
| `ensenar-boton` | skills-panel.ts | — | — |
| `ensenar-ayuda` | skills-panel.ts | — | — |
| `panel-cadenas` | — | aria-controls | — |
| `cadenas-juego-titulo` | — | aria-labelledby | — |
| `cadenas-juego` | project-panel.ts | — | `#proyecto-aportes, #proyecto-actividad, #misiones, #cadenas-juego, #habilidades-lista`, `#cadenas-juego li` |
| `panel-comunidad` | — | aria-controls | — |
| `mision-titulo` | — | aria-labelledby | — |
| `misiones` | project-panel.ts | — | `#proyecto-aportes, #proyecto-actividad, #misiones, #cadenas-juego, #habilidades-lista` |
| `proyecto-novedades` | project-panel.ts | — | — |
| `proyecto-aportes` | project-panel.ts | — | `#proyecto-aportes, #proyecto-actividad, #misiones, #cadenas-juego, #habilidades-lista` |
| `proyecto-actividad` | project-panel.ts | — | `#proyecto-aportes, #proyecto-actividad, #misiones, #cadenas-juego, #habilidades-lista` |
| `jugadores-titulo` | hud.ts | aria-labelledby | — |
| `jugadores` | hud.ts | — | `#jugadores` |
| `zona-consola` | main.ts | — | — |

## panel.html (29 ids)

| id | Código | ARIA (quién lo apunta) | CSS |
|---|---|---|---|
| `contenido` | — | href | — |
| `entrada` | panel.ts, account.ts | — | — |
| `entrada-titulo` | — | aria-labelledby | — |
| `nombre` | account.ts | for | — |
| `nombre-ayuda` | — | aria-describedby | — |
| `contrasena` | account.ts | for | — |
| `contrasena-ayuda` | — | aria-describedby | — |
| `edad-bloque` | account.ts | — | `fieldset label, #edad-bloque label` |
| `edad` | account.ts | — | `fieldset label, #edad-bloque label` |
| `nombre-error` | account.ts | aria-describedby | — |
| `entrada-boton` | account.ts | — | — |
| `panel` | panel.ts | — | — |
| `quien` | panel.ts | — | — |
| `conexion` | panel.ts | — | — |
| `salir` | panel.ts | — | — |
| `aviso` | panel.ts | — | — |
| `rechazo` | panel.ts | — | — |
| `vistas` | panel.ts | — | — |
| `vista-proyecto` | panel.ts | for | — |
| `mis-tareas` | panel.ts | — | — |
| `tab-lista` | — | aria-labelledby | — |
| `tab-tablero` | — | aria-labelledby | — |
| `tab-cronograma` | — | aria-labelledby | — |
| `tab-indicadores` | — | aria-labelledby | — |
| `vista-lista` | — | aria-controls | — |
| `proyectos` | panel.ts | — | — |
| `vista-tablero` | panel.ts | aria-controls | — |
| `vista-cronograma` | panel.ts | aria-controls | — |
| `vista-indicadores` | panel.ts | aria-controls | — |

## Dependencias que el inventario automático no ve (manual)

### Sitios de avisos actuales (se unificarán en la consola, P3)

| Elemento | Quién escribe | Región viva | Comportamiento actual |
|---|---|---|---|
| `#aviso` | `hud.notify` (rechazos del servidor, avisos de acciones) | `role="alert"` | Se borra a los 2,5 s |
| `#acciones` | `hud.announceAction` (recolectar y depositar) | `role="status"` `aria-live="polite"` | Se sobrescribe |
| `#presencia` | `hud.announcePresence` (llegadas, salidas, reconexiones) | `role="status"` `aria-live="polite"` | Se sobrescribe |
| `#conexion` | `hud.setConnection` | `role="status"` `aria-live="polite"` | Estado actual |
| `#proyecto-aviso` | `project-panel` (`say`: aportes, construcción, fabricación, misión) | `role="status"` `aria-live="polite"` | Se sobrescribe |
| `#proyecto-novedades` | `project-panel.showNews` (desde tu última visita) | `role="status"` `aria-live="polite"` | Se escribe una vez al entrar |
| `#habilidades-aviso` | `skills-panel` (`say`: subidas de nivel, ofertas, resultados) | `role="status"` `aria-live="polite"` | Se sobrescribe |

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
| C. Objetivo actual | `section#objetivo` (reservada, oculta) | — (G3c) |
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
