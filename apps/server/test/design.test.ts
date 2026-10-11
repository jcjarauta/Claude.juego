import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  achievementSnapshotFromState, DEFAULT_BUILD_LIMITS, evaluateObjective, MESSAGE, skillBadgesFromState, snapshotFromState,
  type Objective, type WorldConfig,
} from "@juego/shared";
import { MIGRATIONS, openStore, SCHEMA_VERSION } from "../src/store.ts";
import { fixture, joinWorld, sleep, startServer, tempDb, waitFor, type TestPlayer } from "./helpers.ts";

// G1, P0 (TP-31): límites editables, archivo de definiciones y migración v11, con servidor real y base temporal. Mundo de prueba 6×5
// (aparición (0,0), árbol (1,0), Taller (2,1) sin construir; configuración: objeto y receta «herramienta» y la misión «primera-herramienta»).
const WORLD = fixture("regen-world.json");
const send = (p: TestPlayer, type: string, fields: Record<string, unknown> = {}) => p.room.send(type, { requestId: randomUUID(), ...fields });
const limit = (p: TestPlayer, key: string) => p.room.state.limits.get(key);
const itemId = (p: TestPlayer, name: string) => [...p.room.state.items.entries()].filter(([, i]) => i.name === name).map(([id]) => id);
const lastReason = (p: TestPlayer) => p.rejections.at(-1);

// --------------------------------------------------------------- migración

test("migración v10 → v11: conserva los datos, crea ajustes y archivo vacíos, hace copia y no se repite", () => {
  const path = tempDb();
  const v10 = new DatabaseSync(path);
  for (let v = 1; v <= 10; v++) v10.exec(MIGRATIONS[v]!);
  v10.exec("PRAGMA user_version = 10");
  v10.exec(`INSERT INTO item_def (id, definition, created_by, created_at) VALUES ('sal-1', '{"id":"sal-1","name":"Sal"}', 'ana', 1)`);
  v10.exec("INSERT INTO task_comment (project_id, task_id, author, at, text) VALUES ('p', 't', 'ana', 1, 'hola')");
  v10.close();
  const store = openStore(path);
  assert.equal(store.schemaVersion(), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 11);
  assert.ok(existsSync(`${path}.v10.bak`), "copia antes de migrar");
  assert.equal(store.getComments("p", "t").length, 1);
  assert.deepEqual(store.getItemDefs().map((i) => i.def.name), ["Sal"], "las definiciones se conservan");
  assert.deepEqual([store.getSetting("buildLimits"), store.getArchived()], [undefined, []]);
  // ajustes y archivo funcionan
  store.putSetting("buildLimits", '{"recipeInputs":7}', "ana", 5);
  store.putSetting("buildLimits", '{"recipeInputs":9}', "ana", 6);
  assert.equal(store.getSetting("buildLimits"), '{"recipeInputs":9}', "el ajuste se sustituye");
  store.addArchive("objeto", "sal-1", "ana", 7);
  assert.deepEqual(store.getArchived(), [{ kind: "objeto", id: "sal-1", archivedBy: "ana", archivedAt: 7 }]);
  assert.throws(() => store.addArchive("objeto", "sal-1", "ana", 8), "no se archiva dos veces");
  store.removeArchive("objeto", "sal-1");
  store.deleteSetting("buildLimits");
  assert.deepEqual([store.getSetting("buildLimits"), store.getArchived()], [undefined, []]);
  store.close();
  const again = openStore(path);
  assert.equal(again.schemaVersion(), SCHEMA_VERSION, "reabrir no migra de nuevo");
  assert.deepEqual(again.getItemDefs().map((i) => i.def.id), ["sal-1"]);
  again.close();
});

// --------------------------------------------------------------- límites en una sala real

test("TP-31: los límites se cambian sin reiniciar, se sincronizan, se aplican a lo nuevo, persisten y se pueden restaurar", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinWorld(server.url, "luis");
    await waitFor(() => limit(luis, "recipeInputs") === DEFAULT_BUILD_LIMITS.recipeInputs);
    assert.equal(limit(luis, "plannerDepth"), 8, "los límites del planificador llegan al estado");

    // Sin permiso y con valores inválidos: se rechaza y nada cambia.
    send(luis, MESSAGE.updateLimits, { limits: { recipeInputs: 2 } });
    await waitFor(() => lastReason(luis) === "sin-permiso");
    send(ana, MESSAGE.updateLimits, { limits: { recipeInputs: 9999 } });
    await waitFor(() => lastReason(ana) === "definicion-invalida");
    send(ana, MESSAGE.updateLimits, { limits: { colas: 3 } });
    await waitFor(() => ana.rejections.filter((r) => r === "definicion-invalida").length === 2);
    await sleep(150);
    assert.equal(limit(luis, "recipeInputs"), DEFAULT_BUILD_LIMITS.recipeInputs);

    // Cambio válido: llega a todos sin reiniciar.
    send(ana, MESSAGE.updateLimits, { limits: { recipeInputs: 2, skillLevels: 8, plannerDepth: 12 } });
    await waitFor(() => limit(luis, "recipeInputs") === 2 && limit(ana, "skillLevels") === 8 && limit(luis, "plannerDepth") === 12);
    assert.equal(limit(luis, "items"), DEFAULT_BUILD_LIMITS.items, "lo demás no cambia");

    // Con el límite bajado, una receta de tres entradas se rechaza; lo ya creado (la receta de la configuración) sigue.
    await sleep(1100); // el limitador admite 8 operaciones por segundo (Q167)
    send(ana, MESSAGE.createItem, { name: "Harina" });
    await waitFor(() => itemId(luis, "Harina").length === 1);
    const [harina] = itemId(luis, "Harina");
    const recipe = { name: "Mezcla", structureId: "taller", inputs: { madera: 1, piedra: 1, [harina!]: 1 }, output: { item: "herramienta", amount: 1 } };
    send(ana, MESSAGE.createRecipe, recipe);
    await waitFor(() => ana.rejections.filter((r) => r === "definicion-invalida").length === 3);
    assert.equal(luis.room.state.recipes.size, 1, "la receta rechazada no se crea y la de la configuración sigue");
    send(ana, MESSAGE.updateLimits, { limits: { recipeInputs: 3 } });
    await waitFor(() => limit(luis, "recipeInputs") === 3);
    send(ana, MESSAGE.createRecipe, recipe);
    await waitFor(() => luis.room.state.recipes.size === 2);

    // Persiste tras una caída brusca y se aplica al arrancar.
    await sleep(200);
    await server.kill();
    server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
    const eva = await joinWorld(server.url, "eva");
    await waitFor(() => limit(eva, "recipeInputs") === 3);
    assert.equal(limit(eva, "skillLevels"), 8);
    assert.equal(limit(eva, "plannerDepth"), 12);

    // Restaurar por omisión vuelve a los de la configuración.
    const ana2 = await joinWorld(server.url, "ana");
    send(ana2, MESSAGE.updateLimits, { reset: true });
    await waitFor(() => limit(eva, "recipeInputs") === DEFAULT_BUILD_LIMITS.recipeInputs && limit(eva, "plannerDepth") === 8);
    await eva.room.leave();
    await ana2.room.leave();
  } finally {
    await server.kill();
  }
  const store = openStore(dbPath);
  assert.equal(store.getSetting("buildLimits"), undefined, "restaurar borra el ajuste");
  assert.ok(store.audit().balanced);
  store.close();
});

// --------------------------------------------------------------- archivo en una sala real

test("TP-31: archivar y restaurar definiciones (de la configuración y del panel) sin borrar nada, con usos, nombres y persistencia", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinWorld(server.url, "luis");

    // Sin permiso.
    send(luis, MESSAGE.archiveDef, { kind: "mision", id: "primera-herramienta" });
    await waitFor(() => lastReason(luis) === "sin-permiso");
    assert.equal(luis.room.state.missions.get("primera-herramienta")!.archived, false);

    // Un objeto duplicado sin usos: se archiva, su nombre queda libre y restaurar con el nombre ocupado falla.
    send(ana, MESSAGE.createItem, { name: "Sal" });
    await waitFor(() => itemId(luis, "Sal").length === 1);
    const [salA] = itemId(luis, "Sal");
    await sleep(150);
    send(ana, MESSAGE.createItem, { name: "Sal" });
    await waitFor(() => lastReason(ana) === "definicion-invalida"); // mientras está activo, el nombre está ocupado
    send(ana, MESSAGE.archiveDef, { kind: "objeto", id: salA });
    await waitFor(() => luis.room.state.items.get(salA!)!.archived === true);
    await sleep(150);
    send(ana, MESSAGE.createItem, { name: "Sal" });
    await waitFor(() => itemId(luis, "Sal").length === 2);
    const salB = itemId(luis, "Sal").find((id) => id !== salA)!;
    assert.equal(luis.room.state.items.get(salB)!.archived, false);
    assert.equal(luis.room.state.items.get(salA!)!.name, "Sal", "lo archivado conserva su definición");
    await sleep(150);
    send(ana, MESSAGE.restoreDef, { kind: "objeto", id: salA });
    await waitFor(() => lastReason(ana) === "definicion-en-uso"); // el nombre ya lo usa otro elemento activo
    assert.equal(luis.room.state.items.get(salA!)!.archived, true);
    await sleep(150);
    send(ana, MESSAGE.restoreDef, { kind: "objeto", id: "no-existe" });
    await waitFor(() => lastReason(ana) === "definicion-invalida");

    // Algo en uso no se archiva; con la receta archivada, ya sí; y restaurar exige lo que necesita.
    await sleep(200);
    send(ana, MESSAGE.createRecipe, { name: "Salar", structureId: "taller", inputs: { madera: 1 }, output: { item: salB, amount: 1 } });
    await waitFor(() => luis.room.state.recipes.size === 2);
    const salar = [...luis.room.state.recipes.entries()].find(([, r]) => r.name === "Salar")![0];
    await sleep(150);
    send(ana, MESSAGE.archiveDef, { kind: "objeto", id: salB });
    await waitFor(() => lastReason(ana) === "definicion-en-uso");
    assert.equal(luis.room.state.items.get(salB)!.archived, false);
    // Fabricar: con el taller sin construir se rechaza por eso; archivada, la receta deja de existir para fabricar.
    send(luis, MESSAGE.craft, { recipeId: salar });
    await waitFor(() => lastReason(luis) === "taller-sin-construir");
    await sleep(150);
    send(ana, MESSAGE.archiveDef, { kind: "receta", id: salar });
    await waitFor(() => luis.room.state.recipes.get(salar)!.archived === true);
    send(luis, MESSAGE.craft, { recipeId: salar });
    await waitFor(() => lastReason(luis) === "receta-desconocida");
    await sleep(150);
    send(ana, MESSAGE.archiveDef, { kind: "objeto", id: salB });
    await waitFor(() => luis.room.state.items.get(salB)!.archived === true);
    await sleep(150);
    send(ana, MESSAGE.restoreDef, { kind: "receta", id: salar });
    await waitFor(() => lastReason(ana) === "definicion-en-uso"); // el objeto de la receta sigue archivado
    assert.equal(luis.room.state.recipes.get(salar)!.archived, true);
    await sleep(150);
    send(ana, MESSAGE.restoreDef, { kind: "objeto", id: salB });
    await waitFor(() => luis.room.state.items.get(salB)!.archived === false);
    await sleep(150);
    send(ana, MESSAGE.restoreDef, { kind: "receta", id: salar });
    await waitFor(() => luis.room.state.recipes.get(salar)!.archived === false);

    // Lo de la configuración también se archiva (misión → receta → objeto, en ese orden por los usos).
    await sleep(200);
    send(ana, MESSAGE.archiveDef, { kind: "objeto", id: "herramienta" });
    await waitFor(() => lastReason(ana) === "definicion-en-uso");
    for (const [kind, id] of [["mision", "primera-herramienta"], ["receta", "herramienta"], ["objeto", "herramienta"]] as const) {
      await sleep(150);
      send(ana, MESSAGE.archiveDef, { kind, id });
      await waitFor(() => (kind === "mision" ? luis.room.state.missions.get(id)! : kind === "receta" ? luis.room.state.recipes.get(id)! : luis.room.state.items.get(id)!).archived === true);
    }
    // Un objeto con una receta «Salar» activa que no lo usa… y «herramienta» sigue existiendo en el estado (nada se borra).
    assert.equal(luis.room.state.items.has("herramienta"), true);

    // Persiste tras una caída brusca.
    await sleep(200);
    await server.kill();
    server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
    const eva = await joinWorld(server.url, "eva");
    await waitFor(() => eva.room.state.items.size >= 3);
    assert.equal(eva.room.state.missions.get("primera-herramienta")!.archived, true);
    assert.equal(eva.room.state.recipes.get("herramienta")!.archived, true);
    assert.equal(eva.room.state.items.get("herramienta")!.archived, true);
    assert.equal(eva.room.state.items.get(salA!)!.archived, true);
    assert.equal(eva.room.state.items.get(salB)!.archived, false);
    assert.equal(eva.room.state.recipes.get(salar)!.archived, false);
    await eva.room.leave();
  } finally {
    await server.kill();
  }
  const store = openStore(dbPath);
  const archived = store.getArchived().map((a) => `${a.kind}:${a.id}`);
  assert.equal(archived.length, 4, "salA, misión, receta y objeto de la configuración");
  assert.equal(store.getItemDefs().length, 2, "nada se borra: los dos objetos «Sal» siguen en la base");
  assert.ok(store.audit().balanced);
  store.close();
});

// --------------------------------------------------------------- lo archivado en el modelo del juego (P2)

test("TP-31: lo archivado desaparece de las instantáneas del objetivo y de los logros, y el planificador usa los límites vigentes", async () => {
  const config = JSON.parse(readFileSync(WORLD, "utf8")) as WorldConfig;
  const dbPath = tempDb();
  const server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinWorld(server.url, "luis");
    await waitFor(() => limit(luis, "plannerDepth") === 8);
    const snap = () => snapshotFromState(luis.room.state, config, luis.room.sessionId);
    assert.deepEqual(snap().planner, { depth: 8, routes: 24 }, "el planificador recibe los límites vigentes");
    assert.ok(snap().recipes.some((r) => r.id === "herramienta"));
    assert.ok(snap().missions.some((m) => m.def.id === "primera-herramienta"));
    assert.ok(achievementSnapshotFromState(luis.room.state, luis.room.sessionId).missions.some((m) => m.id === "primera-herramienta"));

    send(ana, MESSAGE.updateLimits, { limits: { plannerDepth: 3, plannerRoutes: 5 } });
    await waitFor(() => snap().planner?.depth === 3 && snap().planner?.routes === 5);

    // Con la misión y la receta archivadas, el modelo no las propone; el objetivo por misión archivada queda bloqueado.
    for (const [kind, id] of [["mision", "primera-herramienta"], ["receta", "herramienta"]] as const) {
      await sleep(150);
      send(ana, MESSAGE.archiveDef, { kind, id });
      await waitFor(() => (kind === "mision" ? luis.room.state.missions.get(id)! : luis.room.state.recipes.get(id)!).archived === true);
    }
    assert.ok(!snap().recipes.some((r) => r.id === "herramienta"), "la receta archivada no se propone");
    assert.ok(!snap().missions.some((m) => m.def.id === "primera-herramienta"), "la misión archivada y sin cumplir no cuenta");
    assert.ok(!achievementSnapshotFromState(luis.room.state, luis.room.sessionId).missions.some((m) => m.id === "primera-herramienta"));
    const objective: Objective = { kind: "mission", id: "primera-herramienta" };
    assert.notEqual(evaluateObjective(objective, snap()).status, "disponible", "un objetivo archivado nunca figura como disponible");
    assert.ok(Array.isArray(skillBadgesFromState(luis.room.state, luis.room.sessionId)));
    await ana.room.leave();
    await luis.room.leave();
  } finally {
    await server.kill();
  }
});
