import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MissionDef, ProjectDef } from "@juego/shared";

// Persistencia del mundo (ADR-002): SQLite con escritura previa a la confirmación.
// Cada cambio de recursos se escribe en una transacción junto con su evento antes de
// que el estado sincronizado cambie; si la transacción falla, nada cambia.

export const SCHEMA_VERSION = 6;

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

export interface ReviewRow {
  taskId: string;
  decision: string;
  reviewedBy: string;
  reviewedAt: number;
  note: string;
}

export interface AccountRow {
  id: string;
  name: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
  adultDeclaredAt: number;
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
  // M5: estructuras construidas y misiones completadas. La clave primaria impide construir
  // o completar dos veces aunque lleguen dos órdenes a la vez.
  3: `
    CREATE TABLE structure (
      id TEXT PRIMARY KEY,
      built_at INTEGER NOT NULL,
      built_by TEXT NOT NULL
    );
    CREATE TABLE mission (
      id TEXT PRIMARY KEY,
      completed_at INTEGER NOT NULL,
      completed_by TEXT NOT NULL
    );
  `,
  // M5b: última revisión de cada tarea. El historial completo queda en los eventos «task-review».
  4: `
    CREATE TABLE task_review (
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('aprobada', 'rechazada')),
      reviewed_by TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL,
      note TEXT NOT NULL,
      PRIMARY KEY (project_id, task_id)
    );
  `,
  // M6: cuentas locales y sesiones. El nombre es único sin distinguir mayúsculas (Q155);
  // de la sesión solo se guarda el hash del token.
  5: `
    CREATE TABLE account (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      adult_declared_at INTEGER NOT NULL
    );
    CREATE TABLE session (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account (id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `,
  // F1a: proyectos y misiones creados desde el panel. La definición es inmutable (Q172);
  // cerrar solo anota quién y cuándo.
  6: `
    CREATE TABLE project_def (
      id TEXT PRIMARY KEY,
      definition TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      closed_by TEXT,
      closed_at INTEGER
    );
    CREATE TABLE mission_def (
      id TEXT PRIMARY KEY,
      definition TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
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
    consumedTotals: db.prepare(`SELECT j.key AS resource, SUM(j.value) AS total
      FROM event, json_each(event.data, '$.consumed') AS j WHERE event.type IN ('build', 'craft') GROUP BY j.key`),
    producedTotals: db.prepare(`SELECT j.key AS resource, SUM(j.value) AS total
      FROM event, json_each(event.data, '$.produced') AS j WHERE event.type = 'craft' GROUP BY j.key`),
    contributedAmount: db.prepare(`SELECT COALESCE(SUM(json_extract(data, '$.amount')), 0) AS total FROM event
      WHERE type = 'contribute' AND json_extract(data, '$.project') = ? AND json_extract(data, '$.resource') = ?`),
    getStructures: db.prepare("SELECT id, built_at AS builtAt, built_by AS builtBy FROM structure"),
    addStructure: db.prepare("INSERT INTO structure (id, built_at, built_by) VALUES (?, ?, ?)"),
    getMissions: db.prepare("SELECT id, completed_at AS completedAt, completed_by AS completedBy FROM mission"),
    completeMission: db.prepare("INSERT INTO mission (id, completed_at, completed_by) VALUES (?, ?, ?)"),
    getReviews: db.prepare(`SELECT task_id AS taskId, decision, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt, note
      FROM task_review WHERE project_id = ?`),
    putReview: db.prepare(`INSERT INTO task_review (project_id, task_id, decision, reviewed_by, reviewed_at, note) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, task_id) DO UPDATE SET decision = excluded.decision, reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at, note = excluded.note`),
    taskEvidence: db.prepare(`SELECT COUNT(*) AS contributions, COALESCE(MAX(id), 0) AS lastEventId FROM event
      WHERE type = 'contribute' AND json_extract(data, '$.project') = ? AND json_extract(data, '$.task') = ?`),
    getAccountByName: db.prepare(`SELECT id, name, password_hash AS passwordHash, salt, created_at AS createdAt,
      adult_declared_at AS adultDeclaredAt FROM account WHERE name = ? COLLATE NOCASE`),
    addAccount: db.prepare("INSERT INTO account (id, name, password_hash, salt, created_at, adult_declared_at) VALUES (?, ?, ?, ?, ?, ?)"),
    addSession: db.prepare("INSERT INTO session (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    getSession: db.prepare(`SELECT s.account_id AS accountId, s.expires_at AS expiresAt, a.name AS name
      FROM session s JOIN account a ON a.id = s.account_id WHERE s.token_hash = ?`),
    deleteSession: db.prepare("DELETE FROM session WHERE token_hash = ?"),
    getProjectDefs: db.prepare(`SELECT definition, created_by AS createdBy, created_at AS createdAt, closed_by AS closedBy, closed_at AS closedAt
      FROM project_def ORDER BY created_at, id`),
    addProjectDef: db.prepare("INSERT INTO project_def (id, definition, created_by, created_at) VALUES (?, ?, ?, ?)"),
    closeProjectDef: db.prepare("UPDATE project_def SET closed_by = ?, closed_at = ? WHERE id = ? AND closed_at IS NULL"),
    getMissionDefs: db.prepare("SELECT definition, created_by AS createdBy, created_at AS createdAt FROM mission_def ORDER BY created_at, id"),
    addMissionDef: db.prepare("INSERT INTO mission_def (id, definition, created_by, created_at) VALUES (?, ?, ?, ?)"),
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
    /**
     * Auditoría de conservación. Para cada recurso u objeto debe cumplirse:
     * recolectado + fabricado = en inventarios + consumido (al construir y fabricar).
     */
    audit() {
      const toMap = (rows: unknown[]) => Object.fromEntries((rows as { resource: string; total: number }[]).map((r) => [r.resource, Number(r.total)]));
      const inInventories = toMap(q.inventoryTotals.all());
      const collected = toMap(q.collectTotals.all());
      const consumed = toMap(q.consumedTotals.all());
      const produced = toMap(q.producedTotals.all());
      const keys = new Set([...Object.keys(inInventories), ...Object.keys(collected), ...Object.keys(consumed), ...Object.keys(produced)]);
      const balanced = [...keys].every((k) => (collected[k] ?? 0) + (produced[k] ?? 0) === (inInventories[k] ?? 0) + (consumed[k] ?? 0));
      return { inInventories, collected, consumed, produced, balanced };
    },
    /** Total aportado a un proyecto en un recurso según el registro (no se consume al construir). */
    contributedAmount(projectId: string, resource: string): number {
      return Number((q.contributedAmount.get(projectId, resource) as { total: number }).total);
    },
    getStructures(): { id: string; builtAt: number; builtBy: string }[] {
      return (q.getStructures.all() as { id: string; builtAt: number; builtBy: string }[]).map((r) => ({ id: r.id, builtAt: Number(r.builtAt), builtBy: r.builtBy }));
    },
    addStructure(id: string, by: string, at: number) {
      q.addStructure.run(id, at, by);
    },
    getMissions(): { id: string; completedAt: number; completedBy: string }[] {
      return (q.getMissions.all() as { id: string; completedAt: number; completedBy: string }[]).map((r) => ({ id: r.id, completedAt: Number(r.completedAt), completedBy: r.completedBy }));
    },
    completeMission(id: string, by: string, at: number) {
      q.completeMission.run(id, at, by);
    },
    getAccountByName(name: string): AccountRow | undefined {
      const r = q.getAccountByName.get(name) as AccountRow | undefined;
      return r && { id: r.id, name: r.name, passwordHash: r.passwordHash, salt: r.salt, createdAt: Number(r.createdAt), adultDeclaredAt: Number(r.adultDeclaredAt) };
    },
    addAccount(a: AccountRow) {
      q.addAccount.run(a.id, a.name, a.passwordHash, a.salt, a.createdAt, a.adultDeclaredAt);
    },
    addSession(tokenHash: string, accountId: string, createdAt: number, expiresAt: number) {
      q.addSession.run(tokenHash, accountId, createdAt, expiresAt);
    },
    getSession(tokenHash: string): { accountId: string; expiresAt: number; name: string } | undefined {
      const r = q.getSession.get(tokenHash) as { accountId: string; expiresAt: number; name: string } | undefined;
      return r && { accountId: r.accountId, expiresAt: Number(r.expiresAt), name: r.name };
    },
    deleteSession(tokenHash: string) {
      q.deleteSession.run(tokenHash);
    },
    /** Proyectos creados desde el panel (F1a), en orden de creación. */
    getProjectDefs(): { def: ProjectDef; createdBy: string; createdAt: number; closedBy: string; closedAt: number }[] {
      return (q.getProjectDefs.all() as { definition: string; createdBy: string; createdAt: number; closedBy: string | null; closedAt: number | null }[])
        .map((r) => ({ def: JSON.parse(r.definition) as ProjectDef, createdBy: r.createdBy, createdAt: Number(r.createdAt), closedBy: r.closedBy ?? "", closedAt: Number(r.closedAt ?? 0) }));
    },
    addProjectDef(def: ProjectDef, by: string, at: number) {
      q.addProjectDef.run(def.id, JSON.stringify(def), by, at);
    },
    /** Cierra un proyecto abierto; lanza si no existe o ya estaba cerrado. */
    closeProjectDef(id: string, by: string, at: number) {
      if (Number(q.closeProjectDef.run(by, at, id).changes) !== 1) throw new Error(`proyecto-no-cerrable: ${id}`);
    },
    getMissionDefs(): { def: MissionDef; createdBy: string; createdAt: number }[] {
      return (q.getMissionDefs.all() as { definition: string; createdBy: string; createdAt: number }[])
        .map((r) => ({ def: JSON.parse(r.definition) as MissionDef, createdBy: r.createdBy, createdAt: Number(r.createdAt) }));
    },
    addMissionDef(def: MissionDef, by: string, at: number) {
      q.addMissionDef.run(def.id, JSON.stringify(def), by, at);
    },
    /** Última revisión de cada tarea de un proyecto. */
    getReviews(projectId: string): ReviewRow[] {
      return (q.getReviews.all(projectId) as unknown as ReviewRow[]).map((r) => ({
        taskId: r.taskId, decision: r.decision, reviewedBy: r.reviewedBy, reviewedAt: Number(r.reviewedAt), note: r.note,
      }));
    },
    putReview(projectId: string, taskId: string, decision: string, by: string, at: number, note: string) {
      q.putReview.run(projectId, taskId, decision, by, at, note);
    },
    /** Evidencia de una tarea: cuántos aportes la sostienen y el último evento que la respalda. */
    taskEvidence(projectId: string, taskId: string): { contributions: number; lastEventId: number } {
      const row = q.taskEvidence.get(projectId, taskId) as { contributions: number; lastEventId: number };
      return { contributions: Number(row.contributions), lastEventId: Number(row.lastEventId) };
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
