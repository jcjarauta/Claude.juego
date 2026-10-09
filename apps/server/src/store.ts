import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Persistencia del mundo (ADR-002): SQLite con escritura previa a la confirmación.
// Cada cambio de recursos se escribe en una transacción junto con su evento antes de
// que el estado sincronizado cambie; si la transacción falla, nada cambia.

export const SCHEMA_VERSION = 2;

export type Scope =
  | { type: "player"; id: string }
  | { type: "community"; id: "main" }
  | { type: "project"; id: string };
export const COMMUNITY: Scope = { type: "community", id: "main" };
export const playerScope = (name: string): Scope => ({ type: "player", id: name });
export const projectScope = (id: string): Scope => ({ type: "project", id });

export interface ContributionRow {
  name: string;
  taskId: string;
  resource: string;
  amount: number;
  at: number;
}

export const MIGRATIONS: Record<number, string> = {
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
  // M4: última salida del jugador (novedades asíncronas) e índice para consultar eventos por tipo y fecha.
  2: `
    ALTER TABLE player ADD COLUMN last_seen_at INTEGER;
    CREATE INDEX event_type_at ON event (type, at);
  `,
};

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");

  const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  // Antes de migrar una base con datos se guarda una copia coherente (VACUUM INTO incluye lo
  // que esté en el registro WAL, a diferencia de copiar el archivo).
  if (version >= 1 && version < SCHEMA_VERSION && path !== ":memory:") {
    const backup = `${path}.v${version}.bak`;
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
  }
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
    setLastSeen: db.prepare("UPDATE player SET last_seen_at = ? WHERE name = ?"),
    getLastSeen: db.prepare("SELECT last_seen_at AS lastSeenAt FROM player WHERE name = ?"),
    contributionTotals: db.prepare(`SELECT actor AS name, json_extract(data, '$.resource') AS resource, SUM(json_extract(data, '$.amount')) AS total
      FROM event WHERE type = 'contribute' AND json_extract(data, '$.project') = ? GROUP BY actor, resource`),
    recentContributions: db.prepare(`SELECT actor AS name, json_extract(data, '$.task') AS taskId, json_extract(data, '$.resource') AS resource,
      json_extract(data, '$.amount') AS amount, at FROM event
      WHERE type = 'contribute' AND json_extract(data, '$.project') = ? ORDER BY id DESC LIMIT ?`),
    contributionsSince: db.prepare(`SELECT actor AS name, json_extract(data, '$.project') AS projectId, json_extract(data, '$.task') AS taskId,
      json_extract(data, '$.resource') AS resource, json_extract(data, '$.amount') AS amount, at FROM event
      WHERE type = 'contribute' AND at > ? AND actor <> ? ORDER BY id LIMIT ?`),
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
    /** Última salida del jugador (ms), o null si nunca ha salido. */
    getLastSeen(name: string): number | null {
      const row = q.getLastSeen.get(name) as { lastSeenAt: number | null } | undefined;
      return row?.lastSeenAt ?? null;
    },
    setLastSeen(name: string, at: number) {
      q.setLastSeen.run(at, name);
    },
    /** Quién aportó qué a un proyecto: nombre → recurso → total. */
    contributionTotals(projectId: string): Record<string, Record<string, number>> {
      const result: Record<string, Record<string, number>> = {};
      for (const r of q.contributionTotals.all(projectId) as { name: string; resource: string; total: number }[]) {
        (result[r.name] ??= {})[r.resource] = Number(r.total);
      }
      return result;
    },
    /** Últimos aportes a un proyecto, del más reciente al más antiguo. */
    recentContributions(projectId: string, limit: number): ContributionRow[] {
      return (q.recentContributions.all(projectId, limit) as unknown as ContributionRow[])
        .map((r) => ({ name: r.name, taskId: r.taskId, resource: r.resource, amount: Number(r.amount), at: Number(r.at) }));
    },
    /** Aportes de otros jugadores desde una fecha (novedades al volver). */
    contributionsSince(since: number, excludeName: string, limit: number): (ContributionRow & { projectId: string })[] {
      return (q.contributionsSince.all(since, excludeName, limit) as unknown as (ContributionRow & { projectId: string })[])
        .map((r) => ({ name: r.name, projectId: r.projectId, taskId: r.taskId, resource: r.resource, amount: Number(r.amount), at: Number(r.at) }));
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
