import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MESSAGE, type MoveMessage } from "@juego/shared";
import { COMMUNITY, openStore, playerScope } from "../src/store.ts";
import { fixture, joinWorld, sleep, startServer, tempDb, waitFor, type TestPlayer } from "./helpers.ts";

// Mundo de prueba: 6×5, aparición en (0,0); árbol (1,0) con 5 de madera; roca (3,3) con 1 de piedra;
// inventario máximo 3; recolectar cada 100 ms.
const WORLD = fixture("resources-world.json");

const inv = (p: TestPlayer, resource: string) => p.me().inventory.get(resource) ?? 0;
const node = (p: TestPlayer, id: string) => p.room.state.nodes.get(id);
const community = (p: TestPlayer, resource: string) => p.room.state.community.get(resource) ?? 0;

async function collect(p: TestPlayer, requestId = randomUUID()) {
  p.room.send(MESSAGE.collect, { requestId });
  await sleep(130);
}

async function walk(p: TestPlayer, steps: MoveMessage[]) {
  for (const step of steps) {
    const { x, y } = p.me();
    p.room.send(MESSAGE.move, step);
    await waitFor(() => p.me().x === x + step.dx && p.me().y === y + step.dy, 2000);
    await sleep(110);
  }
}
const DOWN = { dx: 0, dy: 1 };
const RIGHT = { dx: 1, dy: 0 };
const TO_ROCK = [DOWN, DOWN, DOWN, RIGHT, RIGHT]; // (0,0) → (2,3), junto a la roca

test("TP-04: recolectar suma al inventario, resta al nodo y los demás lo ven", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    assert.equal(node(ana, "arbol-1"), 5);
    await collect(ana);
    await waitFor(() => inv(ana, "madera") === 1 && node(bea, "arbol-1") === 4);
    const anaSeenByBea = [...bea.room.state.players.values()].find((p) => p.name === "ana")!;
    assert.equal(anaSeenByBea.inventory.get("madera"), 1);
    await ana.room.leave();
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});

test("recolectar: rechazos por ritmo, inventario lleno, nodo agotado y distancia", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    ana.room.send(MESSAGE.collect, { requestId: randomUUID() });
    ana.room.send(MESSAGE.collect, { requestId: randomUUID() });
    await waitFor(() => ana.rejections.includes("recoleccion-demasiado-rapida"));
    await sleep(130);
    await collect(ana);
    await collect(ana);
    await waitFor(() => inv(ana, "madera") === 3);
    await collect(ana);
    await waitFor(() => ana.rejections.includes("inventario-lleno"));
    assert.equal(node(ana, "arbol-1"), 2);

    await walk(ana, [DOWN, DOWN]);
    await collect(ana);
    await waitFor(() => ana.rejections.includes("nodo-lejos"));

    const bea = await joinWorld(server.url, "bea");
    await walk(bea, TO_ROCK);
    await collect(bea);
    await waitFor(() => inv(bea, "piedra") === 1);
    await collect(bea);
    await waitFor(() => bea.rejections.includes("nodo-agotado"));
    assert.equal(node(bea, "roca-1"), 0);
    await ana.room.leave();
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-05: dos jugadores a por la última unidad: solo uno la obtiene", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    await Promise.all([walk(ana, TO_ROCK), walk(bea, [DOWN, DOWN, RIGHT, RIGHT, RIGHT, RIGHT])]); // ana (2,3), bea (4,2)
    ana.room.send(MESSAGE.collect, { requestId: randomUUID() });
    bea.room.send(MESSAGE.collect, { requestId: randomUUID() });
    await waitFor(() => inv(ana, "piedra") + inv(bea, "piedra") === 1 && ana.rejections.length + bea.rejections.length === 1);
    assert.equal(node(ana, "roca-1"), 0);
    assert.deepEqual([...ana.rejections, ...bea.rejections], ["nodo-agotado"]);
    await ana.room.leave();
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-05: transferencias simultáneas que superan el saldo: solo pasan las válidas", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    for (let i = 0; i < 3; i++) await collect(ana);
    await waitFor(() => inv(ana, "madera") === 3);
    for (let i = 0; i < 3; i++) ana.room.send(MESSAGE.transfer, { requestId: randomUUID(), resource: "madera", amount: 2, to: "community" });
    // Los rechazos son mensajes inmediatos; los cambios de estado llegan en el siguiente parche.
    await waitFor(() => ana.rejections.length === 2 && community(ana, "madera") === 2);
    assert.deepEqual(ana.rejections, ["saldo-insuficiente", "saldo-insuficiente"]);
    assert.equal(inv(ana, "madera"), 1);
    assert.equal(community(ana, "madera"), 2);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-12: un requestId repetido cuenta una sola vez y los datos inválidos no cambian nada", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    const id = randomUUID();
    ana.room.send(MESSAGE.collect, { requestId: id });
    await sleep(150);
    ana.room.send(MESSAGE.collect, { requestId: id });
    await sleep(150);
    assert.equal(inv(ana, "madera"), 1);
    assert.equal(node(ana, "arbol-1"), 4);

    const t = randomUUID();
    ana.room.send(MESSAGE.transfer, { requestId: t, resource: "madera", amount: 1, to: "community" });
    ana.room.send(MESSAGE.transfer, { requestId: t, resource: "madera", amount: 1, to: "community" });
    await waitFor(() => community(ana, "madera") === 1);
    await sleep(150);
    assert.equal(community(ana, "madera"), 1);

    for (const bad of [
      { requestId: randomUUID(), resource: "madera", amount: -1, to: "community" },
      { requestId: randomUUID(), resource: "oro", amount: 1, to: "community" },
      { requestId: randomUUID(), resource: "madera", amount: 1, to: "bea" },
      { resource: "madera", amount: 1, to: "community" },
    ]) ana.room.send(MESSAGE.transfer, bad);
    ana.room.send(MESSAGE.collect, { requestId: "con espacios no vale" });
    await waitFor(() => ana.rejections.length === 5);
    assert.deepEqual([...ana.rejections].sort(), ["destino-no-permitido", "solicitud-invalida", "solicitud-invalida", "solicitud-invalida", "solicitud-invalida"]);
    assert.equal(inv(ana, "madera"), 0);
    assert.equal(community(ana, "madera"), 1);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-09: tras una caída brusca no se pierde ni se duplica nada confirmado; la auditoría cuadra", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  const ana = await joinWorld(server.url, "ana");
  for (let i = 0; i < 3; i++) await collect(ana);
  await waitFor(() => inv(ana, "madera") === 3);
  ana.room.send(MESSAGE.transfer, { requestId: randomUUID(), resource: "madera", amount: 2, to: "community" });
  await waitFor(() => community(ana, "madera") === 2);
  await walk(ana, [DOWN]);
  await sleep(5500); // la posición se guarda cada 5 s (Q149)
  await server.kill(); // SIGKILL: sin cierre ordenado

  const store = openStore(dbPath);
  assert.deepEqual(store.getInventory(playerScope("ana")), { madera: 1 });
  assert.deepEqual(store.getInventory(COMMUNITY), { madera: 2 });
  assert.deepEqual(store.audit(), { inInventories: { madera: 3 }, collected: { madera: 3 }, consumed: {}, produced: {}, balanced: true });
  store.close();

  server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const again = await joinWorld(server.url, "ana");
    assert.equal(inv(again, "madera"), 1);
    assert.equal(community(again, "madera"), 2);
    assert.equal(node(again, "arbol-1"), 2);
    assert.deepEqual({ x: again.me().x, y: again.me().y }, { x: 0, y: 1 });
    await again.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-14: el reloj del mundo regenera en vivo, sin jugadores y con el servidor parado", async () => {
  const dbPath = tempDb();
  const env = { WORLD_CONFIG: fixture("regen-world.json"), DB_PATH: dbPath }; // 1 unidad por segundo
  let server = await startServer(env);
  const ana = await joinWorld(server.url, "ana");
  await collect(ana);
  await collect(ana);
  await waitFor(() => node(ana, "arbol-1") === 3);
  await waitFor(() => node(ana, "arbol-1") === 4, 2500);         // en vivo
  await ana.room.leave();
  await sleep(1300);
  const bea = await joinWorld(server.url, "bea");
  assert.equal(node(bea, "arbol-1"), 5, "sin jugadores conectados");
  await collect(bea);
  await collect(bea);
  await waitFor(() => node(bea, "arbol-1") === 3);
  await server.kill();
  await sleep(2300);                                              // servidor parado
  server = await startServer(env);
  try {
    const again = await joinWorld(server.url, "ana");
    assert.equal(node(again, "arbol-1"), 5, "puesta al día tras el arranque, sin superar el máximo");
    await again.room.leave();
  } finally {
    await server.kill();
  }
});
