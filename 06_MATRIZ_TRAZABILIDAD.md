# Matriz de trazabilidad — BORRADOR

Cada fila enlaza requisito, decisiones del usuario, tipo de evidencia requerida y prueba **propuesta**. Ninguna prueba se ha ejecutado.

| ID | Requisito / control | Decisiones | Evidencia exigida para VERIFICADO | Prueba |
|---|---|---|---|---|
| RF-001 | Mundo 2D web | Q3,Q16,Q17,Q36 | Captura/reproducción en cliente autorizado | TP-01 |
| RF-002 | Multijugador en tiempo real | Q14,Q18,Q36,Q59 | Registro de dos sesiones concordantes | TP-02 |
| RF-003 | Identidad local y permisos | Q34,Q68,Q69,Q77 | Resultado de pruebas negativas de acceso | TP-03 |
| RF-004 | Exploración y recolección | Q27,Q37 | Estado antes/después y evento validado | TP-04 |
| RF-005 | Inventario y gasto sin duplicar | Q10,Q37,Q46 | Estado transaccional y prueba concurrente | TP-05 |
| RF-006 | Proyecto, tareas, aportaciones | Q12,Q13,Q37 | UI y registros coherentes tras cambios | TP-06 |
| RF-007 | Construcción del taller | Q36,Q37,Q45 | Regla y transición validada | TP-07 |
| RF-008 | Misión y resultado persistente | Q30,Q36,Q37 | Registro verificable de misión completada | TP-08 |
| RF-009 | Persistencia/reconexión | Q35,Q36 | Comparación fiable tras reinicio | TP-09 |
| RF-010 | Vista 2D y panel de proyecto | Q15,Q79 | Prueba de navegación y estado compartido | TP-10 |
| RF-011 | Accesibilidad y minimización | Q32,Q34 | Checklist y pruebas de usuario/procedimiento | TP-11 |
| RF-012 | Rechazo de acciones inválidas | Q13,Q57,Q63 | Pruebas negativas sin modificación de estado | TP-12 |
| NFR-01 | Arquitectura modular / contratos | Q58–60,Q64 | ADR + pruebas entre módulos | TA-01 |
| NFR-02 | Auditoría y bloqueo de errores | Q63,Q66–68,Q125–128 | Logs y repetición de caso error | TA-02 |
| NFR-03 | Gobierno de cambios multiagente | Q61–62,Q115–120 | Registro aprobado de cambios y pruebas | TA-03 |
| DOC-01 | Documentación/versiones/trazas | Q98–110,Q121–123 | Manifiesto documental versionado | TA-04 |
| FUT-01 | Procesamiento documental y RAG | Q48–57 | Fuentes, permisos, citas y evaluación | Futuro |
| FUT-02 | Agentes de IA/memoria/recursos | Q21–24,Q84–91 | Evaluaciones, cuotas y autorizaciones | Futuro |
| FUT-03 | Federación y trabajo offline | Q19–20,Q70–73,Q92–97 | Protocolo, migraciones y pruebas de red | Futuro |
| FUT-04 | Editor extensible/grafo | Q25–26,Q80–83,Q111–114 | Contratos, seguridad y pruebas de edición | Futuro |

**Regla:** vincular commits, casos de prueba y artefactos reales solo cuando existan y se verifiquen. No rellenar identificadores de commit ni hashes ficticios.
