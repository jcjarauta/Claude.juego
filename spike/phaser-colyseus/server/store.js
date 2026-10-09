import { DatabaseSync } from "node:sqlite";

// Persistencia write-through: cada cambio confirmado se escribe en SQLite
// antes de reflejarse en el estado que ven los clientes.
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS node (
      id TEXT PRIMARY KEY,
      units INTEGER NOT NULL,
      last_regen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player (
      name TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      madera INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      type TEXT NOT NULL,
      actor TEXT,
      data TEXT
    );
  `);

  const q = {
    getNode: db.prepare("SELECT units, last_regen_at FROM node WHERE id = ?"),
    putNode: db.prepare("INSERT INTO node (id, units, last_regen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET units = excluded.units, last_regen_at = excluded.last_regen_at"),
    getPlayer: db.prepare("SELECT x, y, madera FROM player WHERE name = ?"),
    putPlayer: db.prepare("INSERT INTO player (name, x, y, madera) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET x = excluded.x, y = excluded.y, madera = excluded.madera"),
    addEvent: db.prepare("INSERT INTO event (at, type, actor, data) VALUES (?, ?, ?, ?)"),
  };

  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  return {
    getNode: (id) => q.getNode.get(id),
    putNode: (id, units, lastRegenAt) => q.putNode.run(id, units, lastRegenAt),
    getPlayer: (name) => q.getPlayer.get(name),
    putPlayer: (name, x, y, madera) => q.putPlayer.run(name, x, y, madera),
    event: (type, actor, data) => q.addEvent.run(Date.now(), type, actor, JSON.stringify(data ?? null)),
    transaction,
    close: () => db.close(),
  };
}
