import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEdit, canonical, checkEditDef, checkRestoreVersion, MAX_VERSIONS, type DefVersion, type EditResult } from "../src/index.ts";
import { ADMINS, horno, key, makeView } from "./edit-fixtures.ts";

// G2, P0 (TP-32): reglas de edición por versiones. Puras: sin red ni sala. La sala real llega en P1.

const edit = (view = makeView(), payload: Record<string, unknown> = {}, actor = "ana"): EditResult => checkEditDef({ actor, admins: ADMINS, payload, view });
/** Edita confirmando el análisis: primero pide el análisis y luego reenvía su base. */
function confirmed(view: ReturnType<typeof makeView>, payload: Record<string, unknown>): EditResult {
  const first = edit(view, payload);
  if (first.ok) return first;
  if (first.reason !== "analisis-desactualizado" || !first.analysis) return first;
  return edit(view, { ...payload, basis: first.analysis.canonical });
}
const rename = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ kind: "objeto", id, def: { name }, expectedRev: 1, ...extra });

// ---------------------------------------------------------------- reglas generales

test("solo la administración edita; el contenido y los tipos se validan antes de nada", () => {
  assert.equal((edit(makeView(), rename("harina", "Harina fina"), "luis") as { reason: string }).reason, "sin-permiso");
  for (const bad of [{}, { kind: "casa", id: "x", def: {}, expectedRev: 1 }, { ...rename("harina", "x"), expectedRev: -1 }, { ...rename("harina", "x"), expectedRev: 1.5 }, { ...rename("harina", "x"), basis: 3 }, { ...rename("harina", "x"), note: "n".repeat(201) }]) {
    assert.equal((edit(makeView(), bad) as { reason: string }).reason, "solicitud-invalida");
  }
  assert.equal((edit(makeView(), rename("no-existe", "x")) as { reason: string }).reason, "definicion-invalida");
});

test("lo de la configuración no se edita (se duplica), ni lo archivado, ni lo retirado o cerrado", () => {
  const config = edit(makeView({ origin: { [key("objeto", "harina")]: "configuracion" } }), rename("harina", "Harina fina")) as { reason: string; details: string[] };
  assert.equal(config.reason, "definicion-invalida");
  assert.match(config.details[0]!, /configuración.*duplícala/);
  const archived = edit(makeView({ archived: [key("objeto", "harina")] }), rename("harina", "Harina fina")) as { details: string[] };
  assert.match(archived.details[0]!, /archivado.*restaura la definición/);
  const construction = { kind: "construccion", id: "taller", expectedRev: 1, def: { project: {}, structure: {} } };
  assert.match((edit(makeView(), construction) as { details: string[] }).details[0]!, /configuración/);
  const retired = edit(makeView({ retired: ["horno"] }), { ...construction, id: "horno" }) as { details: string[] };
  assert.match(retired.details[0]!, /retirada/);
  const closed = edit(makeView({ closedProjects: ["horno"] }), { ...construction, id: "horno" }) as { details: string[] };
  assert.match(closed.details[0]!, /proyecto está cerrado/);
});

test("expectedRev: una revisión obsoleta se rechaza explicando qué la cambió; archivar sube la revisión pero no la versión", () => {
  const view = makeView({ rev: { [key("objeto", "harina")]: 4 }, lastChange: { [key("objeto", "harina")]: "luis la archivó y la restauró" } });
  const stale = edit(view, rename("harina", "Harina fina", { expectedRev: 3 })) as { reason: string; details: string[] };
  assert.equal(stale.reason, "version-obsoleta");
  assert.match(stale.details[0]!, /revisión vigente es la 4 y tú tenías la 3: luis la archivó/);
  const ok = confirmed(view, rename("harina", "Harina fina", { expectedRev: 4 }));
  assert.equal(ok.ok, true);
  // la versión de contenido es otra cosa: aquí sigue siendo la 1 aunque la revisión sea la 4, así que la nueva es la 2
  assert.equal((ok as { newVersion: number }).newVersion, 2);
});

test("tope de versiones y 'sin cambios'", () => {
  const full = edit(makeView({ version: { [key("objeto", "harina")]: MAX_VERSIONS } }), rename("harina", "Harina fina")) as { reason: string; details: string[] };
  assert.equal(full.reason, "definicion-invalida");
  assert.match(full.details[0]!, /100 versiones/);
  assert.match((edit(makeView(), rename("harina", "Harina")) as { details: string[] }).details[0]!, /ningún cambio/);
});

// ---------------------------------------------------------------- confirmar el análisis (basis)

test("si hay avisos o efectos hay que confirmar el análisis; la confirmación se invalida si cambia una dependencia", () => {
  const view = makeView();
  const first = edit(view, rename("harina", "Harina fina")) as { ok: false; reason: string; analysis: { avisos: string[]; efectos: string[]; canonical: string } };
  assert.equal(first.reason, "analisis-desactualizado");
  assert.match(first.analysis.avisos[0]!, /Cambia el nombre de «Harina» a «Harina fina»/);
  assert.match(first.analysis.efectos.join(" "), /Recetas que lo usan.*«Moler».*«Hornear»/);
  const basis = first.analysis.canonical;
  assert.equal(edit(view, rename("harina", "Harina fina", { basis })).ok, true, "con la base correcta se aplica");
  // otra persona archiva «Hornear» (una dependencia) mientras tanto: sube su revisión y cambia lo consultado
  const changed = makeView({ rev: { [key("receta", "hornear")]: 2 }, archived: [key("receta", "hornear")] });
  const late = edit(changed, rename("harina", "Harina fina", { basis })) as { reason: string; analysis?: { canonical: string } };
  assert.equal(late.reason, "analisis-desactualizado");
  assert.notEqual(late.analysis?.canonical, basis);
  // y la base también cambia si cambia la revisión de una dependencia sin archivarla
  const bumped = makeView({ rev: { [key("receta", "moler")]: 9 } });
  assert.equal((edit(bumped, rename("harina", "Harina fina", { basis })) as { reason: string }).reason, "analisis-desactualizado");
});

test("la base del análisis no depende del orden en que se cargaron las listas", () => {
  const a = analyzeEdit(makeView(), "objeto", "harina", { id: "harina", name: "Harina fina" });
  const b = analyzeEdit(makeView({ reverse: true }), "objeto", "harina", { id: "harina", name: "Harina fina" });
  assert.equal(a.canonical, b.canonical);
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.notEqual(canonical({ a: [1, 2] }), canonical({ a: [2, 1] }), "el orden de las listas sí cuenta");
});

// ---------------------------------------------------------------- objetos

test("objeto: renombrar respeta nombres de objetos y recursos, excluyéndose a sí mismo", () => {
  assert.equal(confirmed(makeView(), rename("harina", "HARINA fina")).ok, true);
  assert.equal(confirmed(makeView(), rename("pan", "PAN")).ok, true, "cambiar mayúsculas del propio nombre es un cambio válido");
  const taken = confirmed(makeView(), rename("harina", "pan")) as { reason: string; details: string[] };
  assert.equal(taken.reason, "definicion-invalida");
  assert.match(taken.details.join(" "), /ya existe un objeto o recurso con el nombre «pan»/);
  assert.match((confirmed(makeView(), rename("harina", "madera")) as { details: string[] }).details.join(" "), /ya existe/);
  assert.equal((confirmed(makeView(), rename("harina", "  ")) as { reason: string }).reason, "definicion-invalida");
  // un objeto archivado deja libre su nombre
  assert.equal(confirmed(makeView({ archived: [key("objeto", "pan")] }), rename("harina", "Pan")).ok, true);
});

// ---------------------------------------------------------------- recetas

const recipe = (id: string, def: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ kind: "receta", id, def, expectedRev: 1, ...extra });
const hornear = { name: "Hornear", structureId: "horno", inputs: { harina: 1 }, output: { item: "pan", amount: 1 }, verb: "hornear" };

test("receta: cambiar entradas y productos es válido y avisa de que solo afecta a lo posterior", () => {
  const result = confirmed(makeView(), recipe("hornear", { ...hornear, inputs: { harina: 2, sal: 1 } })) as { ok: true; analysis: { avisos: string[]; efectos: string[] } };
  assert.equal(result.ok, true);
  assert.match(result.analysis.avisos.join(" "), /solo a lo que se fabrique a partir de ahora/);
  assert.match(result.analysis.efectos.join(" "), /Lo ya fabricado.*no cambian/);
});

test("receta: reglas de contenido (ciclo, edificio retirado, objeto archivado, nombre repetido)", () => {
  // «moler» produce harina; hacer que consuma pan (que se produce desde harina) cierra un ciclo
  const cycle = confirmed(makeView(), recipe("moler", { name: "Moler", structureId: "molino", inputs: { pan: 1 }, output: { item: "harina", amount: 1 } })) as { reason: string; details: string[] };
  assert.equal(cycle.reason, "definicion-invalida");
  assert.match(cycle.details.join(" "), /ciclo/);
  assert.equal((confirmed(makeView({ retired: ["horno"] }), recipe("hornear", { ...hornear, inputs: { harina: 2 } })) as { reason: string }).reason, "definicion-invalida");
  assert.equal((confirmed(makeView({ archived: [key("objeto", "sal")] }), recipe("hornear", { ...hornear, inputs: { sal: 1 } })) as { reason: string }).reason, "definicion-invalida");
  assert.match((confirmed(makeView(), recipe("hornear", { ...hornear, name: "moler" })) as { details: string[] }).details.join(" "), /ya existe una receta con el nombre «moler»/);
});

test("receta: la práctica de un nivel no puede exigir esa misma habilidad (bloqueo) y se avisa de quién avanza con ella", () => {
  const blocked = edit(makeView(), recipe("moler", { name: "Moler", structureId: "molino", inputs: { piedra: 1 }, output: { item: "harina", amount: 1 }, verb: "moler", requiresSkills: [{ skill: "molinero", level: 1 }] })) as { reason: string; details: string[] };
  assert.equal(blocked.reason, "definicion-en-uso");
  assert.match(blocked.details[0]!, /práctica del nivel «Aprendiz» de «Molinero»: no puede exigir esa misma habilidad/);
  const info = confirmed(makeView(), recipe("moler", { name: "Moler", structureId: "molino", inputs: { piedra: 2 }, output: { item: "harina", amount: 1 }, verb: "moler" })) as { analysis: { avisos: string[] } };
  assert.match(info.analysis.avisos.join(" "), /práctica del nivel «Oficial» de «Molinero»: 1 persona va a por ese nivel \(1 con avance/);
});

test("receta: cambiar la salida avisa de las recetas y misiones que dependían de lo que producía", () => {
  const result = confirmed(makeView(), recipe("hornear", { ...hornear, output: { item: "sal", amount: 1 } })) as { analysis: { avisos: string[] } };
  const text = result.analysis.avisos.join(" ");
  assert.match(text, /Deja de producir «Pan» y produce «Sal»/);
  assert.match(text, /Misiones que piden «Pan»: «Diez panes»/);
});

// ---------------------------------------------------------------- habilidades

const skill = (def: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ kind: "habilidad", id: "molinero", def: { name: "Molinero", description: "", ...def }, expectedRev: 1, ...extra });
const levels = (...entries: [string, string, number][]) => entries.map(([name, recipe, times]) => ({ name, practice: { recipe, times } }));

test("habilidad: se pueden añadir niveles al final y renombrarlos, y se avisa del efecto en la práctica", () => {
  const add = confirmed(makeView(), skill({ levels: levels(["Aprendiz", "moler", 2], ["Oficial", "moler", 5], ["Maestro", "salar", 3]) })) as { ok: true; analysis: { avisos: string[]; efectos: string[] } };
  assert.equal(add.ok, true);
  assert.match(add.analysis.avisos.join(" "), /Se añade 1 nivel al final/);
  assert.match(add.analysis.efectos.join(" "), /niveles ya ganados se conservan/);
  const rename2 = confirmed(makeView(), skill({ levels: levels(["Novato", "moler", 2], ["Oficial", "moler", 5]) })) as { analysis: { avisos: string[] } };
  assert.match(rename2.analysis.avisos.join(" "), /«Aprendiz» pasa a llamarse «Novato»/);
});

test("habilidad: cambiar la práctica de un nivel dice a cuánta gente deja más cerca o más lejos", () => {
  const closer = confirmed(makeView(), skill({ levels: levels(["Aprendiz", "moler", 2], ["Oficial", "moler", 2]) })) as { analysis: { avisos: string[] } };
  assert.match(closer.analysis.avisos.join(" "), /Cambia la práctica del nivel «Oficial»: de 5 × «Moler» a 2 × «Moler» \(1 más cerca y 0 más lejos de ese nivel, de 1\)/);
  const further = confirmed(makeView(), skill({ levels: levels(["Aprendiz", "moler", 2], ["Oficial", "moler", 9]) })) as { analysis: { avisos: string[] } };
  assert.match(further.analysis.avisos.join(" "), /0 más cerca y 1 más lejos/);
});

test("habilidad: no se quitan ni reordenan niveles ocupados (el nivel solo sube)", () => {
  const view = makeView({ players: [{ name: "ana", skills: { molinero: 2 }, crafts: { moler: 9 } }] });
  const remove = edit(view, skill({ levels: levels(["Aprendiz", "moler", 2]) })) as { reason: string; details: string[] };
  assert.equal(remove.reason, "definicion-en-uso");
  assert.match(remove.details[0]!, /nivel 2 \(«Oficial»\).*no puede quedarse con 1 nivel/);
  const reorder = edit(view, skill({ levels: levels(["Oficial", "moler", 5], ["Aprendiz", "moler", 2]) })) as { reason: string; details: string[] };
  assert.equal(reorder.reason, "definicion-en-uso");
  assert.match(reorder.details.join(" "), /ocupado y no se puede cambiar de sitio/);
  // sin nadie con el nivel 2 sí se puede quitar
  assert.equal(confirmed(makeView({ players: [{ name: "ana", skills: { molinero: 1 }, crafts: {} }] }), skill({ levels: levels(["Aprendiz", "moler", 2]) })).ok, true);
});

test("habilidad: las ofertas de enseñanza pendientes se avisan (se revalidan al aceptarlas)", () => {
  const result = confirmed(makeView({ offers: [{ skill: "molinero", level: 1 }] }), skill({ levels: levels(["Aprendiz", "moler", 2], ["Oficial", "moler", 5], ["Maestro", "salar", 3]) })) as { analysis: { avisos: string[] } };
  assert.match(result.analysis.avisos.join(" "), /1 oferta de enseñanza pendiente de esta habilidad/);
});

// ---------------------------------------------------------------- misiones

test("misión: una cumplida no se edita (hecho histórico); una activa sí", () => {
  const mission = (def: Record<string, unknown>) => ({ kind: "mision", id: "pan-10", def: { name: "Diez panes", description: "", objective: { kind: "item-in-community", item: "pan", amount: 10 }, ...def }, expectedRev: 1 });
  const done = edit(makeView({ completed: ["pan-10"] }), mission({ objective: { kind: "item-in-community", item: "pan", amount: 20 } })) as { reason: string; details: string[] };
  assert.equal(done.reason, "definicion-en-uso");
  assert.match(done.details[0]!, /ya está cumplida.*hecho histórico/);
  const active = confirmed(makeView(), mission({ objective: { kind: "item-in-community", item: "pan", amount: 20 } })) as { ok: true; analysis: { avisos: string[] } };
  assert.equal(active.ok, true);
  assert.match(active.analysis.avisos[0]!, /Cambia el objetivo/);
  assert.equal((confirmed(makeView({ archived: [key("objeto", "sal")] }), mission({ objective: { kind: "item-in-community", item: "sal", amount: 1 } })) as { reason: string }).reason, "definicion-invalida");
  assert.equal((confirmed(makeView(), mission({ objective: { kind: "project-completed", project: "molino" } })).ok), true, "el proyecto del molino está abierto");
});

// ---------------------------------------------------------------- construcciones

test("construcción: solar, tareas y aportes (no se quita lo aportado ni se baja de lo aportado) y no si está construida", () => {
  const view = makeView();
  const current = horno(view);
  const make = (project: Record<string, unknown>, structure: Record<string, unknown>) => ({ kind: "construccion", id: "horno", expectedRev: 1, def: { project: { ...current.project, ...project }, structure: { ...current.structure, ...structure } } });
  assert.equal(confirmed(view, make({}, { x: 16, y: 4 })).ok, true, "mover el solar a un sitio libre");
  const overlap = confirmed(view, make({}, { x: 4, y: 0 })) as { reason: string; details: string[] };
  assert.equal(overlap.reason, "definicion-invalida");
  assert.match(overlap.details.join(" "), /ya la ocupa «Molino»/);
  const lower = confirmed(view, make({ tasks: [{ ...current.project.tasks[0]!, required: 2 }, current.project.tasks[1]!] }, {})) as { details: string[] };
  assert.match(lower.details.join(" "), /3 aportados: no puede pedir menos/);
  const removed = confirmed(view, make({ tasks: [current.project.tasks[1]!] }, {})) as { details: string[] };
  assert.match(removed.details.join(" "), /3 aportados: no se puede quitar/);
  const raise = confirmed(view, make({ tasks: [{ ...current.project.tasks[0]!, required: 9 }, current.project.tasks[1]!] }, {})) as { ok: true; analysis: { efectos: string[] } };
  assert.equal(raise.ok, true);
  assert.match(raise.analysis.efectos.join(" "), /Lo ya aportado se conserva: 3 de madera/);
  // construido: no se edita
  const built = { kind: "construccion", id: "molino", expectedRev: 1, def: { project: { ...makeView().projects[0]!.def, name: "Molino grande" }, structure: makeView().structures[0]!.def } };
  const blocked = edit(makeView(), built) as { reason: string; details: string[] };
  assert.equal(blocked.reason, "definicion-en-uso");
  assert.match(blocked.details[0]!, /ya está construido/);
});

// ---------------------------------------------------------------- volver a una versión

test("volver a una versión crea una versión nueva con el contenido de la elegida (nunca borra historial)", () => {
  const view = makeView({ version: { [key("objeto", "harina")]: 3 }, rev: { [key("objeto", "harina")]: 7 } });
  // el objeto vigente se llama «Harina»; la v1 se llamaba «Harina de trigo»
  const versions: DefVersion[] = [
    { version: 1, definition: { id: "harina", name: "Harina de trigo" }, changedBy: "ana", changedAt: 1, note: "" },
    { version: 2, definition: { id: "harina", name: "Harina integral" }, changedBy: "ana", changedAt: 2, note: "cambio" },
    { version: 3, definition: { id: "harina", name: "Harina" }, changedBy: "ana", changedAt: 3, note: "" },
  ];
  const back = (toVersion: number, extra: Record<string, unknown> = {}) => checkRestoreVersion({ actor: "ana", admins: ADMINS, view, versions, payload: { kind: "objeto", id: "harina", toVersion, expectedRev: 7, ...extra } });
  const first = back(1) as { reason: string; analysis: { canonical: string } };
  assert.equal(first.reason, "analisis-desactualizado");
  const done = back(1, { basis: first.analysis.canonical }) as { ok: true; next: { name: string }; newVersion: number; note: string };
  assert.equal(done.ok, true);
  assert.deepEqual([done.next.name, done.newVersion, done.note], ["Harina de trigo", 4, "Vuelve a la versión 1"]);
  assert.equal((back(9) as { reason: string }).reason, "definicion-invalida");
  assert.equal((checkRestoreVersion({ actor: "ana", admins: ADMINS, view, versions, payload: { kind: "objeto", id: "harina", expectedRev: 7 } }) as { reason: string }).reason, "solicitud-invalida");
  assert.equal((back(1, { expectedRev: 6 }) as { reason: string }).reason, "version-obsoleta", "también exige la revisión vigente");
});
