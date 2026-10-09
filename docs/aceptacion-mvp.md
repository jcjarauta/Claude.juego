# Aceptación del MVP — ENGREMIAT (gate M6, Q101)

> Informe de cierre del MVP para la **firma de la persona responsable**. Cada requisito se respalda con pruebas **ejecutadas** registradas en `docs/pruebas.md` §5. Las categorías siguen `CLAUDE.md` §5. Fecha: 2026-10-09. Rama: `m6-endurecimiento`.

## 1. Qué se acepta

Prototipo vertical web 2D con:
- 2–4 jugadores en red local y cuentas locales;
- un mundo persistente con reloj, tres recursos e inventarios individual, de comunidad y de proyecto;
- un proyecto comunitario con tareas, revisión y panel profesional;
- la construcción del taller, la fabricación de la herramienta y la misión «Primera herramienta».

Fuera del MVP (visión futura, `docs/especificacion.md` §5): federación, IA, RAG, Kanban y Gantt, editores de nodos, integraciones reales, proyectos `SIMULACION` y `REAL`, HTTPS y copias programadas.

## 2. Matriz de requisitos

| Requisito | Prueba | Evidencia (`docs/pruebas.md` §5) | Estado |
|---|---|---|---|
| RF-001 Mundo 2D web | TP-01 | M1: navegador integrado y prueba automática | OK |
| RF-002 2–4 jugadores en tiempo real (LAN) | TP-02 | M2: 2 y 4 clientes; soak; red local real probada por la persona responsable | OK |
| RF-003 Cuenta local con permisos | TP-03 | M6: sin token, token inventado o caducado → no entra; el nombre sale de la cuenta; cerrar sesión invalida; nadie revisa como coordinador sin su contraseña; contraseña y token nunca en claro | OK |
| RF-004 Explorar y recolectar | TP-04 | M3 | OK |
| RF-005 Inventarios sin doble gasto | TP-05 | M3 y M4 (última unidad, transferencias simultáneas); auditoría cuadrada en todos los soaks | OK |
| RF-006 Proyecto, tareas y aportes | TP-06 | M4 | OK |
| RF-007 Construir el taller | TP-07 | M5 | OK |
| RF-008 Misión con resultado persistente | TP-08, TP-09 | M5 (ciclo completo y caída) | OK |
| RF-009 Guardado, reconexión y recuperación | TP-09 | M2–M6: SIGKILL sin pérdida; reconexión en 64 ms; arranque con 50 000 eventos en 402 ms | OK |
| RF-010 Mapa + panel de proyecto | TP-10 | M4 (teclas P/M, contexto conservado) | OK |
| RF-011 Accesibilidad en Chrome, Edge y Firefox | TP-11 | M6: recorrido completo solo con teclado y contraste medido en Chromium (navegador integrado). Chrome y Edge: prueba de la persona responsable. Firefox: ver §5 | WARN hasta tu prueba |
| RF-012 Eventos y rechazo de inválidas | TP-12 | M1–M6 | OK |
| RF-013 Colaboración asíncrona | TP-13 | M4 | OK |
| RF-014 Reloj del mundo | TP-14 | M3 | OK |
| RF-015 Panel profesional | TP-15 | M5b | OK |
| RF-016 Revisión con evidencia y permisos | TP-16 | M5b | OK |
| NFR-01 Arquitectura modular y contratos | TA-01 | `typecheck` compartido cliente/servidor; núcleo de proyectos probado sin Colyseus (M6, TA-02) | OK |
| NFR-02 Auditoría y bloqueo de errores | TA-02 | M6: fallo inyectado a mitad de operación sin confirmar nada; logs estructurados | OK |
| NFR-03 Gobierno de cambios | TA-03 | Cada etapa con plan aprobado, rama, evidencias y fusión autorizada (historial git); permisos en `.claude/settings.json` | OK |
| DOC-01 Documentación y trazas | TA-04 | Commits y evidencias reales; sin hashes inventados | OK |

## 3. Umbrales medidos (propuesta Q168)

| Umbral (`docs/pruebas.md` §3) | Propuesto | Medido | Estado |
|---|---|---|---|
| Convergencia en LAN | ≤ 500 ms | 58 ms (M2, sin latencia añadida); 109 ms con 20 ms de latencia; ≤ 1 ms entre clientes en los soaks | OK |
| Reconexión | ≤ 5 s | 64 ms (M6) | OK |
| Persistencia | RPO = 0 para lo confirmado | SIGKILL en M3, M4, M5 y M5b sin pérdida; auditoría cuadrada | OK |
| Recuperación | ≤ 30 s | 402 ms con 50 000 eventos | OK |
| Carga | 4 clientes, 15 min, sin divergencias | SOAK_M6 | SOAK_M6_ESTADO |

## 4. Riesgos residuales (aceptados para el MVP)

| Riesgo | Mitigación actual | Cuándo se resolvería |
|---|---|---|
| Contraseñas por HTTP sin cifrar dentro de la LAN | Servidor en `127.0.0.1` por defecto; LAN privada entre conocidos | HTTPS después del MVP |
| Nombres con datos previos reclamables por la primera cuenta que los registre (Q166) | Documentado; alternativa: mundo nuevo | No aplica a mundos nuevos |
| Sin recuperación de contraseña, borrado de cuenta ni exportación de datos | Datos mínimos (Q034) | Después del MVP |
| Sin copias programadas (BL-09) | Copia automática antes de cada migración | Después del MVP |
| Bloqueo de intentos en memoria (se pierde al reiniciar) | 5 fallos → 30 s; scrypt encarece cada intento | Suficiente para LAN |
| Texto del lienzo (etiquetas de Phaser) no medido en contraste | La misma información está en HTML accesible (HUD, inventarios, panel) | — |

## 5. Pendiente para la firma

1. Tu recorrido con teclado en **Chrome** y **Edge** (crear cuenta → recolectar → aportar → construir → fabricar → misión; panel y revisión).
2. **Firefox** (Q143, Q145): no está instalado. O lo instalas tú y lo pruebas, o decides aceptarlo sin Firefox y queda registrado como excepción.
3. Aprobar los umbrales medidos (Q168).
4. Firma.

```text
ENGREMIAT_PACKAGE_BEGIN
OK | RF-001…RF-016 respaldados por pruebas ejecutadas (docs/pruebas.md §5), salvo RF-011, que está a la espera de la prueba en Chrome, Edge y Firefox
OK | Identidad real: cuentas locales con scrypt, sesiones guardadas como hash, onAuth en la sala; cierra Q151, Q155 y la suplantación de Q161
OK | Robustez: límite de frecuencia, fallo inyectado sin efectos, logs estructurados sin secretos, recuperación en 402 ms
WARN | RF-011: recorrido con teclado verificado solo en Chromium; Chrome y Edge, pendientes de tu prueba; Firefox no instalado
WARN | Riesgos residuales del §4 aceptados para el MVP
NO_GO | Proyectos REAL, conectores con escritura e integraciones externas (AUD-05)
NEXT | Prueba de la persona responsable y firma de la aceptación del MVP
ENGREMIAT_PACKAGE_END
```

**Firma de aceptación:** _pendiente — nombre, fecha y decisión (aceptado / aceptado con excepciones / no aceptado)._
