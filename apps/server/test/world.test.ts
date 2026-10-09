import { test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGE } from "@juego/shared";
import { fixture, joinWorld, sleep, startServer, startServerExpectingFailure, waitFor, type TestPlayer } from "./helpers.ts";

test("el servidor no arranca con una configuración inválida y explica por qué", async () => {
  const { code, output } = await startServerExpectingFailure({ WORLD_CONFIG: fixture("invalid-world.json") });
  assert.equal(code, 1);
  assert.match(output, /Configuración del mundo inválida/);
  assert.match(output, /recurso desconocido "oro"/);
  assert.match(output, /aparición está bloqueada/);
});

test("TP-01: el mundo del MVP se sirve y el jugador aparece en el punto de aparición", async () => {
  const server = await startServer();
  try {
    const config = await (await fetch(`${server.url}/config`)).json();
    assert.equal(config.map.width, 40);
    assert.equal(config.map.height, 30);
    const page = await fetch(`${server.url}/`);
    assert.equal(page.status === 200 || page.status === 404, true);

    const ana = await joinWorld(server.url, "ana");
    assert.deepEqual({ x: ana.me().x, y: ana.me().y }, config.spawn);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("movimiento autoritativo: los pasos válidos se aplican y los inválidos se rechazan sin cambiar el estado", async () => {
  const server = await startServer({ WORLD_CONFIG: fixture("small-world.json") });
  try {
    const ana = await joinWorld(server.url, "ana"); // aparece en (0,0); árbol en (1,0)

    ana.room.send(MESSAGE.move, { dx: -1, dy: 0 });   // borde
    ana.room.send(MESSAGE.move, { dx: 1, dy: 0 });    // árbol
    ana.room.send(MESSAGE.move, { dx: 1, dy: 1 });    // diagonal
    ana.room.send(MESSAGE.move, { dx: 0, dy: 3 });    // salto
    ana.room.send(MESSAGE.move, { dx: "0", dy: 1 });  // tipo inválido
    ana.room.send("teletransporte", { x: 5, y: 4 });  // mensaje desconocido
    await waitFor(() => ana.rejections.length >= 6);
    assert.deepEqual([...ana.rejections].sort(), [
      "casilla-bloqueada", "fuera-del-mapa", "mensaje-desconocido",
      "movimiento-invalido", "movimiento-invalido", "movimiento-invalido",
    ]);
    assert.deepEqual({ x: ana.me().x, y: ana.me().y }, { x: 0, y: 0 });

    ana.room.send(MESSAGE.move, { dx: 0, dy: 1 });
    ana.room.send(MESSAGE.move, { dx: 0, dy: 1 });    // antes de que pase el intervalo mínimo
    await waitFor(() => ana.me().y === 1 && ana.rejections.includes("movimiento-demasiado-rapido"));
    await sleep(150);
    assert.deepEqual({ x: ana.me().x, y: ana.me().y }, { x: 0, y: 1 });

    ana.room.send(MESSAGE.move, { dx: 1, dy: 0 });
    await waitFor(() => ana.me().x === 1);
    assert.deepEqual({ x: ana.me().x, y: ana.me().y }, { x: 1, y: 1 });
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("entrada: nombres inválidos o repetidos se rechazan; la sala es única y admite hasta 4", async () => {
  const server = await startServer({ WORLD_CONFIG: fixture("small-world.json") });
  try {
    await assert.rejects(joinWorld(server.url, ""));
    await assert.rejects(joinWorld(server.url, "nombre con espacios"));

    const players: TestPlayer[] = [];
    for (const name of ["p1", "p2", "p3", "p4"]) players.push(await joinWorld(server.url, name));
    assert.equal(new Set(players.map((p) => p.room.roomId)).size, 1, "todos en la misma sala");
    await assert.rejects(joinWorld(server.url, "p5"), "un quinto jugador no abre otra copia del mundo");

    await players[3]!.room.leave();
    await assert.rejects(joinWorld(server.url, "p1"), "nombre en uso");

    // El segundo cliente ve al primero (comprobación mínima; la sincronización completa es M2).
    players[0]!.room.send(MESSAGE.move, { dx: 0, dy: 1 });
    const id = players[0]!.room.sessionId;
    await waitFor(() => players[1]!.room.state.players.get(id)?.y === 1);

    for (const p of players.slice(0, 3)) await p.room.leave();
  } finally {
    await server.kill();
  }
});
