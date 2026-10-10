import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { nameKey } from "@juego/shared";

// Mantenimiento (F2b): quita de una base de datos los objetos y recetas creados desde el panel con un nombre repetido
// (posibles antes de que el servidor lo impidiera, Q194). Se conserva el más antiguo de cada nombre y solo se borra
// un duplicado si nada lo usa: ni recetas, misiones, existencias o fabricaciones. Sin `apply` solo informa.
// Se ejecuta con el servidor parado: `node scripts/dedupe-defs.ts <base.db> [--apply]`.

export interface DedupeLine {
  kind: "objeto" | "receta";
  id: string;
  name: string;
  /** Id que se conserva con el mismo nombre. */
  keeps: string;
  action: "borrar" | "conservar";
  /** Por qué se conserva un duplicado. */
  reason?: string;
}

export interface DedupeResult {
  lines: DedupeLine[];
  deleted: number;
  /** Copia hecha antes de borrar (solo con `apply` y algo que borrar). */
  backup?: string;
}

interface Row { id: string; definition: string; created_at: number }

export function dedupeDefinitions(path: string, apply: boolean): DedupeResult {
  if (!existsSync(path)) throw new Error(`No existe la base de datos: ${path}`);
  const db = new DatabaseSync(path);
  try {
    const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    if (version < 9) throw new Error(`La base está en la versión ${version}: arranca el servidor una vez para migrarla (se necesita la 9 o posterior).`);
    const rows = (table: string) => db.prepare(`SELECT id, definition, created_at FROM ${table} ORDER BY created_at, id`).all() as unknown as Row[];
    const mentions = (table: string, id: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE definition LIKE ?`).get(`%"${id}"%`) as { n: number }).n > 0;

    const lines: DedupeLine[] = [];
    const toDelete: { table: string; id: string }[] = [];
    const groups = (table: string) => {
      const seen = new Map<string, Row>();
      const duplicates: { row: Row; keeps: Row; name: string }[] = [];
      for (const row of rows(table)) {
        const name = (JSON.parse(row.definition) as { name: string }).name;
        const key = nameKey(name);
        const first = seen.get(key);
        if (first) duplicates.push({ row, keeps: first, name }); else seen.set(key, row);
      }
      return duplicates;
    };

    for (const { row, keeps, name } of groups("item_def")) {
      const inStock = (db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE resource = ? AND amount > 0").get(row.id) as { n: number }).n > 0;
      const inEvents = (db.prepare("SELECT COUNT(*) AS n FROM event WHERE type <> 'item-created' AND data LIKE ?").get(`%"${row.id}"%`) as { n: number }).n > 0;
      const reason = mentions("recipe_def", row.id) ? "la usa una receta" : mentions("mission_def", row.id) ? "la usa una misión"
        : inStock ? "hay existencias" : inEvents ? "figura en fabricaciones" : undefined;
      lines.push({ kind: "objeto", id: row.id, name, keeps: keeps.id, action: reason ? "conservar" : "borrar", ...(reason ? { reason } : {}) });
      if (!reason) toDelete.push({ table: "item_def", id: row.id });
    }
    for (const { row, keeps, name } of groups("recipe_def")) {
      const crafted = (db.prepare("SELECT COUNT(*) AS n FROM event WHERE type = 'craft' AND json_extract(data, '$.recipe') = ?").get(row.id) as { n: number }).n > 0;
      lines.push({ kind: "receta", id: row.id, name, keeps: keeps.id, action: crafted ? "conservar" : "borrar", ...(crafted ? { reason: "ya se ha fabricado con ella" } : {}) });
      if (!crafted) toDelete.push({ table: "recipe_def", id: row.id });
    }

    const result: DedupeResult = { lines, deleted: 0 };
    if (!apply || !toDelete.length) return result;
    const backup = `${path}.dedupe-${Date.now()}.bak`;
    db.prepare("VACUUM INTO ?").run(backup);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const { table, id } of toDelete) {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        if (table === "item_def") db.prepare("DELETE FROM inventory WHERE resource = ? AND amount = 0").run(id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ...result, deleted: toDelete.length, backup };
  } finally {
    db.close();
  }
}
