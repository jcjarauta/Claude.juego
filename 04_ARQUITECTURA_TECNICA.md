# Arquitectura técnica — BORRADOR

## 1. Decisiones respaldadas

Arquitectura objetivo de **microservicios y ejecución distribuida** (Q58), protocolos **API + eventos + WebSocket** (Q59), despliegue inicial **local autoalojado** (Q18), **monorepositorio modular** (Q64), configuración por entornos y contenedores futuros (Q65). Preferencia por tecnologías maduras, preferentemente libres y autoalojables (Q60). Stack **NO VERIFICADO**; no se han seleccionado frameworks, bases de datos, brokers ni proveedores.

## 2. Módulos / límites propuestos

| Servicio o módulo | Responsabilidad | MVP | Estado |
|---|---|---|---|
| Gateway web | Entrada y distribución de peticiones, autenticación de sesión | Mínimo | PROPUESTA |
| Identidad y permisos | Cuenta local inicial y ACL | Sí | PROPUESTA |
| Sesión multijugador | Conexiones/acciones, sincronización de clientes, servidor autoritativo | Sí | PROPUESTA |
| Estado del mundo | Mapa 2D, recursos, construcción, persistencia | Sí | PROPUESTA |
| Proyectos | Comunidad inicial, proyecto/tareas, misión y logros | Sí | PROPUESTA |
| Registro de eventos | Evidencia de cambios de estado y operaciones | Mínimo | PROPUESTA |
| Documentos/conocimiento | Ingesta, clasificación, RAG, grafo | No | VISIÓN FUTURA |
| IA y agentes | Proveedores, herramientas, memoria, presupuestos | No | VISIÓN FUTURA |
| Federación | Intercambio entre mundos/servidores | No | VISIÓN FUTURA |
| Simulación avanzada | Clima, procesos, probabilística y agentes | No | VISIÓN FUTURA |

**NOTA:** el diseño por servicios no obliga a procesos/deploys separados desde la primera iteración. Compartir host y entorno de pruebas mientras se respetan límites de responsabilidades.

## 3. Comunicación y autoridad de datos

- HTTP/API: consultas, comandos controlados, estado administrativo.
- WebSocket: interacción multijugador y eventos de estado cercanos al tiempo real.
- Bus/eventos asíncronos: procesos desacoplados; **no imprescindible un broker externo en el primer prototipo**.
- Estado del mundo e inventarios: una autoridad de escritura por entidad; validación del lado servidor.
- Cada comando requiere: identidad de emisor, alcance/permiso, identificador, versión esperada cuando aplique y resultado.
- Eventos propuestos: `ResourceCollected`, `ResourceContributed`, `TaskCompleted`, `WorkshopBuilt`, `MissionCompleted`. Nombres **de diseño**, no código existente.

## 4. Persistencia y consistencia

Mantener transacciones en cambios de inventario/recursos, evitar doble consumo, considerar idempotencia de comandos. Guardado/reinicio verificables para MVP. Registro de eventos y versionado se ampliarán después. Las copias de seguridad requieren **prueba real de restauración** antes de etiquetar el control como OK.

## 5. Autenticación, privacidad y seguridad

Cuentas locales al inicio (adultos); autorización por acción/recurso; mínimos datos; secretos fuera del código; validación del input del cliente; logs redactados sin datos sensibles. No trasladar credenciales ni documentos privados a IA externa sin consentimiento específico y evaluación de riesgos.

## 6. Red local y federación (futuro)

Requisito aspiracional: funcionamiento autónomo offline y federación voluntaria, con identidad estable. **Tensión abierta:** una «identidad global» no puede depender incondicionalmente de un servicio central cuando cada servidor opera sin Internet. Diseñar negociación de confianza, resolución de conflictos y políticas de migración antes de implementar federación. Ninguna transferencia de recursos únicos por mera copia.

## 7. Obsidian y Graphify (futuro o acompañamiento no bloqueante)

Repositorio fuente; sincronización unidireccional y filtrada hacia bóveda/grafo, primero DRY_RUN. No existen aquí pruebas de disponibilidad de Obsidian, Graphify, APIs, plugins ni rutas. El MVP no debe depender de esa integración para arrancar.

## 8. Alternativas tecnológicas todavía sin decisión

Motor 2D web, protocolo de tiempo real, almacenamiento relacional/documental, contenedorización, sistema de colas, observabilidad, automatización y tests: establecer un *spike* comparativo y decisión ADR antes de programar. No atribuir elecciones al usuario ni comprometer versiones no evaluadas.

## 9. Criterios no funcionales pendientes

Concurrencia esperada, latencia tolerable, límites de memoria/CPU/GPU, plataforma de pruebas, RPO/RTO, duración de sesión, tasa de sincronización, seguridad aplicable y política de datos. Deben concretarse antes del correspondiente gate técnico, sin bloquear la redacción del borrador.
