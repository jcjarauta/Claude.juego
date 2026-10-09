# Juego cooperativo multijugador — paquete de diseño PROVISIONAL

**Estado:** `PROPUESTA / PENDIENTE_GATE_HUMANO`  
**Fecha de consolidación:** 2026-10-09  
**Origen:** decisiones expresadas en la conversación (preguntas 1–130) y estructura del archivo `prompt.base.txt`.  
**Alcance autorizado:** auditoría y redacción documental; **sin código ni ejecución del proyecto**.

## Uso del paquete

1. Leer `09_AUDITORIA_CONSOLIDACION.md` para conocer tensiones y vacíos.
2. Revisar `10_REGISTRO_DECISIONES.md`, que conserva 130 entradas; Q103 no definió profundidad documental, sino separación `CLAUDE.md`/prompt.
3. Revisar `03_ESPECIFICACION_FUNCIONAL.md` y `05_HOJA_RUTA_MVP.md` para distinguir MVP de visión completa.
4. Tras aprobación humana, utilizar `CLAUDE.md` como reglas permanentes y `02_PROMPT_MAESTRO.md` como instrucción del orquestador.
5. Utilizar `11_PROMPTS_ESPECIALIZADOS.md` y `12_PLANTILLA_PROMPT_TAREA.md` para crear tareas acotadas; **no autorizan acciones por sí mismos**.

## Archivos

| Archivo | Propósito |
|---|---|
| `CLAUDE.md` | Reglas estables, seguridad y disciplina operativa |
| `02_PROMPT_MAESTRO.md` | Prompt de orquestación según fuente ROL–CONTEXTO–OBJETIVO–FORMATO–NIVEL–JUSTIFICACIÓN–RESTRICCIONES |
| `03_ESPECIFICACION_FUNCIONAL.md` | Visión jugable, casos de uso y requisitos priorizados |
| `04_ARQUITECTURA_TECNICA.md` | Límites de servicios, datos, APIs y alternativas abiertas |
| `05_HOJA_RUTA_MVP.md` | Incrementos, dependencias y gates |
| `06_MATRIZ_TRAZABILIDAD.md` | Requisito → decisiones → aceptación → prueba |
| `07_PLAN_PRUEBAS.md` | Estrategia y casos reproducibles, no ejecutados |
| `08_PROTOCOLO_MULTIAGENTE.md` | Agentes, autorizaciones y conflictos |
| `09_AUDITORIA_CONSOLIDACION.md` | Informe de coherencia, bloqueos y recomendaciones |
| `10_REGISTRO_DECISIONES.md` | Índice de las 130 respuestas/decisiones |
| `11_PROMPTS_ESPECIALIZADOS.md` | Instrucciones reutilizables por especialidad |
| `12_PLANTILLA_PROMPT_TAREA.md` | Contrato por tarea y reporte ENGREMIAT |
| `13_MODELO_CONCEPTUAL.md` | Entidades, eventos, límites de consistencia y trazabilidad |

## Convenciones de evidencia

- **VERIFICADO/DECISIÓN:** expresado por el usuario; no significa implementado ni probado.
- **PROPUESTA:** diseño sugerido, pendiente de aprobación.
- **INFERENCIA:** consecuencia razonada, no aportada explícitamente.
- **NO VERIFICADO:** falta evidencia o decisión.
- **SIMULACIÓN:** resultado hipotético; no equivale a operación real.
- **NO_GO:** bloqueo para la operación indicada; no implica paralizar el resto del análisis.

## Nota sobre la fuente del prompt

`prompt.base.txt` prescribe los apartados ROL, CONTEXTO, OBJETIVO, FORMATO, NIVEL, JUSTIFICACIÓN y RESTRICCIONES. Contiene un ejemplo de salida con «asunto, preencabezado y cuerpo del mensaje»; esta pauta es pertinente al redactar mensajes, pero **no** se impone a especificaciones técnicas y documentación de software.

## Gate humano pendiente

No usar este paquete como autorización implícita para escribir código, instalar dependencias, sincronizar Obsidian/Graphify, contactar sistemas remotos o desplegar servicios. Es documentación provisional; el gate para consolidarla continúa abierto.
