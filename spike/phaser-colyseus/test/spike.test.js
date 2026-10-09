import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, joinWorld, tempDb, waitFor, sleep, walkTo, collect, NODE_ID } from "./helpers.js";

// Árbol en (10,7); la casilla (9,7) es adyacente. Aparición en (2,2).
const NEXT_TO_NODE = [9, 7];

test("autoritativo: el servidor rechaza acciones inválidas y el estado no cambia", async () => {
  const server = await startServer({ dbPath: tempDb() });
  try {
    const ana = await joinWorld(server.url, "ana");
    const observer = await joinWorld(server.url, "obs");

    ana.room.send("collect", { nodeId: NODE_ID });          // demasiado lejos
    ana.room.send("move", { dx: 5, dy: 0 });                // teletransporte
    ana.room.send("move", { dx: "1", dy: 0 });              // tipo inválido
    ana.room.send("collect", { nodeId: "no-existe" });      // nodo inexistente
    ana.room.send("hack", { units: 99 });                   // mensaje desconocido
    await waitFor(() => ana.rejections.length >= 5);

    assert.deepEqual(ana.rejections.sort(), ["mensaje-desconocido", "movimiento-invalido", "movimiento-invalido", "nodo-lejos", "recoleccion-invalida"].sort());
    assert.equal(ana.me().x, 2);
    assert.equal(ana.me().madera, 0);
    assert.equal(observer.node().units, 3);

    // Modificar la copia local no altera al servidor ni a otros clientes.
    ana.node().units = 99;
    await sleep(200);
    assert.equal(observer.node().units, 3);

    await ana.room.leave();
    await observer.room.leave();
  } finally {
    await server.kill();
  }
});

for (const latency of [0, 20]) {
  test(`convergencia: 4 clientes ven la recolección en ≤ 500 ms (latencia simulada ${latency} ms ida y vuelta)`, async () => {
    const env = latency ? { COLYSEUS_LATENCY: String(latency) } : {};
    const server = await startServer({ dbPath: tempDb(), env });
    try {
      const players = [];
      for (const name of ["p1", "p2", "p3", "p4"]) players.push(await joinWorld(server.url, name));

      // Un quinto cliente es rechazado (maxClients = 4) en lugar de abrir una segunda copia del mundo.
      await assert.rejects(joinWorld(server.url, "p5"));

      await walkTo(players[0], ...NEXT_TO_NODE);
      const seen = players.map(() => null);
      const t0 = performance.now();
      players.forEach((p, i) => {
        p.callbacks.listen(p.node(), "units", (units) => { if (units === 2 && seen[i] === null) seen[i] = performance.now() - t0; });
      });
      players[0].room.send("collect", { nodeId: NODE_ID });
      await waitFor(() => seen.every((v) => v !== null), 3000);

      const max = Math.max(...seen);
      console.log(`  latencias (ms) con ${latency} ms simulados: ${seen.map((v) => v.toFixed(1)).join(", ")} — máx ${max.toFixed(1)}`);
      assert.ok(max <= 500, `convergencia ${max} ms > 500 ms`);
      for (const p of players) assert.equal(p.node().units, 2);

      for (const p of players) await p.room.leave();
    } finally {
      await server.kill();
    }
  });
}

test("persistencia: tras una caída del servidor no se pierde nada confirmado", async () => {
  const dbPath = tempDb();
  let server = await startServer({ dbPath });
  const ana = await joinWorld(server.url, "ana");
  await walkTo(ana, ...NEXT_TO_NODE);
  await collect(ana);
  await collect(ana);
  await server.kill(); // sin cierre ordenado

  server = await startServer({ dbPath });
  try {
    const again = await joinWorld(server.url, "ana");
    assert.equal(again.me().madera, 2, "inventario recuperado");
    assert.equal(again.node().units, 1, "nodo recuperado");
    await again.room.leave();
  } finally {
    await server.kill();
  }
});

test("reloj del mundo: el nodo se regenera también sin jugadores conectados", async () => {
  const dbPath = tempDb();
  const env = { REGEN_MS: "400" };
  const server = await startServer({ dbPath, env });
  try {
    const ana = await joinWorld(server.url, "ana");
    await walkTo(ana, ...NEXT_TO_NODE);
    for (let i = 0; i < 3; i++) await collect(ana);
    assert.equal(ana.node().units, 0);

    // Con jugador conectado: regenera en vivo.
    await waitFor(() => ana.node().units === 1, 2000);
    await ana.room.leave();

    // Sin nadie conectado el reloj sigue corriendo.
    await sleep(1500);
    const bea = await joinWorld(server.url, "bea");
    assert.equal(bea.node().units, 3, "regenerado hasta el máximo sin jugadores");
    await bea.room.leave();
  } finally {
    await server.kill();
  }

  // Y también con el servidor parado.
  const s2 = await startServer({ dbPath, env });
  try {
    const ana = await joinWorld(s2.url, "ana");
    await collect(ana);
    await s2.kill();
    await sleep(900);
    const s3 = await startServer({ dbPath, env });
    try {
      const again = await joinWorld(s3.url, "ana");
      assert.equal(again.node().units, 3, "regenerado con el servidor parado");
      await again.room.leave();
    } finally {
      await s3.kill();
    }
  } finally {
    // s2 ya detenido
  }
});
