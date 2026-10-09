import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MESSAGE, type MoveMessage } from "@juego/shared";
import { COMMUNITY, openStore, projectScope } from "../src/store.ts";
import { fixture, joinWorld, sleep, startServer, tempDb, waitFor, type TestPlayer } from "./helpers.ts";

// Mundo de prueba (regeneración 1/s): aparición (0,0); árbol (1,0) de 5 madera; roca (3,3) de 1 piedra;
// solar del taller 1x1 en (2,1). Proyecto: 4 madera y 1 piedra. Receta: 1 madera + 1 piedra → 1 herramienta.
const WORLD = fixture("regen-world.json");
const PROJECT = "construir-taller";

const DOWN = { dx: 0, dy: 1 };
const RIGHT = { dx: 1, dy: 0 };
const UP = { dx: 0, dy: -1 };
const LEFT = { dx: -1, dy: 0 };

const inv = (p: TestPlayer, id: string) => p.me().inventory.get(id) ?? 0;
const community = (p: TestPlayer, id: string) => p.room.state.community.get(id) ?? 0;
const project = (p: TestPlayer) => p.room.state.projects.get(PROJECT)!;
const taller = (p: TestPlayer) => p.room.state.structures.get("taller")!;
const mission = (p: TestPlayer) => p.room.state.missions.get("primera-herramienta")!;

async function walk(p: TestPlayer, steps: MoveMessage[]) {
  for (const step of steps) {
    const { x, y } = p.me();
    p.room.send(MESSAGE.move, step);
    await waitFor(() => p.me().x === x + step.dx && p.me().y === y + step.dy, 2000);
    await sleep(110);
  }
}

/** Recolecta una unidad del nodo adyacente (esperando a que regenere si hace falta). */
async function collect(p: TestPlayer, resource: string) {
  const before = inv(p, resource);
  let lastSent = 0;
  await waitFor(() => {
    if (inv(p, resource) > before) return true;
    if (Date.now() - lastSent > 150) {
      p.room.send(MESSAGE.collect, { requestId: randomUUID() });
      lastSent = Date.now();
    }
    return false;
  }, 6000);
  await sleep(110);
}

function contribute(p: TestPlayer, taskId: string, amount: number) {
  p.room.send(MESSAGE.contribute, { requestId: randomUUID(), projectId: PROJECT, taskId, from: "player", amount });
}

function deposit(p: TestPlayer, resource: string, amount: number) {
  p.room.send(MESSAGE.transfer, { requestId: randomUUID(), resource, amount, to: "community" });
}

const build = (p: TestPlayer, requestId = randomUUID(), structureId = "taller") => p.room.send(MESSAGE.build, { requestId, structureId });
const craft = (p: TestPlayer, requestId = randomUUID(), recipeId = "herramienta") => p.room.send(MESSAGE.craft, { requestId, recipeId });

/** Deja el proyecto «listo» con ana: 4 de madera y 1 de piedra. Termina en (2,2), junto al taller y la roca. */
async function completeProject(ana: TestPlayer) {
  for (let i = 0; i < 3; i++) await collect(ana, "madera");
  contribute(ana, "madera", 3);
  await waitFor(() => (project(ana).progress.get("madera") ?? 0) === 3);
  await collect(ana, "madera");
  contribute(ana, "madera", 1);
  await walk(ana, [DOWN, RIGHT, DOWN, RIGHT]); // (0,0) → (2,2)
  await collect(ana, "piedra");
  contribute(ana, "piedra", 1);
  await waitFor(() => project(ana).status === "listo");
}

test("TP-07: construir exige proyecto listo, estar junto al solar y el solar libre; consume exactamente lo aportado", async () => {
  const dbPath = tempDb();
  const server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    await walk(ana, [DOWN, RIGHT]); // (1,1), junto al solar
    build(ana);
    await waitFor(() => ana.rejections.includes("proyecto-sin-terminar"));
    await walk(ana, [LEFT, UP]); // de vuelta a (0,0) sin pasar por el árbol (1,0)
    await completeProject(ana);

    build(bea); // bea sigue en (0,0)
    await waitFor(() => bea.rejections.includes("lejos-del-solar"));
    await walk(bea, [DOWN, RIGHT, RIGHT]); // (2,1): dentro del solar
    build(ana);
    await waitFor(() => ana.rejections.includes("solar-ocupado"));
    await walk(bea, [LEFT]); // (1,1), fuera y junto al solar

    // Dos órdenes a la vez: solo una construye.
    build(ana);
    build(bea);
    await waitFor(() => taller(ana).built && [...ana.rejections, ...bea.rejections].includes("ya-construido"));
    assert.ok(["ana", "bea"].includes(taller(bea).builtBy));
    assert.ok([...ana.rejections, ...bea.rejections].includes("ya-construido"));
    assert.equal(project(bea).status, "construido");
    assert.equal(project(bea).progress.get("madera"), 4, "el progreso se conserva tras construir");

    // El taller bloquea el paso y ya no admite aportes.
    bea.room.send(MESSAGE.move, RIGHT);
    await waitFor(() => bea.rejections.includes("casilla-bloqueada"));
    await collect(bea, "madera");
    contribute(bea, "madera", 1);
    await waitFor(() => bea.rejections.includes("tarea-completa"));

    const store = openStore(dbPath);
    assert.deepEqual(store.getInventory(projectScope(PROJECT)), { madera: 0, piedra: 0 });
    assert.equal(store.audit().balanced, true);
    store.close();
    await ana.room.leave();
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-08: fabricar exige taller, cercanía y materiales; la herramienta completa la misión y todos lo ven", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    craft(ana);
    await waitFor(() => ana.rejections.includes("taller-sin-construir"));
    await completeProject(ana); // ana en (2,2)
    build(ana);
    await waitFor(() => taller(ana).built);

    craft(ana);
    await waitFor(() => ana.rejections.includes("faltan-materiales"));
    await collect(ana, "piedra"); // la roca se regenera
    deposit(ana, "piedra", 1);
    await walk(ana, [LEFT, UP]); // (1,1), junto al árbol y al taller
    await collect(ana, "madera");
    deposit(ana, "madera", 1);
    await waitFor(() => community(bea, "madera") === 1 && community(bea, "piedra") === 1);

    craft(bea); // bea está en (0,0): lejos
    await waitFor(() => bea.rejections.includes("lejos-del-taller"));
    assert.equal(mission(bea).status, "pendiente");

    craft(ana);
    await waitFor(() => community(bea, "herramienta") === 1 && mission(bea).status === "completada");
    assert.equal(community(bea, "madera"), 0);
    assert.equal(community(bea, "piedra"), 0);
    assert.equal(mission(bea).completedBy, "ana");
    assert.ok(mission(bea).completedAt > 0);
    await ana.room.leave();
    await bea.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-12: build y craft repetidos o inválidos no tienen efecto", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    build(ana, randomUUID(), "castillo");
    craft(ana, randomUUID(), "espada");
    ana.room.send(MESSAGE.build, { structureId: "taller" });
    ana.room.send(MESSAGE.craft, { requestId: "no válido", recipeId: "herramienta" });
    await waitFor(() => ana.rejections.length === 4);
    assert.deepEqual([...ana.rejections].sort(), ["estructura-desconocida", "receta-desconocida", "solicitud-invalida", "solicitud-invalida"]);

    await completeProject(ana);
    const id = randomUUID();
    build(ana, id);
    await waitFor(() => taller(ana).built);
    const before = ana.rejections.length;
    build(ana, id); // mismo requestId: sin efecto y sin rechazo
    await sleep(300);
    assert.equal(ana.rejections.length, before);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("Ciclo completo (gate M5) y TP-09: dos jugadores de cero a misión completada; todo persiste tras una caída", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  const ana = await joinWorld(server.url, "ana");
  const bea = await joinWorld(server.url, "bea");

  // Recolectar y aportar entre los dos (bea aporta desde la comunidad).
  for (let i = 0; i < 3; i++) await collect(ana, "madera");
  contribute(ana, "madera", 3);
  await collect(bea, "madera");
  deposit(bea, "madera", 1);
  await waitFor(() => community(ana, "madera") === 1);
  bea.room.send(MESSAGE.contribute, { requestId: randomUUID(), projectId: PROJECT, taskId: "madera", from: "community", amount: 1 });
  await waitFor(() => (project(ana).progress.get("madera") ?? 0) === 4);
  await walk(bea, [DOWN, RIGHT, DOWN, RIGHT]); // bea a (2,2)
  await collect(bea, "piedra");
  contribute(bea, "piedra", 1);
  await waitFor(() => project(ana).status === "listo");

  // Construir, reunir materiales, fabricar y completar la misión.
  build(bea);
  await waitFor(() => taller(ana).built);
  await collect(bea, "piedra");
  deposit(bea, "piedra", 1);
  await collect(ana, "madera");
  deposit(ana, "madera", 1);
  await waitFor(() => community(bea, "madera") === 1 && community(bea, "piedra") === 1);
  craft(bea);
  await waitFor(() => mission(ana).status === "completada" && community(ana, "herramienta") === 1);
  assert.equal(mission(ana).completedBy, "bea");
  await server.kill(); // caída brusca

  const store = openStore(dbPath);
  const audit = store.audit();
  assert.equal(audit.balanced, true, JSON.stringify(audit));
  assert.deepEqual(audit.produced, { herramienta: 1 });
  assert.equal(store.getAmount(COMMUNITY, "herramienta"), 1);
  store.close();

  server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const eva = await joinWorld(server.url, "eva");
    assert.equal(taller(eva).built, true);
    assert.equal(taller(eva).builtBy, "bea");
    assert.equal(project(eva).status, "construido");
    assert.equal(mission(eva).status, "completada");
    assert.equal(mission(eva).completedBy, "bea");
    assert.equal(community(eva, "herramienta"), 1);
    await walk(eva, [DOWN, RIGHT]); // (1,1)
    eva.room.send(MESSAGE.move, { dx: 1, dy: 0 }); // hacia el taller
    await waitFor(() => eva.rejections.includes("casilla-bloqueada"));
    await eva.room.leave();
  } finally {
    await server.kill();
  }
});
