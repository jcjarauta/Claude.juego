import { test } from "node:test";
import assert from "node:assert/strict";
import { cascadePlan, dependencyGraph, keyOf, withArchived } from "../src/index.ts";
import { key, makeView } from "./edit-fixtures.ts";

// G2, P0 (TP-32): archivado en cascada. Grafo completo, orden, bloqueos con camino y forma canónica determinista.

const names = (plan: { order: { name: string }[] }) => plan.order.map((n) => n.name);

test("el grafo completo tiene nodos de los cinco tipos y las aristas usa, produce, exige, practica, pide y fabrica-en", () => {
  const g = dependencyGraph(makeView());
  assert.deepEqual([...g.nodes.keys()].sort(), [
    "edificio:horno", "edificio:molino", "edificio:taller", "habilidad:molinero", "mision:pan-10", "objeto:harina", "objeto:pan", "objeto:sal",
    "receta:hornear", "receta:moler", "receta:salar",
  ]);
  const has = (from: string, to: string, why: string) => g.edges.some((e) => e.from === from && e.to === to && e.why === why);
  assert.ok(has("receta:hornear", "objeto:harina", "usa"));
  assert.ok(has("receta:hornear", "objeto:pan", "produce"));
  assert.ok(has("receta:hornear", "edificio:horno", "fabrica-en"));
  assert.ok(has("habilidad:molinero", "receta:moler", "practica"));
  assert.ok(has("mision:pan-10", "objeto:pan", "pide"));
  assert.ok(g.edges.length > 0 && g.edges.every((e) => g.nodes.has(e.from) && g.nodes.has(e.to)));
});

test("archivar un objeto arrastra, en orden, lo que depende de él y termina por el propio objeto", () => {
  // «Pan»: lo produce «Hornear» y lo pide la misión «Diez panes»; nada depende de «Hornear»
  const plan = cascadePlan(makeView({ stock: {} }), "objeto", "pan");
  assert.deepEqual(names(plan), ["Diez panes", "Hornear", "Pan"]);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.executable, true);
  assert.equal(plan.root.name, "Pan");
  assert.deepEqual(plan.cycles, []);
});

test("el cierre es transitivo: harina → moler y hornear → la habilidad que se practica con moler", () => {
  const plan = cascadePlan(makeView({ players: [] }), "objeto", "harina");
  for (const n of ["Hornear", "Moler", "Molinero", "Harina"]) assert.ok(names(plan).includes(n), n);
  assert.equal(names(plan).at(-1), "Harina", "la raíz se archiva la última");
  assert.ok(names(plan).indexOf("Molinero") < names(plan).indexOf("Moler"), "la habilidad que practica con la receta se archiva antes que ella");
  assert.equal(plan.executable, true, "sin existencias ni personas con la habilidad no hay bloqueos");
});

test("bloqueos con el camino que los provoca: existencias, personas con la habilidad y misiones cumplidas", () => {
  const plan = cascadePlan(makeView({ stock: { harina: 4, pan: 2 }, completed: ["pan-10"] }), "objeto", "harina");
  const reasons = plan.blockers.map((b) => b.reason).join(" | ");
  assert.match(reasons, /hay 4 de «Harina» en el almacén/);
  assert.match(reasons, /1 persona tiene la habilidad «Molinero»/);
  assert.equal(plan.executable, false);
  const skill = plan.blockers.find((b) => b.node.kind === "habilidad")!;
  assert.deepEqual(skill.path, ["Molinero", "Moler", "Harina"], "camino desde el bloqueo hasta lo que se quería archivar");
  const completed = cascadePlan(makeView({ completed: ["pan-10"] }), "objeto", "pan");
  assert.match(completed.blockers.map((b) => b.reason).join(" "), /«Diez panes» ya está cumplida \(es un hecho histórico\)/);
  // personas con práctica registrada pero sin nivel también bloquean
  const practice = cascadePlan(makeView({ players: [{ name: "bea", skills: {}, crafts: { moler: 1 } }] }), "receta", "moler");
  assert.match(practice.blockers.map((b) => b.reason).join(" "), /1 persona lleva práctica de «Molinero»/);
});

test("lo archivado ya no entra; archivar algo ya archivado o inexistente no es ejecutable", () => {
  const archivedPlan = cascadePlan(makeView({ archived: [key("objeto", "pan")] }), "objeto", "pan");
  assert.equal(archivedPlan.executable, false);
  assert.match(archivedPlan.blockers[0]!.reason, /ya está archivada/);
  assert.equal(cascadePlan(makeView(), "objeto", "no-existe").executable, false);
  const partial = cascadePlan(makeView({ archived: [key("receta", "hornear")], players: [] }), "objeto", "pan");
  assert.deepEqual(names(partial), ["Diez panes", "Pan"], "la receta ya archivada no se vuelve a incluir");
});

test("ciclos: una habilidad cuya práctica exige la propia habilidad se archiva en el mismo lote sin bucle infinito", () => {
  const view = makeView({ players: [] });
  const cyc = {
    ...view,
    recipes: view.recipes.map((r) => (r.def.id === "salar" ? { ...r, def: { ...r.def, requiresSkills: [{ skill: "molinero", level: 1 }] } } : r)),
    skills: view.skills.map((s) => ({ ...s, def: { ...s.def, levels: [...s.def.levels, { name: "Maestro", practice: { recipe: "salar", times: 3 } }] } })),
  };
  const plan = cascadePlan(cyc, "receta", "moler");
  assert.deepEqual([...plan.cycles].sort(), ["habilidad:molinero", "receta:salar"], "molinero ↔ salar forman un ciclo");
  for (const n of ["Moler", "Molinero", "Salar"]) assert.ok(names(plan).includes(n), n);
  // en el lote ya no queda nada usando lo archivado
  assert.equal(plan.executable, true);
});

test("el plan y su forma canónica son deterministas: no dependen del orden de carga y cambian con cualquier dato relevante", () => {
  const base = cascadePlan(makeView({ stock: { harina: 0 } }), "objeto", "harina");
  const reversed = cascadePlan(makeView({ reverse: true }), "objeto", "harina");
  assert.equal(reversed.canonical, base.canonical);
  assert.deepEqual(reversed.order, base.order);
  assert.equal(cascadePlan(makeView(), "objeto", "harina").canonical, base.canonical, "repetible");
  const differ = (opts: Parameters<typeof makeView>[0]) => assert.notEqual(cascadePlan(makeView(opts), "objeto", "harina").canonical, base.canonical);
  differ({ stock: { harina: 1 } });
  differ({ rev: { [key("receta", "hornear")]: 5 } });
  differ({ players: [] });
  assert.notEqual(cascadePlan(makeView({ completed: ["pan-10"] }), "objeto", "pan").canonical, cascadePlan(makeView(), "objeto", "pan").canonical);
  assert.equal(cascadePlan(makeView({ completed: ["pan-10"] }), "objeto", "harina").canonical, base.canonical, "lo que no está en el cierre no invalida el plan");
  differ({ archived: [key("receta", "hornear")] });
  assert.ok(!/"actor"|"at"|"hora"/.test(base.canonical), "no incluye actor ni hora: solo estado");
});

test("withArchived simula el lote: nada del lote cuenta como 'usándolo'", () => {
  const view = makeView({ players: [] });
  const batch = new Set([keyOf("receta", "hornear"), keyOf("mision", "pan-10")]);
  const sim = withArchived(view, batch);
  assert.equal(sim.recipes.find((r) => r.def.id === "hornear")!.archived, true);
  assert.equal(view.recipes.find((r) => r.def.id === "hornear")!.archived, false, "no modifica la vista original");
  assert.equal(sim.missions.find((m) => m.def.id === "pan-10")!.archived, true);
});
