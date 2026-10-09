# ADR-003 — Herramientas TypeScript del monorepositorio

**Estado:** APROBADO como parte del plan de M1 (aprobado por la persona responsable el 2026-10-09)  
**Requisitos:** Q064 (monorepositorio), Q119 (versiones fijadas), Q147 (TypeScript), ADR-002

## Contexto

Q147 fija TypeScript en cliente y servidor. Hace falta decidir cómo se ejecuta y comprueba sin añadir más herramientas de las necesarias.

## Decisión

- **npm workspaces**, sin herramientas de monorepositorio adicionales: `packages/shared` (`@juego/shared`), `apps/server` y `apps/client`. Un solo `package-lock.json` en la raíz con versiones exactas.
- **El servidor y las pruebas se ejecutan como `.ts` directamente** con la eliminación de tipos de Node 24, sin paso de compilación. Verificado también a través del enlace del workspace (`@juego/shared`).
- **Sintaxis "borrable" obligatoria** (`erasableSyntaxOnly`): sin `enum`, sin propiedades de parámetro, sin decoradores, sin `namespace`. Colyseus Schema se define con `schema()`. Los imports relativos llevan la extensión `.ts`.
- **`tsc` solo comprueba tipos** (`noEmit`) con un único `tsconfig.json` en la raíz: `strict` y `noUncheckedIndexedAccess`.
- **El cliente se empaqueta con esbuild**, que entiende TypeScript y resuelve `@juego/shared` desde el código fuente.
- **Contratos compartidos:** los mensajes, motivos de rechazo, la configuración del mundo y la regla de movimiento viven en `@juego/shared` y los usan cliente y servidor.
- **Pruebas con `node:test`**, sin framework adicional.
- **Versiones:** typescript 7.0.2 (compilador nativo; con 6.0.3 como alternativa si diera problemas), esbuild 0.28.2, @types/node 24.19.1.

## Consecuencias

- Sin carpetas `dist/` ni mapas de código en el servidor; arranque inmediato (`node apps/server/src/index.ts`).
- Algunas construcciones de TypeScript quedan prohibidas por la eliminación de tipos; `tsc` las detecta.
- Express llega como dependencia de Colyseus sin tipos: se declara localmente la interfaz mínima que se usa, en lugar de añadir `@types/express`.
- El SDK de Colyseus no conoce la forma del estado en el cliente (`unknown`). En M1 se usa una conversión explícita; en M2 conviene compartir el esquema del estado en `@juego/shared`.
- En Windows con la política de ejecución de PowerShell restringida, los comandos se lanzan con `npm.cmd`.
