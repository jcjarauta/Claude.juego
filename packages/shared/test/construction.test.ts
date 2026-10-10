import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILD_LIMITS, checkCreateConstruction, checkCreateItem, checkCreateRecipe, solarProblems, validateItemDef, validateRecipeDef,
  type CreateConstructionInput, type MapContext, type StructureDef,
} from "../src/index.ts";

// F2a: editor de construcciones (Q186–Q188).

const taller: StructureDef = { id: "taller", name: "Taller", projectId: "p", x: 5, y: 5, width: 3, height: 2, color: "#a0522d" };
const map = (over: Partial<MapContext> = {}): MapContext => ({
  width: 20, height: 15, nodeCells: new Set(["3,3"]), spawn: { x: 1, y: 1 }, structures: [taller], ...over,
});

test("solar: cabe, fuera del mapa, nodo, aparición, solape y tamaño", () => {
  assert.deepEqual(solarProblems({ x: 10, y: 10, width: 2, height: 2 }, map()), []);
  assert.match(String(solarProblems({ x: 19, y: 14, width: 2, height: 1 }, map())), /fuera del mapa/);
  assert.match(String(solarProblems({ x: -1, y: 0, width: 1, height: 1 }, map())), /fuera del mapa/);
  assert.match(String(solarProblems({ x: 10, y: 10, width: 6, height: 1 }, map())), /de 1 a 5 casillas/);
  assert.match(String(solarProblems({ x: 10, y: 10, width: 1.5, height: 1 }, map())), /no válido/);
  assert.match(String(solarProblems({ x: 3, y: 3, width: 1, height: 1 }, map())), /la casilla 3,3 la ocupa un nodo/);
  assert.match(String(solarProblems({ x: 0, y: 0, width: 2, height: 2 }, map())), /punto de aparición/);
  assert.match(String(solarProblems({ x: 7, y: 6, width: 2, height: 2 }, map())), /ya la ocupa «Taller»/);
  assert.deepEqual(solarProblems({ x: 8, y: 5, width: 1, height: 1 }, map()), [], "pegado al taller pero sin solapar");
});

const construction = (over: Partial<CreateConstructionInput> = {}, payload: Record<string, unknown> = {}) => checkCreateConstruction({
  actor: "admin", admins: ["admin"], resourceIds: new Set(["madera", "piedra"]), resourceName: new Map(), openProjects: 1,
  existingProjectIds: new Set(), constructions: 0, map: map(), idSuffix: "ab12",
  payload: {
    requestId: "r1", name: "Molino", description: "", x: 10, y: 8, width: 2, height: 2, color: "#3366cc",
    tasks: [{ title: "Madera", resource: "madera", required: 3 }], ...payload,
  },
  ...over,
});

test("crear construcción: proyecto y estructura enlazados, con permiso, límite y validación conjunta", () => {
  const ok = construction();
  assert.ok(ok.ok, ok.ok ? "" : JSON.stringify(ok));
  assert.equal(ok.def.project.id, "molino-ab12");
  assert.deepEqual(ok.def.structure, { id: "molino-ab12", name: "Molino", projectId: "molino-ab12", x: 10, y: 8, width: 2, height: 2, color: "#3366cc" });
  assert.deepEqual(construction({ actor: "bea" }), { ok: false, reason: "sin-permiso" });
  assert.deepEqual(construction({ constructions: BUILD_LIMITS.constructions }), { ok: false, reason: "demasiadas-construcciones" });
  assert.deepEqual(construction({ openProjects: 20 }), { ok: false, reason: "demasiados-proyectos" });
  const overlap = construction({}, { x: 6, y: 5, width: 1, height: 1 });
  assert.ok(!overlap.ok && overlap.reason === "definicion-invalida");
  assert.match(String(overlap.details), /ya la ocupa «Taller»/);
  const both = construction({}, { x: 3, y: 3, width: 1, height: 1, color: "rojo", tasks: [] });
  assert.ok(!both.ok);
  assert.match(String(both.details), /color debe ser #rrggbb/);
  assert.match(String(both.details), /ocupa un nodo/);
  assert.match(String(both.details), /tasks debe ser una lista/, "errores del proyecto y del solar juntos");
});

test("crear objeto: nombre, id único y distinto de los recursos, límites", () => {
  const input = { actor: "admin", admins: ["admin"], resourceIds: new Set(["madera"]), itemIds: new Set(["herramienta"]), created: 0, idSuffix: "x1" };
  const ok = checkCreateItem({ ...input, payload: { requestId: "r", name: "  Harina  " } });
  assert.ok(ok.ok);
  assert.deepEqual(ok.def, { id: "harina-x1", name: "Harina" });
  assert.deepEqual(checkCreateItem({ ...input, actor: "bea", payload: { name: "Pan" } }), { ok: false, reason: "sin-permiso" });
  assert.deepEqual(checkCreateItem({ ...input, created: BUILD_LIMITS.items, payload: { name: "Pan" } }), { ok: false, reason: "demasiados-objetos" });
  for (const name of ["", "   ", "x".repeat(61), 5]) {
    const bad = checkCreateItem({ ...input, payload: { name } });
    assert.ok(!bad.ok && bad.reason === "definicion-invalida", String(name));
  }
  assert.equal(validateItemDef({ id: "madera", name: "Madera" }, { itemIds: new Set(), resourceIds: new Set(["madera"]), where: "o" }).length, 1, "igual a un recurso");
});

test("crear receta: edificio, 1–4 entradas, objeto de salida y límites", () => {
  const input = {
    actor: "admin", admins: ["admin"], resourceIds: new Set(["madera", "piedra", "fibra", "oro", "cal"]), itemIds: new Set(["harina"]),
    structureIds: new Set(["taller"]), created: 0, existingIds: new Set<string>(), idSuffix: "r1",
  };
  const recipe = (payload: Record<string, unknown> = {}, over: Partial<typeof input> = {}) => checkCreateRecipe({
    ...input, ...over, payload: { name: "Moler", structureId: "taller", inputs: { madera: 2, piedra: 1 }, output: { item: "harina", amount: 3 }, ...payload },
  });
  const ok = recipe();
  assert.ok(ok.ok);
  assert.deepEqual(ok.def, { id: "moler-r1", name: "Moler", structureId: "taller", inputs: { madera: 2, piedra: 1 }, output: { item: "harina", amount: 3 } });
  assert.deepEqual(recipe({}, { actor: "bea" }), { ok: false, reason: "sin-permiso" });
  assert.deepEqual(recipe({}, { created: BUILD_LIMITS.recipes }), { ok: false, reason: "demasiadas-recetas" });
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ structureId: "castillo" }, /estructura desconocida/],
    [{ inputs: {} }, /inputs obligatorio/],
    [{ inputs: { madera: 1, piedra: 1, fibra: 1, oro: 1, cal: 1 } }, /como máximo 4/],
    [{ inputs: { hierro: 1 } }, /recurso desconocido "hierro"/],
    [{ inputs: { madera: 101 } }, /entero 1–100/],
    [{ inputs: { madera: 0 } }, /entero 1–100/],
    [{ output: { item: "pan", amount: 1 } }, /objeto de salida desconocido/],
    [{ output: { item: "harina", amount: 101 } }, /output.amount/],
    [{ name: "" }, /name obligatorio/],
  ];
  for (const [payload, message] of cases) {
    const bad = recipe(payload);
    assert.ok(!bad.ok && bad.reason === "definicion-invalida", JSON.stringify(payload));
    assert.match(String(bad.details), message, JSON.stringify(payload));
  }
  // La configuración admite hasta 1000 por entrada; el panel, 100 (Q188).
  assert.deepEqual(validateRecipeDef({ id: "r", name: "R", structureId: "taller", inputs: { madera: 500 }, output: { item: "harina", amount: 1 } },
    { resourceIds: input.resourceIds, itemIds: input.itemIds, structureIds: input.structureIds, limits: "config", where: "recipes[0]" }), []);
});

test("crear objeto y receta: no se admiten nombres repetidos (sin mayúsculas ni acentos)", () => {
  const input = { actor: "admin", admins: ["admin"], resourceIds: new Set(["madera"]), itemIds: new Set(["harina-x1"]), takenNames: ["Harina", "Madera"], created: 1, idSuffix: "x2" };
  for (const name of ["Harina", " harina ", "HARINA", "Madera", "Hárina"]) {
    const bad = checkCreateItem({ ...input, payload: { name } });
    assert.ok(!bad.ok && bad.reason === "definicion-invalida", name);
    assert.match(String(bad.details), /ya existe un objeto o recurso/);
  }
  assert.ok(checkCreateItem({ ...input, payload: { name: "Pan" } }).ok);
  const recipe = checkCreateRecipe({
    actor: "admin", admins: ["admin"], resourceIds: new Set(["madera"]), itemIds: new Set(["harina-x1"]), structureIds: new Set(["taller"]),
    created: 0, existingIds: new Set<string>(), takenNames: ["Moler"], idSuffix: "r2",
    payload: { name: "moler", structureId: "taller", inputs: { madera: 1 }, output: { item: "harina-x1", amount: 1 } },
  });
  assert.ok(!recipe.ok && recipe.reason === "definicion-invalida");
  assert.match(String(recipe.details), /ya existe una receta/);
});
