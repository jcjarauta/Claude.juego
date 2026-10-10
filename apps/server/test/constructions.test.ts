import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MESSAGE, type MoveMessage } from "@juego/shared";
import { MIGRATIONS, openStore, SCHEMA_VERSION } from "../src/store.ts";
import { fixture, joinPanel, joinWorld, sleep, startServer, tempDb, waitFor, type TestPanel, type TestPlayer } from "./helpers.ts";

// F2a: editor de construcciones (TP-24) y objetos y recetas (TP-25).
// Mundo de prueba 6×5: aparición (0,0); árboles (1,0) y rocas (3,3); taller (2,1) 1×1; administración: ana.
const WORLD = fixture("regen-world.json");

type Viewer = TestPlayer | TestPanel;
const DOWN = { dx: 0, dy: 1 };
const UP = { dx: 0, dy: -1 };
const RIGHT = { dx: 1, dy: 0 };
const send = (v: Viewer, type: string, fields: Record<string, unknown>) => v.room.send(type, { requestId: randomUUID(), ...fields });
const inv = (p: TestPlayer, id: string) => p.me().inventory.get(id) ?? 0;
const community = (v: Viewer, id: string) => v.room.state.community.get(id) ?? 0;
const structureNamed = (v: Viewer, name: string) => [...v.room.state.structures.entries()].find(([, s]) => s.name === name);

async function walk(p: TestPlayer, steps: MoveMessage[]) {
  for (const step of steps) {
    const { x, y } = p.me();
    p.room.send(MESSAGE.move, step);
    await waitFor(() => p.me().x === x + step.dx && p.me().y === y + step.dy, 2000);
    await sleep(110);
  }
}

async function collectWood(p: TestPlayer) {
  const before = inv(p, "madera");
  let last = 0;
  await waitFor(() => {
    if (inv(p, "madera") > before) return true;
    if (Date.now() - last > 150) { p.room.send(MESSAGE.collect, { requestId: randomUUID() }); last = Date.now(); }
    return false;
  }, 6000);
  await sleep(110);
}

const molino = (extra: Record<string, unknown> = {}) => ({
  name: "Molino", description: "", x: 4, y: 0, width: 1, height: 1, color: "#3366cc",
  tasks: [{ title: "Madera", resource: "madera", required: 1 }], ...extra,
});

test("TP-24: la administración crea una construcción con solar; se aporta, se construye junto al solar, bloquea y persiste", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  const ana = await joinWorld(server.url, "ana");
  const bea = await joinWorld(server.url, "bea");
  const luis = await joinPanel(server.url, "luis");

  send(luis, MESSAGE.createConstruction, molino());
  await waitFor(() => luis.rejections.includes("sin-permiso"));
  send(ana, MESSAGE.createConstruction, molino({ name: "En el árbol", x: 3, y: 3 }));
  send(ana, MESSAGE.createConstruction, molino({ name: "Sobre el taller", x: 2, y: 1 }));
  send(ana, MESSAGE.createConstruction, molino({ name: "Fuera", x: 5, y: 4, width: 2 }));
  await waitFor(() => ana.rejections.filter((r) => r === "definicion-invalida").length === 3);
  assert.equal(bea.room.state.structures.size, 1, "los rechazados no crean solar");

  send(ana, MESSAGE.createMission, { name: "Pan", description: "", objective: { kind: "project-completed", project: "no-existe" } });
  send(ana, MESSAGE.createConstruction, molino());
  await waitFor(() => Boolean(structureNamed(bea, "Molino")) && Boolean(structureNamed(luis, "Molino")));
  const [id, solar] = structureNamed(bea, "Molino")!;
  assert.deepEqual({ x: solar.x, y: solar.y, w: solar.width, h: solar.height, color: solar.color, origin: solar.origin, built: solar.built, project: solar.projectId },
    { x: 4, y: 0, w: 1, h: 1, color: "#3366cc", origin: "panel", built: false, project: id });
  assert.equal(bea.room.state.projects.get(id)!.name, "Molino");
  send(ana, MESSAGE.createMission, { name: "Molino listo", description: "", objective: { kind: "project-completed", project: id } });
  await waitFor(() => bea.room.state.missions.size === 2);

  // Aportar y construir.
  ana.room.send(MESSAGE.move, RIGHT);
  await collectWood(ana);
  send(ana, MESSAGE.contribute, { projectId: id, taskId: "madera", from: "player", amount: 1 });
  await waitFor(() => bea.room.state.projects.get(id)!.status === "listo");
  send(ana, MESSAGE.build, { structureId: id });
  await waitFor(() => ana.rejections.includes("lejos-del-solar"));
  await walk(ana, [DOWN, RIGHT, RIGHT, RIGHT]); // (3,1), en diagonal al solar (4,0)
  send(ana, MESSAGE.build, { structureId: id });
  await waitFor(() => structureNamed(bea, "Molino")![1].built);
  assert.equal(bea.room.state.projects.get(id)!.status, "construido");
  assert.equal([...bea.room.state.missions.values()].find((m) => m.name === "Molino listo")!.status, "completada", "la misión se cumple al construir");
  await walk(ana, [UP]); // (3,0)
  ana.room.send(MESSAGE.move, RIGHT);
  await waitFor(() => ana.rejections.includes("casilla-bloqueada"));

  // Cerrar el proyecto de un solar sin construir lo retira; el edificio construido se queda.
  send(ana, MESSAGE.createConstruction, molino({ name: "Faro", x: 5, y: 4 }));
  await waitFor(() => Boolean(structureNamed(bea, "Faro")));
  const [faroId] = structureNamed(bea, "Faro")!;
  send(ana, MESSAGE.closeProject, { projectId: faroId });
  await waitFor(() => !structureNamed(bea, "Faro") && !structureNamed(luis, "Faro"));
  send(ana, MESSAGE.build, { structureId: faroId });
  await waitFor(() => ana.rejections.includes("estructura-desconocida"));
  send(ana, MESSAGE.closeProject, { projectId: id });
  await waitFor(() => bea.room.state.projects.get(id)!.phase === "cerrado");
  assert.ok(structureNamed(bea, "Molino")![1].built, "el edificio construido no se retira");
  send(ana, MESSAGE.createConstruction, molino({ name: "Faro nuevo", x: 5, y: 4 })); // el hueco del Faro vuelve a estar libre
  await waitFor(() => Boolean(structureNamed(bea, "Faro nuevo")));
  await sleep(200);
  await server.kill(); // caída brusca

  server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const eva = await joinPanel(server.url, "eva");
    const [, again] = structureNamed(eva, "Molino")!;
    assert.deepEqual([again.built, again.builtBy, again.x, again.origin], [true, "ana", 4, "panel"]);
    assert.ok(!structureNamed(eva, "Faro"), "el solar retirado no vuelve");
    assert.ok(structureNamed(eva, "Faro nuevo"));
    assert.equal([...eva.room.state.missions.values()].find((m) => m.name === "Molino listo")!.status, "completada");
    await eva.room.leave();
  } finally {
    await server.kill();
  }
  const store = openStore(dbPath);
  assert.equal(store.audit().balanced, true);
  assert.equal(store.getStructureDefs().filter((s) => s.retiredAt).length, 1);
  store.close();
});

test("TP-25: objetos y recetas creados en el panel se fabrican en el edificio nuevo; la misión de objetos se completa", async () => {
  const dbPath = tempDb();
  const server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinPanel(server.url, "luis");
    send(luis, MESSAGE.createItem, { name: "Harina" });
    await waitFor(() => luis.rejections.includes("sin-permiso"));
    send(ana, MESSAGE.createItem, { name: "x".repeat(61) });
    send(ana, MESSAGE.createItem, { name: "   " });
    await waitFor(() => ana.rejections.filter((r) => r === "definicion-invalida").length === 2);
    send(ana, MESSAGE.createItem, { name: "Harina" });
    await waitFor(() => [...luis.room.state.items.values()].some((i) => i.name === "Harina"));
    const harina = [...luis.room.state.items.entries()].find(([, i]) => i.name === "Harina")![0];
    assert.equal(luis.room.state.items.get("herramienta")!.origin, "configuracion");

    send(ana, MESSAGE.createConstruction, molino());
    await waitFor(() => Boolean(structureNamed(luis, "Molino")));
    const [molinoId] = structureNamed(luis, "Molino")!;
    send(ana, MESSAGE.createRecipe, { name: "Moler", structureId: "castillo", inputs: { madera: 1 }, output: { item: harina, amount: 2 } });
    send(ana, MESSAGE.createRecipe, { name: "Moler", structureId: molinoId, inputs: { oro: 1 }, output: { item: harina, amount: 2 } });
    send(luis, MESSAGE.createRecipe, { name: "Moler", structureId: molinoId, inputs: { madera: 1 }, output: { item: harina, amount: 2 } });
    await waitFor(() => ana.rejections.filter((r) => r === "definicion-invalida").length === 4 && luis.rejections.includes("sin-permiso"));
    send(ana, MESSAGE.createRecipe, { name: "Moler", structureId: molinoId, inputs: { madera: 1 }, output: { item: harina, amount: 2 } });
    await waitFor(() => luis.room.state.recipes.size === 2);
    const [recipeId, recipe] = [...luis.room.state.recipes.entries()].find(([, r]) => r.name === "Moler")!;
    assert.deepEqual([recipe.structureId, recipe.outputItem, recipe.outputAmount, recipe.inputs.get("madera"), recipe.origin], [molinoId, harina, 2, 1, "panel"]);
    send(ana, MESSAGE.createMission, { name: "Dos harinas", description: "", objective: { kind: "item-in-community", item: harina, amount: 2 } });
    await waitFor(() => luis.room.state.missions.size === 2);

    // Fabricar exige el edificio construido, estar a su lado y materiales.
    send(ana, MESSAGE.craft, { recipeId });
    await waitFor(() => ana.rejections.includes("taller-sin-construir"));
    ana.room.send(MESSAGE.move, RIGHT);
    await collectWood(ana);
    await collectWood(ana);
    send(ana, MESSAGE.contribute, { projectId: molinoId, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => luis.room.state.projects.get(molinoId)!.status === "listo");
    await walk(ana, [DOWN, RIGHT, RIGHT, RIGHT]);
    send(ana, MESSAGE.build, { structureId: molinoId });
    await waitFor(() => structureNamed(luis, "Molino")![1].built);
    send(ana, MESSAGE.craft, { recipeId });
    await waitFor(() => ana.rejections.includes("faltan-materiales"));
    send(ana, MESSAGE.transfer, { resource: "madera", amount: 1, to: "community" });
    await waitFor(() => community(luis, "madera") === 1);
    await walk(ana, [{ dx: -1, dy: 0 }, { dx: -1, dy: 0 }]); // (1,1): lejos del molino
    send(ana, MESSAGE.craft, { recipeId });
    await waitFor(() => ana.rejections.includes("lejos-del-taller"));
    await walk(ana, [RIGHT, RIGHT]); // (3,1)
    send(ana, MESSAGE.craft, { recipeId });
    await waitFor(() => community(luis, harina) === 2);
    assert.equal(community(luis, "madera"), 0);
    assert.equal([...luis.room.state.missions.values()].find((m) => m.name === "Dos harinas")!.status, "completada");
    await ana.room.leave();
    await luis.room.leave();
  } finally {
    await server.kill();
  }
  const store = openStore(dbPath);
  const audit = store.audit();
  assert.equal(audit.balanced, true, JSON.stringify(audit));
  assert.equal(Object.values(audit.produced).reduce((a, b) => a + b, 0), 2);
  assert.equal(store.getItemDefs().length, 1);
  assert.equal(store.getRecipeDefs().length, 1);
  store.close();
});

test("migración v8 → v9: conserva los datos y crea construcciones, objetos y recetas", () => {
  const path = tempDb();
  const v8 = new DatabaseSync(path);
  for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) v8.exec(MIGRATIONS[v]!);
  v8.exec("PRAGMA user_version = 8");
  v8.exec("INSERT INTO task_comment (project_id, task_id, author, at, text) VALUES ('p', 't', 'ana', 1, 'hola')");
  v8.close();
  const store = openStore(path);
  assert.equal(store.schemaVersion(), SCHEMA_VERSION);
  assert.ok(existsSync(`${path}.v8.bak`));
  assert.equal(store.getComments("p", "t").length, 1);
  assert.deepEqual([store.getStructureDefs(), store.getItemDefs(), store.getRecipeDefs()], [[], [], []]);
  store.close();
});
