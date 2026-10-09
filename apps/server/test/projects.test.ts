import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MESSAGE, type ContributionSource, type MoveMessage, type NewsMessage } from "@juego/shared";
import { openStore } from "../src/store.ts";
import { fixture, joinWorld, sleep, startServer, tempDb, waitFor, type TestPlayer } from "./helpers.ts";

// Mundo de prueba: aparición en (0,0) junto al árbol (1,0) de 5 madera; roca (3,3) de 1 piedra;
// inventario máximo 3. Proyecto «construir-taller»: 4 madera y 1 piedra.
const WORLD = fixture("resources-world.json");
const PROJECT = "construir-taller";

const inv = (p: TestPlayer, resource: string) => p.me().inventory.get(resource) ?? 0;
const project = (p: TestPlayer) => p.room.state.projects.get(PROJECT)!;
const progress = (p: TestPlayer, resource: string) => project(p).progress.get(resource) ?? 0;
const contributedBy = (p: TestPlayer, name: string, resource: string) => project(p).contributors.get(name)?.totals.get(resource) ?? 0;

async function collect(p: TestPlayer, times = 1) {
  for (let i = 0; i < times; i++) {
    const before = inv(p, "madera") + inv(p, "piedra");
    p.room.send(MESSAGE.collect, { requestId: randomUUID() });
    await waitFor(() => inv(p, "madera") + inv(p, "piedra") === before + 1, 2000);
    await sleep(110);
  }
}

function contribute(p: TestPlayer, taskId: string, amount: number, from: ContributionSource = "player", requestId = randomUUID()) {
  p.room.send(MESSAGE.contribute, { requestId, projectId: PROJECT, taskId, from, amount });
}

async function walk(p: TestPlayer, steps: MoveMessage[]) {
  for (const step of steps) {
    const { x, y } = p.me();
    p.room.send(MESSAGE.move, step);
    await waitFor(() => p.me().x === x + step.dx && p.me().y === y + step.dy, 2000);
    await sleep(110);
  }
}
const TO_ROCK: MoveMessage[] = [{ dx: 0, dy: 1 }, { dx: 0, dy: 1 }, { dx: 0, dy: 1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 0 }];

function requestNews(p: TestPlayer): Promise<NewsMessage> {
  return new Promise((resolve) => {
    p.room.onMessage(MESSAGE.news, (news: NewsMessage) => resolve(news));
    p.room.send(MESSAGE.news, {});
  });
}

test("TP-06: aportes desde el inventario y la comunidad; todos ven progreso, autores y actividad; el proyecto queda listo", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    assert.equal(ana.room.state.communityName, "Comunidad de la aldea");
    assert.equal(project(ana).status, "en-curso");

    await collect(ana, 3);
    contribute(ana, "madera", 2);
    await waitFor(() => progress(bea, "madera") === 2 && contributedBy(bea, "ana", "madera") === 2);
    assert.equal(inv(ana, "madera"), 1);
    assert.equal(project(bea).recent.length, 1);
    assert.equal(project(bea).recent[0]!.name, "ana");

    // Depósito en la comunidad y aporte desde la comunidad por otro miembro (Q152).
    ana.room.send(MESSAGE.transfer, { requestId: randomUUID(), resource: "madera", amount: 1, to: "community" });
    await waitFor(() => (bea.room.state.community.get("madera") ?? 0) === 1);
    contribute(bea, "madera", 1, "community");
    await waitFor(() => progress(ana, "madera") === 3 && contributedBy(ana, "bea", "madera") === 1);
    assert.equal(ana.room.state.community.get("madera"), 0);

    // Recorte (Q153): faltan 1 y se aportan 2; el sobrante se queda en el inventario.
    await collect(ana, 2);
    contribute(ana, "madera", 2);
    await waitFor(() => progress(bea, "madera") === 4);
    await waitFor(() => inv(ana, "madera") === 1);
    contribute(ana, "madera", 1);
    await waitFor(() => ana.rejections.includes("tarea-completa"));

    await walk(bea, TO_ROCK);
    await collect(bea, 1);
    contribute(bea, "piedra", 1);
    await waitFor(() => project(ana).status === "listo" && project(bea).status === "listo");
    assert.deepEqual(project(ana).recent.map((c) => `${c.name}:${c.resource}:${c.amount}`), [
      "ana:madera:2", "bea:madera:1", "ana:madera:1", "bea:piedra:1",
    ]);
    await ana.room.leave();
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-05: aportes simultáneos a la última unidad nunca superan lo requerido", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    await collect(ana, 3);
    contribute(ana, "madera", 3);
    await waitFor(() => progress(ana, "madera") === 3);
    await collect(ana, 1);
    await collect(bea, 1);
    contribute(ana, "madera", 1);
    contribute(bea, "madera", 1);
    await waitFor(() => ana.rejections.length + bea.rejections.length === 1 && inv(ana, "madera") + inv(bea, "madera") === 1);
    assert.equal(progress(ana, "madera"), 4);
    assert.deepEqual([...ana.rejections, ...bea.rejections], ["tarea-completa"]);
    await ana.room.leave();
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-12: aporte repetido cuenta una vez y los aportes inválidos no cambian nada", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    await collect(ana, 2);
    const id = randomUUID();
    contribute(ana, "madera", 1, "player", id);
    contribute(ana, "madera", 1, "player", id);
    await waitFor(() => progress(ana, "madera") === 1);
    await sleep(200);
    assert.equal(progress(ana, "madera"), 1);

    contribute(ana, "oro", 1);
    ana.room.send(MESSAGE.contribute, { requestId: randomUUID(), projectId: "otro", taskId: "madera", from: "player", amount: 1 });
    contribute(ana, "madera", 1, "bea" as ContributionSource);
    contribute(ana, "madera", 0);
    contribute(ana, "madera", 5);
    ana.room.send(MESSAGE.contribute, { projectId: PROJECT, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => ana.rejections.length === 6);
    assert.deepEqual([...ana.rejections].sort(), [
      "origen-no-permitido", "saldo-insuficiente", "solicitud-invalida", "solicitud-invalida", "tarea-desconocida", "tarea-desconocida",
    ]);
    assert.equal(progress(ana, "madera"), 1);
    assert.equal(inv(ana, "madera"), 1);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-13: colaboración asíncrona — quien llega después ve el avance y recibe las novedades", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    await collect(ana, 2);
    contribute(ana, "madera", 2);
    await waitFor(() => progress(ana, "madera") === 2);
    const first = await requestNews(ana);
    assert.deepEqual(first, { since: null, items: [] }, "primera visita: sin novedades");
    await ana.room.leave();

    const bea = await joinWorld(server.url, "bea"); // nadie más conectado
    assert.equal(progress(bea, "madera"), 2);
    assert.equal(contributedBy(bea, "ana", "madera"), 2);
    await collect(bea, 1);
    contribute(bea, "madera", 1);
    await waitFor(() => progress(bea, "madera") === 3);
    await bea.room.leave();

    const back = await joinWorld(server.url, "ana");
    assert.equal(progress(back, "madera"), 3);
    const news = await requestNews(back);
    assert.ok(news.since !== null);
    assert.deepEqual(news.items.map((n) => `${n.name}:${n.taskId}:${n.amount}`), ["bea:madera:1"]);

    // Las novedades se envían una sola vez por sesión.
    let again = false;
    back.room.onMessage(MESSAGE.news, () => { again = true; });
    back.room.send(MESSAGE.news, {});
    await sleep(300);
    assert.equal(again, false);
    await back.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-09: tras una caída, el proyecto conserva progreso, autores y actividad; la auditoría cuadra en todos los ámbitos", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  const ana = await joinWorld(server.url, "ana");
  await collect(ana, 3);
  contribute(ana, "madera", 2);
  ana.room.send(MESSAGE.transfer, { requestId: randomUUID(), resource: "madera", amount: 1, to: "community" });
  await waitFor(() => progress(ana, "madera") === 2 && (ana.room.state.community.get("madera") ?? 0) === 1);
  await server.kill();

  const store = openStore(dbPath);
  assert.deepEqual(store.audit(), { inInventories: { madera: 3 }, collected: { madera: 3 }, consumed: {}, produced: {}, balanced: true });
  store.close();

  server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const bea = await joinWorld(server.url, "bea");
    assert.equal(progress(bea, "madera"), 2);
    assert.equal(contributedBy(bea, "ana", "madera"), 2);
    assert.deepEqual(project(bea).recent.map((c) => `${c.name}:${c.amount}`), ["ana:2"]);
    assert.equal(bea.room.state.community.get("madera"), 1);
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});
