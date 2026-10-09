import { test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGE, type MoveMessage } from "@juego/shared";
import {
  fixture, joinWorld, reconnectWorld, sleep, snapshot, startServer, waitFor, type TestPlayer,
} from "./helpers.ts";

const STEPS: MoveMessage[] = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

/** Varios clientes caminan a la vez; al parar, todos deben ver exactamente lo mismo. */
async function walkTogether(players: TestPlayer[], moves: number) {
  await Promise.all(players.map(async (p, i) => {
    for (let n = 0; n < moves; n++) {
      p.room.send(MESSAGE.move, STEPS[(n * 7 + i * 3 + n * n) % 4]!);
      await sleep(115);
    }
  }));
}

for (const count of [2, 4]) {
  test(`TP-02: ${count} clientes moviéndose a la vez ven el mismo estado al detenerse`, async () => {
    const server = await startServer();
    try {
      const players: TestPlayer[] = [];
      for (let i = 0; i < count; i++) players.push(await joinWorld(server.url, `j${i}`));
      await walkTogether(players, 25);
      const reference = players[0]!;
      await waitFor(() => players.every((p) => snapshot(p) === snapshot(reference)), 2000);
      const view = snapshot(reference);
      assert.equal(view.split(" ").length, count);
      // La posición que cada uno ve de sí mismo es la que ven los demás de él.
      for (const p of players) assert.match(view, new RegExp(`${p.me().name}@${p.me().x},${p.me().y}(\\s|$)`));
      console.log(`  vista común con ${count} clientes: ${view}`);
      for (const p of players) await p.room.leave();
    } finally {
      await server.kill();
    }
  });
}

for (const latency of [0, 20]) {
  test(`convergencia: un movimiento llega a los 4 clientes en ≤ 500 ms (latencia simulada ${latency} ms)`, async () => {
    const server = await startServer(latency ? { COLYSEUS_LATENCY: String(latency) } : {});
    try {
      const players: TestPlayer[] = [];
      for (const name of ["c1", "c2", "c3", "c4"]) players.push(await joinWorld(server.url, name));
      const mover = players[0]!;
      const id = mover.room.sessionId;
      const samples: number[] = [];
      for (let n = 0; n < 10; n++) {
        const target = mover.me().x + (n % 2 === 0 ? 1 : -1);
        const t0 = performance.now();
        mover.room.send(MESSAGE.move, { dx: n % 2 === 0 ? 1 : -1, dy: 0 });
        await waitFor(() => players.every((p) => p.room.state.players.get(id)?.x === target), 2000);
        samples.push(performance.now() - t0);
        await sleep(120);
      }
      const max = Math.max(...samples);
      console.log(`  convergencia (${latency} ms simulados): máx ${max.toFixed(1)} ms, media ${(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1)} ms`);
      assert.ok(max <= 500, `convergencia ${max} ms > 500 ms`);
      for (const p of players) await p.room.leave();
    } finally {
      await server.kill();
    }
  });
}

test("presencia: los demás ven llegar y marcharse a un jugador", async () => {
  const server = await startServer({ WORLD_CONFIG: fixture("small-world.json") });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    await waitFor(() => snapshot(ana) === "ana@0,0 bea@0,0");
    await bea.room.leave(); // salida voluntaria: desaparece sin plazo de reconexión
    await waitFor(() => snapshot(ana) === "ana@0,0", 1000);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-09 (parcial): tras un corte, el jugador vuelve en ≤ 5 s a su posición; los demás lo ven desconectado mientras tanto", async () => {
  const server = await startServer({ WORLD_CONFIG: fixture("small-world.json") }); // plazo: 2 s
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    ana.room.send(MESSAGE.move, { dx: 0, dy: 1 });
    await waitFor(() => ana.me().y === 1);

    const token = ana.room.reconnectionToken;
    await ana.room.leave(false); // corte no consentido
    await waitFor(() => snapshot(bea) === "ana@0,1(desc) bea@0,0", 2000);

    const t0 = performance.now();
    const back = await reconnectWorld(server.url, token);
    await waitFor(() => back.me().connected && snapshot(bea) === "ana@0,1 bea@0,0", 5000);
    const elapsed = performance.now() - t0;
    console.log(`  reconexión en ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed <= 5000);
    assert.deepEqual({ x: back.me().x, y: back.me().y }, { x: 0, y: 1 });

    back.room.send(MESSAGE.move, { dx: 0, dy: 1 });
    await waitFor(() => back.me().y === 2, 1000);
    await back.room.leave();
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});

test("si el plazo de reconexión vence, el jugador desaparece", async () => {
  const server = await startServer({ WORLD_CONFIG: fixture("small-world.json") }); // plazo: 2 s
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    await ana.room.leave(false);
    await waitFor(() => snapshot(bea) === "ana@0,0(desc) bea@0,0", 2000);
    await sleep(1500);
    assert.equal(snapshot(bea), "ana@0,0(desc) bea@0,0", "aún dentro del plazo");
    await waitFor(() => snapshot(bea) === "bea@0,0", 3000);
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});

test("entrar con el mismo nombre durante el plazo (recarga de página) recupera el personaje", async () => {
  const server = await startServer({ WORLD_CONFIG: fixture("small-world.json") });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    ana.room.send(MESSAGE.move, { dx: 0, dy: 1 });
    await waitFor(() => ana.me().y === 1);
    await ana.room.leave(false);
    await waitFor(() => snapshot(bea).includes("(desc)"), 2000);

    const again = await joinWorld(server.url, "ana");
    assert.deepEqual({ x: again.me().x, y: again.me().y, connected: again.me().connected }, { x: 0, y: 1, connected: true });
    await waitFor(() => snapshot(bea) === "ana@0,1 bea@0,0", 1000);
    // Un nombre conectado sigue sin poder duplicarse.
    await assert.rejects(joinWorld(server.url, "ana"));
    await again.room.leave();
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});
