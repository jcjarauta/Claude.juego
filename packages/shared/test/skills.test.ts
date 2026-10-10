import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkCraft, checkCreateRecipe, checkCreateSkill, checkGrantSkill, checkTeach, DEFAULT_BUILD_LIMITS, levelAfterCraft, missingSkills,
  practiceProgress, resolveBuildLimits, skillRequirementText, validateBuildLimits, validateRecipeDef, validateSkillDef, validateWorldConfig,
  type RecipeDef, type SkillDef,
} from "../src/index.ts";

// Habilidades (F2c, Q195–Q199).

const recipe = (id: string, over: Partial<RecipeDef> = {}): RecipeDef => ({
  id, name: id, structureId: "molino", inputs: { madera: 1 }, output: { item: "harina", amount: 1 }, ...over,
});
const recipes = new Map<string, RecipeDef>([
  ["moler-a-mano", recipe("moler-a-mano")],
  ["moler", recipe("moler")],
  ["moler-grueso", recipe("moler-grueso")],
  ["moler-oficio", recipe("moler-oficio", { requiresSkills: [{ skill: "molinero", level: 1 }] })],
  ["moler-fino", recipe("moler-fino", { requiresSkills: [{ skill: "molinero", level: 2 }] })],
]);
const molinero: SkillDef = {
  id: "molinero", name: "Molinero", description: "",
  levels: [
    { name: "Aprendiz", practice: { recipe: "moler-a-mano", times: 3 } },
    { name: "Oficial", practice: { recipe: "moler", times: 3 } },
    { name: "Maestro", practice: { recipe: "moler-grueso", times: 2 } },
  ],
};
const skills = new Map([["molinero", molinero]]);
const skillErrors = (def: unknown, rs = recipes) => validateSkillDef(def, { recipes: rs, limits: "panel", where: "habilidad" }).join(" | ");

test("validar habilidad: niveles, nombres y receta de práctica", () => {
  assert.equal(skillErrors(molinero), "");
  assert.match(skillErrors({ ...molinero, levels: [] }), /de 1 a 3 niveles/);
  assert.match(skillErrors({ ...molinero, levels: [1, 2, 3, 4].map((i) => ({ name: `N${i}`, practice: { recipe: "moler-a-mano", times: 1 } })) }), /de 1 a 3 niveles/);
  assert.match(skillErrors({ ...molinero, levels: [{ name: "A", practice: { recipe: "no-existe", times: 1 } }] }), /receta de práctica es desconocida/);
  assert.match(skillErrors({ ...molinero, levels: [{ name: "A", practice: { recipe: "moler-a-mano", times: 0 } }] }), /times debe ser un entero/);
  assert.match(skillErrors({ ...molinero, levels: [{ name: "", practice: { recipe: "moler-a-mano", times: 1 } }] }), /name obligatorio/);
  assert.match(skillErrors({ ...molinero, levels: [
    { name: "Oficial", practice: { recipe: "moler-a-mano", times: 1 } }, { name: "óficial", practice: { recipe: "moler-a-mano", times: 1 } }] }), /nombre repetido/);
  assert.match(skillErrors({ ...molinero, name: "" }), /name obligatorio/);
});

test("las recetas de práctica son abiertas: no pueden exigir la propia habilidad", () => {
  assert.match(skillErrors({ ...molinero, levels: [{ name: "A", practice: { recipe: "moler-oficio", times: 1 } }] }), /no puede exigir esta misma habilidad/);
  assert.match(skillErrors({ ...molinero, levels: [
    { name: "A", practice: { recipe: "moler-a-mano", times: 1 } }, { name: "B", practice: { recipe: "moler-fino", times: 1 } }] }), /no puede exigir esta misma habilidad/);
  // Exigir otra habilidad sí está permitido.
  assert.equal(skillErrors({ ...molinero, id: "panadero", levels: [{ name: "A", practice: { recipe: "moler-oficio", times: 1 } }] }), "");
});

test("receta con habilidades: existe, nivel válido, sin repetir y como máximo el límite", () => {
  const ctx = { resourceIds: new Set(["madera", "piedra"]), itemIds: new Set(["harina"]), structureIds: new Set(["molino"]), skills, limits: "panel" as const, where: "receta" };
  const errors = (requiresSkills: unknown, buildLimits = DEFAULT_BUILD_LIMITS) =>
    validateRecipeDef({ ...recipe("r"), requiresSkills }, { ...ctx, buildLimits }).join(" | ");
  assert.equal(errors([{ skill: "molinero", level: 2 }]), "");
  assert.match(errors([{ skill: "panadero", level: 1 }]), /habilidad desconocida/);
  assert.match(errors([{ skill: "molinero", level: 4 }]), /nivel debe ser un entero 1–3/);
  assert.match(errors([{ skill: "molinero", level: 0 }]), /nivel debe ser un entero 1–3/);
  assert.match(errors([{ skill: "molinero", level: 1 }, { skill: "molinero", level: 2 }]), /repetida/);
  assert.match(errors("molinero"), /requiresSkills debe ser una lista/);
  const two = new Map([...skills, ["panadero", { ...molinero, id: "panadero" }]]);
  const three = [{ skill: "molinero", level: 1 }, { skill: "panadero", level: 1 }, { skill: "x", level: 1 }];
  assert.match(errors(three), /como máximo 2 habilidades/);
  assert.equal(validateRecipeDef({ ...recipe("r"), requiresSkills: [{ skill: "molinero", level: 1 }, { skill: "panadero", level: 2 }] }, { ...ctx, skills: two }).join(), "");
  assert.equal(validateRecipeDef({ ...recipe("r"), requiresSkills: three.slice(0, 2) }, { ...ctx, skills: two, buildLimits: { ...DEFAULT_BUILD_LIMITS, recipeSkills: 1 } }).length, 1, "límite configurado");
});

test("qué falta: texto de cada habilidad y de lo que exige una receta", () => {
  const needs = recipe("r", { requiresSkills: [{ skill: "molinero", level: 2 }] });
  assert.deepEqual(missingSkills(needs, skills, () => 0), ["Molinero (Oficial); no la tienes"]);
  assert.deepEqual(missingSkills(needs, skills, () => 1), ["Molinero (Oficial); tienes Aprendiz"]);
  assert.deepEqual(missingSkills(needs, skills, () => 2), []);
  assert.deepEqual(missingSkills(needs, skills, () => 3), []);
  assert.deepEqual(missingSkills(recipe("libre"), skills, () => 0), []);
  assert.equal(skillRequirementText(needs, skills), "Molinero (Oficial)");
});

test("fabricar: sin el nivel pedido → falta-habilidad con detalle; con él, se sigue", () => {
  const structure = { id: "molino", name: "Molino", projectId: "p", x: 5, y: 5, width: 2, height: 2, color: "#aa5500" };
  const base = { recipe: recipes.get("moler-oficio")!, structure, structureBuilt: true, position: { x: 4, y: 5 }, stock: () => 9, skills };
  assert.deepEqual(checkCraft({ ...base, skillLevel: () => 0 }), { ok: false, reason: "falta-habilidad", details: ["Te falta la habilidad Molinero (Aprendiz); no la tienes."] });
  assert.equal(checkCraft({ ...base, skillLevel: () => 1 }).ok, true);
  assert.equal(checkCraft({ ...base, recipe: recipes.get("moler-a-mano")!, skillLevel: () => 0 }).ok, true, "sin requisitos no se exige nada");
  assert.equal(checkCraft({ ...base, skillLevel: () => 1, stock: () => 0 }).ok, false);
  assert.deepEqual(checkCraft({ ...base, skillLevel: () => 0, stock: () => 0 }), { ok: false, reason: "falta-habilidad", details: ["Te falta la habilidad Molinero (Aprendiz); no la tienes."] }, "la habilidad se comprueba antes que los materiales");
});

test("practicar: umbral exacto, cada nivel con su receta y varios niveles de golpe", () => {
  const counts: Record<string, number> = {};
  const craft = (id: string, level: number) => { counts[id] = (counts[id] ?? 0) + 1; return levelAfterCraft(molinero, level, id, (r) => counts[r] ?? 0); };
  assert.equal(craft("moler-a-mano", 0), 0);
  assert.equal(craft("moler-a-mano", 0), 0);
  assert.equal(craft("moler-a-mano", 0), 1, "a la tercera sube al nivel 1");
  assert.equal(craft("moler-a-mano", 1), 1, "la receta del nivel 1 ya no sube más");
  assert.equal(craft("moler", 1), 1);
  assert.equal(craft("moler", 1), 1);
  assert.equal(craft("moler", 1), 2, "la tercera con «moler» sube al nivel 2");
  assert.equal(craft("moler-grueso", 2), 2);
  assert.equal(craft("moler-grueso", 2), 3);
  assert.equal(craft("moler-grueso", 3), 3, "nivel máximo");
  // Con cuentas previas, un ascenso puede arrastrar el siguiente.
  const prior: Record<string, number> = { "moler-a-mano": 3, moler: 3 };
  assert.equal(levelAfterCraft(molinero, 0, "moler-a-mano", (r) => prior[r] ?? 0), 2, "las cuentas ya hechas cuentan");
  assert.equal(levelAfterCraft(molinero, 0, "moler", (r) => prior[r] ?? 0), 0, "una receta que no es la del nivel siguiente no sube");
  const progress = practiceProgress(molinero, 1, (r) => (r === "moler" ? 2 : 0));
  assert.deepEqual(progress, { nextLevel: 2, name: "Oficial", recipe: "moler", times: 3, done: 2 });
  assert.equal(practiceProgress(molinero, 3, () => 0), undefined);
});

test("crear habilidad: solo administración, límites, nombres y niveles con práctica", () => {
  const input = { actor: "admin", admins: ["admin"], recipes, existingIds: new Set<string>(), takenNames: ["Panadero"], created: 0, idSuffix: "s1" };
  const payload = { requestId: "r", name: " Molinero ", description: "Muele.", levels: [{ name: "Aprendiz", recipe: "moler-a-mano", times: 3 }, { name: "Oficial", recipe: "moler", times: 3 }] };
  const ok = checkCreateSkill({ ...input, payload });
  assert.ok(ok.ok);
  assert.deepEqual(ok.def, { id: "molinero-s1", name: "Molinero", description: "Muele.", levels: [
    { name: "Aprendiz", practice: { recipe: "moler-a-mano", times: 3 } }, { name: "Oficial", practice: { recipe: "moler", times: 3 } }] });
  assert.deepEqual(checkCreateSkill({ ...input, actor: "bea", payload }), { ok: false, reason: "sin-permiso" });
  assert.deepEqual(checkCreateSkill({ ...input, created: DEFAULT_BUILD_LIMITS.skills, payload }), { ok: false, reason: "demasiadas-habilidades" });
  const dup = checkCreateSkill({ ...input, payload: { ...payload, name: "panadero" } });
  assert.ok(!dup.ok && dup.reason === "definicion-invalida");
  assert.match(String(dup.details), /ya existe una habilidad/);
  for (const bad of [{ ...payload, levels: [] }, { ...payload, levels: "x" }, { ...payload, name: "" }]) {
    const r = checkCreateSkill({ ...input, payload: bad });
    assert.ok(!r.ok && r.reason === "definicion-invalida", JSON.stringify(bad).slice(0, 60));
  }
  const crafted = resolveBuildLimits({ skillLevels: 2 });
  assert.ok(!checkCreateSkill({ ...input, limits: crafted, payload: { ...payload, levels: [...payload.levels, { name: "Maestro", recipe: "moler-fino", times: 1 }] } }).ok);
});

test("conceder: solo la administración, cuenta existente, nivel válido y solo sube", () => {
  const input = { actor: "admin", admins: ["admin"], skills, account: "bea", currentLevel: 0 };
  const ok = checkGrantSkill({ ...input, payload: { name: "bea", skill: "molinero", level: 2 } });
  assert.deepEqual(ok, { ok: true, def: { target: "bea", skill: "molinero", level: 2 } });
  assert.deepEqual(checkGrantSkill({ ...input, actor: "bea", payload: { skill: "molinero", level: 1 } }), { ok: false, reason: "sin-permiso" });
  assert.equal(checkGrantSkill({ ...input, account: undefined, payload: { skill: "molinero", level: 1 } }).ok, false, "sin cuenta");
  for (const payload of [{ skill: "panadero", level: 1 }, { skill: "molinero", level: 0 }, { skill: "molinero", level: 4 }, { skill: "molinero", level: 1.5 }]) {
    const r = checkGrantSkill({ ...input, payload });
    assert.ok(!r.ok && r.reason === "solicitud-invalida" && r.details?.length, JSON.stringify(payload));
  }
  const same = checkGrantSkill({ ...input, currentLevel: 2, payload: { skill: "molinero", level: 2 } });
  assert.ok(!same.ok && same.reason === "definicion-invalida");
  assert.match(String(same.details), /solo sube/);
  assert.equal(checkGrantSkill({ ...input, currentLevel: 1, payload: { skill: "molinero", level: 3 } }).ok, true, "se puede saltar niveles al conceder");
});

test("enseñar: cerca, conectados, un nivel por debajo del maestro y de un nivel en un nivel", () => {
  const base = { teacher: "ana", learner: "bea", skill: molinero, teacherLevel: 3, learnerLevel: 0, teacherAt: { x: 5, y: 5 }, learnerAt: { x: 6, y: 6 }, bothConnected: true };
  assert.deepEqual(checkTeach(base), { ok: true, toLevel: 1 });
  assert.deepEqual(checkTeach({ ...base, learnerLevel: 1 }), { ok: true, toLevel: 2 });
  const no = (over: object) => { const r = checkTeach({ ...base, ...over }); assert.ok(!r.ok); return r.details.join(); };
  assert.match(no({ learnerLevel: 2 }), /Solo puedes enseñar hasta Oficial/, "el maestro (3) enseña hasta el 2");
  assert.match(no({ teacherLevel: 1 }), /aún no puedes enseñar/, "un aprendiz no enseña");
  assert.match(no({ teacherLevel: 2, learnerLevel: 1 }), /Solo puedes enseñar hasta Aprendiz/);
  assert.match(no({ learnerAt: { x: 8, y: 5 } }), /está lejos/);
  assert.equal(checkTeach({ ...base, learnerAt: { x: 7, y: 7 } }).ok, true, "a 2 casillas en diagonal");
  assert.match(no({ bothConnected: false }), /no está conectado/);
  assert.match(no({ learner: "ana" }), /a ti mismo/);
  assert.match(no({ skill: undefined }), /no existe/);
  assert.match(no({ skill: { ...molinero, levels: molinero.levels.slice(0, 2) }, learnerLevel: 2, teacherLevel: 3 }), /último nivel/);
});

test("crear receta con habilidades y configuración del mundo con habilidades de serie", () => {
  const input = {
    actor: "admin", admins: ["admin"], resourceIds: new Set(["madera"]), itemIds: new Set(["harina"]), structureIds: new Set(["molino"]),
    created: 0, existingIds: new Set<string>(), skills, idSuffix: "k1",
  };
  const ok = checkCreateRecipe({ ...input, payload: { name: "Moler fino", structureId: "molino", inputs: { madera: 1 }, output: { item: "harina", amount: 1 }, requiresSkills: [{ skill: "molinero", level: 2 }] } });
  assert.ok(ok.ok);
  assert.deepEqual(ok.def.requiresSkills, [{ skill: "molinero", level: 2 }]);
  const bad = checkCreateRecipe({ ...input, payload: { name: "X", structureId: "molino", inputs: { madera: 1 }, output: { item: "harina", amount: 1 }, requiresSkills: [{ skill: "panadero", level: 1 }] } });
  assert.ok(!bad.ok && bad.reason === "definicion-invalida");

  const world = () => JSON.parse(readFileSync(new URL("../../../content/world.json", import.meta.url), "utf8")) as Record<string, unknown> & { recipes: RecipeDef[] };
  assert.deepEqual((validateWorldConfig(world()) as { config: { skills: unknown[] } }).config.skills, [], "por omisión, sin habilidades");
  const w = world();
  const taller = w.recipes[0]!;
  w.skills = [{ id: "herrero", name: "Herrero", description: "", levels: [{ name: "Aprendiz", practice: { recipe: taller.id, times: 2 } }] }];
  assert.ok(validateWorldConfig(w).ok);
  w.recipes.push({ ...taller, id: "forjar", name: "Forjar", output: taller.output, requiresSkills: [{ skill: "herrero", level: 1 }] });
  assert.ok(validateWorldConfig(w).ok, "una receta puede exigir una habilidad de serie");
  w.skills = [{ id: "herrero", name: "Herrero", description: "", levels: [{ name: "Aprendiz", practice: { recipe: "forjar", times: 2 } }] }];
  const impossible = validateWorldConfig(w);
  assert.ok(!impossible.ok);
  assert.match(impossible.errors.join(" | "), /no puede exigir esta misma habilidad/);
  w.recipes[w.recipes.length - 1]!.requiresSkills = [{ skill: "fantasma", level: 1 }];
  assert.match(String((validateWorldConfig(w) as { errors: string[] }).errors), /habilidad desconocida/);
});

test("límites de habilidades configurables", () => {
  assert.deepEqual(validateBuildLimits({ skills: 20, skillLevels: 5, recipeSkills: 3 }), []);
  for (const bad of [{ skills: 101 }, { skillLevels: 7 }, { recipeSkills: 6 }, { skillLevels: 0 }]) assert.ok(validateBuildLimits(bad).length, JSON.stringify(bad));
  assert.equal(resolveBuildLimits(undefined).skillLevels, 3);
});
