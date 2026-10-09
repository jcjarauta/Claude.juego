import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMUNITY, openStore, playerScope, SCHEMA_VERSION } from "../src/store.ts";

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
  assert.deepEqual(store.audit(), { inInventories: { madera: 2 }, collected: { madera: 2 } });
  store.close();
});
