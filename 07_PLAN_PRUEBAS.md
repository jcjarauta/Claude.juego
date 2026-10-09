# Plan de pruebas — BORRADOR / NO EJECUTADO

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
| TA-01 | Cambiar contrato entre módulos | Pruebas de integración detectan incompatibilidad |
| TA-02 | Forzar caída de servicio durante operación | Errores registrados; ninguna falsa confirmación de éxito |
| TA-03 | Intentar integración sin gate humano | Proceso de integración queda bloqueado |
| TA-04 | Revisar docs/versiones | Referencias reales y ausencia de hashes inventados |

## 3. Umbrales y plataforma

**NO VERIFICADO:** límite de latencia, simultaneidad, pérdida de paquetes tolerable, tiempo máximo de recuperación, RPO/RTO, hardware oficial, navegador objetivo y accesibilidad cuantificada. Requieren fijación antes del correspondiente gate. No declarar pruebas `OK` por diseño de casos.

## 4. Formato de evidencia

`ID de prueba | versión/código real | entorno real | precondición | comando/procedimiento autorizado | resultado observado | evidencia verificable | OK/WARN/ERR/NO_GO | revisor | fecha`.

Los fallos críticos deben reproducirse, diagnosticar causa, corregirse dentro del permiso y repetirse antes del cierre. Pruebas de recuperación y consistencia tienen prioridad sobre extensiones de funcionalidades.
