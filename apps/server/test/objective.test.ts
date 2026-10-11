import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRejection, createStabilizer, overlayRejection, REJECTION_DELAY_MS, REJECTION_WINDOW_MS, TECHNICAL_WINDOW_MS, directionText, evaluateObjective, isObsolete, objectiveLabel, planRoutes, REJECT_TEXT, REJECTION_REASONS,
  stepAfterRejection, suggestObjectives, type Objective, type RecipeDef, type Snapshot, type Step,
} from "@juego/shared";

// G3c, P0 (TP-29): modelo del objetivo actual. Pruebas de tabla, sin red ni sala. La coherencia con el servidor real
// está en objective-coherence.test.ts.

const molinero = { id: "molinero", name: "Molinero", description: "", levels: [
  { name: "Aprendiz", practice: { recipe: "moler", times: 2 } },
  { name: "Oficial", practice: { recipe: "hornear", times: 3 } },
] };

const RECIPES: RecipeDef[] = [
  { id: "moler", name: "Moler grano", structureId: "molino", inputs: { trigo: 2 }, output: { item: "harina", amount: 1 }, verb: "Moler" },
  { id: "hornear", name: "Hornear pan", structureId: "horno", inputs: { harina: 1, madera: 1 }, output: { item: "pan", amount: 1 }, verb: "Hornear" },
  { id: "pan-directo", name: "Pan de grano", structureId: "horno", inputs: { trigo: 3 }, output: { item: "pan", amount: 1 }, verb: "Hornear" },
  { id: "moler-fino", name: "Moler fino", structureId: "molino", inputs: { trigo: 2 }, output: { item: "harina", amount: 2 }, verb: "Moler", requiresSkills: [{ skill: "molinero", level: 2 }] },
];

function snap(over: Partial<Snapshot> & { built?: string[]; recipes?: RecipeDef[] } = {}): Snapshot {
  const built = new Set(over.built ?? ["molino", "horno"]);
  const base: Snapshot = {
    me: { name: "ana", x: 1, y: 1, inventory: {}, skills: {}, crafts: {} },
    inventoryMax: 10,
    stock: {},
    nodes: [
      { id: "n-madera", resource: "madera", x: 2, y: 2, units: 10 },
      { id: "n-trigo", resource: "trigo", x: 6, y: 2, units: 10 },
    ],
    resources: { madera: "Madera", trigo: "Trigo" },
    items: { harina: "Harina", pan: "Pan" },
    recipes: RECIPES.filter((r) => r.id !== "pan-directo" && r.id !== "moler-fino"),
    structures: [
      { def: { id: "molino", name: "Molino", projectId: "p-molino", x: 10, y: 5, width: 2, height: 1, color: "#fff" }, built: built.has("molino") },
      { def: { id: "horno", name: "Horno", projectId: "p-horno", x: 14, y: 5, width: 1, height: 1, color: "#fff" }, built: built.has("horno") },
    ],
    skills: [molinero],
    projects: [
      { def: { id: "p-molino", name: "Molino", description: "", reality: "VIRTUAL", coordinators: [], buildRequiresApproval: false, tasks: [
        { id: "t1", title: "Madera del molino", resource: "madera", required: 4, acceptance: "" },
        { id: "t2", title: "Trigo del molino", resource: "trigo", required: 2, acceptance: "", dependsOn: ["t1"] },
      ] }, contributed: {}, decisions: {}, closed: false, completed: built.has("molino"), approvalMissing: false },
      { def: { id: "p-horno", name: "Horno", description: "", reality: "VIRTUAL", coordinators: [], buildRequiresApproval: false, tasks: [
        { id: "t1", title: "Piedras", resource: "madera", required: 2, acceptance: "" },
      ] }, contributed: {}, decisions: {}, closed: false, completed: built.has("horno"), approvalMissing: false },
    ],
    missions: [{ def: { id: "m-pan", name: "Primer pan", description: "", objective: { kind: "item-in-community", item: "pan", amount: 1 } }, completed: false }],
    others: [],
    offers: [],
  };
  const { built: _b, ...rest } = over;
  return { ...base, ...rest };
}

const ev = (o: Objective, s: Snapshot): Step => evaluateObjective(o, s);
const mission: Objective = { kind: "mission", id: "m-pan" };

// --------------------------------------------------------------- objetivos elegidos y avisos

test("objetivo elegido: una oferta o una misión nueva no sustituyen el paso del objetivo activo", () => {
  const task: Objective = { kind: "task", project: "p-molino", task: "t1" };
  const sin = ev(task, snap());
  const con = ev(task, snap({
    offers: [{ id: "o1", from: "bea", skill: "molinero", level: 1 }],
    missions: [...snap().missions, { def: { id: "m-nueva", name: "Nueva", description: "", objective: { kind: "project-completed", project: "p-horno" } }, completed: false }],
  }));
  assert.equal(con.key, sin.key);
  assert.equal(con.text, sin.text);
  assert.equal(con.status, sin.status);
});

test("sugerencias: misiones, tareas pendientes y habilidades por conseguir; sin fijar nada", () => {
  const c = suggestObjectives(snap({ built: [] }));
  assert.deepEqual(c.map((x) => x.objective.kind), ["mission", "task", "task", "task", "skill"]);
  assert.ok(c[0]!.label.startsWith("Misión"));
  assert.equal(suggestObjectives(snap({ built: [], missions: [] })).filter((x) => x.objective.kind === "mission").length, 0);
});

// --------------------------------------------------------------- tareas

test("tarea: aporta del inventario; si no hay, del almacén; si no hay nada, recoge del nodo más cercano", () => {
  const task: Objective = { kind: "task", project: "p-molino", task: "t1" };
  const a = ev(task, snap({ me: { ...snap().me, inventory: { madera: 3 } } }));
  assert.equal(a.status, "DISPONIBLE");
  assert.deepEqual(a.action, { type: "contribute", project: "p-molino", task: "t1", resource: "madera", amount: 3, from: "player" });
  const b = ev(task, snap({ stock: { madera: 9 } }));
  assert.equal(b.action?.from, "community");
  assert.equal(b.action?.amount, 4);
  const c = ev(task, snap({ me: { ...snap().me, x: 0, y: 0 } }));
  assert.equal(c.type, "go");
  assert.deepEqual(c.target, { x: 2, y: 2, label: "Madera" });
  const d = ev(task, snap());
  assert.equal(d.type, "collect");
  assert.equal(d.action?.amount, 4);
});

test("tarea: bloqueada por dependencias, completada y proyecto cerrado u objeto desaparecido", () => {
  const blocked = ev({ kind: "task", project: "p-molino", task: "t2" }, snap());
  assert.equal(blocked.status, "BLOQUEADO");
  assert.equal(blocked.requirements[0]!.code, "dependencia:t1");
  assert.match(blocked.requirements[0]!.how, /Madera del molino/);
  const s = snap();
  s.projects[0]!.contributed = { madera: 4 };
  assert.equal(ev({ kind: "task", project: "p-molino", task: "t1" }, s).status, "COMPLETADO");
  s.projects[0]!.closed = true;
  const closed = ev({ kind: "task", project: "p-molino", task: "t2" }, s);
  assert.equal(closed.status, "NO_VERIFICADO");
  assert.equal(closed.obsolete, true);
  assert.equal(isObsolete({ kind: "task", project: "ya-no", task: "x" }, snap()), true);
});

test("inventario lleno: con el máximo de un recurso no se recoge más; se aporta o se deposita", () => {
  // Para una tarea, lo que llevas encima se aporta directamente.
  const s = snap({ me: { ...snap().me, x: 1, y: 2, inventory: { madera: 10 } } });
  assert.equal(ev({ kind: "task", project: "p-molino", task: "t1" }, s).type, "contribute");
  // Para fabricar, el inventario no cuenta: primero se deposita.
  const deposit = ev({ kind: "item", item: "harina", amount: 1 }, snap({ me: { ...snap().me, x: 5, y: 2, inventory: { trigo: 10 } } }));
  assert.equal(deposit.type, "deposit");
  // Sin nada que aportar ni depositar, con el inventario lleno de lo mismo que hay que recoger: bloqueo con salida.
  const full = snap({ me: { ...snap().me, x: 5, y: 2, inventory: { trigo: 10 } }, stock: { trigo: 0 } });
  full.projects[0]!.contributed = { madera: 4 };
  full.projects[0]!.decisions = {};
  const blocked = ev({ kind: "task", project: "p-molino", task: "t2" }, full);
  assert.equal(blocked.type, "contribute", "t2 usa trigo y el inventario lo tiene");
});

// --------------------------------------------------------------- cadenas

test("cadena: una ruta viable se usa; lejos del edificio pide ir; junto a él, fabricar", () => {
  const stocked = { trigo: 2 };
  const far = ev({ kind: "item", item: "harina", amount: 1 }, snap({ stock: stocked }));
  assert.equal(far.type, "go");
  assert.equal(far.target?.label, "Molino");
  const near = ev({ kind: "item", item: "harina", amount: 1 }, snap({ stock: stocked, me: { ...snap().me, x: 9, y: 5 } }));
  assert.equal(near.status, "DISPONIBLE");
  assert.equal(near.type, "craft");
  assert.deepEqual(near.action, { type: "craft", recipe: "moler", amount: 1, structure: "molino", verb: "Moler" });
  assert.match(near.text, /^Moler harina/);
});

test("cadena: pan en dos niveles con cantidades totales (Recoge 4, no 2 y 2)", () => {
  // pan ×1 = hornear (harina 1 + madera 1); harina ×1 = moler (trigo 2). Necesidades: trigo 2 y madera 1.
  const s = snap({ me: { ...snap().me, x: 5, y: 2 } });
  const plan = planRoutes(s, { kind: "item", item: "pan", amount: 1 });
  assert.equal(plan.routes.length, 1);
  const route = plan.routes[0]!;
  assert.equal(route.viable, true);
  assert.deepEqual(route.actions.map((a) => a.type), ["collect", "collect", "craft", "craft"]);
  assert.deepEqual(route.actions.filter((a) => a.type === "collect").map((a) => (a as { resource: string; amount: number }).amount).sort(), [1, 2]);
  const step = ev({ kind: "item", item: "pan", amount: 1 }, s);
  assert.equal(step.type, "collect");
  assert.equal(step.action?.resource, "trigo");
  assert.equal(step.action?.amount, 2);
});

test("cadena: edificio sin construir → el paso es construirlo (con el requisito visible)", () => {
  const s = snap({ built: ["horno"], stock: { trigo: 2 } });
  const step = ev({ kind: "item", item: "harina", amount: 1 }, s);
  assert.equal(step.requirements[0]!.code, "sin-construir:molino");
  assert.match(step.why, /primero hace falta Molino/);
  assert.equal(step.key, "recoger:madera", "lo primero es lo que pide el proyecto del molino: su madera");
});

test("cadena: proyecto listo y junto al solar → construir; lejos → ir al solar", () => {
  const s = snap({ built: ["horno"], me: { ...snap().me, x: 9, y: 5 } });
  s.projects[0]!.contributed = { madera: 4, trigo: 2 };
  const near = ev({ kind: "item", item: "harina", amount: 1 }, s);
  assert.equal(near.type, "build");
  assert.equal(near.status, "DISPONIBLE");
  s.me = { ...s.me, x: 1, y: 1 };
  const far = ev({ kind: "item", item: "harina", amount: 1 }, s);
  assert.equal(far.type, "go");
  assert.equal(far.key, "ir-solar:molino");
});

test("cadena: habilidad que falta → practicar con progreso, o pedir a quien la tiene", () => {
  const recipes = [...snap().recipes, RECIPES.find((r) => r.id === "moler-fino")!];
  const s = snap({ recipes, stock: { trigo: 4 }, me: { ...snap().me, x: 9, y: 5, skills: { molinero: 1 }, crafts: { hornear: 1 } },
    others: [{ name: "bea", x: 3, y: 3, connected: true, skills: { molinero: 2 } }, { name: "cai", x: 4, y: 4, connected: true, skills: { molinero: 3 } }] });
  // Quiero harina con moler-fino y moler a la vez; con dos rutas se elige la viable: moler (sin habilidad).
  const direct = ev({ kind: "item", item: "harina", amount: 2 }, s);
  assert.equal(direct.type, "craft");
  // El objetivo de habilidad Oficial: practica «hornear» 3 veces (llevas 1) o pide a cai.
  const skill = ev({ kind: "skill", skill: "molinero", level: 2 }, s);
  assert.equal(skill.progress?.done, 1);
  assert.equal(skill.progress?.total, 3);
  assert.match(skill.why, /Oficial en Molinero/);
  assert.ok(skill.alternatives.some((a) => a.includes("cai") && a.includes("Oficial")));
  assert.equal(skill.alternatives.some((a) => a.includes("bea")), false, "bea solo tiene Oficial: no puede enseñar el mismo nivel");
});

test("habilidad: la oferta pendiente que sirve se menciona y el nivel alcanzado completa el objetivo", () => {
  const s = snap({ offers: [{ id: "o1", from: "bea", skill: "molinero", level: 1 }] });
  assert.match(ev({ kind: "skill", skill: "molinero", level: 1 }, s).alternatives[0]!, /oferta de bea/);
  const done = ev({ kind: "skill", skill: "molinero", level: 1 }, snap({ me: { ...snap().me, skills: { molinero: 1 } } }));
  assert.equal(done.status, "COMPLETADO");
});

test("alternativas: dos rutas viables no se eligen en silencio; la elección guardada se respeta", () => {
  const recipes = [...snap().recipes, RECIPES.find((r) => r.id === "pan-directo")!];
  const s = snap({ recipes, stock: { harina: 1, madera: 1, trigo: 3 } });
  const choose = ev({ kind: "item", item: "pan", amount: 1 }, s);
  assert.equal(choose.type, "choose-route");
  assert.equal(choose.status, "DISPONIBLE");
  assert.equal(choose.routes?.filter((r) => r.viable).length, 2);
  assert.equal(choose.alternatives.length, 2);
  const picked = ev({ kind: "item", item: "pan", amount: 1, route: "pan-directo" }, { ...s, me: { ...s.me, x: 13, y: 5 } });
  assert.notEqual(picked.type, "choose-route");
  assert.match(picked.text, /Hornear pan/i);
  assert.ok(picked.alternatives.some((a) => a.startsWith("Otra ruta")));
});

test("alternativas: ninguna ruta viable → bloqueo de la ruta con menos obstáculos y las demás como alternativas", () => {
  const recipes = [...snap().recipes, RECIPES.find((r) => r.id === "pan-directo")!];
  const s = snap({ recipes, nodes: [{ id: "n-madera", resource: "madera", x: 2, y: 2, units: 0 }, { id: "n-trigo", resource: "trigo", x: 6, y: 2, units: 1 }] });
  const step = ev({ kind: "item", item: "pan", amount: 1 }, s);
  assert.equal(step.status, "BLOQUEADO");
  assert.ok(step.requirements.length > 0);
  assert.ok(step.alternatives.some((a) => a.includes("bloqueada")));
});

// --------------------------------------------------------------- ciclos y datos incompletos

test("ciclos: A necesita B y B necesita A → la ruta se descarta con su camino", () => {
  const cyc: RecipeDef[] = [
    { id: "a-de-b", name: "A", structureId: "molino", inputs: { b: 1 }, output: { item: "a", amount: 1 } },
    { id: "b-de-a", name: "B", structureId: "molino", inputs: { a: 1 }, output: { item: "b", amount: 1 } },
  ];
  const s = snap({ recipes: cyc, items: { a: "A", b: "B" } });
  const plan = planRoutes(s, { kind: "item", item: "a", amount: 1 });
  assert.equal(plan.routes.length, 0);
  assert.match(plan.discarded[0]!, /ciclo A → B → A/);
  const step = ev({ kind: "item", item: "a", amount: 1 }, s);
  assert.equal(step.status, "NO_VERIFICADO");
  assert.match(step.why, /ciclo/);
});

test("ciclos: una ruta con ciclo no oculta una alternativa sin ciclo", () => {
  const recipes: RecipeDef[] = [
    { id: "a-ciclo", name: "A (ciclo)", structureId: "molino", inputs: { b: 1 }, output: { item: "a", amount: 1 } },
    { id: "b-de-a", name: "B", structureId: "molino", inputs: { a: 1 }, output: { item: "b", amount: 1 } },
    { id: "a-simple", name: "A (simple)", structureId: "molino", inputs: { trigo: 1 }, output: { item: "a", amount: 1 } },
  ];
  const s = snap({ recipes, items: { a: "A", b: "B" } });
  const plan = planRoutes(s, { kind: "item", item: "a", amount: 1 });
  assert.deepEqual(plan.routes.map((r) => r.id), ["a-simple"]);
  assert.ok(plan.discarded.length > 0);
});

test("profundidad máxima: una cadena demasiado larga se descarta con su motivo", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
  const recipes: RecipeDef[] = ids.map((id, i) => ({ id: `r${i}`, name: id, structureId: "molino", inputs: i === ids.length - 1 ? { trigo: 1 } : { [ids[i + 1]!]: 1 }, output: { item: id, amount: 1 } }));
  const s = snap({ recipes, items: Object.fromEntries(ids.map((i) => [i, i])) });
  const plan = planRoutes(s, { kind: "item", item: "c0", amount: 1 });
  assert.equal(plan.routes.length, 0);
  assert.match(plan.discarded.join(" "), /profundidad máxima/);
});

test("datos incompletos: edificio o receta desconocidos → NO_VERIFICADO, nunca un paso inventado", () => {
  const noBuilding = snap({ recipes: [{ ...RECIPES[0]!, structureId: "fantasma" }] });
  const a = ev({ kind: "item", item: "harina", amount: 1 }, noBuilding);
  assert.equal(a.status, "NO_VERIFICADO");
  assert.equal(a.requirements[0]!.code, "edificio-desconocido:fantasma");
  const noRecipe = snap({ recipes: [] });
  const b = ev({ kind: "item", item: "harina", amount: 1 }, noRecipe);
  assert.notEqual(b.status, "DISPONIBLE");
  assert.equal(ev({ kind: "item", item: "no-existe", amount: 1 }, snap()).obsolete, true);
  assert.equal(ev({ kind: "skill", skill: "no-existe", level: 1 }, snap()).obsolete, true);
  assert.equal(ev({ kind: "mission", id: "no-existe" }, snap()).obsolete, true);
});

test("completados: misión, objeto en el almacén y proyecto completado", () => {
  assert.equal(ev(mission, snap({ missions: [{ def: snap().missions[0]!.def, completed: true }] })).status, "COMPLETADO");
  assert.equal(ev({ kind: "item", item: "pan", amount: 1 }, snap({ stock: { pan: 1 } })).status, "COMPLETADO");
  // Misión con el objeto ya en el almacén: el paso es COMPLETADO; marcar la misión como hecha es cosa del servidor.
  assert.equal(ev({ kind: "mission", id: "m-pan" }, snap({ stock: { pan: 2 } })).status, "COMPLETADO");
  assert.equal(ev({ kind: "mission", id: "m-pan" }, snap()).status !== "COMPLETADO", true);
});

// --------------------------------------------------------------- libro de necesidades (precisión B)

test("libro: un ingrediente compartido por dos ramas se suma y las existencias se descuentan una sola vez", () => {
  // Dos panes: hornear ×2 necesita 2 harina y 2 madera; moler ×2 necesita 4 trigo. Madera total 2 (solo hornear).
  // Existencias: 3 madera... aquí usamos una receta que comparte madera con otra rama.
  const recipes: RecipeDef[] = [
    { id: "tabla", name: "Tabla", structureId: "molino", inputs: { madera: 2 }, output: { item: "tabla", amount: 1 } },
    { id: "banco", name: "Banco", structureId: "molino", inputs: { tabla: 1, madera: 2 }, output: { item: "banco", amount: 1 } },
  ];
  const s = snap({ recipes, items: { tabla: "Tabla", banco: "Banco" }, stock: { madera: 3 } });
  const route = planRoutes(s, { kind: "item", item: "banco", amount: 1 }).routes[0]!;
  const madera = route.ledger.get("madera")!;
  assert.equal(madera.needed, 4, "2 de la tabla + 2 del banco");
  assert.equal(madera.fromStock, 3, "las 3 del almacén se asignan una sola vez");
  assert.equal(madera.fromNodes, 1, "la cuarta se recoge");
  assert.equal(madera.missing, 0);
  const collects = route.actions.filter((a) => a.type === "collect");
  assert.deepEqual(collects.map((a) => (a as { amount: number }).amount), [1]);
});

test("libro: una existencia que cubre solo uno de dos usos deja el otro en falta, sin doble contabilización", () => {
  const recipes: RecipeDef[] = [
    { id: "tabla", name: "Tabla", structureId: "molino", inputs: { madera: 2 }, output: { item: "tabla", amount: 1 } },
    { id: "banco", name: "Banco", structureId: "molino", inputs: { tabla: 1, madera: 2 }, output: { item: "banco", amount: 1 } },
  ];
  const s = snap({ recipes, items: { tabla: "Tabla", banco: "Banco" }, stock: { madera: 3 },
    nodes: [{ id: "n-madera", resource: "madera", x: 2, y: 2, units: 0 }] });
  const plan = planRoutes(s, { kind: "item", item: "banco", amount: 1 });
  const route = plan.routes[0]!;
  assert.equal(route.viable, false);
  assert.equal(route.ledger.get("madera")!.missing, 1, "faltan 4-3 = 1, no 4-3-3");
  assert.equal(route.blockers[0]!.code, "sin-unidades:madera");
});

test("libro: el subproducto de un paso cubre un paso posterior (crédito una sola vez)", () => {
  const recipes: RecipeDef[] = [
    { id: "moler-con-salvado", name: "Moler", structureId: "molino", inputs: { trigo: 2 }, output: { item: "harina", amount: 1 }, byproducts: [{ item: "salvado", amount: 2 }] },
    { id: "pienso", name: "Pienso", structureId: "molino", inputs: { salvado: 1, harina: 1 }, output: { item: "pienso", amount: 1 } },
  ];
  const s = snap({ recipes, items: { harina: "Harina", salvado: "Salvado", pienso: "Pienso" } });
  const route = planRoutes(s, { kind: "item", item: "pienso", amount: 1 }).routes[0]!;
  assert.equal(route.viable, true);
  assert.equal(route.ledger.get("salvado")!.needed, 1);
  assert.equal(route.ledger.get("salvado")!.fromCrafts, 2, "moler da 2 de salvado (subproducto); se usa 1 y sobra 1");
  assert.equal(route.ledger.get("harina")!.fromStock, 1, "la harina que sale de esa misma fabricación se acredita al otro uso, no se fabrica otra vez");
  assert.equal(route.actions.filter((x) => x.type === "craft" && x.recipe.id === "moler-con-salvado").length, 1);
  // El salvado lo da moler (subproducto): no hay ninguna recolección de salvado ni receta aparte.
  assert.equal(route.actions.some((a) => a.type === "collect" && a.resource === "salvado"), false);
  assert.deepEqual(route.actions.filter((a) => a.type === "craft").map((a) => (a as { recipe: RecipeDef }).recipe.id), ["moler-con-salvado", "pienso"]);
});

test("libro: lo que llevas en el inventario solo cuenta tras depositarlo (paso «Deposita»)", () => {
  const s = snap({ me: { ...snap().me, x: 5, y: 2, inventory: { trigo: 5 } } });
  const route = planRoutes(s, { kind: "item", item: "harina", amount: 1 }).routes[0]!;
  assert.deepEqual(route.actions.map((a) => a.type), ["deposit", "craft"]);
  assert.equal(route.ledger.get("trigo")!.fromInventory, 2);
  assert.equal(route.ledger.get("trigo")!.fromStock, 0);
  const step = ev({ kind: "item", item: "harina", amount: 1 }, s);
  assert.equal(step.type, "deposit");
  assert.deepEqual(step.action, { type: "deposit", resource: "trigo", amount: 2 });
});

test("libro: las unidades de un nodo se asignan una vez entre varios usos", () => {
  // Pan ×2 por hornear necesita 2 madera + 2 harina (4 trigo): trigo del nodo 3 → faltan 1.
  const s = snap({ nodes: [{ id: "n-madera", resource: "madera", x: 2, y: 2, units: 10 }, { id: "n-trigo", resource: "trigo", x: 6, y: 2, units: 3 }] });
  const route = planRoutes(s, { kind: "item", item: "pan", amount: 2 }).routes[0]!;
  assert.equal(route.ledger.get("trigo")!.needed, 4);
  assert.equal(route.ledger.get("trigo")!.fromNodes, 3);
  assert.equal(route.ledger.get("trigo")!.missing, 1);
  assert.equal(route.viable, false);
});

test("libro: el coste agregado permite comparar rutas", () => {
  const recipes = [...snap().recipes, RECIPES.find((r) => r.id === "pan-directo")!];
  const plan = planRoutes(snap({ recipes }), { kind: "item", item: "pan", amount: 1 });
  assert.equal(plan.routes.length, 2);
  const byId = Object.fromEntries(plan.routes.map((r) => [r.id, r.cost]));
  assert.deepEqual(byId["moler>hornear"], { gather: 3, deposit: 0, crafts: 2 }); // trigo 2 + madera 1
  assert.deepEqual(byId["pan-directo"], { gather: 3, deposit: 0, crafts: 1 }); // trigo 3
});

// --------------------------------------------------------------- rechazos del servidor (precisión C)

test("rechazos: cada razón del servidor está clasificada en exactamente una clase", () => {
  assert.deepEqual([...REJECTION_REASONS].sort(), Object.keys(REJECT_TEXT).sort(), "añadir una razón sin clasificarla debe fallar");
  const classes = new Set(["bloqueo-confirmado", "estado-desactualizado", "permisos", "error-tecnico"]);
  for (const r of REJECTION_REASONS) {
    assert.ok(classes.has(classifyRejection(r, true)), r);
    assert.ok(classes.has(classifyRejection(r, false)), r);
  }
});

test("rechazos: la misma razón cambia de clase según el estado explique o no la causa", () => {
  assert.equal(classifyRejection("faltan-materiales", true), "bloqueo-confirmado");
  assert.equal(classifyRejection("faltan-materiales", false), "estado-desactualizado");
  assert.equal(classifyRejection("lejos-del-taller", true), "bloqueo-confirmado");
  assert.equal(classifyRejection("nodo-agotado"), "estado-desactualizado");
  assert.equal(classifyRejection("sin-permiso"), "permisos");
  assert.equal(classifyRejection("proyecto-cerrado"), "permisos");
  assert.equal(classifyRejection("demasiadas-solicitudes"), "error-tecnico");
  assert.equal(classifyRejection("recoleccion-demasiado-rapida"), "error-tecnico");
});

test("rechazos: el paso refleja la clase y nunca cambia el objetivo ni su identidad", () => {
  const base = ev({ kind: "item", item: "harina", amount: 1 }, snap({ stock: { trigo: 2 }, me: { ...snap().me, x: 9, y: 5 } }));
  assert.equal(base.status, "DISPONIBLE");
  const confirmed = stepAfterRejection(base, "faltan-materiales", REJECT_TEXT["faltan-materiales"], true);
  assert.equal(confirmed.status, "BLOQUEADO");
  assert.match(confirmed.why, /rechazó/);
  const stale = stepAfterRejection(base, "faltan-materiales", "x", false);
  assert.equal(stale.status, "NO_VERIFICADO");
  assert.match(stale.why, /estado cambió/);
  const perm = stepAfterRejection(base, "sin-permiso", "Solo coordinación.", true);
  assert.equal(perm.status, "BLOQUEADO");
  assert.match(perm.why, /Necesitas permiso/);
  assert.equal(perm.requirements[0]!.code, "sin-permiso");
  const tech = stepAfterRejection(base, "demasiadas-solicitudes", "x", true);
  assert.equal(tech.status, "NO_VERIFICADO");
  assert.match(tech.why, /técnico/);
  for (const s of [confirmed, stale, perm, tech]) assert.equal(s.key, base.key);
});

// --------------------------------------------------------------- estabilidad

test("estabilidad: mismas entradas → misma clave; las cantidades no cambian la identidad", () => {
  const task: Objective = { kind: "task", project: "p-molino", task: "t1" };
  const a = ev(task, snap({ me: { ...snap().me, inventory: { madera: 1 } } }));
  const b = ev(task, snap({ me: { ...snap().me, inventory: { madera: 3 } } }));
  assert.equal(a.key, b.key);
  assert.notEqual(a.text, b.text);
  assert.equal(JSON.stringify(ev(task, snap())), JSON.stringify(ev(task, snap())));
});

test("estabilizador: el mismo paso actualiza texto y progreso al momento, sin anunciar; el cambio de identidad espera 800 ms", () => {
  const stab = createStabilizer(800);
  const s1: Step = { key: "tarea:p:t1", status: "DISPONIBLE", type: "contribute", text: "Aporta 1", why: "", requirements: [], alternatives: [], progress: { done: 1, total: 4 } };
  assert.equal(stab.feed({ step: s1, now: 0, busy: false }).announce, true, "primer paso: se anuncia una vez");
  const s2 = { ...s1, text: "Aporta 3", progress: { done: 3, total: 4 } };
  const same = stab.feed({ step: s2, now: 100, busy: false });
  assert.equal(same.announce, false);
  assert.equal(same.shown.text, "Aporta 3");
  const other: Step = { ...s1, key: "tarea:p:t2", text: "Otra" };
  assert.equal(stab.feed({ step: other, now: 200, busy: false }).shown.key, "tarea:p:t1", "aún no estable");
  assert.equal(stab.feed({ step: other, now: 700, busy: false }).shown.key, "tarea:p:t1");
  const changed = stab.feed({ step: other, now: 1000, busy: false });
  assert.equal(changed.shown.key, "tarea:p:t2");
  assert.equal(changed.announce, true);
  assert.equal(stab.feed({ step: other, now: 1100, busy: false }).announce, false, "no se repite");
});

test("estabilizador: ocupado (se mueve, diálogo, foco en el panel) no cambia la identidad; parpadeo entre claves no la cambia", () => {
  const stab = createStabilizer(800);
  const a: Step = { key: "a", status: "DISPONIBLE", type: "collect", text: "A", why: "", requirements: [], alternatives: [] };
  const b: Step = { ...a, key: "b", text: "B" };
  stab.feed({ step: a, now: 0, busy: false });
  assert.equal(stab.feed({ step: b, now: 100, busy: true }).shown.key, "a");
  assert.equal(stab.feed({ step: b, now: 5000, busy: true }).shown.key, "a", "ocupado: nunca cambia");
  // Parpadeo a/b/a/b: cada vez que vuelve a «a» se reinicia el candidato.
  const flicker = createStabilizer(800);
  flicker.feed({ step: a, now: 0, busy: false });
  flicker.feed({ step: b, now: 100, busy: false });
  flicker.feed({ step: a, now: 600, busy: false });
  assert.equal(flicker.feed({ step: b, now: 1000, busy: false }).shown.key, "a");
});

test("estabilizador: se anuncian las transiciones BLOQUEADO ↔ DISPONIBLE y COMPLETADO del mismo paso, no el progreso", () => {
  const stab = createStabilizer();
  const a: Step = { key: "k", status: "BLOQUEADO", type: "craft", text: "x", why: "", requirements: [], alternatives: [] };
  stab.feed({ step: a, now: 0, busy: false });
  assert.equal(stab.feed({ step: { ...a, status: "DISPONIBLE" }, now: 10, busy: false }).announce, true);
  assert.equal(stab.feed({ step: { ...a, status: "DISPONIBLE", progress: { done: 1, total: 2 } }, now: 20, busy: false }).announce, false);
  assert.equal(stab.feed({ step: { ...a, status: "COMPLETADO" }, now: 30, busy: false }).announce, true);
});

// --------------------------------------------------------------- texto de dirección

test("dirección y distancia en texto", () => {
  assert.equal(directionText({ x: 1, y: 1 }, { x: 6, y: -2 }), "5 casillas al este y 3 casillas al norte");
  assert.equal(directionText({ x: 4, y: 4 }, { x: 4, y: 5 }), "1 casilla al sur");
  assert.equal(directionText({ x: 4, y: 4 }, { x: 4, y: 4 }), "estás en el destino");
  assert.equal(directionText({ x: 9, y: 0 }, { x: 0, y: 0 }), "9 casillas al oeste");
});

test("etiqueta legible del objetivo y ruta elegida válida para cualquier tipo de objetivo", () => {
  const s = snap({ built: [] });
  assert.equal(objectiveLabel(mission, s), "Misión: Primer pan");
  assert.equal(objectiveLabel({ kind: "task", project: "p-molino", task: "t1" }, s), "Tarea: Madera del molino (Molino)");
  assert.equal(objectiveLabel({ kind: "item", item: "pan", amount: 2 }, s), "Obtener 2 de pan");
  assert.equal(objectiveLabel({ kind: "skill", skill: "molinero", level: 2 }, s), "Habilidad: Molinero (Oficial)");
  // La ruta elegida sirve también a una misión (el objeto es un subobjetivo).
  const recipes = [...snap().recipes, RECIPES.find((r) => r.id === "pan-directo")!];
  const rich = snap({ recipes, stock: { harina: 1, madera: 1, trigo: 3 }, me: { ...snap().me, x: 13, y: 5 } });
  assert.equal(ev(mission, rich).type, "choose-route");
  assert.notEqual(ev({ ...mission, route: "pan-directo" } as Objective, rich).type, "choose-route");
});

test("estabilizador: completar u obsoletar el objetivo se muestra al momento aunque la persona esté ocupada", () => {
  const stab = createStabilizer(800);
  const a: Step = { key: "fabricar:x", status: "DISPONIBLE", type: "craft", text: "A", why: "", requirements: [], alternatives: [] };
  stab.feed({ step: a, now: 0, busy: false });
  const done: Step = { ...a, key: "mision:m", status: "COMPLETADO", type: "done", text: "Hecho" };
  const r = stab.feed({ step: done, now: 10, busy: true });
  assert.equal(r.shown.key, "mision:m");
  assert.equal(r.announce, true);
  const gone: Step = { ...a, key: "tarea:p:t", status: "NO_VERIFICADO", obsolete: true, text: "Ya no existe" };
  assert.equal(createStabilizer().feed({ step: a, now: 0, busy: false }) && stab.feed({ step: gone, now: 20, busy: true }).shown.key, "tarea:p:t");
});

test("rutas alternativas: cada ruta se describe con el nombre de su receta para poder distinguirlas", () => {
  const recipes = [...snap().recipes, RECIPES.find((r) => r.id === "pan-directo")!];
  const choose = ev({ kind: "item", item: "pan", amount: 1 }, snap({ recipes, stock: { harina: 1, madera: 1, trigo: 3 } }));
  const texts = choose.routes!.map((r) => r.text);
  assert.equal(new Set(texts).size, texts.length, "no hay dos rutas con el mismo texto");
  assert.ok(texts.some((t) => t.includes("«Hornear pan»")) && texts.some((t) => t.includes("«Pan de grano»")));
});

test("aviso tras un rechazo: espera un ciclo de sincronización, clasifica, caduca y se retira si el paso ya es otro", () => {
  const before: Step = { key: "fabricar:x", status: "DISPONIBLE", type: "craft", text: "Moler", why: "", requirements: [], alternatives: [] };
  const rej = (reason: Parameters<typeof classifyRejection>[0], at = 0) => ({ reason, text: "texto del servidor", before, at });
  // Antes de 300 ms se muestra el paso tal cual (aún no ha llegado el estado nuevo).
  assert.equal(overlayRejection(rej("faltan-materiales"), before, REJECTION_DELAY_MS - 1).step.status, "DISPONIBLE");
  // Mismo paso, sigue DISPONIBLE tras el ciclo: el estado no explica el rechazo → estado desactualizado (NO_VERIFICADO).
  const stale = overlayRejection(rej("faltan-materiales"), before, REJECTION_DELAY_MS);
  assert.equal(stale.step.status, "NO_VERIFICADO");
  assert.match(stale.step.why, /estado cambió/);
  assert.equal(stale.keep, true);
  // Mismo paso ya bloqueado por el estado: bloqueo confirmado, con el motivo del servidor, durante 15 s.
  const blocked: Step = { ...before, status: "BLOQUEADO", requirements: [{ code: "faltan-materiales", text: "Faltan 2 de madera.", how: "Recógela." }] };
  const confirmed = overlayRejection(rej("faltan-materiales"), blocked, 5_000);
  assert.equal(confirmed.step.status, "BLOQUEADO");
  assert.match(confirmed.step.why, /rechazó/);
  assert.equal(overlayRejection(rej("faltan-materiales"), blocked, REJECTION_WINDOW_MS + 1).keep, false);
  // Permisos: bloqueado con «Necesitas permiso».
  assert.match(overlayRejection(rej("sin-permiso"), before, 1_000).step.why, /Necesitas permiso/);
  // Técnico: transitorio, caduca a los 4 s.
  const tech = overlayRejection(rej("demasiadas-solicitudes"), before, 1_000);
  assert.equal(tech.step.status, "NO_VERIFICADO");
  assert.match(tech.step.why, /técnico/);
  assert.equal(overlayRejection(rej("demasiadas-solicitudes"), before, TECHNICAL_WINDOW_MS + 1).keep, false);
  assert.equal(overlayRejection(rej("demasiadas-solicitudes"), before, TECHNICAL_WINDOW_MS + 1).step.status, "DISPONIBLE");
  // Si el paso ya es otro, se muestra la verdad y el aviso se retira.
  const other: Step = { ...before, key: "recoger:madera", type: "collect" };
  const gone = overlayRejection(rej("faltan-materiales"), other, 1_000);
  assert.equal(gone.step.key, "recoger:madera");
  assert.equal(gone.keep, false);
});
