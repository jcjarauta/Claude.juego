import type { ContributionSource, RejectReason, ReviewDecision } from "./contracts.ts";
import { checkBuild, checkCraft } from "./crafting.ts";
import { blockedBy, isTaskDone } from "./management.ts";
import { checkContribution, projectStatus, taskStatus } from "./projects.ts";
import type { NodeView } from "./resources.ts";
import { practiceProgress, skillLevelName, type SkillLevels } from "./skills.ts";
import { recipeProducts, recipeVerb, type MissionDef, type ProjectDef, type RecipeDef, type SkillDef, type StructureDef } from "./world-config.ts";

// Objetivo actual (G3c, Q215–Q226). Modelo puro: sin DOM, sin red y sin reloj. Calcula, a partir de una instantánea del estado
// sincronizado, la SIGUIENTE ACCIÓN hacia el OBJETIVO ACTIVO que eligió la persona. Usa las mismas funciones de reglas que el
// servidor (checkCraft, checkBuild, checkContribution…), nunca reglas paralelas.
//
// DISPONIBLE significa «las condiciones se cumplen según el último estado sincronizado»: NO garantiza que el servidor lo acepte
// ante cambios concurrentes. El servidor conserva siempre la autoridad (CLAUDE.md §7).

export type StepStatus = "DISPONIBLE" | "BLOQUEADO" | "NO_VERIFICADO" | "COMPLETADO";

export type Objective = (
  | { kind: "mission"; id: string }
  | { kind: "task"; project: string; task: string }
  /** Obtener `amount` unidades del objeto en el almacén común. */
  | { kind: "item"; item: string; amount: number }
  | { kind: "skill"; skill: string; level: number }
) & {
  /** Ruta elegida por la persona (identidad de la ruta) cuando hay varias viables; sirve a cualquier tipo de objetivo. */
  route?: string;
};

export interface Requirement {
  /** Código estable (para pruebas y para no repetir). */
  code: string;
  text: string;
  /** Cómo resolverlo. */
  how: string;
}

export type StepType = "collect" | "deposit" | "contribute" | "build" | "craft" | "go" | "choose-route" | "wait" | "done" | "none";

export interface StepAction {
  type: StepType;
  resource?: string;
  amount?: number;
  recipe?: string;
  /** Verbo de la receta con mayúscula inicial («Moler»), para el botón de la acción. */
  verb?: string;
  structure?: string;
  project?: string;
  task?: string;
  from?: ContributionSource;
}

export interface RouteSummary {
  /** Receta(s) que la identifican, en orden de fabricación. */
  id: string;
  text: string;
  viable: boolean;
  blockers: Requirement[];
  cost: { gather: number; deposit: number; crafts: number };
}

export interface Step {
  /** Identidad estable: tipo + destino. No cambia con las cantidades. */
  key: string;
  status: StepStatus;
  type: StepType;
  text: string;
  why: string;
  requirements: Requirement[];
  /** Otras formas de avanzar (otras rutas, «pide a…»). */
  alternatives: string[];
  target?: { x: number; y: number; label: string };
  progress?: { done: number; total: number };
  action?: StepAction;
  routes?: RouteSummary[];
  /** El objetivo ya no tiene sentido (proyecto cerrado, objeto borrado…). */
  obsolete?: boolean;
}

// ---------------------------------------------------------------- instantánea

export interface ProjectView {
  def: ProjectDef;
  /** Aportado por recurso al proyecto. */
  contributed: Readonly<Record<string, number>>;
  /** Última revisión por tarea. */
  decisions: Readonly<Record<string, ReviewDecision | "">>;
  closed: boolean;
  /** Completado según el servidor (construido, o tareas hechas si no hay edificio). */
  completed: boolean;
  /** Con buildRequiresApproval: falta alguna tarea por aprobar. */
  approvalMissing: boolean;
}

export interface Snapshot {
  me: { name: string; x: number; y: number; inventory: Readonly<Record<string, number>>; skills: SkillLevels; crafts: Readonly<Record<string, number>> };
  inventoryMax: number;
  /** Almacén común. */
  stock: Readonly<Record<string, number>>;
  nodes: readonly NodeView[];
  /** id → nombre. */
  resources: Readonly<Record<string, string>>;
  items: Readonly<Record<string, string>>;
  recipes: readonly RecipeDef[];
  structures: readonly { def: StructureDef; built: boolean }[];
  skills: readonly SkillDef[];
  projects: readonly ProjectView[];
  missions: readonly { def: MissionDef; completed: boolean }[];
  others: readonly { name: string; x: number; y: number; connected: boolean; skills: SkillLevels }[];
  offers: readonly { id: string; from: string; skill: string; level: number }[];
}

export const MAX_DEPTH = 8;
export const MAX_ROUTES = 24;

const nameOf = (s: Snapshot, id: string) => s.items[id] ?? s.resources[id] ?? id;
const isItem = (s: Snapshot, id: string) => id in s.items;
const have = (r: Readonly<Record<string, number>>, id: string) => r[id] ?? 0;
const skillDef = (s: Snapshot, id: string) => s.skills.find((k) => k.id === id);
const structureOf = (s: Snapshot, id: string) => s.structures.find((x) => x.def.id === id);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const step = (partial: Partial<Step> & Pick<Step, "key" | "status" | "type" | "text">): Step =>
  ({ why: "", requirements: [], alternatives: [], ...partial });

const unknown = (key: string, text: string, why: string): Step => step({ key, status: "NO_VERIFICADO", type: "none", text, why });

// ---------------------------------------------------------------- planificador de rutas (libro de necesidades)

type PlanAction =
  | { type: "collect"; resource: string; amount: number }
  | { type: "deposit"; resource: string; amount: number }
  | { type: "craft"; recipe: RecipeDef; times: number };

interface LedgerLine {
  needed: number;
  fromStock: number;
  fromInventory: number;
  fromNodes: number;
  fromCrafts: number;
  missing: number;
}

interface PlanState {
  /** Existencias del almacén más lo que ya han producido los pasos anteriores de la ruta (cada unidad se descuenta una sola vez). */
  avail: Map<string, number>;
  inv: Map<string, number>;
  nodeUnits: Map<string, number>;
  ledger: Map<string, LedgerLine>;
  actions: PlanAction[];
  blockers: Requirement[];
}

const cloneState = (st: PlanState): PlanState => ({
  avail: new Map(st.avail),
  inv: new Map(st.inv),
  nodeUnits: new Map(st.nodeUnits),
  ledger: new Map([...st.ledger].map(([k, v]) => [k, { ...v }])),
  actions: [...st.actions],
  blockers: [...st.blockers],
});

const line = (st: PlanState, id: string): LedgerLine => {
  let l = st.ledger.get(id);
  if (!l) { l = { needed: 0, fromStock: 0, fromInventory: 0, fromNodes: 0, fromCrafts: 0, missing: 0 }; st.ledger.set(id, l); }
  return l;
};

const addBlocker = (st: PlanState, b: Requirement) => { if (!st.blockers.some((x) => x.code === b.code)) st.blockers.push(b); };

export interface Route {
  /** Recetas en orden de fabricación, unidas por «>». */
  id: string;
  actions: PlanAction[];
  ledger: ReadonlyMap<string, LedgerLine>;
  blockers: Requirement[];
  viable: boolean;
  cost: { gather: number; deposit: number; crafts: number };
}

export interface PlanResult {
  routes: Route[];
  /** Rutas descartadas y por qué («ciclo Harina → Pan → Harina»). */
  discarded: string[];
  truncated: boolean;
}

type Root = { kind: "item"; item: string; amount: number } | { kind: "craft"; recipe: RecipeDef; times: number };

/** Recetas que producen el objeto (salida principal o subproducto) y cuántas unidades da cada fabricación. */
const producers = (s: Snapshot, item: string) =>
  s.recipes.flatMap((r) => { const y = recipeProducts(r).filter((p) => p.item === item).reduce((n, p) => n + p.amount, 0); return y > 0 ? [{ recipe: r, yieldPer: y }] : []; });

export function planRoutes(s: Snapshot, root: Root): PlanResult {
  const discarded: string[] = [];
  let truncated = false;
  const routes: Route[] = [];
  const seen = new Set<string>();
  let produced = 0;

  const start: PlanState = {
    avail: new Map(Object.entries(s.stock)),
    inv: new Map(Object.entries(s.me.inventory)),
    nodeUnits: new Map(),
    ledger: new Map(),
    actions: [],
    blockers: [],
  };
  for (const n of s.nodes) start.nodeUnits.set(n.resource, (start.nodeUnits.get(n.resource) ?? 0) + n.units);

  const takeAvail = (st: PlanState, id: string, n: number) => {
    const got = Math.min(n, st.avail.get(id) ?? 0);
    st.avail.set(id, (st.avail.get(id) ?? 0) - got);
    return got;
  };

  function* satisfy(id: string, n: number, st: PlanState, path: readonly string[]): Generator<PlanState> {
    if (n <= 0) { yield st; return; }
    const l = line(st, id);
    l.needed += n;
    const fromAvail = takeAvail(st, id, n);
    l.fromStock += fromAvail;
    let deficit = n - fromAvail;
    if (deficit <= 0) { yield st; return; }

    if (!isItem(s, id)) {
      // Recurso: lo que llevas encima solo cuenta cuando lo depositas; después, los nodos con unidades.
      const inv = Math.min(deficit, st.inv.get(id) ?? 0);
      if (inv > 0) { st.inv.set(id, (st.inv.get(id) ?? 0) - inv); st.actions.push({ type: "deposit", resource: id, amount: inv }); l.fromInventory += inv; deficit -= inv; }
      const nodes = Math.min(deficit, st.nodeUnits.get(id) ?? 0);
      if (nodes > 0) { st.nodeUnits.set(id, (st.nodeUnits.get(id) ?? 0) - nodes); st.actions.push({ type: "collect", resource: id, amount: nodes }); l.fromNodes += nodes; deficit -= nodes; }
      if (deficit > 0) {
        l.missing += deficit;
        addBlocker(st, { code: `sin-unidades:${id}`, text: `No hay unidades suficientes de ${nameOf(s, id).toLowerCase()} en los nodos ahora (faltan ${deficit}).`, how: "Espera a que se regeneren o pide a alguien que las recoja." });
      }
      yield st;
      return;
    }

    if (path.length >= MAX_DEPTH) {
      discarded.push(`Ruta descartada: profundidad máxima (${MAX_DEPTH}) al producir ${nameOf(s, id)}.`);
      return;
    }
    const options = producers(s, id);
    if (options.length === 0) {
      l.missing += deficit;
      addBlocker(st, { code: `sin-receta:${id}`, text: `No hay ninguna receta que produzca ${nameOf(s, id).toLowerCase()} y no hay existencias.`, how: "Pide a la administración que defina una receta." });
      yield st;
      return;
    }
    for (const { recipe, yieldPer } of options) {
      if (path.includes(id)) { discarded.push(`Ruta descartada: ciclo ${[...path.slice(path.indexOf(id)), id].map((p) => nameOf(s, p)).join(" → ")}.`); continue; }
      const times = Math.ceil(deficit / yieldPer);
      const branch = cloneState(st);
      const before = branch.ledger.get(id)!;
      before.fromCrafts += times * yieldPer;
      for (const done of craftRecipe(recipe, times, branch, [...path, id])) {
        // Producto principal y subproductos entran en las existencias; después se consume lo que esta necesidad pedía.
        const out = cloneState(done);
        out.avail.set(id, (out.avail.get(id) ?? 0) - deficit);
        yield out;
      }
    }
  }

  /** Satisface los ingredientes de `times` fabricaciones de la receta y añade la fabricación (con sus productos). */
  function* craftRecipe(recipe: RecipeDef, times: number, st: PlanState, path: readonly string[]): Generator<PlanState> {
    const entries = Object.entries(recipe.inputs);
    function* inputs(i: number, cur: PlanState): Generator<PlanState> {
      if (i === entries.length) { yield cur; return; }
      const [input, amount] = entries[i]!;
      for (const next of satisfy(input, amount * times, cur, path)) yield* inputs(i + 1, next);
    }
    for (const done of inputs(0, st)) {
      const out = cloneState(done);
      checkRecipeAccess(recipe, out);
      out.actions.push({ type: "craft", recipe, times });
      for (const p of recipeProducts(recipe)) out.avail.set(p.item, (out.avail.get(p.item) ?? 0) + p.amount * times);
      yield out;
    }
  }

  function checkRecipeAccess(recipe: RecipeDef, st: PlanState) {
    const b = structureOf(s, recipe.structureId);
    if (!b) { addBlocker(st, { code: `edificio-desconocido:${recipe.structureId}`, text: `La receta «${recipe.name}» usa un edificio que ya no existe.`, how: "Avisa a la administración." }); return; }
    if (!b.built) addBlocker(st, { code: `sin-construir:${b.def.id}`, text: `Falta construir ${b.def.name}.`, how: `Completa el proyecto «${b.def.projectId}» y constrúyelo.` });
    for (const extra of recipe.alsoNeeds ?? []) {
      const e = structureOf(s, extra);
      if (!e) addBlocker(st, { code: `edificio-desconocido:${extra}`, text: `La receta «${recipe.name}» exige un edificio que ya no existe.`, how: "Avisa a la administración." });
      else if (!e.built) addBlocker(st, { code: `sin-construir:${e.def.id}`, text: `Falta construir ${e.def.name}.`, how: `Completa el proyecto «${e.def.projectId}» y constrúyelo.` });
    }
    const defs = new Map(s.skills.map((k) => [k.id, k]));
    for (const q of recipe.requiresSkills ?? []) {
      const lvl = have(s.me.skills, q.skill);
      if (lvl >= q.level) continue;
      const def = defs.get(q.skill);
      addBlocker(st, {
        code: `habilidad:${q.skill}:${q.level}`,
        text: `Te falta ${def ? `${def.name} (${skillLevelName(def, q.level)})` : q.skill}; ${lvl > 0 && def ? `tienes ${skillLevelName(def, lvl)}` : "no la tienes"}.`,
        how: "Practica la receta de práctica o pide a alguien con más nivel que te enseñe.",
      });
    }
  }

  const finalize = (st: PlanState) => {
    if (routes.length >= MAX_ROUTES) { truncated = true; return; }
    const crafts = st.actions.filter((a): a is Extract<PlanAction, { type: "craft" }> => a.type === "craft");
    const id = crafts.map((c) => c.recipe.id).join(">") || "directa";
    if (seen.has(id)) return;
    seen.add(id);
    // Orden de acción: recoger, depositar y fabricar; recoger y depositar se agrupan por recurso (cantidades totales).
    const sumBy = (type: "collect" | "deposit") => {
      const totals = new Map<string, number>();
      for (const a of st.actions) if (a.type === type) totals.set(a.resource, (totals.get(a.resource) ?? 0) + a.amount);
      return [...totals].map(([resource, amount]) => ({ type, resource, amount }) as PlanAction);
    };
    const actions = [...sumBy("collect"), ...sumBy("deposit"), ...crafts];
    const gather = sumBy("collect").reduce((n, a) => n + (a as { amount: number }).amount, 0);
    const deposit = sumBy("deposit").reduce((n, a) => n + (a as { amount: number }).amount, 0);
    routes.push({ id, actions, ledger: st.ledger, blockers: st.blockers, viable: st.blockers.length === 0, cost: { gather, deposit, crafts: crafts.reduce((n, c) => n + c.times, 0) } });
  };

  if (root.kind === "item") {
    for (const st of satisfy(root.item, root.amount, cloneState(start), [])) { produced++; finalize(st); if (produced > MAX_ROUTES * 4) { truncated = true; break; } }
  } else {
    for (const st of craftRecipe(root.recipe, root.times, cloneState(start), [])) { produced++; finalize(st); if (produced > MAX_ROUTES * 4) { truncated = true; break; } }
  }
  return { routes, discarded: [...new Set(discarded)], truncated };
}

const routeText = (s: Snapshot, r: Route) => {
  const parts = r.actions.map((a) =>
    a.type === "craft" ? `${recipeVerb(a.recipe).toLowerCase()} ${nameOf(s, a.recipe.output.item).toLowerCase()} con «${a.recipe.name}» (×${a.times})`
      : a.type === "collect" ? `recoger ${a.amount} de ${nameOf(s, a.resource).toLowerCase()}` : `depositar ${a.amount} de ${nameOf(s, a.resource).toLowerCase()}`);
  return parts.length ? parts.join("; ") : "ya está en el almacén";
};

const summarize = (s: Snapshot, routes: readonly Route[]): RouteSummary[] =>
  routes.map((r) => ({ id: r.id, text: routeText(s, r), viable: r.viable, blockers: r.blockers, cost: r.cost }));

const score = (r: Route) => r.cost.gather + r.cost.deposit + r.cost.crafts * 2;

// ---------------------------------------------------------------- evaluación de pasos

const targetOf = (s: Snapshot, st: StructureDef) => ({ x: st.x, y: st.y, label: st.name });

function goTo(s: Snapshot, st: StructureDef, why: string, key = `go:${st.id}`): Step {
  const d = chebyshev(s.me, { x: st.x, y: st.y });
  return step({ key, status: "DISPONIBLE", type: "go", text: `Ve a ${st.name} (a ${plural(d, "casilla", "casillas")}).`, why, target: targetOf(s, st), action: { type: "go", structure: st.id } });
}

function nearestNode(s: Snapshot, resource: string): NodeView | undefined {
  return s.nodes.filter((n) => n.resource === resource && n.units > 0).sort((a, b) => chebyshev(s.me, a) - chebyshev(s.me, b) || a.id.localeCompare(b.id))[0];
}

/** Tarea de un proyecto: aportar (o conseguir lo que falta para aportar). */
function evaluateTask(s: Snapshot, projectId: string, taskId: string, context = ""): Step {
  const pv = s.projects.find((p) => p.def.id === projectId);
  const task = pv?.def.tasks.find((t) => t.id === taskId);
  const key = `tarea:${projectId}:${taskId}`;
  if (!pv || !task) return { ...unknown(key, "Esta tarea ya no existe.", "El proyecto o la tarea se han retirado."), obsolete: true };
  if (pv.closed) return { ...unknown(key, "Este proyecto está cerrado.", "Un proyecto cerrado ya no admite aportes."), obsolete: true };
  const contributed = have(pv.contributed, task.resource);
  const status = taskStatus(task, contributed, pv.decisions[task.id]);
  if (contributed >= task.required) {
    return step({ key, status: "COMPLETADO", type: "done", text: `Tarea completa: ${task.title}.`, why: pv.def.buildRequiresApproval && !isTaskDone(status, true) ? "Falta la revisión de una persona coordinadora." : "", progress: { done: task.required, total: task.required } });
  }
  const doneIds = (id: string) => { const t = pv.def.tasks.find((x) => x.id === id); return t ? isTaskDone(taskStatus(t, have(pv.contributed, t.resource), pv.decisions[t.id]), pv.def.buildRequiresApproval) : true; };
  const blockers = blockedBy(task, doneIds);
  const remaining = task.required - contributed;
  const progress = { done: contributed, total: task.required };
  if (blockers.length) {
    const names = blockers.map((b) => pv.def.tasks.find((t) => t.id === b)?.title ?? b);
    return step({ key, status: "BLOQUEADO", type: "none", text: `${task.title} está bloqueada.`, why: context, progress,
      requirements: [{ code: `dependencia:${blockers.join(",")}`, text: `Primero hay que terminar: ${names.join(", ")}.`, how: `Termina «${names[0]}».` }] });
  }
  const inInventory = have(s.me.inventory, task.resource);
  const inStock = have(s.stock, task.resource);
  const contribute = (from: ContributionSource, available: number) => {
    const amount = Math.min(remaining, available);
    const check = checkContribution({
      projects: [pv.def], projectId, taskId, from, amount,
      contributed: (_p, r) => have(pv.contributed, r), balance: (src, r) => (src === "player" ? have(s.me.inventory, r) : have(s.stock, r)),
      closed: () => pv.closed, blocked: () => false,
    });
    return check.ok
      ? step({ key, status: "DISPONIBLE", type: "contribute", text: `Aporta ${amount} de ${nameOf(s, task.resource).toLowerCase()} a «${task.title}».`, why: context || `Faltan ${remaining} para completar la tarea.`, progress, action: { type: "contribute", project: projectId, task: taskId, resource: task.resource, amount, from } })
      : unknown(key, `Aportar a «${task.title}».`, `Las reglas no lo permiten ahora (${check.reason}).`);
  };
  if (inInventory > 0) return contribute("player", inInventory);
  if (inStock > 0) return contribute("community", inStock);
  // Nada disponible: conseguirlo.
  if (!isItem(s, task.resource)) {
    const node = nearestNode(s, task.resource);
    if (!node) {
      return step({ key, status: "BLOQUEADO", type: "none", text: `No hay de dónde sacar ${nameOf(s, task.resource).toLowerCase()} ahora.`, why: context, progress,
        requirements: [{ code: `sin-unidades:${task.resource}`, text: `Los nodos de ${nameOf(s, task.resource).toLowerCase()} están agotados.`, how: "Espera a que se regeneren." }] });
    }
    return collectStep(s, node, remaining, progress, context || `Hacen falta ${remaining} para «${task.title}».`);
  }
  return fromItemObjective(s, { kind: "item", item: task.resource, amount: remaining }, `Para «${task.title}» hace falta ${nameOf(s, task.resource).toLowerCase()}.`, progress);
}

function collectStep(s: Snapshot, node: NodeView, total: number, progress: Step["progress"], why: string): Step {
  const label = nameOf(s, node.resource);
  const held = have(s.me.inventory, node.resource);
  const key = `recoger:${node.resource}`;
  const room = s.inventoryMax - held;
  const requirements: Requirement[] = [];
  if (room <= 0) {
    return step({ key, status: "BLOQUEADO", type: "collect", text: `Tu inventario de ${label.toLowerCase()} está lleno.`, why, progress,
      requirements: [{ code: "inventario-lleno", text: `Llevas el máximo de ${label.toLowerCase()} (${s.inventoryMax}).`, how: "Deposita parte en el almacén o aporta a una tarea." }] });
  }
  const adjacent = chebyshev(s.me, node) === 1;
  const amount = Math.min(total, room);
  if (!adjacent) {
    const d = chebyshev(s.me, node);
    return step({ key: `ir:${node.resource}`, status: "DISPONIBLE", type: "go", text: `Ve a por ${label.toLowerCase()} (a ${plural(d, "casilla", "casillas")}) y recoge ${amount}.`, why, requirements, progress,
      target: { x: node.x, y: node.y, label }, action: { type: "go", resource: node.resource } });
  }
  return step({ key, status: "DISPONIBLE", type: "collect", text: `Recoge ${amount} de ${label.toLowerCase()}.`, why, progress, target: { x: node.x, y: node.y, label }, action: { type: "collect", resource: node.resource, amount } });
}

/** Tarea del proyecto o construcción: el objetivo «completar este proyecto». */
function evaluateProject(s: Snapshot, projectId: string, context = ""): Step {
  const pv = s.projects.find((p) => p.def.id === projectId);
  const key = `proyecto:${projectId}`;
  if (!pv) return { ...unknown(key, "Este proyecto ya no existe.", "Se ha retirado."), obsolete: true };
  if (pv.completed) return step({ key, status: "COMPLETADO", type: "done", text: `Proyecto completado: ${pv.def.name}.` });
  if (pv.closed) return { ...unknown(key, "Este proyecto está cerrado.", "Un proyecto cerrado ya no avanza."), obsolete: true };
  const ready = projectStatus(pv.def, (r) => have(pv.contributed, r)) === "listo";
  const structure = s.structures.find((x) => x.def.projectId === projectId);
  if (ready && structure && !structure.built) {
    const others = s.others.filter((o) => o.connected).map((o) => ({ x: o.x, y: o.y }));
    const check = checkBuild({ structure: structure.def, projectReady: true, approvalMissing: pv.approvalMissing, built: false, position: s.me, others });
    const stKey = `construir:${structure.def.id}`;
    if (check.ok) return step({ key: stKey, status: "DISPONIBLE", type: "build", text: `Construye ${structure.def.name}.`, why: context || "El proyecto tiene todo lo necesario.", target: targetOf(s, structure.def), action: { type: "build", structure: structure.def.id } });
    if (check.reason === "lejos-del-solar") return goTo(s, structure.def, context || `Para construir ${structure.def.name} hay que estar junto al solar.`, `ir-solar:${structure.def.id}`);
    if (check.reason === "tareas-sin-aprobar") return step({ key: stKey, status: "NO_VERIFICADO", type: "wait", text: `Espera la revisión de las tareas de ${pv.def.name}.`, why: "Construir exige tareas aprobadas por una persona coordinadora.", requirements: [{ code: "tareas-sin-aprobar", text: "Faltan tareas por aprobar.", how: "Pide a una persona coordinadora que las revise." }] });
    return step({ key: stKey, status: "BLOQUEADO", type: "build", text: `No puedes construir ${structure.def.name} ahora.`, why: context, requirements: [{ code: check.reason, text: check.reason === "solar-ocupado" ? "Hay alguien dentro del solar." : "El solar no está disponible.", how: "Pide que se aparten o inténtalo de nuevo." }] });
  }
  // Primera tarea pendiente cuyo bloqueo por dependencias ya está resuelto.
  const doneIds = (id: string) => { const t = pv.def.tasks.find((x) => x.id === id); return t ? isTaskDone(taskStatus(t, have(pv.contributed, t.resource), pv.decisions[t.id]), pv.def.buildRequiresApproval) : true; };
  const pending = pv.def.tasks.filter((t) => have(pv.contributed, t.resource) < t.required);
  const open = pending.find((t) => blockedBy(t, doneIds).length === 0) ?? pending[0];
  if (open) return evaluateTask(s, projectId, open.id, context);
  if (!structure) return step({ key, status: "NO_VERIFICADO", type: "wait", text: `Espera a que ${pv.def.name} se dé por completado.`, why: "Todas las tareas están hechas; falta la revisión o el cierre." });
  return unknown(key, `Estado de ${pv.def.name} sin determinar.`, "Los datos del proyecto no permiten decidir el siguiente paso.");
}

/** Mejor ruta para obtener un objeto en el almacén; con varias viables no elige: pide elegir. */
function fromItemObjective(s: Snapshot, obj: Extract<Objective, { kind: "item" }>, context = "", progress?: Step["progress"]): Step {
  const key = `objeto:${obj.item}`;
  const label = nameOf(s, obj.item).toLowerCase();
  if (!isItem(s, obj.item) && !(obj.item in s.resources)) return { ...unknown(key, "Este objeto ya no existe.", "Se ha retirado."), obsolete: true };
  if (have(s.stock, obj.item) >= obj.amount) return step({ key, status: "COMPLETADO", type: "done", text: `Ya hay ${obj.amount} de ${label} en el almacén.`, progress: { done: obj.amount, total: obj.amount } });
  const plan = planRoutes(s, { kind: "item", item: obj.item, amount: obj.amount });
  return fromPlan(s, plan, key, label, context, progress ?? { done: have(s.stock, obj.item), total: obj.amount });
}

function fromPlan(s: Snapshot, plan: PlanResult, key: string, label: string, context: string, progress: Step["progress"], chosen = chosenRoute): Step {
  if (plan.routes.length === 0) {
    return unknown(key, `No se encuentra cómo obtener ${label}.`, plan.discarded[0] ?? (plan.truncated ? "Demasiadas rutas: elige un objetivo más concreto." : "No hay recetas que lo produzcan."));
  }
  const summaries = summarize(s, plan.routes);
  const viable = plan.routes.filter((r) => r.viable);
  let route: Route | undefined = chosen ? plan.routes.find((r) => r.id.split(">").includes(chosen) || r.id === chosen) : undefined;
  if (!route && viable.length > 1) {
    return step({ key: `${key}:elegir`, status: "DISPONIBLE", type: "choose-route", text: `Hay ${viable.length} formas de obtener ${label}: elige una.`, why: context, progress, routes: summaries,
      alternatives: summaries.filter((r) => r.viable).map((r) => r.text) });
  }
  route = route ?? viable[0] ?? [...plan.routes].sort((a, b) => a.blockers.length - b.blockers.length || score(a) - score(b))[0]!;
  const alternatives = summaries.filter((r) => r.id !== route!.id).map((r) => r.viable ? `Otra ruta: ${r.text}.` : `Otra ruta (bloqueada: ${r.blockers[0]?.text ?? "?"}): ${r.text}.`);
  if (plan.truncated) alternatives.push("Hay más rutas de las que se muestran: elige un objetivo más concreto.");
  const first = route.actions[0];

  // Un bloqueo se resuelve con su propio camino: construir el edificio o conseguir la habilidad.
  if (!route.viable) {
    const b = route.blockers[0]!;
    if (b.code.startsWith("sin-construir:")) {
      const sid = b.code.slice("sin-construir:".length);
      const projectId = structureOf(s, sid)?.def.projectId;
      if (projectId) {
        const sub = evaluateProject(s, projectId, `Para obtener ${label} primero hace falta ${structureOf(s, sid)!.def.name}.`);
        return { ...sub, requirements: [b, ...sub.requirements], alternatives: [...sub.alternatives, ...alternatives] };
      }
    }
    if (b.code.startsWith("habilidad:")) {
      const [, skill, level] = b.code.split(":");
      const sub = evaluateSkill(s, skill!, Number(level), `Para obtener ${label} necesitas esa habilidad.`);
      return { ...sub, requirements: [b, ...sub.requirements], alternatives: [...sub.alternatives, ...alternatives] };
    }
    if (b.code.startsWith("edificio-desconocido:")) {
      return step({ key, status: "NO_VERIFICADO", type: "none", text: `No se puede comprobar cómo obtener ${label}.`, why: b.text, progress, requirements: route.blockers, alternatives, routes: summaries });
    }
    return step({ key, status: "BLOQUEADO", type: "none", text: `No puedes obtener ${label} ahora.`, why: context, progress, requirements: route.blockers, alternatives, routes: summaries });
  }

  if (!first) return step({ key, status: "COMPLETADO", type: "done", text: `Ya hay ${label} en el almacén.`, progress });
  if (first.type === "collect") {
    const node = nearestNode(s, first.resource);
    if (!node) return step({ key, status: "NO_VERIFICADO", type: "none", text: `Recoger ${nameOf(s, first.resource).toLowerCase()}.`, why: "No se encuentra un nodo con unidades.", progress });
    return { ...collectStep(s, node, first.amount, progress, context || `Para obtener ${label}.`), alternatives, routes: summaries };
  }
  if (first.type === "deposit") {
    return step({ key: `depositar:${first.resource}`, status: "DISPONIBLE", type: "deposit", text: `Deposita ${first.amount} de ${nameOf(s, first.resource).toLowerCase()} en el almacén.`, why: context || `Fabricar usa el almacén, no tu inventario.`, progress, alternatives, routes: summaries,
      action: { type: "deposit", resource: first.resource, amount: first.amount } });
  }
  // fabricar
  const recipe = first.recipe;
  const structure = structureOf(s, recipe.structureId)!;
  const defs = new Map(s.skills.map((k) => [k.id, k]));
  const check = checkCraft({
    recipe, structure: structure.def, structureBuilt: structure.built,
    extraBuildings: (recipe.alsoNeeds ?? []).flatMap((id) => { const e = structureOf(s, id); return e ? [{ id, name: e.def.name, built: e.built }] : []; }),
    skills: defs, skillLevel: (k) => have(s.me.skills, k), position: s.me, stock: (id) => have(s.stock, id),
  });
  const craftKey = `fabricar:${recipe.id}`;
  const verb = recipeVerb(recipe).replace(/^./, (c) => c.toUpperCase());
  if (check.ok) {
    return step({ key: craftKey, status: "DISPONIBLE", type: "craft", text: `${verb} ${nameOf(s, recipe.output.item).toLowerCase()}${first.times > 1 ? ` (×${first.times})` : ""}.`, why: context || `Es el paso que produce ${label}.`, progress, alternatives, routes: summaries,
      target: targetOf(s, structure.def), action: { type: "craft", recipe: recipe.id, amount: first.times, structure: structure.def.id, verb } });
  }
  if (check.reason === "lejos-del-taller") return { ...goTo(s, structure.def, context || `${verb} ${nameOf(s, recipe.output.item).toLowerCase()} exige estar junto a ${structure.def.name}.`), alternatives, routes: summaries };
  const reqText = check.details?.[0] ?? "";
  return step({ key: craftKey, status: "NO_VERIFICADO", type: "craft", text: `${verb} ${nameOf(s, recipe.output.item).toLowerCase()}.`, why: `El cliente no puede confirmarlo (${check.reason}${reqText ? `: ${reqText}` : ""}).`, progress, alternatives, routes: summaries });
}

/** Habilidad: practicar su receta de práctica o pedir que te la enseñen. */
function evaluateSkill(s: Snapshot, skillId: string, level: number, context = ""): Step {
  const def = skillDef(s, skillId);
  const key = `habilidad:${skillId}:${level}`;
  if (!def) return { ...unknown(key, "Esta habilidad ya no existe.", "Se ha retirado."), obsolete: true };
  const mine = have(s.me.skills, skillId);
  if (mine >= level) return step({ key, status: "COMPLETADO", type: "done", text: `Tienes ${def.name} (${skillLevelName(def, mine)}).` });
  const progress = practiceProgress(def, mine, (r) => have(s.me.crafts, r));
  if (!progress) return unknown(key, `${def.name}: sin siguiente nivel.`, "No hay un nivel por practicar.");
  const alternatives: string[] = [];
  const teachers = s.others.filter((o) => o.connected && have(o.skills, skillId) - 1 >= mine + 1);
  for (const t of teachers) alternatives.push(`Pide a ${t.name} (${skillLevelName(def, have(t.skills, skillId))}) que te enseñe ${skillLevelName(def, mine + 1)}; tiene que estar a 2 casillas o menos.`);
  const offer = s.offers.find((o) => o.skill === skillId);
  if (offer) alternatives.unshift(`Tienes una oferta de ${offer.from} que te sirve: respóndela en Importantes.`);
  const recipe = s.recipes.find((r) => r.id === progress.recipe);
  const total = progress.times;
  const bar = { done: progress.done, total };
  if (!recipe) return { ...unknown(key, `Practicar ${def.name}.`, "La receta de práctica ya no existe."), alternatives };
  const times = Math.max(1, total - progress.done);
  const plan = planRoutes(s, { kind: "craft", recipe, times });
  const why = context || `Para ${skillLevelName(def, mine + 1)} en ${def.name}: ${recipeVerb(recipe).toLowerCase()} «${recipe.name}» ${plural(total, "vez", "veces")} (llevas ${progress.done}).`;
  const sub = fromPlan(s, plan, key, nameOf(s, recipe.output.item).toLowerCase(), why, bar);
  return { ...sub, key: sub.type === "craft" || sub.type === "go" ? sub.key : key, alternatives: [...alternatives, ...sub.alternatives], progress: bar };
}

function evaluateMission(s: Snapshot, id: string): Step {
  const m = s.missions.find((x) => x.def.id === id);
  const key = `mision:${id}`;
  if (!m) return { ...unknown(key, "Esta misión ya no existe.", "Se ha retirado."), obsolete: true };
  if (m.completed) return step({ key, status: "COMPLETADO", type: "done", text: `Misión completada: ${m.def.name}.` });
  const why = `Misión «${m.def.name}».`;
  const o = m.def.objective;
  return o.kind === "item-in-community"
    ? fromItemObjective(s, { kind: "item", item: o.item, amount: o.amount }, why)
    : evaluateProject(s, o.project, why);
}

/** Ruta elegida del objetivo que se está evaluando (la evaluación es síncrona, así que basta una variable de módulo). */
let chosenRoute: string | undefined;

export function evaluateObjective(obj: Objective, s: Snapshot): Step {
  chosenRoute = obj.route;
  try {
    switch (obj.kind) {
      case "mission": return evaluateMission(s, obj.id);
      case "task": return evaluateTask(s, obj.project, obj.task);
      case "item": return fromItemObjective(s, obj);
      case "skill": return evaluateSkill(s, obj.skill, obj.level);
    }
  } finally {
    chosenRoute = undefined;
  }
}

export interface Candidate {
  objective: Objective;
  label: string;
}

/** Objetivos que la persona puede elegir, ordenados: misiones, tareas pendientes de proyectos abiertos y habilidades por conseguir. */
export function suggestObjectives(s: Snapshot): Candidate[] {
  const out: Candidate[] = [];
  for (const m of s.missions) if (!m.completed) out.push({ objective: { kind: "mission", id: m.def.id }, label: `Misión: ${m.def.name}` });
  for (const pv of s.projects) {
    if (pv.closed || pv.completed) continue;
    for (const t of pv.def.tasks) if (have(pv.contributed, t.resource) < t.required) out.push({ objective: { kind: "task", project: pv.def.id, task: t.id }, label: `Tarea: ${t.title} (${pv.def.name})` });
  }
  for (const k of s.skills) {
    const mine = have(s.me.skills, k.id);
    if (mine < k.levels.length) out.push({ objective: { kind: "skill", skill: k.id, level: mine + 1 }, label: `Habilidad: ${k.name} (${skillLevelName(k, mine + 1)})` });
  }
  return out;
}

/** Nombre legible del objetivo para la zona C y los diálogos. */
export function objectiveLabel(obj: Objective, s: Snapshot): string {
  switch (obj.kind) {
    case "mission": return `Misión: ${s.missions.find((m) => m.def.id === obj.id)?.def.name ?? obj.id}`;
    case "task": {
      const pv = s.projects.find((p) => p.def.id === obj.project);
      return `Tarea: ${pv?.def.tasks.find((t) => t.id === obj.task)?.title ?? obj.task}${pv ? ` (${pv.def.name})` : ""}`;
    }
    case "item": return `Obtener ${obj.amount} de ${nameOf(s, obj.item).toLowerCase()}`;
    case "skill": { const d = skillDef(s, obj.skill); return `Habilidad: ${d?.name ?? obj.skill} (${d ? skillLevelName(d, obj.level) : `nivel ${obj.level}`})`; }
  }
}

/** ¿El objetivo guardado sigue existiendo? (si no, se pide elegir otro) */
export const isObsolete = (obj: Objective, s: Snapshot): boolean => evaluateObjective(obj, s).obsolete === true;

// ---------------------------------------------------------------- rechazos del servidor (precisión C)

export type RejectionClass = "bloqueo-confirmado" | "estado-desactualizado" | "permisos" | "error-tecnico";

/** `bloqueo` = depende de si el estado actual todavía explica el rechazo (ver classifyRejection). */
const REJECTION_TABLE: Record<RejectReason, RejectionClass | "bloqueo"> = {
  "movimiento-invalido": "error-tecnico",
  "movimiento-demasiado-rapido": "error-tecnico",
  "fuera-del-mapa": "bloqueo",
  "casilla-bloqueada": "bloqueo",
  "mensaje-desconocido": "error-tecnico",
  "solicitud-invalida": "error-tecnico",
  "recoleccion-demasiado-rapida": "error-tecnico",
  "nodo-lejos": "bloqueo",
  "nodo-agotado": "estado-desactualizado",
  "inventario-lleno": "bloqueo",
  "saldo-insuficiente": "bloqueo",
  "destino-no-permitido": "permisos",
  "tarea-desconocida": "estado-desactualizado",
  "tarea-completa": "estado-desactualizado",
  "origen-no-permitido": "permisos",
  "estructura-desconocida": "estado-desactualizado",
  "receta-desconocida": "estado-desactualizado",
  "proyecto-sin-terminar": "bloqueo",
  "ya-construido": "estado-desactualizado",
  "lejos-del-solar": "bloqueo",
  "solar-ocupado": "estado-desactualizado",
  "taller-sin-construir": "bloqueo",
  "lejos-del-taller": "bloqueo",
  "faltan-materiales": "bloqueo",
  "faltan-edificios": "bloqueo",
  "falta-habilidad": "bloqueo",
  "demasiadas-habilidades": "error-tecnico",
  "oferta-invalida": "estado-desactualizado",
  "sin-permiso": "permisos",
  "tarea-sin-completar": "bloqueo",
  "nota-invalida": "error-tecnico",
  "sin-personaje": "permisos",
  "tareas-sin-aprobar": "bloqueo",
  "demasiadas-solicitudes": "error-tecnico",
  "proyecto-desconocido": "estado-desactualizado",
  "proyecto-cerrado": "permisos",
  "proyecto-de-serie": "permisos",
  "demasiados-proyectos": "error-tecnico",
  "demasiadas-misiones": "error-tecnico",
  "definicion-invalida": "error-tecnico",
  "fecha-invalida": "error-tecnico",
  "motivo-invalido": "error-tecnico",
  "tarea-bloqueada": "bloqueo",
  "comentario-invalido": "error-tecnico",
  "demasiados-responsables": "error-tecnico",
  "demasiadas-construcciones": "error-tecnico",
  "demasiados-objetos": "error-tecnico",
  "demasiadas-recetas": "error-tecnico",
};

export const REJECTION_REASONS = Object.keys(REJECTION_TABLE) as RejectReason[];

/**
 * Clase de un rechazo. Las razones de bloqueo son «confirmadas» solo si el estado actual todavía las explica
 * (`stillExplained`); si el modelo ya no ve la causa (otra persona la resolvió o cambió algo), es estado desactualizado.
 */
export function classifyRejection(reason: RejectReason, stillExplained = true): RejectionClass {
  const c = REJECTION_TABLE[reason];
  if (c === "bloqueo") return stillExplained ? "bloqueo-confirmado" : "estado-desactualizado";
  return c;
}

/**
 * ¿El estado actual todavía explica el rechazo? Sí si el mismo paso (misma identidad) sigue sin estar disponible; si el estado
 * ya muestra otro paso o el mismo disponible, la causa desapareció o la cambió otra persona: estado desactualizado.
 */
export const rejectionStillExplained = (before: Step, now: Step): boolean => now.key === before.key && now.status !== "DISPONIBLE";

/** El paso tras un rechazo: texto y estado según la clase; ninguna clase cambia el objetivo activo. */
export function stepAfterRejection(current: Step, reason: RejectReason, serverText: string, stillExplained: boolean): Step {
  const cls = classifyRejection(reason, stillExplained);
  switch (cls) {
    case "bloqueo-confirmado":
      return { ...current, status: "BLOQUEADO", why: `El servidor lo rechazó: ${serverText}`, requirements: current.requirements.length ? current.requirements : [{ code: reason, text: serverText, how: "Resuelve el requisito indicado y vuelve a intentarlo." }] };
    case "estado-desactualizado":
      return { ...current, status: "NO_VERIFICADO", why: "El estado cambió mientras actuabas; se recalculará con el siguiente estado." };
    case "permisos":
      return { ...current, status: "BLOQUEADO", why: `Necesitas permiso: ${serverText}`, requirements: [{ code: reason, text: serverText, how: "Pide a quien tenga permiso (coordinación o administración) que lo haga." }] };
    case "error-tecnico":
      return { ...current, status: "NO_VERIFICADO", why: "Fallo técnico; inténtalo de nuevo." };
  }
}

/** Un rechazo del servidor a una acción propia, pendiente de clasificar cuando llegue el siguiente estado. */
export interface PendingRejection {
  reason: RejectReason;
  text: string;
  /** El paso que se mostraba al actuar. */
  before: Step;
  /** Marca de tiempo en ms. */
  at: number;
}

export const REJECTION_DELAY_MS = 300;
export const REJECTION_WINDOW_MS = 15_000;
/** Un fallo técnico es transitorio: el aviso caduca antes. */
export const TECHNICAL_WINDOW_MS = 4_000;

/**
 * Cómo se muestra un paso tras un rechazo: espera un ciclo de sincronización (300 ms) antes de clasificar; se retira si el
 * paso ya es otro (la causa se resolvió o cambió: se muestra la verdad) o si caduca. Función pura.
 */
export function overlayRejection(r: PendingRejection, fresh: Step, now: number): { step: Step; keep: boolean } {
  const age = now - r.at;
  const window = classifyRejection(r.reason, true) === "error-tecnico" ? TECHNICAL_WINDOW_MS : REJECTION_WINDOW_MS;
  if (age > window || fresh.key !== r.before.key) return { step: fresh, keep: false };
  if (age < REJECTION_DELAY_MS) return { step: fresh, keep: true };
  return { step: stepAfterRejection(fresh, r.reason, r.text, rejectionStillExplained(r.before, fresh)), keep: true };
}

// ---------------------------------------------------------------- estabilidad

export const HOLD_MS = 800;

export interface StabilizerInput {
  step: Step;
  now: number;
  /** El personaje se mueve, hay un diálogo abierto o el foco está en el panel. */
  busy: boolean;
}

export interface Stabilized {
  shown: Step;
  /** Anunciar ahora (cambio de identidad o transición relevante). El progreso numérico nunca se anuncia. */
  announce: boolean;
}

/**
 * Estabilizador del paso mostrado: la identidad (`key`) solo cambia si el candidato se mantiene estable `holdMs` y la persona no
 * está ocupada; el texto, el progreso y el estado del mismo paso se actualizan al momento. Anuncia una vez por cambio de identidad
 * y en las transiciones BLOQUEADO ↔ DISPONIBLE y a COMPLETADO.
 */
export function createStabilizer(holdMs = HOLD_MS) {
  let shown: Step | undefined;
  let candidate: { key: string; since: number } | undefined;
  return {
    feed({ step: next, now, busy }: StabilizerInput): Stabilized {
      if (!shown) { shown = next; return { shown, announce: true }; }
      if (next.key === shown.key) {
        const before = shown.status;
        shown = next;
        candidate = undefined;
        const relevant = before !== next.status && (next.status === "COMPLETADO" || before === "BLOQUEADO" || next.status === "BLOQUEADO");
        return { shown, announce: relevant };
      }
      if (!candidate || candidate.key !== next.key) candidate = { key: next.key, since: now };
      // Que el objetivo se haya completado o ya no exista es un hecho, no una recomendación: se muestra al momento.
      const fact = next.status === "COMPLETADO" || next.obsolete === true;
      if (fact || (!busy && now - candidate.since >= holdMs)) {
        shown = next;
        candidate = undefined;
        return { shown, announce: true };
      }
      // Identidad distinta aún no estable: se conserva el paso mostrado, con el progreso de su propio objetivo ya recalculado por quien llama.
      return { shown, announce: false };
    },
  };
}

// ---------------------------------------------------------------- utilidades para la interfaz

/** Dirección y distancia en texto: «5 casillas al este y 3 al norte». */
export function directionText(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return "estás en el destino";
  const parts: string[] = [];
  if (dx !== 0) parts.push(`${plural(Math.abs(dx), "casilla", "casillas")} al ${dx > 0 ? "este" : "oeste"}`);
  if (dy !== 0) parts.push(`${plural(Math.abs(dy), "casilla", "casillas")} al ${dy > 0 ? "sur" : "norte"}`);
  return parts.join(" y ");
}

