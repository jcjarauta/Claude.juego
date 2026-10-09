# CLAUDE.md — Reglas permanentes del proyecto (BORRADOR)

> Estado `PROPUESTA / PENDIENTE_GATE_HUMANO`. Este archivo define reglas propuestas, no prueba que existan agentes, repositorios, permisos o integraciones operativas.

## 1. Propósito y límites

Proyecto: juego cooperativo multijugador con mundo persistente, gestión de comunidades, misiones, proyectos, recursos, aprendizaje y futura integración documental/IA. Primer MVP: pequeño mundo web 2D, varios jugadores, una comunidad, un proyecto, recolección, taller, misión y persistencia.

No confundir **visión de producto** con **alcance del MVP**. La federación, IA compleja, economía federada, RAG, editores de nodos, automatizaciones amplias, integraciones reales y escalado horizontal pertenecen a fases futuras salvo autorización documentada.

## 2. Jerarquía y autoridad

1. Instrucciones legítimas y aprobaciones explícitas de la persona responsable.
2. Reglas permanentes `CLAUDE.md` (cuando este borrador sea aprobado).
3. Requisitos/decisiones aprobados y ADR versionados.
4. Prompt de especialidad y contrato de tarea, con ámbito autorizado.
5. Propuestas de IA, que no son autorizaciones.

Las autorizaciones son **específicas para una operación y un alcance**. Una orden para crear código no autoriza ejecutarlo, instalar paquetes, llamar APIs, editar datos reales ni desplegar. El silencio no autoriza. Si falta permiso: `NO_GO` para esa operación.

## 3. Disciplina verificable

Usar las categorías `VERIFICADO`, `NO VERIFICADO`, `INFERENCIA`, `PROPUESTA`, `SIMULACIÓN`. No inventar archivos, rutas, funciones, resultados, logs, pruebas, ejecuciones, permisos, hashes ni aprobaciones.

Antes de modificar, identificar: objetivo, alcance de archivos, requisitos/ADR, impacto, dependencias, riesgos, plan de pruebas, método de reversión y gate. Mantener cambios mínimos y reversibles. No sobreescribir trabajo ajeno.

## 4. Protocolo de errores y gates

Estados operativos: `OK`, `WARN`, `ERR`, `NO_GO`. Ante `ERR` o `NO_GO` detener la operación afectada, preservar evidencia, diagnosticar, proponer/ejecutar únicamente la reparación autorizada y repetir la verificación. No declarar cierre ni éxito sin pruebas. Continuar otras tareas independientes solo si no tienen dependencia insegura.

Si existe una secuencia aprobada: avanzar hasta el próximo gate humano o bloqueo real, sin solicitar autorizaciones repetidas para pasos ya cubiertos.

## 5. Repositorio, Obsidian y Graphify

**Decisión:** monorepositorio modular inicial, servicios lógicamente separados; Git como historia de código. Obsidian sirve de red de conocimiento basada en relaciones; Graphify es apoyo de análisis del código. Flujo previsto `repositorio → Obsidian / Graphify`, unidireccional, incremental y selectivo; primero `DRY_RUN` y sin modificación de notas manuales. **NO VERIFICADO**: existencia, configuración, rutas y conectores en el entorno real.

No ejecutar sincronización ni escribir en Obsidian/Graphify sin prueba técnica y autorización específica. No declarar que Graphify dispone de API o integración hasta verificarlo.

## 6. Arquitectura y calidad

Diseño objetivo: microservicios / componentes distribuidos, APIs para operaciones, eventos para procesos desacoplados y WebSocket para sesión multijugador. Para MVP se permite coexistencia en un solo host; no introducir infraestructura distribuida remota innecesaria. Servidor autoritativo propuesto; integridad de inventarios y transacciones prioritaria.

Aislar secretos, datos personales y entornos. Establecer identidades y permisos por ámbito. Pruebas unitarias/integración/funcionales/seguridad/accesibilidad antes de integrar. Rama principal protegida y gate humano para integraciones críticas. Fijar versiones y registrar dependencias. Ninguna prueba se declara superada sin evidencia.

## 7. IA y contenidos documentales

Separar datos verificables, inferencias y contenido ficcional/simulado. Procesamiento documental y acciones externas: solo lectura primero; escrituras y cambios reales con aprobación explícita, registro y, si procede, reversión. Los agentes no se conceden permisos, presupuestos ni memoria compartida por sí mismos.

## 8. Formato de salida

Para auditorías y paquetes operativos, usar:

```text
ENGREMIAT_PACKAGE_BEGIN
OK | <hallazgo respaldado por evidencia>
WARN | <limitación no bloqueante>
ERR | <error comprobado>
NO_GO | <operación bloqueada y causa>
NEXT | <única acción siguiente o gate>
ENGREMIAT_PACKAGE_END
```

No emitir etiquetas `OK` simulando pruebas no ejecutadas. Incluir referencia a fuente/versión cuando exista. Los scripts PowerShell solicitados deben ser autocontenidos, físicamente de una sola línea, con log completo, copia por `Set-Clipboard` y marcadores del protocolo; revisar sintaxis/escapes/efectos laterales antes de entregarlos. El código propuesto **no se ejecuta** salvo orden expresa.

## 9. Índices de referencia

Ver `10_REGISTRO_DECISIONES.md` para decisiones; `09_AUDITORIA_CONSOLIDACION.md` para conflictos; `06_MATRIZ_TRAZABILIDAD.md` para aceptación; `08_PROTOCOLO_MULTIAGENTE.md` para autorización; `02_PROMPT_MAESTRO.md` para orquestación por tarea.
