# Especificación funcional — BORRADOR

**Estado:** PROVISIONAL. Decisiones de producto respaldadas por la conversación; requisitos técnicos aún no validados en implementación. Consolida los antiguos `03_ESPECIFICACION_FUNCIONAL`, `06_MATRIZ_TRAZABILIDAD` y `13_MODELO_CONCEPTUAL`.

## 1. Finalidad y experiencia

Juego cooperativo de entretenimiento, aprendizaje práctico y simulación social. Mundo persistente, comunidades flexibles, campañas/misiones/proyectos con objetivos y cierre propios. Cooperación como mecánica central; competición opcional por reglas y consentimiento. Público inicial adulto; educación y menores en etapas futuras con controles específicos.

**Bucle mínimo objetivo:** explorar → localizar/recolectar recursos → aportar materiales a un proyecto común → construir taller → producir primer recurso/objeto → completar misión → persistir y consultar el resultado. El jugador puede alternar mundo y panel de proyecto.

## 2. Requisitos del MVP y trazabilidad

Cada fila enlaza requisito, decisiones del usuario, criterio, evidencia exigida y prueba **propuesta** (`docs/pruebas.md`). Ninguna prueba se ha ejecutado.

| RF | Requisito | Decisiones | Criterio preliminar | Evidencia para VERIFICADO | Prueba |
|---|---|---|---|---|---|
| RF-001 | Crear/entrar en un mundo 2D pequeño vía web de escritorio | Q3,Q16,Q17,Q36 | Un cliente carga el mismo mundo identificable | Captura/reproducción en cliente autorizado | TP-01 |
| RF-002 | Dos o más jugadores colaboran en una sesión en tiempo real | Q14,Q18,Q36,Q59 | Acciones compartidas son visibles y consistentes | Registro de dos sesiones concordantes | TP-02 |
| RF-003 | Cuenta/perfil local mínimo con permisos de acceso | Q34,Q68,Q69,Q77 | Un usuario no accede a recursos ajenos sin permiso | Resultado de pruebas negativas de acceso | TP-03 |
| RF-004 | Explorar mapa y recolectar un recurso | Q27,Q37,Q45 | Acción válida altera inventario/estado en servidor | Estado antes/después y evento validado | TP-04 |
| RF-005 | Inventario y materiales para un taller, sin duplicar gasto | Q10,Q37,Q46 | Consumo de materiales evita duplicación y es auditable | Estado transaccional y prueba concurrente | TP-05 |
| RF-006 | Crear/seguir un proyecto comunitario simple, tareas y aportaciones | Q12,Q13,Q36,Q37 | Se puede consultar estado y avance de tareas | UI y registros coherentes tras cambios | TP-06 |
| RF-007 | Construir un taller con materiales y condición de logro | Q36,Q37,Q45 | Taller no aparece sin satisfacer reglas y recursos | Regla y transición validada | TP-07 |
| RF-008 | Completar misión/producto y registrar resultado persistente | Q30,Q36,Q37 | Estado y evidencia persisten tras reconectar | Registro verificable de misión completada | TP-08 |
| RF-009 | Guardado, carga, reconexión y recuperación básica del mundo | Q35,Q36 | Una sesión reiniciada conserva cambios confirmados | Comparación fiable tras reinicio | TP-09 |
| RF-010 | Interfaz híbrida: mapa + panel mínimo de proyecto | Q15,Q79 | Se puede cambiar vista conservando contexto | Prueba de navegación y estado compartido | TP-10 |
| RF-011 | Reglas básicas de accesibilidad y datos mínimos | Q32,Q34 | Interacciones esenciales usables con controles alternativos definidos | Checklist y pruebas de usuario/procedimiento | TP-11 |
| RF-012 | Eventos verificables y rechazo de acciones inválidas | Q13,Q59,Q63 ⚠ | Acción inválida no altera inventario/estado | Pruebas negativas sin modificación de estado | TP-12 |

*«Dos o más» describe la definición funcional mínima de multijugador, **no** un objetivo de carga aprobado; concurrencia real y umbrales siguen pendientes.*

**Nota de consolidación (2026-10-09):** los antiguos 03 y 06 discrepaban en las decisiones citadas. Se ha tomado la unión en RF-002 (+Q59), RF-004 (+Q45) y RF-006 (+Q36). En **RF-012** ⚠ 03 citaba Q59 y 06 citaba Q57 («resolución de conflictos de fuentes», área de integraciones futuras); se mantiene Q59 por pertinencia y queda pendiente de confirmación humana (`docs/hoja-ruta.md`, PEND-01).

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

La representación 2D concreta, los activos gráficos, el algoritmo de exploración, la cantidad/recetas de recursos y las cifras de concurrencia **no están decididos**.

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
| Recurso | `resource_type_id` | Tipo, origen/propiedades (cantidades en inventarios) |
| Inventario | `inventory_id` | Saldo por recurso y propietario/ámbito |
| Construcción | `structure_id` | Taller construido y sus condiciones |
| Misión | `mission_id` | Objetivo, estado y resultado |
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

Contratos, formatos y semántica de reintentos: ver `docs/arquitectura.md` §3.

## 5. Visión futura — no asumir MVP

| ID | Ámbito | Decisiones | Evidencia exigida cuando llegue su fase |
|---|---|---|---|
| — | Múltiples comunidades, gobernanza configurable, progresión por competencias y economías complejas | Q4–12,Q31 | — |
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
