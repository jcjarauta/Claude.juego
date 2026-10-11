import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRetire, checkRestoreStructure, checkRetireStructure, RETIRE_PRESERVES } from "../src/index.ts";
import { ADMINS, key, makeView } from "./edit-fixtures.ts";

// G2, P0 (TP-32): retirada de edificios. Lo operativo cambia; lo histórico se conserva y se lista como tal.

const retire = (view = makeView(), structureId = "molino", extra: Record<string, unknown> = {}, actor = "ana") =>
  checkRetireStructure({ actor, admins: ADMINS, view, payload: { structureId, expectedRev: 1, ...extra } });

test("el análisis separa el estado operativo (cambia) de los resultados históricos (se conservan)", () => {
  // «Molino» está construido, lo usan «Moler» y «Salar»; hay una misión de proyecto completada y otra activa
  const view = makeView({ completed: ["pan-10"], contributed: { "molino:madera": 4 } });
  const a = analyzeRetire(view, "molino");
  assert.deepEqual(a.operativo.recetas, ["«Moler» (se fabrica en «Molino»)", "«Salar» (se fabrica en «Molino»)"]);
  assert.deepEqual(a.operativo.tareasPendientes, [], "construido: no hay tareas pendientes");
  assert.match(a.operativo.objetivos.join(" "), /«Moler», «Salar» quedarán bloqueados/);
  assert.match(a.operativo.objetivos.join(" "), /Cada navegador avisa/);
  assert.deepEqual(a.historico.aportaciones, ["4 de madera"]);
  assert.match(a.historico.construccion, /Está construido/);
  assert.deepEqual(a.historico.conservado, [...RETIRE_PRESERVES]);
  assert.deepEqual(a.bloqueos, []);
});

test("una misión de proyecto ya completada es un hecho histórico; una activa pasa a depender de lo operativo", () => {
  const withMissions = (completed: boolean) => {
    const view = makeView({ completed: completed ? ["m-molino"] : [] });
    return {
      ...view,
      missions: [...view.missions, { def: { id: "m-molino", name: "Levantar el molino", description: "", objective: { kind: "project-completed" as const, project: "molino" } }, archived: false }],
    };
  };
  const done = analyzeRetire(withMissions(true), "molino");
  assert.deepEqual(done.historico.misionesCompletadas, ["«Levantar el molino»"], "completada: se conserva como resultado histórico");
  assert.ok(!done.operativo.misionesActivas.some((m) => m.includes("Levantar el molino")), "y NO aparece como misión activa afectada");
  const active = analyzeRetire(withMissions(false), "molino");
  assert.ok(active.operativo.misionesActivas.some((m) => m.includes("Levantar el molino")));
  assert.deepEqual(active.historico.misionesCompletadas, []);
});

test("una misión activa que pide un objeto que solo se fabrica ahí queda bloqueada; si hay existencias suficientes, no", () => {
  // «Diez panes» pide pan, que solo se fabrica en el Horno
  const without = analyzeRetire(makeView(), "horno");
  assert.ok(without.operativo.misionesActivas.some((m) => m.includes("Diez panes")));
  const stocked = analyzeRetire(makeView({ stock: { pan: 10 } }), "horno");
  assert.ok(!stocked.operativo.misionesActivas.some((m) => m.includes("Diez panes")));
  // sin construir: sus tareas pendientes dejan de poder cumplirse
  assert.deepEqual(without.operativo.tareasPendientes, ["«Madera» (3 de 6)", "«Piedra» (0 de 2)"]);
  assert.match(without.historico.construccion, /Aún no está construido/);
});

test("retirar exige administración, un edificio del panel, la revisión vigente y confirmar el análisis", () => {
  assert.equal(retire(makeView(), "molino", {}, "luis").ok, false);
  assert.equal((retire(makeView(), "molino", {}, "luis") as { reason: string }).reason, "sin-permiso");
  assert.equal((checkRetireStructure({ actor: "ana", admins: ADMINS, view: makeView(), payload: { structureId: "molino" } }) as { reason: string }).reason, "solicitud-invalida");
  assert.match((retire(makeView(), "taller") as { details: string[] }).details[0]!, /configuración/);
  assert.equal((retire(makeView(), "no-existe") as { reason: string }).reason, "definicion-invalida");
  const stale = retire(makeView({ rev: { [key("construccion", "molino")]: 3 }, lastChange: { [key("construccion", "molino")]: "luis lo editó" } })) as { reason: string; details: string[] };
  assert.equal(stale.reason, "version-obsoleta");
  assert.match(stale.details[0]!, /luis lo editó/);
  const first = retire() as { ok: false; reason: string; analysis: { canonical: string } };
  assert.equal(first.reason, "analisis-desactualizado", "sin la base se devuelve el análisis");
  assert.equal(retire(makeView(), "molino", { basis: first.analysis.canonical }).ok, true);
  // cambia una dependencia (archivan «Moler») → la confirmación vale para un estado anterior
  const changed = makeView({ rev: { [key("receta", "moler")]: 2 }, archived: [key("receta", "moler")] });
  assert.equal((retire(changed, "molino", { basis: first.analysis.canonical }) as { reason: string }).reason, "analisis-desactualizado");
  assert.match((retire(makeView({ retired: ["molino"] })) as { details: string[] }).details[0]!, /ya está retirado/);
});

test("restaurar un edificio tiene reglas propias: solar libre y proyecto abierto (no es restaurar un archivado)", () => {
  const restore = (view: ReturnType<typeof makeView>, extra: Record<string, unknown> = {}) => checkRestoreStructure({ actor: "ana", admins: ADMINS, view, payload: { structureId: "horno", expectedRev: 1, ...extra } });
  assert.equal(restore(makeView({ retired: ["horno"] })).ok, true);
  assert.match((restore(makeView()) as { details: string[] }).details[0]!, /no está retirado/);
  assert.equal((restore(makeView({ retired: ["horno"], rev: { [key("construccion", "horno")]: 2 } })) as { reason: string }).reason, "version-obsoleta");
  const closed = restore(makeView({ retired: ["horno"], closedProjects: ["horno"] })) as { reason: string; details: string[] };
  assert.equal(closed.reason, "definicion-en-uso");
  assert.match(closed.details[0]!, /proyecto de «Horno» está cerrado/);
  // el solar del horno (8,0) 2×2 lo ocupa ahora otro edificio
  const view = makeView({ retired: ["horno"] });
  const occupied = { ...view, structures: view.structures.map((s) => (s.def.id === "taller" ? { ...s, def: { ...s.def, x: 8, y: 0 } } : s)) };
  const blocked = restore(occupied) as { details: string[] };
  assert.match(blocked.details.join(" "), /El solar de «Horno» ya no está libre.*«Taller»/);
  assert.equal((checkRestoreStructure({ actor: "luis", admins: ADMINS, view: makeView({ retired: ["horno"] }), payload: { structureId: "horno", expectedRev: 1 } }) as { reason: string }).reason, "sin-permiso");
  // archivar una receta (restauración funcional) no tiene nada que ver con restaurar el edificio
  assert.equal(restore(makeView({ retired: ["horno"], archived: [key("receta", "hornear")] })).ok, true);
});
