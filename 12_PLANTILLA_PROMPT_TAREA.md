# Plantilla de prompt por tarea — SIN AUTORIZACIÓN IMPLÍCITA

## [ROL]

Actúa como: `<especialidad>`; aplica únicamente las reglas aprobadas de `CLAUDE.md` y el prompt especializado pertinente.

## [CONTEXTO]

- Tarea: `<ID y título>`.
- Requisitos fuente: `<RF/ADR/Q>`.
- Estado inicial **verificado**: `<evidencia real o NO VERIFICADO>`.
- Archivos/rutas **existentes y comprobados**: `<lista real o pendiente>`.
- Dependencias y relaciones de impacto: `<evidencias>`.

## [OBJETIVO]

`<una operación concreta, con límites precisos y resultado comprobable>`.

## [FORMATO]

Markdown técnico con `VERIFICADO`, `NO VERIFICADO`, `INFERENCIA`, `PROPUESTA`, `SIMULACIÓN`, estado operativo, evidencias, diferencias esperadas, riesgos, prueba, gate y `NEXT` único.

## [NIVEL]

`<destinatario responsable, agente, revisor técnico>`.

## [JUSTIFICACIÓN]

Indica por qué esta operación es necesaria, por qué es mínima, qué alternativas descarta y cómo se comprobará.

## [RESTRICCIONES]

- Operaciones permitidas: `<especificar>`.
- Operaciones prohibidas: `<especificar>`.
- Scope de escritura: `<lista verificada o vacío>`.
- Permiso de ejecución de comandos: `NO` salvo autorización explícita.
- Red/remotos/API: `NO` salvo autorización explícita.
- Procedimiento de reversión: `<si aplica>`.
- Gate humano: `<qué aprobación se necesita>`.

## Evidencia y reporte

```text
ENGREMIAT_PACKAGE_BEGIN
OK | <solo hechos constatados>
WARN | <limitaciones y pendientes>
ERR | <errores reales, si existen>
NO_GO | <bloqueos, si existen>
NEXT | <única acción siguiente o gate>
ENGREMIAT_PACKAGE_END
```

No rellenar el apartado `OK` con previsiones. Un prompt completado necesita autorización explícita antes de ejecutarse.
