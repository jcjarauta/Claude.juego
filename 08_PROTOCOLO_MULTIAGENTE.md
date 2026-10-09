# Protocolo de desarrollo multiagente — BORRADOR

## 1. Roles propuestos, no instancias existentes

| Rol | Responsabilidad | Prohibición principal |
|---|---|---|
| Orquestador | Interpretar tareas, dependencia/impacto, gates y secuencia | No concederse permisos ni ejecutar sin autorización |
| Arquitectura | Contratos, ADR, integridad entre módulos | No imponer stack sin evaluación y gate |
| Gameplay/Web | UI y bucle jugable acotado | No modificar reglas de servidor sin contrato |
| Backend/Multijugador | Sesiones, permisos, acciones, persistencia | No crear estado inconsistente ni bypass de auth |
| Calidad | Diseñar/ejecutar pruebas si está autorizado | No declarar OK sin evidencia real |
| Seguridad | Revisión de límites, secretos, permisos y vulnerabilidades | No exfiltrar datos ni usar externos sin permiso |
| Documentación | Requisitos, decisiones, matriz y fuentes | No inventar documentación de funciones inexistentes |
| Integración | Verificar conflictos, paquetes y aprobaciones | No fusionar directamente en principal sin gate |

## 2. Contrato obligatorio por tarea

- ID / objetivo / requisito fuente.
- Estado inicial verificado; fuentes realmente leídas.
- Alcance de archivos **confirmados**; rutas exactas solo si están verificadas.
- Acciones permitidas y expresamente prohibidas.
- Dependencias, hipótesis y análisis de impacto.
- Plan de cambio mínimo, pruebas y reversión.
- Evidencia esperada y gate de aprobación.

## 3. Secuencia por gates

`ANALIZAR → PROPONER → AUTORIZAR → IMPLEMENTAR (si autorizado) → PROBAR (si autorizado) → AUDITAR → INTEGRAR (con gate) → DOCUMENTAR → NEXT`.

La fase de análisis y documentación autorizada no implica que las fases de escritura o ejecución lo estén. Agentes pueden trabajar en paralelo solo cuando el alcance de escritura es independiente y la coordinación está autorizada.

## 4. Política de integración

Ramas aisladas y revisión de diferencias como objetivo de proceso, no como repositorio ya configurado. Controlar conflictos de escritura, bloqueo por pruebas fallidas, revisión del impacto y autorización explícita antes de fusionar. Fijar dependencias y licencias, generar evidencias reales solo al ejecutar pruebas autorizadas.

## 5. Incidentes

`ERR` o `NO_GO`: detener operación afectada y dependencias inseguras; preservar evidencia; diagnosticar; aplicar reparación **solo en ámbito autorizado**; retestar; actualizar trazas. Otros flujos independientes pueden continuar si no requieren el componente defectuoso.

## 6. Datos y herramientas auxiliares

Repositorios/Obsidian/Graphify y conectores: usarlos solo tras verificar disponibilidad y permisos; flujo unilateral repositorio→índices propuesto y DRY_RUN inicial. Nunca cargar secretos, datos sensibles o información privada a proveedores externos de IA sin aprobación.

## 7. Cierre de tarea

El agente entrega un único `NEXT` que refiere a la próxima operación autorizada o gate. Distinguir `PROPUESTA` de `VERIFICADO`, y `SIMULACIÓN` de ejecución. No autoaprobar.
