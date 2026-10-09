import { DatabaseSync } from "node:sqlite";

// Persistencia del mundo (ADR-002): SQLite con escritura previa a la confirmación.
// Cada cambio de recursos se escribe en una transacción junto con su evento antes de
// que el estado sincronizado cambie; si la transacción falla, nada cambia.

export const SCHEMA_VERSION = 1;

export type Scope = { type: "player"; id: string } | { type: "community"; id: "main" };
export const COMMUNITY: Scope = { type: "community", id: "main" };
export const playerScope = (name: string): Scope => ({ type: "player", id: name });

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE node_state (
      node_id TEXT PRIMARY KEY,
      units INTEGER NOT NULL CHECK (units >= 0),
      last_regen_at INTEGER NOT NULL
    );
    CREATE TABLE inventory (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 0),
      PRIMARY KEY (scope_type, scope_id, resource)
    );
    CREATE TABLE player (
      name TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      type TEXT NOT NULL,
      actor TEXT,
      request_id TEXT,
      data TEXT,
      UNIQUE (actor, request_id)
    );
  `,
};

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");

  const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let v = version + 1; v <= SCHEMA_VERSION; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  const q = {
    getNode: db.prepare("SELECT units, last_regen_at AS lastRegenAt FROM node_state WHERE node_id = ?"),
    putNode: db.prepare(`INSERT INTO node_state (node_id, units, last_regen_at) VALUES (?, ?, ?)
      ON CONFLICT (node_id) DO UPDATE SET units = excluded.units, last_regen_at = excluded.last_regen_at`),
    getInventory: db.prepare("SELECT resource, amount FROM inventory WHERE scope_type = ? AND scope_id = ?"),
    getAmount: db.prepare("SELECT amount FROM inventory WHERE scope_type = ? AND scope_id = ? AND resource = ?"),
    // Las sumas insertan o acumulan; las restas solo actualizan una fila existente.
    // (Con INSERT ... ON CONFLICT, SQLite valida el CHECK sobre la fila candidata, que
    // con una cantidad negativa fallaría siempre.)
    addAmount: db.prepare(`INSERT INTO inventory (scope_type, scope_id, resource, amount) VALUES (?, ?, ?, ?)
      ON CONFLICT (scope_type, scope_id, resource) DO UPDATE SET amount = amount + excluded.amount`),
    subtractAmount: db.prepare("UPDATE inventory SET amount = amount - ? WHERE scope_type = ? AND scope_id = ? AND resource = ?"),
    getPlayer: db.prepare("SELECT x, y FROM player WHERE name = ?"),
    putPlayer: db.prepare(`INSERT INTO player (name, x, y, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`),
    hasRequest: db.prepare("SELECT 1 AS found FROM event WHERE actor = ? AND request_id = ?"),
    addEvent: db.prepare("INSERT INTO event (at, type, actor, request_id, data) VALUES (?, ?, ?, ?, ?)"),
    inventoryTotals: db.prepare("SELECT resource, SUM(amount) AS total FROM inventory GROUP BY resource"),
    collectTotals: db.prepare(`SELECT json_extract(data, '$.resource') AS resource, COUNT(*) AS total
      FROM event WHERE type = 'collect' GROUP BY resource`),
  };

  return {
    /** Ejecuta fn en una transacción; si lanza, se deshace todo y el error se propaga. */
    transaction<T>(fn: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    getNode(id: string): { units: number; lastRegenAt: number } | undefined {
      const row = q.getNode.get(id) as { units: number; lastRegenAt: number } | undefined;
      return row && { units: row.units, lastRegenAt: row.lastRegenAt };
    },
    putNode(id: string, units: number, lastRegenAt: number) {
      q.putNode.run(id, units, lastRegenAt);
    },
    getInventory(scope: Scope): Record<string, number> {
      const rows = q.getInventory.all(scope.type, scope.id) as { resource: string; amount: number }[];
      return Object.fromEntries(rows.map((r) => [r.resource, r.amount]));
    },
    getAmount(scope: Scope, resource: string): number {
      return (q.getAmount.get(scope.type, scope.id, resource) as { amount: number } | undefined)?.amount ?? 0;
    },
    /** Suma (o resta) a un inventario. Restar más de lo que hay lanza un error y aborta la transacción. */
    addAmount(scope: Scope, resource: string, delta: number) {
      if (delta >= 0) {
        q.addAmount.run(scope.type, scope.id, resource, delta);
        return;
      }
      // Si el saldo no alcanza, el CHECK (amount >= 0) lanza; si no hay fila, no cambia nada.
      const { changes } = q.subtractAmount.run(-delta, scope.type, scope.id, resource);
      if (Number(changes) !== 1) throw new Error(`saldo-insuficiente: ${scope.type}/${scope.id}/${resource}`);
    },
    getPlayer(name: string): { x: number; y: number } | undefined {
      const row = q.getPlayer.get(name) as { x: number; y: number } | undefined;
      return row && { x: row.x, y: row.y };
    },
    putPlayer(name: string, x: number, y: number) {
      q.putPlayer.run(name, x, y, Date.now());
    },
    hasRequest(actor: string, requestId: string): boolean {
      return q.hasRequest.get(actor, requestId) !== undefined;
    },
    event(type: string, actor: string | null, requestId: string | null, data: unknown) {
      q.addEvent.run(Date.now(), type, actor, requestId, JSON.stringify(data ?? null));
    },
    /** Auditoría de conservación: lo recolectado según eventos frente a lo que hay en inventarios. */
    audit() {
      const toMap = (rows: unknown[]) => Object.fromEntries((rows as { resource: string; total: number }[]).map((r) => [r.resource, Number(r.total)]));
      return { inInventories: toMap(q.inventoryTotals.all()), collected: toMap(q.collectTotals.all()) };
    },
    schemaVersion(): number {
      return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    },
    close() {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof openStore>;
