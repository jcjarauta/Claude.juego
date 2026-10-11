# Arquitectura visual de ENGREMIAT

> Documento de diseño (G3a). Estado: **PROPUESTA aprobada por plan** para los fundamentos (tokens, componentes, reglas); las zonas de pantalla (§4) se construyen en G3b–G3d. Decisiones: Q200–Q205 en `docs/decisiones.md`.

## 1. Propósito y alcance

Fijar las **reglas visuales y de comunicación** del juego y del panel profesional para que cada etapa construya sobre la misma base: qué es fijo y qué variable en la pantalla, dónde se avisa de lo que ocurre, qué componentes se reutilizan y cómo se garantiza su accesibilidad. No cambia reglas del juego.

## 2. Principios

1. **Lo que siempre importa está fijo; lo que depende del momento está en un panel contextual.** Nada crece sin límite en una columna.
2. **Se avisa una sola vez, en un sitio previsible.** Los avisos que no son errores van a una región viva única (la consola, G3b); los errores, junto al formulario que los provocó.
3. **Siempre hay un próximo paso visible** (competencia) y caminos elegibles (autonomía); las metas son compartidas (relación).
4. **Accesible por construcción:** elementos nativos primero, teclado para todo, contraste comprobado por script, nada depende solo del color.
5. **Una sola fuente de estilos:** `tokens.css` y `base.css`; los componentes viven en `apps/client/src/ui/`.

## 3. Taxonomía de la interfaz (Fagerholt y Lorentzon) aplicada

| Tipo | Qué es | En ENGREMIAT |
|---|---|---|
| No diegética | HUD fuera del mundo | Barra superior, objetivo actual, panel contextual, consola, barra de recursos |
| Espacial | Marcadores sobre el mundo que el personaje «no ve» | Marcador del objetivo actual, etiquetas de edificios y de personas (G3c) |
| Diegética | Parte del mundo ficticio | Edificios, solares y personajes del mapa |
| Meta | Retroalimentación en pantalla ligada al mundo | Celebraciones breves al subir de nivel o cumplir una meta (G3d, desactivables) |

Se elige **HUD no diegético por zonas más capa espacial**: es un juego de gestión y cooperación con mucha información contextual.

## 4. Zonas de la pantalla del juego (A, B, D, E y F construidas en G3b; C en G3c; G en F2d)

| Zona | Tipo | Contenido | Hoy |
|---|---|---|---|
| A. Barra superior | Fija | Identidad, conexión, zona y posición, ayuda y accesibilidad (tamaño de texto, contraste, menos movimiento) | **Construida (G3b):** `header.zona-barra` con zona, posición, conexión, Ayuda (?), Accesibilidad y Salir |
| B. Mundo | Fija | Mapa + capa espacial de marcadores | **Construida (G3b):** `section.zona-mundo`, sin cambios de controles |
| C. Objetivo actual | Fija | Una tarea destacada con su progreso y «Mostrar en el mapa» | **Construida (G3c):** `section#objetivo` bajo la barra, a todo el ancho: objetivo activo elegido por la persona, siguiente acción con estado, requisitos, alternativas, progreso, destino en texto y «Mostrar en el mapa» |
| D. Panel contextual | Variable | Pestañas: Proyecto · Taller y recetas · Habilidades · Cadenas · Comunidad · Guía (G3c) | **Construida (G3b):** `section#proyecto` con cinco pestañas, insignias y regla de actividad |
| E. Consola | Fija, plegable | Registro cronológico y filtrable, región `aria-live` educada | **Construida (G3b):** `#zona-consola` con Importantes e Historial, plegable; anunciador con dos regiones ocultas |
| F. Barra de recursos | Fija | Inventario propio y almacén de la comunidad | **Construida (G3b):** `section.zona-recursos` bajo el mapa |
| G. Conversación | Reservada | La Guía y el canal común (F2d) | Región `#conversacion` reservada y oculta |

El **panel profesional** (`/panel`) adopta el mismo marco con navegación lateral por áreas (Proyectos, Biblioteca, Cadenas, Habilidades, Ajustes de diseño).

## 5. Reglas de comunicación

| Qué | Dónde | Cómo |
|---|---|---|
| Error de un formulario | Junto al formulario | `role="alert"` (componente `formFeedback`); el foco vuelve al primer campo con problema |
| Confirmación de crear algo | Junto al formulario | `role="status"` (no solo en la cabecera, donde puede quedar fuera de vista) |
| Cambios del mundo (aportes, fabricaciones, subidas de nivel, ofertas) | Consola (G3b); mientras tanto, la región viva de cada panel | `aria-live="polite"`, sin mover el foco |
| Hitos importantes | Aviso breve y consola | Opcional y respeta «menos movimiento» (G3d) |
| Acción no disponible | En el propio botón | `aria-disabled="true"` (sigue en el orden del foco) y el motivo en texto cerca |

## 6. Atajos globales

Mismo método de entrada para el juego y la interfaz (Game Accessibility Guidelines, básico).

| Tecla | Acción |
|---|---|
| Flechas o W A S D | Moverse |
| Espacio o E | Recolectar |
| P | Ir al panel del proyecto |
| M | Volver al mapa |
| Tab / Mayús+Tab | Recorrer los controles |
| Escape | Cerrar o cancelar |
| `?` | Ayuda con la lista de atajos (G3b) |
| `C` | Mover el foco a la consola (G3b) |
| `O` | Mover el foco al objetivo actual (G3c) |

## 7. Tokens de diseño (`apps/client/public/tokens.css`)

Única fuente de **colores, tipografía, espaciado, radios, foco y tamaños de objetivo**. Tema oscuro. Ninguna otra hoja ni página declara colores en hexadecimal (lo comprueba `npm.cmd run a11y`).

- **Colores:** fondos (`fondo`, `superficie`, `campo`, `boton`, `mapa`), texto (`texto`, `texto-suave`, `texto-apagado`), bordes (`borde-suave`, `borde`, `borde-campo`, `borde-fuerte`) y semánticos (`acento`, `info`, `error`, `exito`), más los de diagramas (`nodo-recurso`, `nodo-objeto`, `flecha`, `texto-nodo`).
- **Contraste exigido:** 4,5:1 para texto y 3:1 para bordes de componentes y foco (WCAG 1.4.3 y 1.4.11). Los 30 pares en uso están declarados en `scripts/a11y.ts` con su razón.
- **Objetivos:** mínimo 24×24 px (`--objetivo-min`, WCAG 2.2: 2.5.8) para todos los controles; 44 px (`--objetivo-principal`) para acciones principales.
- **Foco:** contorno de 3 px en el color de acento, siempre visible (WCAG 2.4.7).
- **Añadir un color:** declararlo en `tokens.css`, añadir sus pares a `scripts/a11y.ts` y ejecutar `npm.cmd run a11y`.

## 8. Componentes reutilizables (`apps/client/src/ui/`)

Todos usan **elementos nativos** y exigen accesibilidad en su API. Se ven y se prueban a mano con teclado en `/estilo`.

| Componente | Archivo | Patrón | Requisitos que impone |
|---|---|---|---|
| Elemento (`el`) | `dom.ts` | — | Valores iniciales = valores de `reset()` |
| Campo con etiqueta y ayuda (`field`) | `field.ts` | Etiqueta asociada, `aria-describedby` | Etiqueta obligatoria (lanza error si falta); nunca `placeholder` como etiqueta |
| Selector con opciones y grupos | `select-options.ts` | `<select>` nativo, `<optgroup>` | Conserva la elección y el foco al refrescar |
| Lista dinámica (`dynamicList`) | `dynamic-list.ts` | Fieldset con botones | Etiquetas renumeradas; foco a la fila nueva o siguiente; anuncio de cada cambio; máximo y mínimo con `aria-disabled` |
| Pestañas (`setupTabs`) | `tabs.ts` | WAI-ARIA APG «Tabs» | Roving tabindex; flechas, Inicio y Fin; solo el panel activo visible |
| Retroalimentación de formularios (`formFeedback`) y región viva (`liveRegion`) | `feedback.ts` | `role="alert"`, `role="status"`, `aria-live="polite"` | Error y confirmación junto al formulario |
| Tarjeta de progreso (`progressCard`) | `progress.ts` | `<progress>` con `<label>` | Etiqueta obligatoria; avance también en texto |
| Tabla de datos (`dataTable`) | `data-table.ts` | `<table>` con `<caption>` y `th scope="col"` | Leyenda obligatoria |

Adoptados hoy: el panel de administración (`admin-forms.ts`) y las pestañas de gestión (`panel.ts`). El panel del juego (`project-panel.ts`, `skills-panel.ts`) adopta los componentes al reorganizarse en G3b.

## 9. Gamificación (reglas)

Cooperativa y **sin presión** (Octalysis: significado, desarrollo y logro, creatividad y retroalimentación, influencia social; evitar impulsos de presión).

- **Sí:** progreso visible (barras y texto), insignias de nivel con forma y texto, meta comunitaria, logros cooperativos, reconocimiento de quién aportó, celebraciones desactivables.
- **No:** clasificaciones competitivas entre personas, rachas diarias, cuentas atrás que penalicen, avisos que interrumpan el foco.

## 10. Lista de comprobación por componente (WCAG 2.2 AA y APG)

Para cada componente nuevo: (1) elemento nativo si existe; (2) etiqueta visible o nombre accesible; (3) operable solo con teclado, sin trampas, con orden lógico; (4) foco visible y que vuelva al origen al cerrar; (5) objetivo ≥ 24×24 px; (6) contraste de texto 4,5:1 y de bordes 3:1; (7) estado no solo por color; (8) cambios dinámicos anunciados con región viva; (9) con el texto al 200 % no hay desplazamiento horizontal de la página; (10) aparece en `/estilo` y pasa `npm.cmd run a11y`.

## 11. Auditoría de G3a (pantallas actuales)

Medido el 2026-10-11 con el navegador integrado (juego, panel de administración y `/estilo`): contraste mínimo **9,99:1** en el juego, **7,94:1** en el panel y **10,87:1** en la guía; ningún control menor de 24 px; sin desplazamiento horizontal con el texto al 200 % (tras corregir una tabla del juego, A-7).

| Id | Prioridad | Hallazgo | Etapa |
|---|---|---|---|
| A-1 | Alta | El panel P es una columna que crece con cada función; el progreso de habilidades queda fuera de la vista | G3b (zonas y pestañas) |
| A-2 | Alta | No hay «próximo paso» ni marcador en el mapa: se puede quedar uno bloqueado (p. ej. practicar una habilidad) | G3c |
| A-3 | Media | Botones con verbo y nombre repetidos («Moler: Moler a mano») | G3c |
| A-4 | Media | Los avisos están dispersos (cabecera, proyecto, habilidades, presencia, acciones) | G3b (consola) |
| A-5 | Media | El lienzo del juego no es legible por lector de pantalla; hoy la información está duplicada en el HUD de texto | Mantener la paridad en cada etapa |
| A-6 | Baja | Botones desactivados con opacidad 0,45: el texto queda bajo 4,5:1 (permitido en componentes inactivos); el motivo debe estar en texto cercano | G3b |
| A-7 | Resuelta | Faltaban enlace de salto, tamaño mínimo de objetivo y la tabla del almacén desbordaba con el texto ampliado | G3a |
| A-8 | Media | No hay preferencias de usuario (tamaño de texto, contraste, menos movimiento) | G3b |
| A-9 | Baja | No hay pruebas automáticas de interfaz en el cliente (solo `a11y` de tokens y recorridos manuales) | Propuesta futura (dependencias con gate) |

## 12. Fuentes

- Taxonomía de la interfaz: [Game Developer — UI en videojuegos](https://www.gamedeveloper.com/design/user-interface-design-in-video-games), [Game UI Discoveries](https://www.gamedeveloper.com/design/game-ui-discoveries-what-players-want).
- Motivación: [Ryan, Rigby y Przybylski (2006)](https://www.rochester.edu/warner/lida/wp-content/uploads/2022/11/02bfe513dd59366750000000.pdf).
- Gamificación: [Octalysis](https://www.gbl.uzh.ch/quartz/definitions/Octalysis-Framework).
- Accesibilidad: [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/basic/), [WCAG 2.2 (referencia rápida)](https://www.w3.org/WAI/WCAG22/quickref), [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg).
- Parte de las fuentes de divulgación son prácticas de la comunidad. Los umbrales usados (4,5:1, 3:1, 24 px) son los de WCAG 2.2 AA; conviene revisarlos contra la referencia rápida del W3C antes de darlos por definitivos.
