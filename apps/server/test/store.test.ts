import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { COMMUNITY, MIGRATIONS, openStore, playerScope, projectScope, SCHEMA_VERSION } from "../src/store.ts";

const tempDb = () => join(mkdtempSync(join(tmpdir(), "juego-store-")), "test.db");

test("la migración crea el esquema y los datos sobreviven a reabrir la base", () => {
  const path = tempDb();
  const store = openStore(path);
  assert.equal(store.schemaVersion(), SCHEMA_VERSION);
  store.transaction(() => {
    store.putNode("arbol-1", 2, 1000);
    store.addAmount(playerScope("ana"), "madera", 3);
    store.addAmount(COMMUNITY, "piedra", 1);
    store.putPlayer("ana", 4, 5);
  });
  store.close();

  const again = openStore(path);
  assert.deepEqual(again.getNode("arbol-1"), { units: 2, lastRegenAt: 1000 });
  assert.deepEqual(again.getInventory(playerScope("ana")), { madera: 3 });
  assert.deepEqual(again.getInventory(COMMUNITY), { piedra: 1 });
  assert.deepEqual(again.getPlayer("ana"), { x: 4, y: 5 });
  again.close();
});

test("migración v2 → v3, construir y completar solo una vez, y auditoría con consumos y objetos", () => {
  const path = tempDb();
  const v2 = new DatabaseSync(path);
  v2.exec(MIGRATIONS[1]!);
  v2.exec(MIGRATIONS[2]!);
  v2.exec("PRAGMA user_version = 2");
  v2.exec("INSERT INTO inventory VALUES ('community', 'main', 'madera', 7)");
  v2.close();

  const store = openStore(path);
  assert.equal(store.schemaVersion(), 3);
  assert.ok(existsSync(`${path}.v2.bak`));
  assert.deepEqual(store.getInventory(COMMUNITY), { madera: 7 });

  store.transaction(() => store.addStructure("taller", "ana", 10));
  assert.throws(() => store.transaction(() => store.addStructure("taller", "bea", 11)), "no se construye dos veces");
  assert.deepEqual(store.getStructures(), [{ id: "taller", builtAt: 10, builtBy: "ana" }]);
  store.transaction(() => store.completeMission("m1", "bea", 20));
  assert.throws(() => store.transaction(() => store.completeMission("m1", "ana", 21)));
  assert.deepEqual(store.getMissions(), [{ id: "m1", completedAt: 20, completedBy: "bea" }]);

  // Conservación: 4 recolectadas; 3 consumidas al fabricar 1 herramienta.
  const fresh = openStore(tempDb());
  fresh.transaction(() => {
    for (let i = 0; i < 4; i++) fresh.event("collect", "ana", `c${i}`, { resource: "madera" });
    fresh.addAmount(COMMUNITY, "madera", 1);
    fresh.addAmount(COMMUNITY, "herramienta", 1);
    fresh.event("craft", "ana", "f1", { recipe: "herramienta", consumed: { madera: 3 }, produced: { herramienta: 1 } });
  });
  assert.deepEqual(fresh.audit(), {
    inInventories: { madera: 1, herramienta: 1 }, collected: { madera: 4 }, consumed: { madera: 3 }, produced: { herramienta: 1 }, balanced: true,
  });
  fresh.close();
  store.close();
});

test("migración v1 → v2: conserva los datos y deja una copia de seguridad", () => {
  const path = tempDb();
  const v1 = new DatabaseSync(path);
  v1.exec(MIGRATIONS[1]!);
  v1.exec("PRAGMA user_version = 1");
  v1.exec("INSERT INTO inventory VALUES ('player', 'ana', 'madera', 4)");
  v1.exec("INSERT INTO player (name, x, y, updated_at) VALUES ('ana', 3, 2, 1)");
  v1.close();

  const store = openStore(path);
  assert.equal(store.schemaVersion(), SCHEMA_VERSION);
  assert.deepEqual(store.getInventory(playerScope("ana")), { madera: 4 });
  assert.deepEqual(store.getPlayer("ana"), { x: 3, y: 2 });
  assert.equal(store.getLastSeen("ana"), null);
  store.setLastSeen("ana", 1234);
  assert.equal(store.getLastSeen("ana"), 1234);
  store.close();

  assert.ok(existsSync(`${path}.v1.bak`), "copia de seguridad previa a la migración");
  const backup = new DatabaseSync(`${path}.v1.bak`, { readOnly: true });
  assert.equal(Number((backup.prepare("PRAGMA user_version").get() as { user_version: number }).user_version), 1);
  assert.equal(Number((backup.prepare("SELECT amount FROM inventory").get() as { amount: number }).amount), 4);
  backup.close();
});

test("consultas de aportes: totales por jugador, recientes y novedades desde una fecha", () => {
  const store = openStore(tempDb());
  const contribute = (name: string, resource: string, amount: number) => store.transaction(() => {
    store.addAmount(projectScope("taller"), resource, amount);
    store.event("contribute", name, `${name}-${resource}-${amount}`, { project: "taller", task: resource, resource, amount, from: "player" });
  });
  contribute("ana", "madera", 3);
  contribute("bea", "madera", 2);
  contribute("ana", "piedra", 1);
  assert.deepEqual(store.contributionTotals("taller"), { ana: { madera: 3, piedra: 1 }, bea: { madera: 2 } });
  assert.deepEqual(store.recentContributions("taller", 2).map((r) => `${r.name}:${r.resource}:${r.amount}`), ["ana:piedra:1", "bea:madera:2"]);
  assert.deepEqual(store.contributionsSince(0, "ana", 10).map((r) => `${r.name}:${r.resource}:${r.amount}`), ["bea:madera:2"]);
  assert.deepEqual(store.getInventory(projectScope("taller")), { madera: 5, piedra: 1 });
  store.close();
});

test("un saldo negativo es imposible y deshace toda la transacción", () => {
  const store = openStore(tempDb());
  store.transaction(() => store.addAmount(playerScope("ana"), "madera", 2));
  assert.throws(() => store.transaction(() => {
    store.addAmount(COMMUNITY, "madera", 5);              // se deshará
    store.addAmount(playerScope("ana"), "madera", -5);    // viola CHECK (amount >= 0)
  }));
  assert.equal(store.getAmount(playerScope("ana"), "madera"), 2);
  assert.equal(store.getAmount(COMMUNITY, "madera"), 0);
  store.close();
});

test("restar de un inventario sin fila no crea saldo negativo ni deja rastro", () => {
  const store = openStore(tempDb());
  assert.throws(() => store.transaction(() => {
    store.addAmount(COMMUNITY, "fibra", 1);
    store.addAmount(playerScope("bea"), "fibra", -1); // bea no tiene fibra
  }), /saldo-insuficiente/);
  assert.equal(store.getAmount(COMMUNITY, "fibra"), 0);
  store.close();
});

test("un requestId solo puede registrarse una vez por jugador", () => {
  const store = openStore(tempDb());
  store.event("collect", "ana", "req-1", { resource: "madera" });
  assert.equal(store.hasRequest("ana", "req-1"), true);
  assert.equal(store.hasRequest("bea", "req-1"), false);
  assert.throws(() => store.event("collect", "ana", "req-1", { resource: "madera" }));
  store.event("join", "ana", null, null);
  store.event("join", "ana", null, null); // sin requestId no hay restricción
  store.close();
});

test("la auditoría compara lo recolectado con lo que hay en inventarios", () => {
  const store = openStore(tempDb());
  store.transaction(() => {
    store.addAmount(playerScope("ana"), "madera", 1);
    store.event("collect", "ana", "r1", { resource: "madera", node: "arbol-1" });
    store.addAmount(playerScope("ana"), "madera", 1);
    store.event("collect", "ana", "r2", { resource: "madera", node: "arbol-1" });
    store.addAmount(playerScope("ana"), "madera", -1);
    store.addAmount(COMMUNITY, "madera", 1);
  });
  assert.deepEqual(store.audit(), { inInventories: { madera: 2 }, collected: { madera: 2 }, consumed: {}, produced: {}, balanced: true });
  store.close();
});
