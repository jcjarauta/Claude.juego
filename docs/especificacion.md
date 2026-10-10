# Especificación funcional — BORRADOR

**Estado:** PROVISIONAL. Decisiones de producto respaldadas por la conversación; requisitos técnicos aún no validados en implementación. Consolida los antiguos `03_ESPECIFICACION_FUNCIONAL`, `06_MATRIZ_TRAZABILIDAD` y `13_MODELO_CONCEPTUAL`.

## 1. Finalidad y experiencia

Juego cooperativo de entretenimiento, aprendizaje práctico y simulación social. Mundo persistente, comunidades flexibles, campañas/misiones/proyectos con objetivos y cierre propios. Cooperación como mecánica central; competición opcional por reglas y consentimiento. Público inicial adulto; educación y menores en etapas futuras con controles específicos.

**Bucle mínimo objetivo:** explorar → localizar/recolectar recursos → aportar materiales a un proyecto común → construir taller → producir primer recurso/objeto → completar misión → persistir y consultar el resultado. El jugador puede alternar mundo y panel de proyecto.

**Concreción del MVP (decisiones Q132–Q143):** vista 2D **cenital**; **2–4 jugadores** en local/LAN; ritmo **mixto** (movimiento y recolección en tiempo real, aportes al proyecto también asíncronos); recursos **madera, piedra y fibra** que **se regeneran con el reloj del mundo**; inventarios **individual, de comunidad y de proyecto**; el taller fabrica una **herramienta** cuya fabricación y entrega completa la misión. Cifras en §3.1.

## 2. Requisitos del MVP y trazabilidad

Cada fila enlaza requisito, decisiones del usuario, criterio, evidencia exigida y prueba **propuesta** (`docs/pruebas.md`). Ninguna prueba se ha ejecutado.

| RF | Requisito | Decisiones | Criterio preliminar | Evidencia para VERIFICADO | Prueba |
|---|---|---|---|---|---|
| RF-001 | Crear/entrar en un mundo 2D pequeño vía web de escritorio | Q3,Q16,Q17,Q36 | Un cliente carga el mismo mundo identificable | Captura/reproducción en cliente autorizado | TP-01 |
| RF-002 | De 2 a 4 jugadores colaboran en una sesión en tiempo real en local/LAN | Q14,Q18,Q36,Q59,Q133,Q134 | Acciones compartidas son visibles y consistentes en todos los clientes | Registro de sesiones concordantes con 2 y con 4 clientes | TP-02 |
| RF-003 | Cuenta/perfil local mínimo con permisos de acceso | Q34,Q68,Q69,Q77 | Un usuario no accede a recursos ajenos sin permiso | Resultado de pruebas negativas de acceso | TP-03 |
| RF-004 | Explorar el mapa cenital y recolectar madera, piedra y fibra | Q27,Q37,Q45,Q132,Q136 | Acción válida altera inventario/estado en servidor | Estado antes/después y evento validado | TP-04 |
| RF-005 | Inventarios individual, de comunidad y de proyecto; transferencias y consumo sin duplicar gasto | Q10,Q37,Q46,Q139 | Consumo y transferencias evitan duplicación y son auditables | Estado transaccional y prueba concurrente | TP-05 |
| RF-006 | Crear/seguir un proyecto comunitario simple, tareas y aportaciones | Q12,Q13,Q36,Q37 | Se puede consultar estado y avance de tareas | UI y registros coherentes tras cambios | TP-06 |
| RF-007 | Construir un taller con materiales y condición de logro | Q36,Q37,Q45 | Taller no aparece sin satisfacer reglas y recursos | Regla y transición validada | TP-07 |
| RF-008 | Completar misión/producto y registrar resultado persistente | Q30,Q36,Q37 | Estado y evidencia persisten tras reconectar | Registro verificable de misión completada | TP-08 |
| RF-009 | Guardado, carga, reconexión y recuperación básica del mundo | Q35,Q36 | Una sesión reiniciada conserva cambios confirmados | Comparación fiable tras reinicio | TP-09 |
| RF-010 | Interfaz híbrida: mapa + panel mínimo de proyecto | Q15,Q79 | Se puede cambiar vista conservando contexto | Prueba de navegación y estado compartido | TP-10 |
| RF-011 | Accesibilidad base y datos mínimos: Chrome, Edge y Firefox recientes de escritorio; todas las acciones esenciales con teclado; contraste y textos legibles | Q32,Q34,Q143 | Las acciones esenciales del bucle se completan solo con teclado en los tres navegadores | Checklist y recorrido completo con teclado | TP-11 |
| RF-012 | Eventos verificables y rechazo de acciones inválidas | Q13,Q59,Q63 | Acción inválida no altera inventario/estado | Pruebas negativas sin modificación de estado | TP-12 |
| RF-013 | Colaboración asíncrona: aportes y tareas del proyecto funcionan aunque los demás jugadores no estén conectados, y quien se conecta ve el estado actualizado y quién aportó qué | Q14,Q133 | Un aporte hecho con un único jugador conectado aparece, con su autor, al conectarse otro | Registro de aporte y vista del segundo jugador tras conectar | TP-13 |
| RF-015 | Panel profesional: consultar y operar las tareas de un proyecto desde una vista de lista separada del mundo, sobre el mismo estado autoritativo (M5b) | Q12,Q15,Q79,Q160 | Lo hecho en el panel se ve en el mundo y al revés; el panel no crea personaje | Prueba de dos interfaces sincronizadas | TP-15 |
| RF-016 | Estados de tarea, revisión con evidencia y permisos por rol: completar es automático; aprobar o rechazar lo hace la coordinación con nota y evidencia (M5b) | Q13,Q161,Q162,Q164 | Un no coordinador no puede revisar; la decisión, su autor, hora, nota y evidencia persisten | Pruebas negativas de permiso y registro de eventos | TP-16 |
| RF-017 | Proyectos y misiones configurables (F1a, FUT-05): la administración crea desde el panel proyectos (tareas por recurso, criterio, coordinación, aprobación opcional) y misiones (`project-completed`, `item-in-community`) sin programar ni reiniciar; cierra proyectos del panel | Q144,Q171–Q175 | Un proyecto y su misión creados en el panel se juegan hasta completarse con varios jugadores y persisten; sin rol, no se puede | Pruebas de permiso, validación, ciclo completo y caída | TP-17, TP-18 |
| RF-018 | Vistas de gestión (F1b): tablero por estado de tarea, cronograma con barras y tabla, e indicadores (avance, estados, ritmo, plazo, aportes por persona, evolución) sobre los mismos datos autoritativos | Q12,Q15,Q178–Q180 | Las vistas muestran lo mismo que la lista y el mundo, en vivo; accesibles con teclado y con tablas equivalentes | Recorrido con teclado y comparación con el estado | TP-20 + navegador |
| RF-019 | Fechas objetivo y replanificación (F1b): fechas opcionales de proyecto y tarea, «vencida», replanificar con motivo y permiso, historial | Q176,Q177 | Sin permiso o sin motivo se rechaza; el historial y las fechas vigentes persisten | Pruebas de permiso, validación y caída | TP-19 |
| RF-020 | Responsables por tarea (F1c): asignar con rol, apuntarse o quitarse uno mismo, máximo 3; filtro «Mis tareas» | Q181 | Sin rol no se asigna a otros; los responsables persisten y se ven en vivo | Pruebas de permiso y caída | TP-21 |
| RF-021 | Dependencias entre tareas (F1c): bloqueo de aportes hasta terminar los requisitos, sin ciclos, fechas coherentes, cadena crítica en el cronograma | Q182,Q183 | Un aporte a una tarea bloqueada no tiene efecto; se desbloquea sola | Pruebas de bloqueo, desbloqueo y validación | TP-22 |
| RF-022 | Comentarios por tarea (F1c): hilo con autor y hora, traza no editable, visible en panel y juego | Q184 | Comentarios persistentes; hilo solo con sesión | Pruebas de validación, HTTP y caída | TP-23 |
| RF-023 | Construcciones desde el panel (F2a): la administración crea un proyecto con su edificio y solar en el mapa (con previsualización de si cabe); el solar aparece al instante, se construye junto a él y bloquea el paso; cerrar el proyecto de un solar sin construir lo retira | Q186,Q187 | Solar inválido (fuera, nodo, aparición, solape) rechazado con motivo; sin rol no se crea; persiste | Pruebas de colocación, permiso, construcción y caída | TP-24 |
| RF-024 | Objetos y recetas desde el panel (F2a): crear objetos fabricables y recetas (1–4 recursos del almacén común → objeto) en cualquier edificio; las misiones de «objetos en el almacén» admiten los nuevos | Q186,Q188 | Fabricar exige edificio construido, cercanía y materiales; la auditoría cuadra con objetos nuevos | Pruebas de fabricación, misión y auditoría | TP-25 |
| RF-025 | Cadenas de producción (F2b): una receta consume recursos u objetos, deja una salida principal y subproductos, se hace con un verbo junto a su edificio y puede exigir otros edificios construidos; sin ciclos; los límites son configurables (`buildLimits`); una vista de texto y diagrama, en el panel y en el juego, muestra las cadenas y qué falta | Q190–Q194 | Una cadena de dos edificios con objeto intermedio y subproducto se fabrica con dos jugadores; ciclo y límites rechazados con motivo; la auditoría cuadra | Pruebas de cadena, límites y auditoría | TP-26 |
| RF-014 | Reloj del mundo continuo en servidor que regenera recursos, también sin jugadores conectados y sin pausa global | Q40,Q138 | Un nodo agotado recupera unidades según la regla tras el tiempo de mundo definido, con o sin jugadores | Estado del nodo antes/después de un intervalo controlado | TP-14 |

**Nota de consolidación (2026-10-09):** los antiguos 03 y 06 discrepaban en las decisiones citadas. Se ha tomado la unión en RF-002 (+Q59), RF-004 (+Q45) y RF-006 (+Q36). En RF-012 se confirma Q59 (Q140); Q57 trata conflictos de fuentes en integraciones futuras.

### Requisitos no funcionales y de proceso

| ID | Requisito / control | Decisiones | Evidencia para VERIFICADO | Prueba |
|---|---|---|---|---|
| NFR-01 | Arquitectura modular / contratos | Q58–60,Q64 | ADR + pruebas entre módulos | TA-01 |
| NFR-02 | Auditoría y bloqueo de errores | Q63,Q66–68,Q125–128 | Logs y repetición de caso error | TA-02 |
| NFR-03 | Gobierno de cambios multiagente | Q61–62,Q115–120 | Registro aprobado de cambios y pruebas | TA-03 |
| DOC-01 | Documentación/versiones/trazas | Q98–110,Q121–123 | Historial git de la documentación | TA-04 |

**Regla:** vincular commits, casos de prueba y artefactos reales solo cuando existan y se verifiquen. No rellenar identificadores de commit ni hashes ficticios.

## 3. Casos de uso mínimos

**CU-01:** Un jugador accede al mundo y encuentra la comunidad inicial.  
**CU-02:** Dos clientes visualizan una acción de recolección compartida.  
**CU-03:** El grupo consulta el proyecto «Construir taller», aporta recursos y completa tareas.  
**CU-04:** Al cumplirse condiciones, el taller cambia el mundo.  
**CU-05:** Se crea un objeto simple, se completa la misión y se muestra su resultado.  
**CU-06:** Un reinicio/reconexión conserva estados confirmados y no duplica recursos.  
**CU-07:** Una acción sin permisos o con recursos insuficientes se rechaza de forma explicable.  
**CU-08:** Un jugador conectado en solitario aporta al proyecto; al conectarse otro, ve el avance y quién aportó.  
**CU-09:** Un nodo agotado se regenera con el paso del tiempo del mundo, aunque nadie esté conectado.

Los activos gráficos y el algoritmo de exploración **no están decididos**.

### 3.1 Bucle concreto — cifras PROPUESTA (pendientes de revisión humana)

Valores iniciales para implementar y equilibrar; se ajustan con pruebas de juego sin cambiar los requisitos.

| Elemento | Propuesta |
|---|---|
| Mapa | 40 × 30 casillas, tres zonas: bosque (madera), cantera (piedra) y pradera (fibra); punto de inicio común junto al solar del taller |
| Nodos de recurso | 12 árboles, 8 rocas y 10 matas de fibra; cada nodo con 3 unidades |
| Recolección | Acción de 1 s junto al nodo; +1 unidad al inventario individual |
| Reloj del mundo | Continuo en el servidor; cada nodo recupera 1 unidad cada 2 min reales hasta su máximo |
| Inventario individual | Máximo 10 unidades por recurso (obliga a aportar y coordinarse) |
| Transferencias | Individual → comunidad; individual o comunidad → proyecto; nunca de vuelta. Implementado: individual → comunidad (M3) e individual o comunidad → proyecto (M4), con recorte a lo que falta (Q153) |
| Proyecto «Construir taller» | Tareas: aportar 20 madera, 15 piedra y 5 fibra; al completarlas, cualquier miembro puede ordenar la construcción |
| Taller | Solar 3×2 en (17,7)–(19,8) de la aldea; se construye junto al solar y libre de jugadores (Q156), consume los materiales del proyecto y bloquea el paso |
| Herramienta | Receta en el taller: 3 madera + 2 piedra + 2 fibra del inventario de la comunidad (Q157) |
| Misión «Primera herramienta» | Se completa al fabricar la herramienta, que queda en el inventario de la comunidad; persiste con autor y hora (Q158) |
| Umbrales técnicos | Ver `docs/pruebas.md` §3 |

## 4. Modelo conceptual

### 4.1 Entidades (no tablas ni clases implementadas)

| Entidad propuesta | Identificador estable | Responsabilidad / relaciones |
|---|---|---|
| Usuario | `user_id` | Identidad de acceso local, permisos; futura identidad global |
| Personaje | `character_id` | Presencia de usuario en mundo, futuro perfil por mundo |
| Mundo | `world_id` | Estado persistente; uno en MVP |
| Zona / celda | `area_id` | Región/coordenadas del mundo 2D |
| Comunidad | `community_id` | Grupo inicial, membresías y derechos |
| Proyecto | `project_id` | Objetivo comunitario, tareas, recursos aportados |
| Tarea | `task_id` | Condición y progreso |
| Recurso | `resource_type_id` | Tipo, origen/propiedades (cantidades en inventarios); en MVP: madera, piedra, fibra |
| Nodo de recurso | `resource_node_id` | Posición en el mapa, unidades disponibles, máximo y regla de regeneración |
| Reloj del mundo | `world_id` | Tiempo de mundo del servidor; dirige la regeneración (RF-014) |
| Inventario | `inventory_id` | Saldo por recurso; ámbito individual, comunidad o proyecto |
| Receta | `recipe_id` | Entradas, inventario de origen y producto (en MVP: la herramienta) |
| Construcción | `structure_id` | Taller construido y sus condiciones (implementado en M5: tabla `structure`) |
| Objeto | `item_id` | Producto fabricado (herramienta); distinto de los recursos recolectables |
| Receta | `recipe_id` | Entradas del almacén común y producto (implementado en M5) |
| Misión | `mission_id` | Objetivo (configurable, Q144), estado y resultado; implementado en M5 (tabla `mission`) |
| Evento | `event_id` | Tipo, actor, ámbito, hora de servidor, correlación y resultado |

Todos los nombres son **PROPUESTA**. No existen en código verificado.

### 4.2 Invariantes preliminares

- Una acción de cliente no modifica directamente saldos; pasa por validación en servidor.
- Una contribución al proyecto y la deducción del inventario deben ser coherentes.
- No puede construirse taller sin requisitos satisfechos.
- Las operaciones duplicadas con el mismo identificador no deben producir doble efecto.
- El evento de éxito solo se confirma después de persistir el resultado requerido.
- Los cambios en sistemas externos, documentación real o federación quedan fuera del MVP.

### 4.3 Flujos propuestos

**Recolección:** intención cliente → permiso/regla → validación de recurso → transacción inventario/mundo → persistencia → emisión de cambio.  
**Proyecto:** aporte → validación de propietario y saldo → asignación a proyecto → estado de tarea → visibilidad compartida.  
**Taller:** comprobar condición de construcción → consumir recursos previstos → crear estructura → persistir → notificar.  
**Misión:** constatar productos/objetivo → registrar logro → persistir → mostrar resultado.

**Principio para el MVP (Q144, PROPUESTA):** el proyecto «Construir taller», la receta de la herramienta y la misión «Primera herramienta» se definen como **datos de configuración** que el servidor carga y valida, no como lógica programada para ese caso. Así, las misiones futuras se añaden con nueva configuración. El editor de configuración para jugadores queda fuera del MVP (FUT-05).

Contratos, formatos y semántica de reintentos: ver `docs/arquitectura.md` §3.

## 5. Visión futura — no asumir MVP

| ID | Ámbito | Decisiones | Evidencia exigida cuando llegue su fase |
|---|---|---|---|
| — | Múltiples comunidades, gobernanza configurable, progresión por competencias y economías complejas | Q4–12,Q31 | — |
| FUT-05 | **Implementado en F1a como RF-017** (crear proyectos y misiones desde el panel). Pendiente: editores de estructuras, recetas y objetos (FUT-04). Original: misiones como **proyectos configurables**: crear nuevas misiones definiendo objetivos, tareas, recursos y resultado sin programar | Q11,Q25,Q144 | Esquema de configuración validado, permisos de quién configura y pruebas de misiones creadas por configuración |
| — | Ecosistemas sistémicos, generaciones regionales, territorios protegidos, tecnología, ingeniería y cadenas de producción | Q42–47 | — |
| FUT-01 | Procesamiento documental y RAG; distinguir `DOCUMENTAL`, `INFERENCIA`, `SIMULACIÓN` | Q48–57 | Fuentes, permisos, citas y evaluación |
| FUT-02 | Agentes de IA, memoria y recursos | Q21–24,Q84–91 | Evaluaciones, cuotas y autorizaciones |
| FUT-03 | Redes locales desconectadas, servidores federados autónomos, economías entre mundos y migración | Q19–20,Q70–73,Q92–97 | Protocolo, migraciones y pruebas de red |
| FUT-04 | Edición por nodos, programación extensible, automatizaciones, interfaces personalizadas y grafo | Q25–26,Q38–39,Q80–83,Q111–114 | Contratos, seguridad y pruebas de edición |
| — | Competición regulada, moderación integral con apelación, público menor y modelo comercial | Q28–29,Q33,Q74–78 | — |

Entidades de documentos/fuentes/licencias, relaciones tipadas, simulaciones, agentes, mundos federados y transferencias de recursos se definirán cuando corresponda a su fase; no sobrecargar ahora el modelo inicial.

## 6. Reglas transversales

Servidor autoritativo propuesto para cambios de inventario/mundo; permisos mínimos; privacidad desde diseño; trazabilidad de acciones; registro de conflictos; revisión humana de decisiones críticas; no afectar proyectos reales sin aprobación. La IA no es requisito de jugabilidad del primer ciclo del MVP salvo nueva decisión.

## 7. Condiciones de salida

La funcionalidad no se considerará VERIFICADA hasta que existan código, pruebas y evidencias independientes. Véase `docs/pruebas.md`.
