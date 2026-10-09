# Especificación funcional — BORRADOR

**Estado:** PROVISIONAL. Decisiones de producto respaldadas por la conversación; requisitos técnicos aún no validados en implementación.

## 1. Finalidad y experiencia

Juego cooperativo de entretenimiento, aprendizaje práctico y simulación social. Mundo persistente, comunidades flexibles, campañas/misiones/proyectos con objetivos y cierre propios. Cooperación como mecánica central; competición opcional por reglas y consentimiento. Público inicial adulto; educación y menores en etapas futuras con controles específicos.

**Bucle mínimo objetivo:** explorar → localizar/recolectar recursos → aportar materiales a un proyecto común → construir taller → producir primer recurso/objeto → completar misión → persistir y consultar el resultado. El jugador puede alternar mundo y panel de proyecto.

## 2. Alcance funcional de MVP (diseño objetivo)

| RF | Requisito | Decisiones fuente | Criterio preliminar |
|---|---|---|---|
| RF-001 | Crear/entrar en un mundo 2D pequeño vía web de escritorio | Q3,Q16,Q17,Q36 | Un cliente carga el mismo mundo identificable |
| RF-002 | Dos o más jugadores colaboran en una sesión | Q14,Q18,Q36 | Acciones compartidas son visibles y consistentes |
| RF-003 | Cuenta/perfil local mínimo con permisos de acceso | Q34,Q68,Q69,Q77 | Un usuario no accede a recursos ajenos sin permiso |
| RF-004 | Explorar mapa y recolectar un recurso | Q27,Q37,Q45 | Acción válida altera inventario/estado en servidor |
| RF-005 | Inventario y materiales para un taller | Q10,Q37,Q46 | Consumo de materiales evita duplicación y es auditable |
| RF-006 | Crear/seguir un proyecto comunitario simple y tareas | Q12,Q13,Q36,Q37 | Se puede consultar estado y avance de tareas |
| RF-007 | Construir un taller con materiales y condición de logro | Q36,Q37,Q45 | Taller no aparece sin satisfacer reglas y recursos |
| RF-008 | Completar misión/producto y registrar resultado | Q30,Q36,Q37 | Estado y evidencia persisten tras reconectar |
| RF-009 | Guardado, carga y recuperación básica del mundo | Q35,Q36 | Una sesión reiniciada conserva cambios confirmados |
| RF-010 | Interfaz híbrida: mapa + panel mínimo de proyecto | Q15,Q79 | Se puede cambiar vista conservando contexto |
| RF-011 | Reglas básicas de accesibilidad y datos mínimos | Q32,Q34 | Interacciones esenciales usables con controles alternativos definidos |
| RF-012 | Eventos verificables y rechazo de acciones inválidas | Q13,Q59,Q63 | Acción inválida no altera inventario/estado |

*«Dos o más» describe la definición funcional mínima de multijugador, **no** un objetivo de carga aprobado; concurrencia real y umbrales siguen pendientes.*

## 3. Experiencia de usuario mínima (casos de uso)

**CU-01:** Un jugador accede al mundo y encuentra la comunidad inicial.  
**CU-02:** Dos clientes visualizan una acción de recolección compartida.  
**CU-03:** El grupo consulta el proyecto «Construir taller», aporta recursos y completa tareas.  
**CU-04:** Al cumplirse condiciones, el taller cambia el mundo.  
**CU-05:** Se crea un objeto simple, se completa la misión y se muestra su resultado.  
**CU-06:** Un reinicio/reconexión conserva estados confirmados y no duplica recursos.  
**CU-07:** Una acción sin permisos o con recursos insuficientes se rechaza de forma explicable.

La representación 2D concreta, los activos gráficos, el algoritmo de exploración, la cantidad/recetas de recursos y las cifras de concurrencia **no están decididos**.

## 4. Funciones de visión futura — no asumir MVP

- Múltiples comunidades, gobernanza configurable, progresión por competencias y economías complejas (Q4–12, Q31).
- Ecosistemas sistémicos, generaciones regionales, territorios protegidos, tecnología, ingeniería y cadenas de producción (Q42–47).
- Edición por nodos, programación extensible, automatizaciones e interfaces personalizadas (Q25–26,Q38–39,Q80–83).
- Documentación, RAG, grafo, agentes y conversión de documentos en proyectos; distinguir `DOCUMENTAL`, `INFERENCIA`, `SIMULACIÓN` (Q48–57,Q84–90).
- Redes locales desconectadas, servidores federados autónomos, economías entre mundos y migración (Q19–20,Q70–73,Q92–97).
- Competición regulada, moderación integral con apelación, público menor y modelo comercial (Q28–29,Q33,Q74–78).

## 5. Reglas transversales

Servidor autoritativo propuesto para cambios de inventario/mundo; permisos mínimos; privacidad desde diseño; trazabilidad de acciones; registro de conflictos; revisión humana de decisiones críticas; no afectar proyectos reales sin aprobación. La IA no es requisito de jugabilidad del primer ciclo del MVP salvo nueva decisión.

## 6. Condiciones de salida

La funcionalidad no se considerará VERIFICADA hasta que existan código, pruebas y evidencias independientes. Véase `07_PLAN_PRUEBAS.md`.
