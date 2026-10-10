import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MESSAGE, type MoveMessage } from "@juego/shared";
import { openStore } from "../src/store.ts";
import { fixture, joinPanel, joinWorld, sleep, startServer, tempDb, waitFor, type TestPanel, type TestPlayer } from "./helpers.ts";

// F2b: cadenas de producción (TP-26). Mismo mundo de prueba 6×5 que F2a: aparición (0,0); árboles (1,0);
// taller (2,1) 1×1 sin construir (no bloquea); administración: ana.
const WORLD = fixture("regen-world.json");

type Viewer = TestPlayer | TestPanel;
const DOWN = { dx: 0, dy: 1 };
const RIGHT = { dx: 1, dy: 0 };
const send = (v: Viewer, type: string, fields: Record<string, unknown>) => v.room.send(type, { requestId: randomUUID(), ...fields });
const inv = (p: TestPlayer, id: string) => p.me().inventory.get(id) ?? 0;
const community = (v: Viewer, id: string) => v.room.state.community.get(id) ?? 0;
const structureNamed = (v: Viewer, name: string) => [...v.room.state.structures.entries()].find(([, s]) => s.name === name);
const itemNamed = (v: Viewer, name: string) => [...v.room.state.items.entries()].find(([, i]) => i.name === name)![0];

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

const building = (name: string, x: number, y: number) => ({
  name, description: "", x, y, width: 1, height: 1, color: "#3366cc", tasks: [{ title: "Madera", resource: "madera", required: 1 }],
});

test("TP-26: cadena Molino → Horno creada en el panel, con objeto de entrada, subproducto, verbo y edificio extra", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinPanel(server.url, "luis");

    for (const name of ["Harina", "Salvado", "Pan"]) send(ana, MESSAGE.createItem, { name });
    send(ana, MESSAGE.createConstruction, building("Molino", 4, 0));
    send(ana, MESSAGE.createConstruction, building("Horno", 4, 2));
    await waitFor(() => luis.room.state.items.size === 4 && Boolean(structureNamed(luis, "Molino")) && Boolean(structureNamed(luis, "Horno")));
    const [harina, salvado, pan] = ["Harina", "Salvado", "Pan"].map((n) => itemNamed(luis, n));
    const [molinoId] = structureNamed(luis, "Molino")!;
    const [hornoId] = structureNamed(luis, "Horno")!;

    // Moler: madera → 2 harina + 1 salvado (subproducto). Hornear: 2 harina → pan, en el Horno y con el Molino construido.
    send(ana, MESSAGE.createRecipe, {
      name: "Moler", structureId: molinoId, verb: "moler", inputs: { madera: 1 },
      output: { item: harina!, amount: 2 }, byproducts: [{ item: salvado!, amount: 1 }],
    });
    send(ana, MESSAGE.createRecipe, {
      name: "Hornear", structureId: hornoId, verb: "hornear", alsoNeeds: [molinoId], inputs: { [harina!]: 2 }, output: { item: pan!, amount: 1 },
    });
    await waitFor(() => luis.room.state.recipes.size === 3);
    const recipeOf = (name: string) => [...luis.room.state.recipes.entries()].find(([, r]) => r.name === name)!;
    const [moler, molerState] = recipeOf("Moler");
    const [hornear, hornearState] = recipeOf("Hornear");
    assert.deepEqual([molerState.verb, molerState.byproducts.get(salvado!), molerState.outputAmount], ["moler", 1, 2]);
    assert.deepEqual([hornearState.verb, [...hornearState.alsoNeeds], hornearState.inputs.get(harina!)], ["hornear", [molinoId], 2], "un objeto como entrada");

    // Rechazos con motivo: ciclo (pan → harina), salida repetida como subproducto, verbo largo, edificio extra desconocido, sin permiso.
    await sleep(1100); // el limitador admite 8 operaciones por segundo (Q167)
    const before = ana.rejections.filter((r) => r === "definicion-invalida").length;
    send(ana, MESSAGE.createRecipe, { name: "Deshornear", structureId: molinoId, inputs: { [pan!]: 1 }, output: { item: harina!, amount: 1 } });
    send(ana, MESSAGE.createRecipe, { name: "Doble", structureId: molinoId, inputs: { madera: 1 }, output: { item: harina!, amount: 1 }, byproducts: [{ item: harina!, amount: 1 }] });
    send(ana, MESSAGE.createRecipe, { name: "Verboso", structureId: molinoId, verb: "x".repeat(21), inputs: { madera: 1 }, output: { item: harina!, amount: 1 } });
    send(ana, MESSAGE.createRecipe, { name: "Extra", structureId: molinoId, alsoNeeds: ["castillo"], inputs: { madera: 1 }, output: { item: harina!, amount: 1 } });
    send(luis, MESSAGE.createRecipe, { name: "Intruso", structureId: molinoId, inputs: { madera: 1 }, output: { item: harina!, amount: 1 } });
    await waitFor(() => ana.rejections.filter((r) => r === "definicion-invalida").length === before + 4 && luis.rejections.includes("sin-permiso"));
    assert.equal(luis.room.state.recipes.size, 3, "los rechazados no crean receta");

    await sleep(1100);
    send(ana, MESSAGE.createMission, { name: "Un pan", description: "", objective: { kind: "item-in-community", item: pan!, amount: 1 } });
    await waitFor(() => luis.room.state.missions.size === 2);

    // Aportes y construcción del Horno primero: sin el Molino construido, no se puede hornear aunque haya materiales.
    await collectWood(ana);
    await collectWood(ana);
    await collectWood(ana);
    send(ana, MESSAGE.contribute, { projectId: molinoId, taskId: "madera", from: "player", amount: 1 });
    send(ana, MESSAGE.contribute, { projectId: hornoId, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => luis.room.state.projects.get(molinoId)!.status === "listo" && luis.room.state.projects.get(hornoId)!.status === "listo");
    send(ana, MESSAGE.transfer, { resource: "madera", amount: 1, to: "community" });
    await waitFor(() => community(luis, "madera") === 1);
    await walk(ana, [DOWN, RIGHT, RIGHT, RIGHT]); // (3,1): en diagonal al Molino (4,0) y al Horno (4,2)
    send(ana, MESSAGE.build, { structureId: hornoId });
    await waitFor(() => structureNamed(luis, "Horno")![1].built);
    send(ana, MESSAGE.craft, { recipeId: hornear });
    await waitFor(() => ana.rejections.includes("faltan-edificios"));
    assert.equal(community(luis, harina!), 0);

    send(ana, MESSAGE.build, { structureId: molinoId });
    await waitFor(() => structureNamed(luis, "Molino")![1].built);
    send(ana, MESSAGE.craft, { recipeId: hornear });
    await waitFor(() => ana.rejections.filter((r) => r === "faltan-materiales").length === 1);

    // Moler deja harina y el subproducto en la misma fabricación.
    send(ana, MESSAGE.craft, { recipeId: moler });
    await waitFor(() => community(luis, harina!) === 2);
    assert.deepEqual([community(luis, salvado!), community(luis, "madera")], [1, 0]);

    // Hornear consume el objeto intermedio y completa la misión del pan.
    send(ana, MESSAGE.craft, { recipeId: hornear });
    await waitFor(() => community(luis, pan!) === 1);
    assert.equal(community(luis, harina!), 0);
    assert.equal([...luis.room.state.missions.values()].find((m) => m.name === "Un pan")!.status, "completada");
    await sleep(200);
    await server.kill(); // caída brusca

    server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
    const eva = await joinPanel(server.url, "eva");
    const [, again] = recipeOf2(eva, "Hornear");
    assert.deepEqual([again.verb, [...again.alsoNeeds], again.inputs.get(harina!)], ["hornear", [molinoId], 2]);
    assert.equal(recipeOf2(eva, "Moler")[1].byproducts.get(salvado!), 1, "el subproducto persiste");
    assert.deepEqual([community(eva, pan!), community(eva, salvado!)], [1, 1]);
    await eva.room.leave();
  } finally {
    await server.kill();
  }
  const store = openStore(dbPath);
  const audit = store.audit();
  assert.equal(audit.balanced, true, JSON.stringify(audit));
  assert.deepEqual(Object.values(audit.produced).sort(), [1, 1, 2], "harina 2, salvado 1 y pan 1");
  store.close();
});

const recipeOf2 = (v: Viewer, name: string) => [...v.room.state.recipes.entries()].find(([, r]) => r.name === name)!;

test("límites configurables: el servidor aplica los de la configuración (entradas, subproductos, objetos y lado del solar)", async () => {
  const server = await startServer({ WORLD_CONFIG: fixture("limits-world.json"), DB_PATH: tempDb() });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinPanel(server.url, "luis");
    for (const name of ["Harina", "Salvado", "Pan"]) send(ana, MESSAGE.createItem, { name });
    await waitFor(() => luis.room.state.items.size === 4);
    send(ana, MESSAGE.createItem, { name: "Cuarto" });
    await waitFor(() => ana.rejections.includes("demasiados-objetos"));
    await sleep(1100);
    send(ana, MESSAGE.createConstruction, { ...building("Ancho", 4, 0), width: 3 });
    await waitFor(() => ana.rejections.includes("definicion-invalida"));
    send(ana, MESSAGE.createConstruction, { ...building("Molino", 4, 0), width: 2 });
    await waitFor(() => Boolean(structureNamed(luis, "Molino")));
    const [molinoId] = structureNamed(luis, "Molino")!;
    const [harina, salvado, pan] = ["Harina", "Salvado", "Pan"].map((n) => itemNamed(luis, n));
    const rejected = () => ana.rejections.filter((r) => r === "definicion-invalida").length;
    const before = rejected();
    send(ana, MESSAGE.createRecipe, { name: "Dos entradas", structureId: molinoId, inputs: { madera: 1, piedra: 1 }, output: { item: harina!, amount: 1 } });
    send(ana, MESSAGE.createRecipe, { name: "Dos subproductos", structureId: molinoId, inputs: { madera: 1 }, output: { item: harina!, amount: 1 }, byproducts: [{ item: salvado!, amount: 1 }, { item: pan!, amount: 1 }] });
    await waitFor(() => rejected() === before + 2);
    send(ana, MESSAGE.createRecipe, { name: "Una entrada", structureId: molinoId, inputs: { madera: 1 }, output: { item: harina!, amount: 1 }, byproducts: [{ item: salvado!, amount: 1 }] });
    await waitFor(() => luis.room.state.recipes.size === 2);
    await ana.room.leave();
    await luis.room.leave();
  } finally {
    await server.kill();
  }
});
