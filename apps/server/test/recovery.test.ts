import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore, playerScope } from "../src/store.ts";
import { joinWorld, startServer, tempDb } from "./helpers.ts";

// Umbral de recuperación (docs/pruebas.md §3): servidor operativo de nuevo en ≤ 30 s tras un
// reinicio. Se mide con una base grande (50 000 eventos) y el mundo real (content/world.json).
const EVENTS = 50_000;

test("recuperación: con 50 000 eventos el servidor arranca y admite jugadores en ≤ 30 s", async () => {
  const dbPath = tempDb();
  const store = openStore(dbPath);
  store.transaction(() => {
    for (let i = 0; i < EVENTS; i++) store.event("collect", `bot${i % 4}`, `r${i}`, { resource: "madera", node: "arbol-1" });
    for (let i = 0; i < 4; i++) store.addAmount(playerScope(`bot${i}`), "madera", EVENTS / 4);
  });
  assert.equal(store.audit().balanced, true);
  store.close();

  const t0 = performance.now();
  const server = await startServer({ DB_PATH: dbPath });
  try {
    const ana = await joinWorld(server.url, "ana");
    const elapsed = performance.now() - t0;
    console.log(`  arranque y primera entrada con ${EVENTS} eventos: ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed <= 30_000);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});
