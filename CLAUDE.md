# CLAUDE.md — Reglas del proyecto

> Dinámica de trabajo aprobada el 2026-10-09 (reducción a documentos en `docs/` y permisos en `.claude/settings.json`); actualizada el 2026-10-10 (Q189). **Estado:** MVP aceptado el 2026-10-10 (Q170, `docs/aceptacion-mvp.md`); fases posteriores F1a–F1c cerradas. Lo no aprobado sigue siendo `PROPUESTA`. Absorbe el antiguo prompt maestro (02), protocolo multiagente (08), prompts especializados (11) y plantilla de tarea (12); los originales están en el commit `b203e92`.

## 1. Proyecto y alcance

**ENGREMIAT** (Q159): juego cooperativo multijugador con mundo persistente, comunidades, misiones, proyectos, recursos y aprendizaje, que evoluciona hacia un gestor de proyectos colaborativo cuyo núcleo de proyectos es la fuente de verdad y el mundo y el panel profesional son representaciones. **MVP (aceptado):** prototipo vertical web 2D, varios jugadores, una comunidad, exploración, recolección, taller, un proyecto, una misión y persistencia. **Después del MVP** se avanza por fases que elige la persona responsable y que empiezan con su propio plan aprobado (F1a proyectos configurables, F1b vistas de gestión, F1c responsables y dependencias…; ver `docs/hoja-ruta.md`).

No confundir **visión** con **alcance aprobado**. Federación, IA compleja, economía federada, RAG, editores de nodos, automatizaciones amplias, integraciones reales y escalado horizontal son fases futuras salvo autorización documentada. No implementar funciones futuras por el mero hecho de estar en la visión.

## 2. Documentos — leer solo lo necesario para la tarea

| Documento | Contenido |
|---|---|
| `docs/especificacion.md` | Requisitos RF/NFR con decisiones, evidencia y prueba; casos de uso; modelo conceptual; visión futura |
| `docs/arquitectura.md` | Módulos, comunicación, persistencia, seguridad, alternativas y registro de ADR (`docs/adr/`) |
| `docs/hoja-ruta.md` | Etapas G0–M6 y fases posteriores (F1a…), bloqueos BL, tensiones AUD, fases futuras; su `NEXT` dice qué toca |
| `docs/pruebas.md` | Catálogo TP/TA, umbrales y evidencias de cada etapa (§5) |
| `docs/decisiones.md` | Registro de decisiones (Q001 en adelante) y su reclasificación. **Solo lectura**: cambiarlo requiere gate humano (lo cubre un plan aprobado que lo diga) |
| `docs/aceptacion-mvp.md` | Matriz RF → prueba → evidencia, umbrales medidos y firma del MVP |
| `docs/auditoria-engremiat-2026-10-09.md` | Auditoría que originó el núcleo de proyectos (M5b) |

**Comandos** (raíz; en Windows `npm.cmd`): `install`, `run typecheck`, `test`, `run build`, `start`, `run soak` (15 min). Servidores en segundo plano con `exec node …` para poder pararlos de verdad. Ver §11.

## 3. Autoridad y permisos

Jerarquía: (1) instrucciones y aprobaciones explícitas de la persona responsable; (2) este archivo; (3) requisitos, decisiones y ADR aprobados; (4) el plan aprobado de la tarea; (5) propuestas de IA, que no son autorizaciones.

- Las autorizaciones son **por operación y alcance**. Crear código no autoriza ejecutarlo, instalar paquetes, llamar APIs, tocar datos reales ni desplegar. El silencio no autoriza.
- Los permisos técnicos están en `.claude/settings.json` (permitir / preguntar / denegar). No intentar rodearlos por otra vía; si se deniega una operación, es `NO_GO` para esa operación.
- **Gates humanos obligatorios:** aprobar el plan de una tarea; añadir o actualizar dependencias; fusionar en `main`; cambiar requisitos, decisiones o este archivo; cualquier acción de red o sobre sistemas externos (incluidos Obsidian y Graphify).
- Claude puede detectar y señalar conflictos en requisitos; los cambios en ellos los decide una persona (Q122).

## 4. Ciclo de trabajo por tarea

1. La persona pide una tarea citando requisito o etapa (RF-xxx, M1…).
2. Claude, en **modo plan**, lee solo lo necesario y propone: objetivo y requisito fuente; estado inicial verificado y fuentes leídas; archivos afectados (rutas comprobadas); acciones permitidas y prohibidas; dependencias, hipótesis e impacto; cambio mínimo; pruebas; reversión; evidencia esperada; gate.
3. **La persona aprueba el plan** (gate).
4. Claude implementa en una rama propia, ejecuta las pruebas autorizadas y hace commits pequeños.
5. Cierre: resumen con `OK/WARN/ERR/NO_GO` y un único `NEXT`; actualizar especificación, ADR o hoja de ruta si algo cambió.
6. **La persona revisa el diff y fusiona** (gate).

Con una secuencia aprobada, avanzar hasta el próximo gate o bloqueo real sin pedir de nuevo permisos ya cubiertos (Q128). Paralelizar solo con alcances de escritura independientes y coordinación autorizada.

## 5. Disciplina de evidencia

Categorías: `VERIFICADO` (con evidencia citable: archivo, salida de comando, prueba), `NO VERIFICADO`, `INFERENCIA`, `PROPUESTA`, `SIMULACIÓN` (resultado hipotético, nunca operación real). «VERIFICADO» en `docs/decisiones.md` significa *decidido*, no *implementado*.

No inventar archivos, rutas, funciones, resultados, logs, pruebas, permisos, hashes, commits ni aprobaciones. Ninguna prueba se declara superada sin ejecución real. Mantener cambios mínimos y reversibles; no sobrescribir trabajo ajeno.

## 6. Errores e incidentes

Estados: `OK`, `WARN`, `ERR`, `NO_GO`. Ante `ERR` o `NO_GO`: detener la operación afectada y sus dependientes inseguros, preservar evidencia, diagnosticar, reparar solo dentro del permiso, repetir la verificación y actualizar trazas. Otras tareas independientes pueden continuar. No declarar cierre sin pruebas.

## 7. Arquitectura y calidad (resumen; detalle en `docs/arquitectura.md`)

- Servicios **lógicamente** separados en un monorepositorio; en el MVP pueden convivir en un solo proceso y host. Sin infraestructura distribuida innecesaria.
- Servidor autoritativo: el cliente no modifica saldos ni estado del mundo; validación en servidor; una autoridad de escritura por entidad; operaciones idempotentes; sin doble gasto.
- Secretos fuera del código; datos personales mínimos; logs sin datos sensibles; versiones de dependencias fijadas y registradas.
- Ninguna elección de stack sin spike comparativo y ADR aprobado.

## 8. Perspectivas especializadas

No son agentes instanciados: son enfoques que Claude adopta según la tarea. Solo se crean subagentes en `.claude/agents/` con gate.

| Perspectiva | Foco | Prohibición principal |
|---|---|---|
| Arquitectura | Contratos, ADR, límites de datos | Imponer tecnologías no probadas o distribución innecesaria |
| Gameplay / UX | Bucle recolección→taller→misión, panel profesional, accesibilidad (teclado, contraste, Chrome/Edge) | Añadir funciones de fases no aprobadas o cambiar la perspectiva cenital decidida (Q132) |
| Backend / multijugador | Sesiones, permisos, persistencia, concurrencia | Confiar en el cliente; inventar límites de latencia o concurrencia |
| Calidad | Pruebas RF/TP; usar `/code-review` | Declarar `OK` sin pruebas ejecutadas |
| Seguridad | Permisos, secretos, privacidad; usar `/security-review` | Afirmar vulnerabilidades sin reproducirlas en entorno autorizado |
| Documentación / trazabilidad | Requisitos, ADR, pruebas, contradicciones | Reescribir decisiones humanas o documentar funciones inexistentes |
| IA y agentes del juego (futuro) | Proveedores, memoria, presupuestos, revocación | Crear agentes reales, contratar servicios o enviar datos fuera |

## 9. Datos, IA y herramientas auxiliares

- El repositorio es la única fuente de verdad. La persona abre `docs/` como vault de Obsidian (Q141): no hay sincronización, y sus ediciones allí son cambios del repositorio que se revisan con `git diff`. Claude no opera Obsidian. Graphify queda para después del MVP; no instalarlo ni ejecutarlo sin autorización específica.
- Separar datos verificables, inferencias y contenido ficticio o simulado; separar proyectos VIRTUAL / SIMULACIÓN / REAL.
- No enviar secretos, datos personales ni documentos privados a proveedores externos de IA sin aprobación. No mezclar economía del juego con pagos reales.

## 10. Formato de salida

Markdown técnico y conciso; recomendaciones justificadas con requisito, alternativas, riesgos, impacto en el MVP y pruebas. Si falta un dato, dejar la decisión abierta sin presentarla como aprobada.

Para auditorías y paquetes operativos:

```text
ENGREMIAT_PACKAGE_BEGIN
OK | <hallazgo respaldado por evidencia>
WARN | <limitación no bloqueante>
ERR | <error comprobado>
NO_GO | <operación bloqueada y causa>
NEXT | <única acción siguiente o gate>
ENGREMIAT_PACKAGE_END
```

El formato asunto / preencabezado / cuerpo de `prompt.base.txt` se usa solo al redactar mensajes, no en documentación técnica. Si la persona pide un script PowerShell para ejecutarlo ella misma: autocontenido, de una sola línea física, con log completo, copia por `Set-Clipboard` y marcadores ENGREMIAT, revisado en sintaxis, escapes y efectos laterales.

## 11. Entorno y pruebas (lecciones de M1–F1c)

- **Windows / PowerShell:** usar `npm.cmd` (la política de ejecución bloquea `npm.ps1`). Las rutas del proyecto: `C:\Users\pc\Desktop\claude.proyectos\claude.juego`.
- **Servidores:** el de la persona usa el puerto 2567 (a veces con `HOST=0.0.0.0`, `DB_PATH` o `WORLD_CONFIG` en su terminal). Claude usa 2568 u otro libre y **nunca** para procesos ajenos. Si la persona ve algo viejo, comprobar `netstat -ano | findstr :2567`: un servidor antiguo en `127.0.0.1` gana a uno nuevo en `0.0.0.0`.
- **Navegador:** el servidor envía `Cache-Control: no-cache`, pero tras un cambio de versión conviene recargar con **Ctrl+F5**.
- **Datos:** las pruebas automáticas usan bases temporales (`tempDb`) y puertos 42000–43999 (fetch prohíbe algunos puertos, p. ej. 3659). Las demostraciones usan bases temporales y cuentas de prueba generadas; nunca la base ni las cuentas de la persona. Cada migración deja una copia `*.vN.bak`.
- **Verificación por etapa:** unitarias + integración (`npm.cmd test`), `typecheck`, `build`, clon limpio (`npm.cmd ci`…), soak de 15 min (0 divergencias, auditoría cuadrada) y recorrido con teclado en el navegador integrado con contraste medido.
- **Cierre de etapa:** registrar evidencias en `docs/pruebas.md` §5 y dar a la persona responsable **los datos y los pasos de prueba** (comandos para cambiar de rama, construir y arrancar; qué crear; qué debe ver). Fusionar y subir solo cuando lo autorice.
