import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archivedDependencies, checkArchive, checkRestore, checkUpdateLimits, DEFAULT_BUILD_LIMITS, HARD_BUILD_LIMITS, LIMIT_KEYS, LIMIT_LABELS, scaleLevels, SKILL_SCALES,
  similarNames, usedBy, type DesignView, type ItemDef, type MissionDef, type RecipeDef, type SkillDef,
} from "../src/index.ts";

// G1, P0 (TP-31): reglas de diseño. Puras: sin red ni sala. La sala real está en apps/server/test/design.test.ts.

const ADMINS = ["ana"];

// ---------------------------------------------------------------- límites (Q237, Q238)

test("límites: techos nuevos dentro de lo que soporta el estado y con los dos del planificador", () => {
  assert.ok(HARD_BUILD_LIMITS.inputAmount <= 65535 && HARD_BUILD_LIMITS.outputAmount <= 65535, "cantidades uint16");
  assert.ok(HARD_BUILD_LIMITS.skillLevels <= 255, "niveles uint8");
  assert.deepEqual([DEFAULT_BUILD_LIMITS.plannerDepth, DEFAULT_BUILD_LIMITS.plannerRoutes], [8, 24], "los valores por omisión del planificador no cambian");
  assert.ok(HARD_BUILD_LIMITS.plannerDepth > DEFAULT_BUILD_LIMITS.plannerDepth && HARD_BUILD_LIMITS.plannerRoutes > DEFAULT_BUILD_LIMITS.plannerRoutes);
  for (const key of LIMIT_KEYS) {
    assert.ok(DEFAULT_BUILD_LIMITS[key] >= 1 && DEFAULT_BUILD_LIMITS[key] <= HARD_BUILD_LIMITS[key], `${key}: omisión dentro del techo`);
    assert.ok(LIMIT_LABELS[key].length > 3, `${key}: tiene etiqueta`);
  }
  assert.equal(Object.keys(LIMIT_LABELS).length, LIMIT_KEYS.length);
});

test("límites: solo la administración; valores enteros entre 1 y el techo; claves conocidas", () => {
  const current = { ...DEFAULT_BUILD_LIMITS };
  const run = (payload: unknown, actor = "ana") => checkUpdateLimits({ actor, admins: ADMINS, payload, current, defaults: DEFAULT_BUILD_LIMITS });
  const ok = run({ limits: { recipeInputs: 12, skillLevels: 8 } });
  assert.ok(ok.ok);
  if (ok.ok) { assert.equal(ok.limits.recipeInputs, 12); assert.equal(ok.limits.skillLevels, 8); assert.equal(ok.limits.items, current.items, "lo demás no cambia"); assert.equal(ok.changed, true); }
  assert.deepEqual(run({ limits: { recipeInputs: 2 } }, "luis"), { ok: false, reason: "sin-permiso" });
  for (const bad of [0, -1, 1.5, "5", null, NaN, HARD_BUILD_LIMITS.recipeInputs + 1]) {
    const r = run({ limits: { recipeInputs: bad } });
    assert.ok(!r.ok && r.reason === "definicion-invalida", JSON.stringify(bad));
    assert.match((!r.ok && r.details?.[0]) || "", /Entradas distintas por receta: debe ser un entero de 1 a 50/);
  }
  assert.ok(run({ limits: { recipeInputs: HARD_BUILD_LIMITS.recipeInputs } }).ok, "el techo exacto vale");
  const unknown = run({ limits: { colas: 3 } });
  assert.ok(!unknown.ok && unknown.details?.[0]?.includes("límite desconocido «colas»"));
  for (const bad of [undefined, null, {}, { limits: {} }, { limits: "x" }, { limits: [] }]) assert.deepEqual(run(bad), { ok: false, reason: "solicitud-invalida" }, JSON.stringify(bad));
});

test("límites: un cambio a lo mismo no cuenta como cambio y «restaurar» vuelve a los de la configuración", () => {
  const defaults = { ...DEFAULT_BUILD_LIMITS };
  const current = { ...defaults, recipeInputs: 30 };
  const same = checkUpdateLimits({ actor: "ana", admins: ADMINS, payload: { limits: { recipeInputs: 30 } }, current, defaults });
  assert.ok(same.ok && same.changed === false);
  const reset = checkUpdateLimits({ actor: "ana", admins: ADMINS, payload: { reset: true }, current, defaults });
  assert.ok(reset.ok);
  if (reset.ok) { assert.deepEqual(reset.limits, defaults); assert.equal(reset.changed, true); }
  const noop = checkUpdateLimits({ actor: "ana", admins: ADMINS, payload: { reset: true }, current: defaults, defaults });
  assert.ok(noop.ok && noop.changed === false);
  assert.deepEqual(checkUpdateLimits({ actor: "luis", admins: ADMINS, payload: { reset: true }, current, defaults }), { ok: false, reason: "sin-permiso" });
});

// ---------------------------------------------------------------- escalas (Q239)

test("escalas: plantillas con nombres únicos que caben en los techos y se recortan al límite vigente", () => {
  const ids = SKILL_SCALES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const scale of SKILL_SCALES) {
    assert.equal(new Set(scale.levels.map((l) => l.toLowerCase())).size, scale.levels.length, `${scale.id}: sin niveles repetidos`);
    assert.ok(scale.levels.length >= 2 && scale.levels.length <= HARD_BUILD_LIMITS.skillLevels, scale.id);
    assert.ok(scale.levels.every((l) => l.trim() === l && l.length >= 1 && l.length <= 40), `${scale.id}: nombres válidos`);
  }
  assert.deepEqual(SKILL_SCALES[0]!.levels, ["Aprendiz", "Oficial", "Maestro"]);
  assert.deepEqual(scaleLevels(SKILL_SCALES.find((s) => s.id === "cinco-grados")!, 3), ["Novato", "Aprendiz", "Competente"]);
  assert.deepEqual(scaleLevels(SKILL_SCALES[0]!, 10), ["Aprendiz", "Oficial", "Maestro"]);
  assert.equal(scaleLevels(SKILL_SCALES[0]!, 0).length, 1, "al menos un nivel");
});

// ---------------------------------------------------------------- archivar y restaurar (Q240, Q241)

const item = (id: string, name = id): ItemDef => ({ id, name });
const recipe = (id: string, over: Partial<RecipeDef> = {}): RecipeDef => ({ id, name: `Receta ${id}`, structureId: "taller", inputs: { madera: 1 }, output: { item: "pan", amount: 1 }, ...over });
const skill = (id: string, practice: string[]): SkillDef => ({ id, name: `Habilidad ${id}`, description: "", levels: practice.map((r, i) => ({ name: `Nivel ${i + 1}`, practice: { recipe: r, times: 2 } })) });
const mission = (id: string, objective: MissionDef["objective"]): MissionDef => ({ id, name: `Misión ${id}`, description: "", objective });

function view(over: Partial<Omit<DesignView, "stock">> & { archived?: string[]; stock?: Record<string, number> } = {}): DesignView {
  const archived = new Set(over.archived ?? []);
  const a = (kind: string, id: string) => archived.has(`${kind}:${id}`);
  return {
    items: [item("pan"), item("harina"), item("masa")].map((def) => ({ def, archived: a("objeto", def.id) })),
    recipes: [recipe("hornear", { inputs: { harina: 1 }, output: { item: "pan", amount: 1 } }), recipe("moler", { inputs: { trigo: 2 }, output: { item: "harina", amount: 1 }, byproducts: [{ item: "masa", amount: 1 }], requiresSkills: [{ skill: "molinero", level: 1 }] })]
      .map((def) => ({ def, archived: a("receta", def.id) })),
    skills: [skill("molinero", ["hornear"])].map((def) => ({ def, archived: a("habilidad", def.id) })),
    missions: [mission("m-pan", { kind: "item-in-community", item: "pan", amount: 2 }), mission("m-libre", { kind: "project-completed", project: "p" })].map((def) => ({ def, archived: a("mision", def.id) })),
    resourceNames: ["Madera", "Trigo"],
    stock: (id) => over.stock?.[id] ?? 0,
    ...(over.items ? { items: over.items } : {}),
  };
}

const arch = (payload: unknown, v: DesignView, actor = "ana") => checkArchive({ actor, admins: ADMINS, payload, view: v });
const rest = (payload: unknown, v: DesignView, actor = "ana") => checkRestore({ actor, admins: ADMINS, payload, view: v });

test("archivar: solo la administración y una definición conocida y activa", () => {
  const v = view();
  assert.deepEqual(arch({ kind: "mision", id: "m-libre" }, v, "luis"), { ok: false, reason: "sin-permiso" });
  for (const bad of [undefined, {}, { kind: "otro", id: "x" }, { kind: "objeto" }, { kind: "objeto", id: "" }, { kind: 3, id: "x" }]) assert.deepEqual(arch(bad, v), { ok: false, reason: "solicitud-invalida" }, JSON.stringify(bad));
  const unknown = arch({ kind: "objeto", id: "nada" }, v);
  assert.ok(!unknown.ok && unknown.reason === "definicion-invalida");
  const again = arch({ kind: "mision", id: "m-libre" }, view({ archived: ["mision:m-libre"] }));
  assert.ok(!again.ok && again.reason === "definicion-invalida" && again.details?.[0]?.includes("ya está archivada"));
});

test("archivar: una misión sin dependientes se archiva", () => {
  assert.deepEqual(arch({ kind: "mision", id: "m-libre" }, view()), { ok: true });
  assert.deepEqual(arch({ kind: "mision", id: "m-pan" }, view()), { ok: true });
});

test("archivar un objeto: no si una receta activa lo usa (entrada, salida o subproducto), una misión activa lo pide o hay existencias", () => {
  const v = view();
  const asInput = arch({ kind: "objeto", id: "harina" }, v);
  assert.ok(!asInput.ok && asInput.reason === "definicion-en-uso");
  assert.deepEqual((!asInput.ok && asInput.details) || [], ["No se puede archivar «harina»: la receta «Receta hornear» lo usa como entrada.", "No se puede archivar «harina»: la receta «Receta moler» lo usa como salida."]);
  const asOutput = arch({ kind: "objeto", id: "pan" }, v);
  assert.ok(!asOutput.ok);
  assert.ok((!asOutput.ok && asOutput.details?.some((d) => d.includes("la receta «Receta hornear» lo usa como salida") && true)) || false);
  assert.ok(!asOutput.ok && asOutput.details?.some((d) => d.includes("la misión «Misión m-pan» lo pide")));
  const byproduct = arch({ kind: "objeto", id: "masa" }, v);
  assert.ok(!byproduct.ok && byproduct.details?.[0]?.includes("lo usa como subproducto"));
  // con todo lo que lo usa ya archivado, se puede… salvo que haya existencias
  const free = view({ archived: ["receta:moler", "receta:hornear", "mision:m-pan"] });
  assert.deepEqual(arch({ kind: "objeto", id: "harina" }, free), { ok: true });
  const withStock = arch({ kind: "objeto", id: "harina" }, view({ archived: ["receta:moler", "receta:hornear", "mision:m-pan"], stock: { harina: 3 } }));
  assert.ok(!withStock.ok && withStock.details?.[0]?.includes("hay 3 en el almacén de la comunidad"));
});

test("archivar una receta: no si es la práctica de un nivel de una habilidad activa; una habilidad: no si una receta activa la exige", () => {
  const recipePractice = arch({ kind: "receta", id: "hornear" }, view());
  assert.ok(!recipePractice.ok && recipePractice.reason === "definicion-en-uso");
  assert.ok(!recipePractice.ok && recipePractice.details?.[0]?.includes("es la práctica del nivel «Nivel 1» de la habilidad «Habilidad molinero»"));
  assert.deepEqual(arch({ kind: "receta", id: "moler" }, view()), { ok: true }, "moler no es práctica de nada");
  const skillRequired = arch({ kind: "habilidad", id: "molinero" }, view());
  assert.ok(!skillRequired.ok && skillRequired.details?.[0]?.includes("la receta «Receta moler» la exige"));
  assert.deepEqual(arch({ kind: "habilidad", id: "molinero" }, view({ archived: ["receta:moler"] })), { ok: true });
});

test("usos: solo cuenta lo ACTIVO (lo archivado no impide archivar)", () => {
  assert.equal(usedBy(view({ archived: ["receta:hornear", "receta:moler", "mision:m-pan"] }), "objeto", "pan").length, 0);
  assert.equal(usedBy(view(), "mision", "m-pan").length, 0);
});

test("restaurar: solo archivadas, con nombre libre entre las activas y con las dependencias activas", () => {
  const v = view({ archived: ["objeto:harina"] });
  assert.deepEqual(rest({ kind: "objeto", id: "harina" }, v), { ok: true });
  const notArchived = rest({ kind: "objeto", id: "pan" }, v);
  assert.ok(!notArchived.ok && notArchived.reason === "definicion-invalida" && notArchived.details?.[0]?.includes("no está archivada"));
  assert.deepEqual(rest({ kind: "objeto", id: "harina" }, v, "luis"), { ok: false, reason: "sin-permiso" });
  // otro objeto activo con el mismo nombre (sin tildes ni mayúsculas)
  const clash = view({ archived: ["objeto:harina"], items: [item("pan"), { id: "harina", name: "Harina" }, { id: "harina-2", name: "HARINA" }, item("masa")].map((def) => ({ def, archived: def.id === "harina" })) });
  const clashed = rest({ kind: "objeto", id: "harina" }, clash);
  assert.ok(!clashed.ok && clashed.reason === "definicion-en-uso" && clashed.details?.[0]?.includes("Ya hay un elemento activo llamado «Harina»"));
  // un objeto no puede llamarse como un recurso
  const asResource = view({ archived: ["objeto:harina"], items: [item("pan"), { id: "harina", name: "Madera" }, item("masa")].map((def) => ({ def, archived: def.id === "harina" })) });
  assert.ok(!rest({ kind: "objeto", id: "harina" }, asResource).ok);
});

test("restaurar: lo que depende de algo archivado no se restaura hasta restaurar antes lo que necesita", () => {
  const recipeNeedsItem = view({ archived: ["receta:hornear", "objeto:harina"] });
  const r = rest({ kind: "receta", id: "hornear" }, recipeNeedsItem);
  assert.ok(!r.ok && r.reason === "definicion-en-uso" && r.details?.[0]?.includes("el objeto «harina» está archivado"));
  const recipeNeedsSkill = view({ archived: ["receta:moler", "habilidad:molinero"] });
  const s = rest({ kind: "receta", id: "moler" }, recipeNeedsSkill);
  assert.ok(!s.ok && s.details?.some((d) => d.includes("la habilidad «Habilidad molinero» está archivada")));
  const skillNeedsRecipe = view({ archived: ["habilidad:molinero", "receta:hornear"] });
  const k = rest({ kind: "habilidad", id: "molinero" }, skillNeedsRecipe);
  assert.ok(!k.ok && k.details?.[0]?.includes("la receta de práctica «Receta hornear» está archivada"));
  const missionNeedsItem = view({ archived: ["mision:m-pan", "objeto:pan"] });
  assert.ok(!rest({ kind: "mision", id: "m-pan" }, missionNeedsItem).ok);
  assert.deepEqual(archivedDependencies(view(), "receta", "hornear"), []);
  // restaurando antes lo que necesita, ya se puede
  assert.deepEqual(rest({ kind: "receta", id: "hornear" }, view({ archived: ["receta:hornear"] })), { ok: true });
});

// ---------------------------------------------------------------- posibles duplicados

test("posibles duplicados: mismo nombre sin tildes ni mayúsculas o uno contenido en otro (≥ 4 letras); solo activos; orden estable", () => {
  const entries = [
    { id: "a", name: "Harina", archived: false },
    { id: "b", name: "HARINA", archived: false },
    { id: "c", name: "Harina fina", archived: false },
    { id: "d", name: "Pan", archived: false },
    { id: "e", name: "Pan de molde", archived: false },
    { id: "f", name: "Harina", archived: true },
    { id: "g", name: "Águila", archived: false },
    { id: "h", name: "aguila", archived: false },
  ];
  const groups = similarNames("objeto", entries);
  const asText = groups.map((g) => `${g.reason}:${g.entries.map((e) => e.id).join("+")}`);
  assert.ok(asText.includes("igual:a+b"), "mayúsculas");
  assert.ok(asText.includes("igual:g+h"), "tildes");
  assert.ok(asText.includes("contenido:a+c") || asText.includes("contenido:b+c"), "«Harina» dentro de «Harina fina»");
  assert.ok(!asText.some((t) => t.includes("f")), "lo archivado no aparece");
  assert.ok(!asText.some((t) => t.includes("d+e") || t.includes("e+d")), "«Pan» tiene menos de 4 letras");
  assert.deepEqual(similarNames("objeto", entries), groups, "mismo resultado con las mismas entradas");
  assert.ok(groups.every((g) => g.kind === "objeto"));
  assert.deepEqual(similarNames("receta", [{ id: "x", name: "Moler", archived: false }]), []);
});
