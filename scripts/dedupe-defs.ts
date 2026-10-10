// Quita objetos y recetas del panel con nombre repetido de una base de datos (F2b, Q194).
// Uso, con el servidor parado:
//   node scripts/dedupe-defs.ts data/mundo.db            (solo informa)
//   node scripts/dedupe-defs.ts data/mundo.db --apply    (hace una copia y borra los duplicados sin uso)
import { dedupeDefinitions } from "../apps/server/src/dedupe.ts";

const [path, flag] = process.argv.slice(2);
if (!path || (flag && flag !== "--apply")) {
  console.error("Uso: node scripts/dedupe-defs.ts <base.db> [--apply]");
  process.exit(2);
}
try {
  const result = dedupeDefinitions(path, flag === "--apply");
  if (!result.lines.length) console.log("No hay objetos ni recetas con nombre repetido.");
  for (const l of result.lines) {
    console.log(`${l.action === "borrar" ? (flag ? "BORRAR   " : "BORRARÍA ") : "CONSERVAR"} ${l.kind} «${l.name}» (${l.id}); se queda ${l.keeps}${l.reason ? ` — ${l.reason}` : ""}`);
  }
  if (flag === "--apply") console.log(result.deleted ? `Borrados ${result.deleted}. Copia previa: ${result.backup}` : "Nada que borrar.");
  else if (result.lines.some((l) => l.action === "borrar")) console.log("Para borrarlos: añade --apply (se hace antes una copia de la base).");
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exit(1);
}
