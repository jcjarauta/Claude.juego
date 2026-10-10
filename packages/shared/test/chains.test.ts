import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkCraft, checkCreateRecipe, DEFAULT_BUILD_LIMITS, HARD_BUILD_LIMITS, recipeCycle, recipeProducts, recipeVerb, resolveBuildLimits,
  validateBuildLimits, validateRecipeDef, validateWorldConfig, type RecipeDef,
} from "../src/index.ts";

// Cadenas de producción (F2b, Q190–Q193): entradas de objetos, ciclos, verbo, edificios extra, subproductos y límites configurables.

const ctx = {
  resourceIds: new Set(["madera", "piedra", "fibra"]),
  itemIds: new Set(["harina", "salvado", "pan", "masa"]),
  structureIds: new Set(["molino", "obrador", "horno"]),
};
const recipe = (over: Record<string, unknown> = {}) => ({
  id: "r", name: "R", structureId: "molino", inputs: { madera: 1 }, output: { item: "harina", amount: 1 }, ...over,
});
const errorsOf = (r: unknown, buildLimits = DEFAULT_BUILD_LIMITS) => validateRecipeDef(r, { ...ctx, limits: "panel", buildLimits, where: "receta" }).join(" | ");

test("las entradas pueden ser recursos u objetos; una entrada desconocida se rechaza", () => {
  assert.equal(errorsOf(recipe({ structureId: "obrador", inputs: { harina: 2, madera: 1 }, output: { item: "pan", amount: 1 } })), "");
  assert.match(errorsOf(recipe({ inputs: { hierro: 1 } })), /entrada desconocida "hierro"/);
  assert.match(errorsOf(recipe({ inputs: { harina: 0 } })), /entero 1–100/);
});

test("la salida no puede ser también entrada ni repetirse como subproducto", () => {
  assert.match(errorsOf(recipe({ inputs: { harina: 1 } })), /a la vez entrada y salida/);
  assert.match(errorsOf(recipe({ inputs: { madera: 1, salvado: 1 }, byproducts: [{ item: "salvado", amount: 1 }] })), /a la vez entrada y salida/);
  assert.match(errorsOf(recipe({ byproducts: [{ item: "harina", amount: 1 }] })), /ya es otra salida/);
  assert.match(errorsOf(recipe({ byproducts: [{ item: "salvado", amount: 1 }, { item: "salvado", amount: 2 }] })), /ya es otra salida/);
});

test("subproductos: objeto conocido, cantidad en rango y como máximo el límite", () => {
  assert.equal(errorsOf(recipe({ byproducts: [{ item: "salvado", amount: 2 }] })), "");
  assert.match(errorsOf(recipe({ byproducts: [{ item: "oro", amount: 1 }] })), /objeto desconocido/);
  assert.match(errorsOf(recipe({ byproducts: [{ item: "salvado", amount: 101 }] })), /entero 1–100/);
  assert.match(errorsOf(recipe({ byproducts: [{ item: "salvado", amount: 1 }, { item: "pan", amount: 1 }, { item: "masa", amount: 1 }] })), /como máximo 2 subproductos/);
  assert.match(errorsOf(recipe({ byproducts: "salvado" })), /como máximo 2 subproductos/);
  assert.deepEqual(recipeProducts({ output: { item: "harina", amount: 1 }, byproducts: [{ item: "salvado", amount: 2 }] }),
    [{ item: "harina", amount: 1 }, { item: "salvado", amount: 2 }]);
});

test("verbo: texto de 1 a 20 caracteres; por omisión «Fabricar»", () => {
  assert.equal(errorsOf(recipe({ verb: "Moler" })), "");
  for (const verb of ["", "   ", "x".repeat(21), 5]) assert.match(errorsOf(recipe({ verb })), /verb debe ser un texto/, String(verb));
  assert.equal(recipeVerb({}), "Fabricar");
  assert.equal(recipeVerb({ verb: " Moler " }), "Moler");
});

test("edificios extra: existen, distintos del principal y entre sí, y como máximo el límite", () => {
  assert.equal(errorsOf(recipe({ structureId: "obrador", alsoNeeds: ["horno"] })), "");
  assert.match(errorsOf(recipe({ alsoNeeds: ["castillo"] })), /edificio extra desconocido/);
  assert.match(errorsOf(recipe({ alsoNeeds: ["molino"] })), /es el principal/);
  assert.match(errorsOf(recipe({ alsoNeeds: ["horno", "horno"] })), /repetido/);
  assert.match(errorsOf(recipe({ structureId: "molino", alsoNeeds: ["obrador", "horno", "molino"] })), /como máximo 2 edificios/);
});

test("ciclos: directo y a través de varias recetas, con el camino", () => {
  const existing: RecipeDef[] = [
    { id: "moler", name: "Moler", structureId: "molino", inputs: { madera: 1 }, output: { item: "harina", amount: 1 } },
    { id: "amasar", name: "Amasar", structureId: "obrador", inputs: { harina: 2 }, output: { item: "masa", amount: 1 } },
  ];
  const hornear: RecipeDef = { id: "hornear", name: "Hornear", structureId: "horno", inputs: { masa: 1 }, output: { item: "pan", amount: 1 } };
  assert.equal(recipeCycle(existing, hornear), undefined, "una cadena lineal no es un ciclo");
  // harina ← masa ← pan ← harina: moler consumiría pan.
  const cerrar: RecipeDef = { id: "cerrar", name: "Cerrar", structureId: "molino", inputs: { pan: 1 }, output: { item: "harina", amount: 1 } };
  assert.deepEqual(recipeCycle([...existing, hornear], cerrar), ["harina", "pan", "masa", "harina"]);
  // Un subproducto también cuenta: la receta deja masa y consume pan.
  const sub: RecipeDef = { id: "sub", name: "Sub", structureId: "molino", inputs: { pan: 1 }, output: { item: "salvado", amount: 1 }, byproducts: [{ item: "masa", amount: 1 }] };
  assert.ok(recipeCycle([...existing, hornear], sub));
  // Recetas distintas para un mismo producto no son un ciclo.
  const otra: RecipeDef = { id: "otra", name: "Otra", structureId: "molino", inputs: { fibra: 1 }, output: { item: "harina", amount: 1 } };
  assert.equal(recipeCycle(existing, otra), undefined);
});

test("crear receta: rechaza un ciclo y nombra el camino con los nombres de los objetos", () => {
  const names: Record<string, string> = { harina: "Harina", masa: "Masa", pan: "Pan" };
  const recipes: RecipeDef[] = [
    { id: "amasar", name: "Amasar", structureId: "obrador", inputs: { harina: 1 }, output: { item: "masa", amount: 1 } },
    { id: "hornear", name: "Hornear", structureId: "horno", inputs: { masa: 1 }, output: { item: "pan", amount: 1 } },
  ];
  const input = {
    actor: "admin", admins: ["admin"], ...ctx, created: 0, existingIds: new Set(recipes.map((r) => r.id)), recipes, entryName: (id: string) => names[id] ?? id, idSuffix: "c1",
  };
  const bad = checkCreateRecipe({ ...input, payload: { name: "Deshornear", structureId: "molino", inputs: { pan: 1 }, output: { item: "harina", amount: 1 } } });
  assert.ok(!bad.ok && bad.reason === "definicion-invalida");
  assert.match(String(bad.details), /forma un ciclo: Harina → Pan → Masa → Harina/);
  const ok = checkCreateRecipe({
    ...input, payload: { name: "Moler", structureId: "molino", inputs: { madera: 1 }, output: { item: "harina", amount: 2 }, verb: " moler ", alsoNeeds: ["obrador"], byproducts: [{ item: "salvado", amount: 1 }] },
  });
  assert.ok(ok.ok);
  assert.deepEqual(ok.def, {
    id: "moler-c1", name: "Moler", structureId: "molino", inputs: { madera: 1 }, output: { item: "harina", amount: 2 }, verb: "moler", alsoNeeds: ["obrador"], byproducts: [{ item: "salvado", amount: 1 }],
  });
});

test("fabricar: faltan edificios extra con su nombre; con todos construidos se sigue con los materiales", () => {
  const def: RecipeDef = { id: "hornear", name: "Hornear", structureId: "obrador", inputs: { harina: 2 }, output: { item: "pan", amount: 1 }, alsoNeeds: ["horno"] };
  const obrador = { id: "obrador", name: "Obrador", projectId: "p", x: 5, y: 5, width: 2, height: 2, color: "#aa5500" };
  const base = { recipe: def, structure: obrador, structureBuilt: true, position: { x: 4, y: 5 }, stock: () => 5 };
  const sinHorno = checkCraft({ ...base, extraBuildings: [{ id: "horno", name: "Horno", built: false }] });
  assert.deepEqual(sinHorno, { ok: false, reason: "faltan-edificios", details: ["Falta construir: Horno."] });
  assert.equal(checkCraft({ ...base, extraBuildings: [{ id: "horno", name: "Horno", built: true }] }).ok, true);
  assert.deepEqual(checkCraft({ ...base, stock: () => 1, extraBuildings: [{ id: "horno", name: "Horno", built: true }] }), { ok: false, reason: "faltan-materiales" });
  // El orden de comprobación no cambia: sin el edificio principal, antes que los extra.
  assert.equal(checkCraft({ ...base, structureBuilt: false, extraBuildings: [{ id: "horno", name: "Horno", built: false }] }).ok, false);
  assert.equal(checkCraft({ ...base, recipe: { ...def, alsoNeeds: undefined } }).ok, true, "sin edificios extra no se exige ninguno");
});

test("límites configurables: por omisión, parciales, techos duros y efecto en la validación", () => {
  assert.deepEqual(resolveBuildLimits(undefined), DEFAULT_BUILD_LIMITS);
  assert.deepEqual(resolveBuildLimits({ recipeInputs: 6 }), { ...DEFAULT_BUILD_LIMITS, recipeInputs: 6 });
  assert.deepEqual(validateBuildLimits(undefined), []);
  assert.deepEqual(validateBuildLimits({ recipeInputs: 6, byproducts: 3 }), []);
  assert.deepEqual(validateBuildLimits({ recipeInputs: HARD_BUILD_LIMITS.recipeInputs }), []);
  for (const bad of [{ recipeInputs: 0 }, { recipeInputs: 11 }, { inputAmount: 1001 }, { items: 1.5 }, { recipes: "20" }, { side: -1 }]) {
    assert.ok(validateBuildLimits(bad).length, JSON.stringify(bad));
  }
  assert.match(validateBuildLimits({ colas: 3 }).join(), /límite desconocido "colas"/);
  assert.match(validateBuildLimits([]).join(), /debe ser un objeto/);

  const six = { madera: 1, piedra: 1, fibra: 1, harina: 1, salvado: 1, pan: 1 };
  const manyInputs = recipe({ inputs: six, output: { item: "masa", amount: 1 } });
  assert.match(errorsOf(manyInputs), /como máximo 4 entradas/);
  assert.equal(errorsOf(manyInputs, { ...DEFAULT_BUILD_LIMITS, recipeInputs: 6 }), "");
  assert.match(errorsOf(recipe({ inputs: { madera: 1, piedra: 1, fibra: 1 } }), { ...DEFAULT_BUILD_LIMITS, recipeInputs: 2 }), /como máximo 2 entradas/);
  assert.match(errorsOf(recipe({ inputs: { madera: 300 } })), /entero 1–100/);
  assert.equal(errorsOf(recipe({ inputs: { madera: 300 } }), { ...DEFAULT_BUILD_LIMITS, inputAmount: 500 }), "");
});

test("la configuración del mundo: sección buildLimits opcional, validada, y ciclos entre recetas", () => {
  const world = () => JSON.parse(readFileSync(new URL("../../../content/world.json", import.meta.url), "utf8")) as Record<string, unknown>;
  const plain = validateWorldConfig(world());
  assert.ok(plain.ok);
  assert.deepEqual(plain.config.buildLimits, DEFAULT_BUILD_LIMITS, "sin sección, los valores por omisión");

  const partial = validateWorldConfig({ ...world(), buildLimits: { recipeInputs: 6 } });
  assert.ok(partial.ok);
  assert.equal(partial.config.buildLimits.recipeInputs, 6);
  assert.equal(partial.config.buildLimits.items, DEFAULT_BUILD_LIMITS.items);

  const invalid = validateWorldConfig({ ...world(), buildLimits: { recipeInputs: 99, colas: 1 } });
  assert.ok(!invalid.ok);
  assert.match(invalid.errors.join(" | "), /buildLimits.recipeInputs debe ser un entero 1–10/);
  assert.match(invalid.errors.join(" | "), /límite desconocido "colas"/);

  const w = world() as { items: unknown[]; recipes: { id: string; name?: string; structureId: string; inputs: Record<string, number>; output: { item: string; amount: number } }[] };
  const taller = w.recipes[0]!.structureId;
  w.items.push({ id: "pan", name: "Pan" }, { id: "harina", name: "Harina" });
  w.recipes.push(
    { id: "moler", name: "Moler", structureId: taller, inputs: { pan: 1 }, output: { item: "harina", amount: 1 } },
    { id: "hornear", name: "Hornear", structureId: taller, inputs: { harina: 1 }, output: { item: "pan", amount: 1 } },
  );
  const cyc = validateWorldConfig(w);
  assert.ok(!cyc.ok);
  assert.match(cyc.errors.join(" | "), /forma un ciclo: pan → harina → pan/);
});
