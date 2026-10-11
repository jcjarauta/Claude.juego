import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MESSAGE, type MoveMessage, type TeachOfferedMessage, type TeachResultMessage } from "@juego/shared";
import { MIGRATIONS, openStore, SCHEMA_VERSION } from "../src/store.ts";
import { fixture, joinPanel, joinWorld, sessionFor, sleep, startServer, tempDb, waitFor, type TestPanel, type TestPlayer } from "./helpers.ts";

// F2c: habilidades (TP-27). Mundo de prueba 6×5: aparición (0,0); árboles (1,0); taller (2,1) sin construir (no bloquea); administración: ana.
const WORLD = fixture("regen-world.json");

type Viewer = TestPlayer | TestPanel;
const DOWN = { dx: 0, dy: 1 };
const RIGHT = { dx: 1, dy: 0 };
const send = (v: Viewer, type: string, fields: Record<string, unknown>) => v.room.send(type, { requestId: randomUUID(), ...fields });
const inv = (p: TestPlayer, id: string) => p.me().inventory.get(id) ?? 0;
const community = (v: Viewer, id: string) => v.room.state.community.get(id) ?? 0;
const structureNamed = (v: Viewer, name: string) => [...v.room.state.structures.entries()].find(([, s]) => s.name === name);
const itemNamed = (v: Viewer, name: string) => [...v.room.state.items.entries()].find(([, i]) => i.name === name)![0];
const recipeNamed = (v: Viewer, name: string) => [...v.room.state.recipes.entries()].find(([, r]) => r.name === name)![0];
const skillOf = (v: Viewer, who: string, skill: string) => [...v.room.state.players.values()].find((p) => p.name === who)?.skills.get(skill) ?? 0;

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

const rejected = (p: TestPlayer | TestPanel, reason: string) => p.rejections.filter((r) => r === reason).length;

test("TP-27: habilidades con niveles; práctica, concesión y enseñanza con aceptación; recetas que las exigen; persiste", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    const luis = await joinPanel(server.url, "luis");
    await sessionFor(server.url, "carla"); // cuenta sin conectar, para conceder
    const offers: TeachOfferedMessage[] = [];
    const results: TeachResultMessage[] = [];
    bea.room.onMessage(MESSAGE.teachOffered, (m: TeachOfferedMessage) => offers.push(m));
    for (const p of [ana, bea]) p.room.onMessage(MESSAGE.teachResult, (m: TeachResultMessage) => results.push(m));

    send(ana, MESSAGE.createItem, { name: "Harina" });
    send(ana, MESSAGE.createConstruction, { name: "Molino", description: "", x: 4, y: 0, width: 1, height: 1, color: "#3366cc", tasks: [{ title: "Madera", resource: "madera", required: 1 }] });
    await waitFor(() => luis.room.state.items.size === 2 && Boolean(structureNamed(luis, "Molino")));
    const harina = itemNamed(luis, "Harina");
    const [molinoId] = structureNamed(luis, "Molino")!;
    await sleep(1100);
    const recipe = (name: string, extra: Record<string, unknown> = {}) =>
      send(ana, MESSAGE.createRecipe, { name, structureId: molinoId, inputs: { madera: 1 }, output: { item: harina, amount: 1 }, ...extra });
    recipe("Moler a mano");
    recipe("Moler");
    recipe("Moler grueso");
    await waitFor(() => luis.room.state.recipes.size === 4);
    await sleep(1100);

    // Sin permiso, y rechazos de definición (receta de práctica desconocida, sin niveles).
    const levels = [
      { name: "Aprendiz", recipe: recipeNamed(luis, "Moler a mano"), times: 1 },
      { name: "Oficial", recipe: recipeNamed(luis, "Moler"), times: 1 },
      { name: "Maestro", recipe: recipeNamed(luis, "Moler grueso"), times: 1 },
    ];
    send(luis, MESSAGE.createSkill, { name: "Molinero", description: "", levels });
    send(ana, MESSAGE.createSkill, { name: "Fantasma", description: "", levels: [{ name: "A", recipe: "no-existe", times: 1 }] });
    send(ana, MESSAGE.createSkill, { name: "Vacía", description: "", levels: [] });
    await waitFor(() => rejected(luis, "sin-permiso") === 1 && rejected(ana, "definicion-invalida") >= 2);
    assert.equal(luis.room.state.skills.size, 0, "los rechazados no crean habilidad");
    await sleep(1100);
    send(ana, MESSAGE.createSkill, { name: "Molinero", description: "Muele.", levels });
    await waitFor(() => luis.room.state.skills.size === 1);
    const [skillId, skill] = [...luis.room.state.skills.entries()][0]!;
    assert.deepEqual([skill.name, skill.levels.length, skill.levels[1]!.name, skill.levels[0]!.times, skill.origin], ["Molinero", 3, "Oficial", 1, "panel"]);
    send(ana, MESSAGE.createSkill, { name: "molinero", description: "", levels });
    await waitFor(() => rejected(ana, "definicion-invalida") >= 3);

    // Una receta que exige Molinero (Oficial) y otra con una habilidad inexistente.
    await sleep(1100);
    send(ana, MESSAGE.createRecipe, { name: "Moler fino", structureId: molinoId, inputs: { madera: 1 }, output: { item: harina, amount: 1 }, requiresSkills: [{ skill: skillId, level: 2 }] });
    send(ana, MESSAGE.createRecipe, { name: "Panadería", structureId: molinoId, inputs: { madera: 1 }, output: { item: harina, amount: 1 }, requiresSkills: [{ skill: "panadero", level: 1 }] });
    await waitFor(() => luis.room.state.recipes.size === 5 && rejected(ana, "definicion-invalida") >= 4);
    const fino = recipeNamed(luis, "Moler fino");
    assert.equal(luis.room.state.recipes.get(fino)!.requiresSkills.get(skillId), 2);

    // Preparar el molino: aportar, construir, y madera en el almacén.
    await collectWood(ana);
    await collectWood(ana);
    await collectWood(ana);
    send(ana, MESSAGE.contribute, { projectId: molinoId, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => luis.room.state.projects.get(molinoId)!.status === "listo");
    send(ana, MESSAGE.transfer, { resource: "madera", amount: 2, to: "community" });
    await waitFor(() => community(luis, "madera") === 2);
    await walk(ana, [DOWN, RIGHT, RIGHT, RIGHT]); // (3,1)
    send(ana, MESSAGE.build, { structureId: molinoId });
    await waitFor(() => structureNamed(luis, "Molino")![1].built);

    // Sin la habilidad no se fabrica la receta que la exige; no se gasta nada.
    send(ana, MESSAGE.craft, { recipeId: fino });
    await waitFor(() => rejected(ana, "falta-habilidad") === 1);
    assert.equal(community(luis, "madera"), 2);

    // Practicar: cada receta de práctica sube un nivel (1 vez cada una) y se anuncia en el estado.
    send(ana, MESSAGE.craft, { recipeId: recipeNamed(luis, "Moler a mano") });
    await waitFor(() => skillOf(luis, "ana", skillId) === 1);
    assert.equal(ana.me().crafts.get(levels[0]!.recipe), 1, "el progreso de práctica se sincroniza");
    send(ana, MESSAGE.craft, { recipeId: recipeNamed(luis, "Moler") });
    await waitFor(() => skillOf(luis, "ana", skillId) === 2);
    assert.equal(community(luis, "madera"), 0);
    await collectWood(bea); // bea sigue junto al árbol; ana ya está en el molino
    send(bea, MESSAGE.transfer, { resource: "madera", amount: 1, to: "community" });
    await waitFor(() => community(luis, "madera") === 1);
    send(ana, MESSAGE.craft, { recipeId: recipeNamed(luis, "Moler grueso") });
    await waitFor(() => skillOf(luis, "ana", skillId) === 3);
    // Con Oficial o más, la receta que exige Oficial se abre.
    await collectWood(bea); // bea sigue junto al árbol; ana ya está en el molino
    send(bea, MESSAGE.transfer, { resource: "madera", amount: 1, to: "community" });
    await waitFor(() => community(luis, "madera") === 1);
    send(ana, MESSAGE.craft, { recipeId: fino });
    await waitFor(() => community(luis, "madera") === 0 && community(luis, harina) === 4);

    // Enseñar: lejos, sin permiso de nivel y sin aceptación no sube nada.
    send(bea, MESSAGE.teachOffer, { to: "ana", skill: skillId });
    await waitFor(() => rejected(bea, "oferta-invalida") === 1); // bea no tiene la habilidad
    send(ana, MESSAGE.teachOffer, { to: "bea", skill: skillId });
    await waitFor(() => rejected(ana, "oferta-invalida") === 1); // bea está a más de 2 casillas
    await walk(bea, [DOWN, RIGHT]); // (1,1): a 2 casillas de ana (3,1)
    await sleep(1100);
    send(ana, MESSAGE.teachOffer, { to: "bea", skill: skillId });
    await waitFor(() => offers.length === 1);
    assert.deepEqual([offers[0]!.from, offers[0]!.skill, offers[0]!.level], ["ana", skillId, 1]);
    assert.equal(skillOf(luis, "bea", skillId), 0, "una oferta sin aceptar no cambia nada");
    send(ana, MESSAGE.teachOffer, { to: "bea", skill: skillId });
    await waitFor(() => rejected(ana, "oferta-invalida") === 2); // ya hay una oferta pendiente
    send(ana, MESSAGE.teachRespond, { offerId: offers[0]!.offerId, accept: true });
    await waitFor(() => rejected(ana, "oferta-invalida") === 3); // solo quien la recibe puede responder
    send(bea, MESSAGE.teachRespond, { offerId: offers[0]!.offerId, accept: false });
    await waitFor(() => results.some((r) => r.status === "rechazada"));
    assert.equal(skillOf(luis, "bea", skillId), 0, "rechazar no cambia nada");

    await sleep(1100);
    send(ana, MESSAGE.teachOffer, { to: "bea", skill: skillId });
    await waitFor(() => offers.length === 2);
    send(bea, MESSAGE.teachRespond, { offerId: offers[1]!.offerId, accept: true });
    await waitFor(() => skillOf(luis, "bea", skillId) === 1);
    assert.ok(results.some((r) => r.status === "aceptada" && r.level === 1));
    await sleep(1100);
    send(ana, MESSAGE.teachOffer, { to: "bea", skill: skillId });
    await waitFor(() => offers.length === 3);
    send(bea, MESSAGE.teachRespond, { offerId: offers[2]!.offerId, accept: true });
    await waitFor(() => skillOf(luis, "bea", skillId) === 2);
    // Ana es Maestro (3): solo puede enseñar hasta Oficial (2).
    await sleep(1100);
    send(ana, MESSAGE.teachOffer, { to: "bea", skill: skillId });
    await waitFor(() => rejected(ana, "oferta-invalida") === 4);
    assert.equal(skillOf(luis, "bea", skillId), 2);

    // Conceder: solo la administración, solo sube, también a una cuenta desconectada.
    send(bea, MESSAGE.grantSkill, { name: "carla", skill: skillId, level: 2 });
    await waitFor(() => rejected(bea, "sin-permiso") === 1);
    send(ana, MESSAGE.grantSkill, { name: "carla", skill: skillId, level: 2 });
    send(ana, MESSAGE.grantSkill, { name: "nadie", skill: skillId, level: 1 });
    await waitFor(() => rejected(ana, "solicitud-invalida") === 1);
    await sleep(1100);
    send(ana, MESSAGE.grantSkill, { name: "carla", skill: skillId, level: 1 });
    await waitFor(() => rejected(ana, "definicion-invalida") === 5, 5000); // no baja
    await sleep(200);
    await server.kill(); // caída brusca

    server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
    const bea2 = await joinWorld(server.url, "bea");
    const ana2 = await joinWorld(server.url, "ana");
    const carla = await joinWorld(server.url, "carla");
    assert.deepEqual([bea2.me().skills.get(skillId), ana2.me().skills.get(skillId), carla.me().skills.get(skillId)], [2, 3, 2], "los niveles persisten");
    assert.equal(ana2.me().crafts.get(levels[0]!.recipe), 1, "las cuentas de práctica persisten");
    assert.equal(bea2.room.state.skills.get(skillId)!.levels.length, 3);
    assert.equal(bea2.room.state.recipes.get(fino)!.requiresSkills.get(skillId), 2);
    for (const p of [bea2, ana2, carla]) await p.room.leave();
  } finally {
    await server.kill();
  }
  const store = openStore(dbPath);
  const audit = store.audit();
  assert.equal(audit.balanced, true, JSON.stringify(audit));
  assert.deepEqual(store.getPlayerSkills("ana"), { [store.getSkillDefs()[0]!.def.id]: 3 });
  assert.equal(store.getSkillDefs().length, 1);
  store.close();
});

test("migración v9 → v10: conserva los datos y crea las tablas de habilidades", () => {
  const path = tempDb();
  const v9 = new DatabaseSync(path);
  for (let v = 1; v <= 9; v++) v9.exec(MIGRATIONS[v]!);
  v9.exec("PRAGMA user_version = 9");
  v9.exec("INSERT INTO task_comment (project_id, task_id, author, at, text) VALUES ('p', 't', 'ana', 1, 'hola')");
  v9.close();
  const store = openStore(path);
  assert.equal(store.schemaVersion(), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 10, "la migración v9 → v10 sigue siendo parte del historial (hoy hay más versiones)");
  assert.ok(existsSync(`${path}.v9.bak`));
  assert.equal(store.getComments("p", "t").length, 1);
  assert.deepEqual([store.getSkillDefs(), store.getPlayerSkills("ana"), store.getCraftCounts("ana")], [[], {}, {}]);
  store.close();
});
