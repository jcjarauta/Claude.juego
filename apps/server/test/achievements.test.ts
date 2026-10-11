import { test } from "node:test";
import assert from "node:assert/strict";
import {
  achievedIds, CATALOG, CATALOG_VERSION, communityReference, creditText, evaluateAchievements, levelBadge, REFERENCE_NOTE, summarize, SUPERSEDED,
  type AchievementSnapshot, type AchievementState,
} from "@juego/shared";

// G3d, P0 (TP-30): modelo de logros. Pruebas de tabla, sin red ni sala. La coherencia con una sala real está en achievements-room.test.ts.

type Over = Partial<AchievementSnapshot>;

function snap(over: Over = {}): AchievementSnapshot {
  return {
    me: { name: "ana", skills: {}, crafts: {} },
    stock: {},
    structures: [
      { id: "taller", name: "Taller", origin: "configuracion", built: false, builtBy: "", projectId: "p1" },
      { id: "molino", name: "Molino", origin: "panel", built: false, builtBy: "", projectId: "p2" },
    ],
    missions: [
      { id: "m1", name: "Primer pan", origin: "configuracion", createdBy: "", completed: false, completedBy: "", objective: { kind: "item-in-community", item: "pan", amount: 4 } },
      { id: "m2", name: "Molino en marcha", origin: "panel", createdBy: "luis", completed: false, completedBy: "", objective: { kind: "project-completed", project: "p2" } },
    ],
    projects: [
      { id: "p1", name: "Construir taller", origin: "configuracion", createdBy: "", closed: false, contributors: {}, tasks: [{ resource: "madera", required: 4, contributed: 0 }] },
      { id: "p2", name: "Construir molino", origin: "panel", createdBy: "luis", closed: false, contributors: {}, tasks: [{ resource: "madera", required: 6, contributed: 0 }] },
    ],
    skills: [{ id: "molinero", name: "Molinero", levels: ["Aprendiz", "Oficial", "Maestro"] }],
    ...over,
  };
}

const get = (states: readonly AchievementState[], id: string) => states.find((s) => s.id === id)!;
const run = (s: AchievementSnapshot, vistos: string[] = []) => evaluateAchievements(s, { vistos: new Set(vistos) });

// --------------------------------------------------------------- base

test("logros: sin nada hecho todo está pendiente y los totales cuentan 0", () => {
  const states = run(snap());
  assert.ok(states.every((s) => s.status === "pendiente" && !s.localRecord && s.credits.length === 0));
  assert.deepEqual(summarize(states), { achieved: 0, total: CATALOG.length });
  assert.deepEqual(achievedIds(states), []);
});

test("logros: datos incompletos o vacíos no fallan", () => {
  const empty = run({ me: { name: "", skills: {}, crafts: {} }, stock: {}, structures: [], missions: [], projects: [], skills: [] });
  assert.equal(empty.length, CATALOG.length);
  // misión que apunta a un proyecto inexistente, proyecto sin tareas, habilidad sin niveles
  const odd = run(snap({
    missions: [{ id: "x", name: "Rota", origin: "panel", createdBy: "", completed: false, completedBy: "", objective: { kind: "project-completed", project: "nada" } }],
    projects: [{ id: "q", name: "Vacío", origin: "panel", createdBy: "", closed: true, contributors: {}, tasks: [] }],
    skills: [{ id: "s", name: "Sin niveles", levels: [] }], me: { name: "ana", skills: { s: 3 }, crafts: {} },
  }));
  assert.equal(get(odd, "nivel-maximo@1").status, "pendiente");
  assert.equal(communityReference(snap({ missions: [{ id: "x", name: "Rota", origin: "panel", createdBy: "", completed: false, completedBy: "", objective: { kind: "project-completed", project: "nada" } }] })).progress, undefined);
});

// --------------------------------------------------------------- comunidad y atribución por papeles (precisión 4)

test("atribución: creación, ejecución final y aportaciones son tres papeles; la última acción no es trabajo exclusivo", () => {
  const s = snap({
    structures: [{ id: "molino", name: "Molino", origin: "panel", built: true, builtBy: "bea", projectId: "p2" }],
    projects: [{ id: "p2", name: "Construir molino", origin: "panel", createdBy: "luis", closed: false, contributors: { cai: 10, ana: 1, bea: 3, luis: 0 }, tasks: [] }],
  });
  const st = get(run(s), "primer-edificio@1");
  assert.equal(st.status, "conseguido");
  assert.deepEqual(st.credits, [{ what: "Molino", creadoPor: "luis", ejecutadoPor: "bea", aportaron: ["ana", "bea", "cai"] }]);
  assert.equal(creditText(st.credits[0]!, "Construido"), "Molino: Creado por luis. Construido por bea con la aportación de ana, bea y cai.");
});

test("atribución: el orden es alfabético aunque las cantidades difieran y no hay cifras en el reconocimiento", () => {
  const s = snap({
    structures: [{ id: "t", name: "Taller", origin: "configuracion", built: true, builtBy: "zoe", projectId: "p1" }],
    projects: [{ id: "p1", name: "Taller", origin: "configuracion", createdBy: "", closed: false, contributors: { zoe: 500, ana: 1, mia: 50 }, tasks: [] }],
  });
  const line = get(run(s), "primer-edificio@1").credits[0]!;
  assert.deepEqual(line.aportaron, ["ana", "mia", "zoe"]);
  for (const st of run(s)) for (const c of st.credits) assert.ok(Object.values(c).every((v) => typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"))), "solo texto: sin cifras comparativas");
});

test("atribución: sin aportaciones registradas se dice, y una misión de objeto no atribuye todo a quien hizo la última acción", () => {
  assert.equal(creditText({ what: "Taller", ejecutadoPor: "bea", aportaron: [] }, "Construido"), "Taller: Construido por bea; el estado no registra otras aportaciones.");
  assert.equal(creditText({ what: "Taller", aportaron: [] }, "Construido"), "Taller: El estado no registra quiénes aportaron.");
  const s = snap({ missions: [{ id: "m1", name: "Primer pan", origin: "configuracion", createdBy: "ana", completed: true, completedBy: "bea", objective: { kind: "item-in-community", item: "pan", amount: 4 } }] });
  const credit = get(run(s), "primera-mision@1").credits[0]!;
  assert.equal(credit.nota, "El estado no registra todas las aportaciones de esta misión.");
  assert.equal(creditText(credit, "Completada"), "Primer pan: Creado por ana. Completada por bea. El estado no registra todas las aportaciones de esta misión.", "el límite se dice una sola vez");
});

test("comunidad: varios edificios construidos dan una línea de reconocimiento por edificio, sin elegir a una sola persona como «la primera»", () => {
  const s = snap({
    structures: [
      { id: "b", name: "Molino", origin: "panel", built: true, builtBy: "luis", projectId: "p2" },
      { id: "a", name: "Almacén", origin: "panel", built: true, builtBy: "bea", projectId: "p3" },
    ],
  });
  const credits = get(run(s), "primer-edificio@1").credits;
  assert.deepEqual(credits.map((c) => [c.what, c.ejecutadoPor]), [["Almacén", "bea"], ["Molino", "luis"]]);
});

// --------------------------------------------------------------- conjuntos y estado actual (precisión 1)

test("conjunto inicial: «n de M» sobre los elementos de origen configuración; añadir elementos del panel no revoca ni cambia el conjunto", () => {
  const built = snap({ structures: [{ id: "taller", name: "Taller", origin: "configuracion", built: true, builtBy: "ana", projectId: "p1" }] });
  const a = get(run(built), "edificios-iniciales@1");
  assert.equal(a.status, "conseguido");
  assert.deepEqual(a.progress, { done: 1, total: 1 });
  assert.equal(a.set, "conjunto inicial");
  assert.equal(a.type, "estado-actual");
  // la administración añade un edificio nuevo sin construir desde el panel: el conjunto inicial sigue completo
  const more = snap({ structures: [...built.structures, { id: "nuevo", name: "Nuevo", origin: "panel", built: false, builtBy: "", projectId: "p9" }] });
  assert.equal(get(run(more), "edificios-iniciales@1").status, "conseguido");
  assert.deepEqual(get(run(more), "edificios-iniciales@1").progress, { done: 1, total: 1 });
});

test("estado actual: si se retira lo que lo cumplía deja de constar; solo queda un «registro de este navegador» que no cuenta", () => {
  const withBuilding = snap({ structures: [{ id: "taller", name: "Taller", origin: "configuracion", built: true, builtBy: "ana", projectId: "p1" }] });
  const achieved = achievedIds(run(withBuilding));
  assert.ok(achieved.includes("primer-edificio@1") && achieved.includes("edificios-iniciales@1"));
  // se retira el edificio: sin evidencia ya no es «conseguido»
  const retired = run(snap({ structures: [] }), achieved);
  for (const id of ["primer-edificio@1", "edificios-iniciales@1"]) {
    const st = get(retired, id);
    assert.notEqual(st.status, "conseguido", id);
    assert.equal(st.localRecord, true, `${id}: registro de este navegador`);
    assert.deepEqual(st.credits, [], "el registro local no se atribuye a nadie");
  }
  assert.equal(summarize(retired).achieved, 0, "el registro local no cuenta en los totales");
  // lo que sí tiene evidencia nunca es registro local
  assert.ok(run(withBuilding, achieved).every((s) => s.status !== "conseguido" || !s.localRecord));
});

test("conjunto inicial de misiones: completadas n de M; un conjunto vacío nunca es un logro", () => {
  const s = snap({ missions: snap().missions.map((m) => (m.id === "m1" ? { ...m, completed: true, completedBy: "bea" } : m)) });
  const st = get(run(s), "misiones-iniciales@1");
  assert.equal(st.status, "conseguido");
  assert.deepEqual(st.progress, { done: 1, total: 1 });
  assert.equal(get(run(snap({ missions: [], structures: [] })), "misiones-iniciales@1").status, "pendiente");
  assert.equal(get(run(snap({ missions: [], structures: [] })), "edificios-iniciales@1").status, "pendiente");
});

test("proyecto colectivo: cuenta personas con aportes mayores que cero; progreso hacia tres", () => {
  const two = snap({ projects: [{ id: "p", name: "P", origin: "panel", createdBy: "luis", closed: false, contributors: { ana: 2, bea: 1, cai: 0 }, tasks: [] }] });
  const st = get(run(two), "proyecto-colectivo@1");
  assert.equal(st.status, "en-progreso");
  assert.deepEqual(st.progress, { done: 2, total: 3 });
  const three = snap({ projects: [{ id: "p", name: "P", origin: "panel", createdBy: "luis", closed: false, contributors: { ana: 2, bea: 1, cai: 3 }, tasks: [] }] });
  const ok = get(run(three), "proyecto-colectivo@1");
  assert.equal(ok.status, "conseguido");
  assert.deepEqual(ok.credits[0], { what: "P", creadoPor: "luis", aportaron: ["ana", "bea", "cai"] });
});

// --------------------------------------------------------------- personal y cooperación

test("personal: niveles de habilidad (primera, segunda, máximo)", () => {
  const lv = (n: number) => run(snap({ me: { name: "ana", skills: { molinero: n }, crafts: {} } }));
  assert.deepEqual(["primera-habilidad@1", "segundo-nivel@1", "nivel-maximo@1"].map((id) => get(lv(0), id).status), ["pendiente", "pendiente", "pendiente"]);
  assert.deepEqual(["primera-habilidad@1", "segundo-nivel@1", "nivel-maximo@1"].map((id) => get(lv(1), id).status), ["conseguido", "en-progreso", "pendiente"]);
  assert.deepEqual(["primera-habilidad@1", "segundo-nivel@1", "nivel-maximo@1"].map((id) => get(lv(2), id).status), ["conseguido", "conseguido", "pendiente"]);
  assert.deepEqual(["primera-habilidad@1", "segundo-nivel@1", "nivel-maximo@1"].map((id) => get(lv(3), id).status), ["conseguido", "conseguido", "conseguido"]);
});

test("personal: unidades aportadas (propias, de todos los proyectos) con progreso n de m; fabricaciones acumuladas", () => {
  const s = snap({
    projects: [
      { id: "p1", name: "A", origin: "panel", createdBy: "", closed: false, contributors: { ana: 7, bea: 99 }, tasks: [] },
      { id: "p2", name: "B", origin: "panel", createdBy: "", closed: false, contributors: { ana: 6 }, tasks: [] },
    ],
    me: { name: "ana", skills: {}, crafts: { moler: 4, hornear: 6 } },
  });
  const st = run(s);
  assert.equal(get(st, "primer-aporte@1").status, "conseguido");
  assert.equal(get(st, "aportes-10@1").status, "conseguido");
  assert.equal(get(st, "aportes-50@1").status, "en-progreso");
  assert.deepEqual(get(st, "aportes-50@1").progress, { done: 13, total: 50 }, "las 99 de bea no cuentan para ana");
  assert.equal(get(st, "aportes-100@1").status, "en-progreso");
  assert.equal(get(st, "primera-practica@1").status, "conseguido");
  assert.equal(get(st, "practicas-10@1").status, "conseguido");
  assert.deepEqual(get(st, "practicas-10@1").progress, { done: 10, total: 10 });
});

test("cooperación: aportar a un proyecto del panel creado por otra persona; no cuentan los de configuración ni los propios", () => {
  const mk = (origin: string, createdBy: string, mine: number) => snap({ projects: [{ id: "p", name: "P", origin, createdBy, closed: false, contributors: { ana: mine, luis: 2 }, tasks: [] }] });
  assert.equal(get(run(mk("panel", "luis", 3)), "aporte-ajeno@1").status, "conseguido");
  assert.equal(get(run(mk("panel", "luis", 3)), "aporte-ajeno@1").credits[0]!.creadoPor, "luis");
  assert.equal(get(run(mk("configuracion", "", 3)), "aporte-ajeno@1").status, "pendiente");
  assert.equal(get(run(mk("panel", "ana", 3)), "aporte-ajeno@1").status, "pendiente", "un proyecto propio no es de otra persona");
  assert.equal(get(run(mk("panel", "luis", 0)), "aporte-ajeno@1").status, "pendiente", "sin aportes propios");
});

// --------------------------------------------------------------- referencia orientativa (precisión 3)

test("referencia de la comunidad: la primera misión pendiente con su progreso, rotulada como orientativa", () => {
  const item = communityReference(snap({ stock: { pan: 3 } }));
  assert.equal(item.label, "Misión: Primer pan");
  assert.deepEqual(item.progress, { done: 3, total: 4 });
  assert.equal(item.text, "3 de 4 en las existencias del almacén.");
  assert.equal(item.note, REFERENCE_NOTE);
  assert.match(REFERENCE_NOTE, /no es una decisión del equipo ni sustituye tu objetivo/);
  const done = snap({ missions: snap().missions.map((m) => (m.id === "m1" ? { ...m, completed: true } : m)) });
  assert.equal(communityReference(done).label, "Misión: Molino en marcha", "pasa a la siguiente pendiente");
  const project = communityReference(snap({ projects: [snap().projects[0]!, { ...snap().projects[1]!, tasks: [{ resource: "madera", required: 6, contributed: 9 }, { resource: "piedra", required: 4, contributed: 1 }] }], missions: [snap().missions[1]!] }));
  assert.deepEqual(project.progress, { done: 7, total: 10 }, "el exceso de una tarea no cuenta de más");
  const none = communityReference(snap({ missions: [] }));
  assert.equal(none.label, "Sin referencia pendiente");
  assert.equal(none.note, REFERENCE_NOTE);
});

// --------------------------------------------------------------- insignias de nivel (forma y texto)

test("insignia de nivel: forma y texto, no solo color; la forma se reparte por posición", () => {
  const three = ["Aprendiz", "Oficial", "Maestro"];
  assert.deepEqual([0, 1, 2, 3].map((l) => levelBadge(l, three).label), ["○ Sin nivel", "▲ Aprendiz", "◆ Oficial", "★ Maestro"]);
  assert.deepEqual([1, 2].map((l) => levelBadge(l, ["Básico", "Experto"]).shape), ["▲", "★"]);
  assert.deepEqual([1, 2, 3, 4].map((l) => levelBadge(l, ["a", "b", "c", "d"]).shape), ["▲", "◆", "■", "★"]);
  assert.deepEqual([1, 2, 3, 4, 5].map((l) => levelBadge(l, ["a", "b", "c", "d", "e"]).shape), ["▲", "◆", "■", "⬟", "★"]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((l) => levelBadge(l, ["a", "b", "c", "d", "e", "f", "g"]).shape), ["▲", "◆", "◆", "■", "⬟", "⬟", "★"], "con más de cinco niveles se reparten por posición");
  assert.equal(levelBadge(1, ["Solo"]).shape, "★");
  assert.equal(levelBadge(9, three).label, "★ Maestro", "un nivel mayor que el máximo se queda en el último");
  assert.equal(levelBadge(2, []).label, "○ Sin nivel");
  for (const l of [1, 2, 3]) assert.ok(/^\S+ \S/.test(levelBadge(l, three).label), "siempre símbolo y texto");
});

// --------------------------------------------------------------- catálogo versionado (precisión 9)

/** Tabla congelada id → condición. Si cambia la condición de un logro hay que crear OTRO id (`@2`) y este test obliga a ello. */
const FROZEN: Record<string, string> = {
  "primer-edificio@1": "estructuras-construidas>=1",
  "edificios-iniciales@1": "estructuras-origen-configuracion-construidas=todas",
  "primera-mision@1": "misiones-completadas>=1",
  "misiones-iniciales@1": "misiones-origen-configuracion-completadas=todas",
  "proyecto-colectivo@1": "proyecto-con>=3-contribuyentes",
  "primera-habilidad@1": "nivel-habilidad-propio>=1",
  "segundo-nivel@1": "nivel-habilidad-propio>=2",
  "nivel-maximo@1": "nivel-habilidad-propio=ultimo",
  "primer-aporte@1": "unidades-aportadas-propias>=1",
  "aportes-10@1": "unidades-aportadas-propias>=10",
  "aportes-50@1": "unidades-aportadas-propias>=50",
  "aportes-100@1": "unidades-aportadas-propias>=100",
  "primera-practica@1": "fabricaciones-de-practica-propias>=1",
  "practicas-10@1": "fabricaciones-de-practica-propias>=10",
  "aporte-ajeno@1": "aporte-propio-a-proyecto-de-panel-creado-por-otra-persona",
};

test("catálogo versionado: ids únicos con versión; la condición de cada id está congelada y un id retirado no se reutiliza", () => {
  assert.equal(CATALOG_VERSION, 1);
  const ids = CATALOG.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, "ids únicos");
  for (const id of ids) assert.match(id, /^[a-z0-9-]+@[1-9]\d*$/, id);
  // Condición congelada: cambiarla sin cambiar de id rompe este test.
  assert.deepEqual(Object.fromEntries(CATALOG.map((d) => [d.id, d.condition])), FROZEN);
  // Retirados: ningún id retirado sigue vivo, y los reemplazos apuntan a ids vivos de versión mayor.
  for (const [old, next] of Object.entries(SUPERSEDED)) {
    assert.ok(!ids.includes(old), `${old} está retirado y no puede reutilizarse`);
    if (next !== null) {
      assert.ok(ids.includes(next), `${old} → ${next} debe ser un id vivo`);
      assert.ok(Number(next.split("@")[1]) > Number(old.split("@")[1]), "el reemplazo tiene una versión mayor");
      assert.equal(next.split("@")[0], old.split("@")[0], "el reemplazo conserva el nombre base");
    }
  }
});

test("catálogo: sin presión por diseño: ningún logro ordena personas por cantidad, ni hay plazos o rachas", () => {
  for (const d of CATALOG) {
    assert.ok(!/racha|plazo|cuenta atr|ranking|clasific|mejor/i.test(`${d.name} ${d.description} ${d.condition}`), d.id);
  }
  // Las personas siempre salen en orden alfabético con independencia de las cantidades.
  const s = snap({
    structures: [{ id: "t", name: "T", origin: "configuracion", built: true, builtBy: "ana", projectId: "p1" }],
    projects: [{ id: "p1", name: "T", origin: "configuracion", createdBy: "", closed: false, contributors: { c: 1, b: 100, a: 50 }, tasks: [] }],
  });
  assert.deepEqual(get(run(s), "primer-edificio@1").credits[0]!.aportaron, ["a", "b", "c"]);
});
