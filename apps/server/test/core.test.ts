import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadWorld } from "../src/world.ts";
import { createProjectCore } from "../src/projects/core.ts";
import { COMMUNITY, openStore, playerScope, projectScope, type Store } from "../src/store.ts";
import { fixture, tempDb } from "./helpers.ts";

// TA-02 (Q067): un fallo a mitad de una operación no confirma nada. El núcleo de proyectos
// no depende de Colyseus, así que se prueba directamente con un almacén que falla.

const { config } = loadWorld(fixture("regen-world.json"));
const PROJECT = "construir-taller";

/** Almacén real cuya escritura número `failAt` lanza un error (como un disco lleno). */
function faultyStore(store: Store, failAt: number): Store {
  let writes = 0;
  return {
    ...store,
    addAmount(...args: Parameters<Store["addAmount"]>) {
      if (++writes === failAt) throw new Error("fallo inyectado");
      return store.addAmount(...args);
    },
  };
}

test("TA-02: si la escritura falla a mitad del aporte, no cambia ningún saldo ni queda evento", () => {
  const store = openStore(tempDb());
  store.transaction(() => {
    store.addAmount(playerScope("ana"), "madera", 3);
    for (let i = 0; i < 3; i++) store.event("collect", "ana", `c${i}`, { resource: "madera" });
  });
  const core = createProjectCore(faultyStore(store, 2), config); // falla al sumar al proyecto, tras restar al jugador
  const requestId = randomUUID();
  assert.throws(() => core.contribute("ana", { requestId, projectId: PROJECT, taskId: "madera", from: "player", amount: 2 }), /fallo inyectado/);

  assert.equal(store.getAmount(playerScope("ana"), "madera"), 3, "la resta al jugador se ha deshecho");
  assert.equal(store.getAmount(projectScope(PROJECT), "madera"), 0);
  assert.equal(store.contributedAmount(PROJECT, "madera"), 0, "sin evento de aporte");
  assert.equal(store.hasRequest("ana", requestId), false, "el requestId no queda consumido: el reintento funciona");

  const retry = createProjectCore(store, config).contribute("ana", { requestId, projectId: PROJECT, taskId: "madera", from: "player", amount: 2 });
  assert.equal(retry.kind, "done");
  assert.equal(store.getAmount(playerScope("ana"), "madera"), 1);
  assert.equal(store.audit().balanced, true);
  store.close();
});

test("TA-02: si la escritura falla al consumir materiales en la construcción, el proyecto conserva su inventario", () => {
  const store = openStore(tempDb());
  store.transaction(() => {
    store.addAmount(projectScope(PROJECT), "madera", 4);
    store.addAmount(projectScope(PROJECT), "piedra", 1);
  });
  const core = createProjectCore(faultyStore(store, 2), config);
  const project = core.projectById(PROJECT)!;
  assert.throws(() => store.transaction(() => {
    core.consumeForBuild(project);
    store.addStructure("taller", "ana", 1);
  }), /fallo inyectado/);
  assert.deepEqual(store.getInventory(projectScope(PROJECT)), { madera: 4, piedra: 1 });
  assert.deepEqual(store.getStructures(), [], "la estructura no aparece");
  assert.deepEqual(store.getInventory(COMMUNITY), {});
  store.close();
});
