import type { RejectReason } from "./contracts.ts";
import { canonical, identityHash, type HashFn } from "./canonical.ts";
import { nameKey, placementContext, type MapContext } from "./construction.ts";
import type { DesignView } from "./design.ts";
import { authorize } from "./projects.ts";
import {
  recipeCycle, validateItemDef, validateMissionDef, validateProjectDef, validateRecipeDef, validateSkillDef, validateStructureDef,
  type BuildLimits, type ItemDef, type MissionDef, type ProjectDef, type RecipeDef, type SkillDef, type StructureDef,
} from "./world-config.ts";

// Edición de definiciones por versiones (G2, Q243–Q245, Q249, Q251). Reglas puras: el servidor las aplica dentro de una transacción
// y el panel las usa para explicar qué pasará ANTES de confirmar. El id no cambia nunca; la v1 no se toca y cada cambio añade una
// versión nueva (la vigente es la última). Dos contadores distintos:
//   · `version` — de CONTENIDO: sube solo al editar o volver a una versión; es la que guardan los registros históricos.
//   · `rev` — de CONCURRENCIA: sube con cualquier cambio de estado (editar, archivar, restaurar, retirar…); es la que se compara
//     con `expectedRev` para no sobrescribir lo que otra persona acaba de cambiar.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const EDITABLE_KINDS = ["objeto", "receta", "habilidad", "mision", "construccion"] as const;
export type EditableKind = (typeof EDITABLE_KINDS)[number];

/** Tope de versiones por definición: red de seguridad contra abusos, no un límite de diseño. */
export const MAX_VERSIONS = 100;

export type Origin = "configuracion" | "panel";

/** Una construcción editable: su proyecto y su estructura, que comparten id. */
export interface ConstructionDef {
  project: ProjectDef;
  structure: StructureDef;
}

export type EditableDef = ItemDef | RecipeDef | SkillDef | MissionDef | ConstructionDef;

export interface DefMeta {
  origin: Origin;
  /** Versión de contenido (1 = la original). */
  version: number;
  /** Revisión de concurrencia. */
  rev: number;
}

export interface PlayerFacts {
  name: string;
  skills: Readonly<Record<string, number>>;
  /** Veces que ha fabricado cada receta (la práctica de las habilidades, Q196). */
  crafts: Readonly<Record<string, number>>;
}

/** Lo que las reglas de edición, retirada y cascada necesitan saber del mundo. */
export interface EditView extends DesignView {
  structures: readonly { def: StructureDef; built: boolean; retired: boolean }[];
  projects: readonly { def: ProjectDef; closed: boolean }[];
  meta: (kind: EditableKind, id: string) => DefMeta | undefined;
  /** Qué cambió por última vez una definición y quién (para explicar `version-obsoleta`). */
  lastChange?: (kind: EditableKind, id: string) => string | undefined;
  resourceIds: ReadonlySet<string>;
  limits: BuildLimits;
  map: Omit<MapContext, "structures">;
  /** Unidades aportadas a una tarea de un proyecto. */
  contributed: (project: string, resource: string) => number;
  players: readonly PlayerFacts[];
  /** Ofertas de enseñanza pendientes ahora. */
  offers: readonly { skill: string; level: number }[];
  /** Misiones ya cumplidas (un hecho histórico: no se deshace). */
  completedMissions: ReadonlySet<string>;
}

export interface EditAnalysis {
  /** Lo que impide aplicar el cambio. */
  bloqueos: string[];
  /** Lo que cambia y conviene saber. */
  avisos: string[];
  /** Lo que se conserva o queda como está. */
  efectos: string[];
  /** Forma canónica de todo lo consultado (el servidor la firma con un hash: es la «base» del análisis). */
  canonical: string;
}

export type EditResult =
  | { ok: true; kind: EditableKind; id: string; next: EditableDef; analysis: EditAnalysis; newVersion: number; note: string }
  | { ok: false; reason: RejectReason; details?: string[]; analysis?: EditAnalysis };

export interface DefVersion {
  version: number;
  definition: unknown;
  changedBy: string;
  changedAt: number;
  note: string;
}

// ---------------------------------------------------------------- lectura de la vista

const activeFirst = <T extends { archived: boolean }>(list: readonly T[]) => list.filter((e) => !e.archived);

/** La definición vigente de un elemento editable, con su estado, o undefined si no existe. */
export function currentOf(view: EditView, kind: EditableKind, id: string): { def: EditableDef; unavailable?: string } | undefined {
  if (kind === "objeto") { const e = view.items.find((x) => x.def.id === id); return e && { def: e.def, ...(e.archived ? { unavailable: "está archivado" } : {}) }; }
  if (kind === "receta") { const e = view.recipes.find((x) => x.def.id === id); return e && { def: e.def, ...(e.archived ? { unavailable: "está archivada" } : {}) }; }
  if (kind === "habilidad") { const e = view.skills.find((x) => x.def.id === id); return e && { def: e.def, ...(e.archived ? { unavailable: "está archivada" } : {}) }; }
  if (kind === "mision") { const e = view.missions.find((x) => x.def.id === id); return e && { def: e.def, ...(e.archived ? { unavailable: "está archivada" } : {}) }; }
  const structure = view.structures.find((x) => x.def.id === id);
  const project = view.projects.find((x) => x.def.id === id);
  if (!structure || !project) return undefined;
  return { def: { project: project.def, structure: structure.def }, ...(structure.retired ? { unavailable: "está retirada" } : project.closed ? { unavailable: "su proyecto está cerrado" } : {}) };
}

const itemLabel = (view: EditView, id: string) => view.items.find((i) => i.def.id === id)?.def.name ?? id;
const structureLabel = (view: EditView, id: string) => view.structures.find((s) => s.def.id === id)?.def.name ?? id;
const maxHeld = (view: EditView, skill: string) => Math.max(0, ...view.players.map((p) => p.skills[skill] ?? 0));

// ---------------------------------------------------------------- análisis previo (precisión 2)

/**
 * Qué pasaría si `next` sustituyera la definición vigente: bloqueos, avisos y efectos, y la forma canónica de TODO lo consultado
 * (la base del análisis). No valida el contenido (eso es `checkEditDef`): analiza la compatibilidad con lo que ya existe.
 */
export function analyzeEdit(view: EditView, kind: EditableKind, id: string, next: EditableDef): EditAnalysis {
  const current = currentOf(view, kind, id)?.def;
  const bloqueos: string[] = [];
  const avisos: string[] = [];
  const efectos: string[] = [];
  const consulted: { kind: string; id: string; rev: number; archived?: boolean }[] = [];
  const facts: Record<string, unknown> = {};
  const see = (k: EditableKind, i: string, archived?: boolean) => consulted.push({ kind: k, id: i, rev: view.meta(k, i)?.rev ?? 0, ...(archived === undefined ? {} : { archived }) });
  see(kind, id);
  if (!current) return { bloqueos: ["No existe esa definición."], avisos, efectos, canonical: canonical({ kind, id, missing: true }) };

  if (kind === "objeto") {
    const before = current as ItemDef, after = next as ItemDef;
    if (before.name !== after.name) {
      const recipes = activeFirst(view.recipes).filter((r) => id in r.def.inputs || r.def.output.item === id || r.def.byproducts?.some((b) => b.item === id));
      const missions = activeFirst(view.missions).filter((m) => m.def.objective.kind === "item-in-community" && m.def.objective.item === id);
      for (const r of recipes) see("receta", r.def.id, r.archived);
      for (const m of missions) see("mision", m.def.id, m.archived);
      avisos.push(`Cambia el nombre de «${before.name}» a «${after.name}»: se verá con el nombre nuevo en el almacén, las recetas y las misiones.`);
      if (recipes.length) efectos.push(`Recetas que lo usan (siguen apuntando al mismo objeto): ${recipes.map((r) => `«${r.def.name}»`).join(", ")}.`);
      if (missions.length) efectos.push(`Misiones que lo piden (siguen pidiendo el mismo objeto): ${missions.map((m) => `«${m.def.name}»`).join(", ")}.`);
      facts.stock = view.stock(id);
    }
  } else if (kind === "receta") {
    const before = current as RecipeDef, after = next as RecipeDef;
    for (const itemId of [...Object.keys(after.inputs), after.output.item, ...(after.byproducts ?? []).map((b) => b.item)]) if (view.items.some((i) => i.def.id === itemId)) see("objeto", itemId, view.items.find((i) => i.def.id === itemId)?.archived);
    for (const q of after.requiresSkills ?? []) see("habilidad", q.skill, view.skills.find((s) => s.def.id === q.skill)?.archived);
    if (before.structureId !== after.structureId || JSON.stringify(before.alsoNeeds ?? []) !== JSON.stringify(after.alsoNeeds ?? [])) avisos.push(`Cambia dónde se fabrica: ahora en «${structureLabel(view, after.structureId)}»${after.alsoNeeds?.length ? ` y con ${after.alsoNeeds.map((s) => `«${structureLabel(view, s)}»`).join(", ")}` : ""}.`);
    if (canonical({ i: before.inputs, o: before.output, b: before.byproducts ?? [] }) !== canonical({ i: after.inputs, o: after.output, b: after.byproducts ?? [] })) avisos.push("Cambian las entradas o los productos: afecta solo a lo que se fabrique a partir de ahora.");
    if (JSON.stringify(before.requiresSkills ?? []) !== JSON.stringify(after.requiresSkills ?? [])) avisos.push("Cambian las habilidades exigidas: quien no las tenga dejará de poder fabricarla.");
    efectos.push("Lo ya fabricado, el almacén y las existencias no cambian.");
    // Es la práctica de algún nivel de una habilidad activa
    for (const s of activeFirst(view.skills)) {
      s.def.levels.forEach((level, i) => {
        if (level.practice.recipe !== id) return;
        see("habilidad", s.def.id, s.archived);
        if (after.requiresSkills?.some((q) => q.skill === s.def.id)) bloqueos.push(`«${before.name}» es la práctica del nivel «${level.name}» de «${s.def.name}»: no puede exigir esa misma habilidad.`);
        const working = view.players.filter((p) => (p.skills[s.def.id] ?? 0) === i);
        const withProgress = working.filter((p) => (p.crafts[id] ?? 0) > 0).length;
        avisos.push(`Es la práctica del nivel «${level.name}» de «${s.def.name}»${working.length ? `: ${working.length} ${working.length === 1 ? "persona va" : "personas van"} a por ese nivel (${withProgress} con avance, que se conserva)` : ""}.`);
        facts[`practica:${s.def.id}:${i}`] = { working: working.length, withProgress };
      });
    }
    // Otras recetas y misiones que dependen de lo que producía
    if (before.output.item !== after.output.item) {
      const usedByRecipes = activeFirst(view.recipes).filter((r) => r.def.id !== id && before.output.item in r.def.inputs);
      const askedBy = activeFirst(view.missions).filter((m) => m.def.objective.kind === "item-in-community" && m.def.objective.item === before.output.item);
      for (const r of usedByRecipes) see("receta", r.def.id, r.archived);
      for (const m of askedBy) see("mision", m.def.id, m.archived);
      avisos.push(`Deja de producir «${itemLabel(view, before.output.item)}» y produce «${itemLabel(view, after.output.item)}».`);
      if (usedByRecipes.length) avisos.push(`Recetas que usan «${itemLabel(view, before.output.item)}» como entrada: ${usedByRecipes.map((r) => `«${r.def.name}»`).join(", ")} (si ninguna otra receta lo produce, no se podrá reponer).`);
      if (askedBy.length) avisos.push(`Misiones que piden «${itemLabel(view, before.output.item)}»: ${askedBy.map((m) => `«${m.def.name}»`).join(", ")}.`);
    }
  } else if (kind === "habilidad") {
    const before = current as SkillDef, after = next as SkillDef;
    const held = maxHeld(view, id);
    const offers = view.offers.filter((o) => o.skill === id);
    facts.held = held;
    facts.offers = offers.length;
    if (after.levels.length < held) bloqueos.push(`Hay quien tiene el nivel ${held} («${before.levels[held - 1]?.name ?? held}»): la habilidad no puede quedarse con ${after.levels.length} ${after.levels.length === 1 ? "nivel" : "niveles"}.`);
    for (let i = 0; i < Math.min(held, before.levels.length); i++) {
      const old = nameKey(before.levels[i]!.name);
      const nowAt = after.levels[i] ? nameKey(after.levels[i]!.name) : "";
      if (old !== nowAt && after.levels.some((l, j) => j !== i && nameKey(l.name) === old)) bloqueos.push(`El nivel «${before.levels[i]!.name}» está ocupado y no se puede cambiar de sitio.`);
    }
    if (after.levels.length > before.levels.length) { const n = after.levels.length - before.levels.length; avisos.push(n === 1 ? "Se añade 1 nivel al final." : `Se añaden ${n} niveles al final.`); }
    before.levels.forEach((level, i) => {
      const other = after.levels[i];
      if (!other) return;
      if (level.practice.recipe !== other.practice.recipe || level.practice.times !== other.practice.times) {
        see("receta", other.practice.recipe, view.recipes.find((r) => r.def.id === other.practice.recipe)?.archived);
        const working = view.players.filter((p) => (p.skills[id] ?? 0) === i);
        const remainingBefore = (p: PlayerFacts) => level.practice.times - Math.min(p.crafts[level.practice.recipe] ?? 0, level.practice.times);
        const remainingAfter = (p: PlayerFacts) => other.practice.times - Math.min(p.crafts[other.practice.recipe] ?? 0, other.practice.times);
        const closer = working.filter((p) => remainingAfter(p) < remainingBefore(p)).length;
        const further = working.filter((p) => remainingAfter(p) > remainingBefore(p)).length;
        avisos.push(`Cambia la práctica del nivel «${other.name}»: de ${level.practice.times} × «${view.recipes.find((r) => r.def.id === level.practice.recipe)?.def.name ?? level.practice.recipe}» a ${other.practice.times} × «${view.recipes.find((r) => r.def.id === other.practice.recipe)?.def.name ?? other.practice.recipe}»${working.length ? ` (${closer} más cerca y ${further} más lejos de ese nivel, de ${working.length})` : ""}.`);
        facts[`nivel:${i}`] = { working: working.length, closer, further };
      } else if (level.name !== other.name) {
        avisos.push(`El nivel «${level.name}» pasa a llamarse «${other.name}».`);
      }
    });
    if (offers.length) avisos.push(`${offers.length} ${offers.length === 1 ? "oferta de enseñanza pendiente" : "ofertas de enseñanza pendientes"} de esta habilidad: se vuelve a comprobar al aceptarlas (caducan a los 60 s).`);
    efectos.push("Los niveles ya ganados se conservan: el nivel solo sube.");
  } else if (kind === "mision") {
    const before = current as MissionDef, after = next as MissionDef;
    if (JSON.stringify(before.objective) !== JSON.stringify(after.objective)) {
      avisos.push("Cambia el objetivo de la misión: se evalúa de nuevo con el estado actual.");
      if (after.objective.kind === "item-in-community") facts.stock = view.stock(after.objective.item);
    }
    if (before.name !== after.name) avisos.push(`La misión pasa a llamarse «${after.name}».`);
    if (view.completedMissions.has(id)) bloqueos.push("La misión ya está cumplida: es un hecho histórico y no se edita.");
  } else {
    const before = current as ConstructionDef, after = next as ConstructionDef;
    const structure = view.structures.find((s) => s.def.id === id)!;
    if (structure.built) bloqueos.push("El edificio ya está construido: no se edita.");
    const moved = ["x", "y", "width", "height"].some((k) => (before.structure as unknown as Record<string, unknown>)[k] !== (after.structure as unknown as Record<string, unknown>)[k]);
    if (moved) avisos.push("Cambia el solar: se mueve en el mapa y las recetas que lo usan lo siguen.");
    const usingRecipes = activeFirst(view.recipes).filter((r) => r.def.structureId === id || r.def.alsoNeeds?.includes(id));
    for (const r of usingRecipes) see("receta", r.def.id, r.archived);
    if (usingRecipes.length) efectos.push(`Recetas que lo usan: ${usingRecipes.map((r) => `«${r.def.name}»`).join(", ")}.`);
    const done: string[] = [];
    for (const task of before.project.tasks) {
      const amount = view.contributed(id, task.resource);
      facts[`aporte:${task.resource}`] = amount;
      if (amount > 0) done.push(`${amount} de ${task.resource}`);
    }
    if (done.length) efectos.push(`Lo ya aportado se conserva: ${done.join(", ")}.`);
    if (JSON.stringify(before.project.tasks) !== JSON.stringify(after.project.tasks)) avisos.push("Cambian las tareas del proyecto.");
  }
  return { bloqueos, avisos, efectos, canonical: canonical({ kind, id, targetRev: view.meta(kind, id)?.rev ?? 0, next, consulted: consulted.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)), facts }) };
}

// ---------------------------------------------------------------- validar el contenido nuevo

interface Parsed {
  kind: EditableKind;
  id: string;
  def: Record<string, unknown>;
  expectedRev: number;
  basis: string | undefined;
  note: string;
}

function parseEdit(payload: unknown): Parsed | undefined {
  const raw = isRecord(payload) ? payload : {};
  if (!EDITABLE_KINDS.includes(raw.kind as EditableKind) || typeof raw.id !== "string" || raw.id === "" || !isRecord(raw.def)) return undefined;
  if (!Number.isInteger(raw.expectedRev) || (raw.expectedRev as number) < 0) return undefined;
  if (raw.basis !== undefined && typeof raw.basis !== "string") return undefined;
  if (raw.note !== undefined && (typeof raw.note !== "string" || raw.note.length > 200)) return undefined;
  return { kind: raw.kind as EditableKind, id: raw.id, def: raw.def, expectedRev: raw.expectedRev as number, basis: raw.basis as string | undefined, note: typeof raw.note === "string" ? raw.note.trim() : "" };
}

const trimmedName = (v: unknown) => (typeof v === "string" ? v.trim() : v);

/** Valida el contenido propuesto con las mismas reglas que al crear, excluyendo a la propia definición. Devuelve la definición normalizada o los errores. */
function validateContent(view: EditView, p: Parsed): { next: EditableDef } | { errors: string[] } {
  const others = <T extends { def: { id: string } }>(list: readonly T[]) => list.filter((e) => e.def.id !== p.id);
  const errors: string[] = [];
  const activeItemIds = new Set(activeFirst(view.items).map((i) => i.def.id));
  const clash = (names: readonly string[], name: unknown, what: string) => {
    if (typeof name === "string" && name && names.some((n) => nameKey(n) === nameKey(name))) errors.push(`ya existe ${what} con el nombre «${name}»`);
  };
  if (p.kind === "objeto") {
    const next = { id: p.id, name: trimmedName(p.def.name) };
    errors.push(...validateItemDef(next, { itemIds: new Set(), resourceIds: view.resourceIds, where: "objeto" }));
    clash([...activeFirst(others(view.items)).map((i) => i.def.name), ...view.resourceNames], next.name, "un objeto o recurso");
    return errors.length ? { errors } : { next: next as ItemDef };
  }
  if (p.kind === "receta") {
    const next: Record<string, unknown> = { id: p.id, name: trimmedName(p.def.name), structureId: p.def.structureId, inputs: p.def.inputs, output: isRecord(p.def.output) ? { item: p.def.output.item, amount: p.def.output.amount } : p.def.output };
    for (const key of ["verb", "alsoNeeds", "byproducts", "requiresSkills"] as const) if (p.def[key] !== undefined) next[key] = key === "verb" ? trimmedName(p.def[key]) : p.def[key];
    const skills = new Map(activeFirst(view.skills).map((s) => [s.def.id, s.def]));
    errors.push(...validateRecipeDef(next, {
      resourceIds: view.resourceIds, itemIds: activeItemIds,
      structureIds: new Set(view.structures.filter((s) => !s.retired).map((s) => s.def.id)),
      limits: "panel", buildLimits: view.limits, skills, where: "receta",
    }));
    if (!errors.length) {
      const cycle = recipeCycle(activeFirst(others(view.recipes)).map((r) => r.def), next as unknown as RecipeDef);
      if (cycle) errors.push(`forma un ciclo: ${cycle.map((i) => itemLabel(view, i)).join(" → ")}`);
    }
    clash(activeFirst(others(view.recipes)).map((r) => r.def.name), next.name, "una receta");
    return errors.length ? { errors } : { next: next as unknown as RecipeDef };
  }
  if (p.kind === "habilidad") {
    const next = { id: p.id, name: trimmedName(p.def.name), description: typeof p.def.description === "string" ? p.def.description.trim() : "", levels: p.def.levels };
    const recipes = new Map(activeFirst(view.recipes).map((r) => [r.def.id, r.def]));
    errors.push(...validateSkillDef(next, { recipes, limits: "panel", buildLimits: view.limits, where: "habilidad" }));
    clash(activeFirst(others(view.skills)).map((s) => s.def.name), next.name, "una habilidad");
    return errors.length ? { errors } : { next: next as unknown as SkillDef };
  }
  if (p.kind === "mision") {
    const next = { id: p.id, name: trimmedName(p.def.name), description: typeof p.def.description === "string" ? p.def.description.trim() : "", objective: p.def.objective };
    const openProjects = new Set(view.projects.filter((x) => !x.closed).map((x) => x.def.id));
    errors.push(...validateMissionDef(next, { itemIds: activeItemIds, projectIds: openProjects, where: "misión" }));
    return errors.length ? { errors } : { next: next as unknown as MissionDef };
  }
  // construcción
  const project = isRecord(p.def.project) ? { ...p.def.project, id: p.id } : undefined;
  const structure = isRecord(p.def.structure) ? { ...p.def.structure, id: p.id, projectId: p.id } : undefined;
  if (!project || !structure) return { errors: ["la construcción necesita «project» y «structure»"] };
  errors.push(...validateProjectDef(project, { resourceIds: view.resourceIds, limits: "panel", where: "proyecto" }));
  const map: MapContext = { ...view.map, structures: view.structures.filter((s) => !s.retired && s.def.id !== p.id).map((s) => s.def), side: view.limits.side };
  errors.push(...validateStructureDef(structure, { placement: placementContext(map), projectIds: new Set([p.id]), maxSide: view.limits.side, where: "construcción" }));
  // Lo ya aportado no se invalida: no se quita una tarea con aportes ni se baja de lo aportado.
  const old = (currentOf(view, "construccion", p.id)?.def as ConstructionDef | undefined)?.project;
  const rawTasks = (project as Record<string, unknown>).tasks;
  const tasks = Array.isArray(rawTasks) ? (rawTasks as { resource?: unknown; required?: unknown }[]) : [];
  for (const task of old?.tasks ?? []) {
    const amount = view.contributed(p.id, task.resource);
    if (amount <= 0) continue;
    const now = tasks.find((t) => t.resource === task.resource);
    if (!now) errors.push(`la tarea de «${task.resource}» tiene ${amount} aportados: no se puede quitar`);
    else if (typeof now.required === "number" && now.required < amount) errors.push(`la tarea de «${task.resource}» tiene ${amount} aportados: no puede pedir menos`);
  }
  return errors.length ? { errors } : { next: { project, structure } as unknown as ConstructionDef };
}

export interface EditInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  view: EditView;
  /** Firma de la forma canónica del análisis; el servidor pasa SHA-256. Por omisión, la identidad. */
  hash?: HashFn;
}

/**
 * Editar una definición (administración): crea una versión nueva con el contenido propuesto. Rechaza, con su motivo, lo que no se
 * puede editar (lo de la configuración, lo archivado, lo cumplido o construido), una revisión obsoleta (`version-obsoleta`), lo que
 * bloquea el análisis de compatibilidad y una confirmación basada en un análisis que ya cambió (`analisis-desactualizado`).
 * Si el análisis tiene avisos o efectos, hay que confirmarlo reenviando su `basis`: sin ella se devuelve el análisis.
 */
export function checkEditDef({ actor, admins, payload, view, hash = identityHash }: EditInput): EditResult {
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  const p = parseEdit(payload);
  if (!p) return { ok: false, reason: "solicitud-invalida" };
  const found = currentOf(view, p.kind, p.id);
  const meta = view.meta(p.kind, p.id);
  if (!found || !meta) return { ok: false, reason: "definicion-invalida", details: ["No existe esa definición."] };
  const name = (found.def as { name?: string }).name ?? (found.def as ConstructionDef).project?.name ?? p.id;
  if (meta.origin !== "panel") return { ok: false, reason: "definicion-invalida", details: [`«${name}» viene de la configuración y no se edita: duplícala y archiva la original.`] };
  if (found.unavailable) return { ok: false, reason: "definicion-invalida", details: [`«${name}» ${found.unavailable}: restaura la definición antes de editarla.`] };
  if (meta.rev !== p.expectedRev) {
    const last = view.lastChange?.(p.kind, p.id);
    return { ok: false, reason: "version-obsoleta", details: [`La revisión vigente es la ${meta.rev} y tú tenías la ${p.expectedRev}${last ? `: ${last}` : ""}.`] };
  }
  if (meta.version >= MAX_VERSIONS) return { ok: false, reason: "definicion-invalida", details: [`«${name}» ya tiene ${MAX_VERSIONS} versiones, el máximo.`] };
  const content = validateContent(view, p);
  if ("errors" in content) return { ok: false, reason: "definicion-invalida", details: content.errors };
  if (canonical(content.next) === canonical(found.def)) return { ok: false, reason: "definicion-invalida", details: ["No hay ningún cambio respecto a la versión vigente."] };
  const analysis = analyzeEdit(view, p.kind, p.id, content.next);
  if (analysis.bloqueos.length) return { ok: false, reason: "definicion-en-uso", details: analysis.bloqueos, analysis };
  const basis = hash(analysis.canonical);
  const needsConfirmation = analysis.avisos.length > 0 || analysis.efectos.length > 0;
  if ((p.basis !== undefined && p.basis !== basis) || (p.basis === undefined && needsConfirmation)) return { ok: false, reason: "analisis-desactualizado", details: [p.basis === undefined ? "Revisa el análisis y confirma el cambio." : "Lo que depende de este cambio ha variado: revisa el análisis nuevo."], analysis };
  return { ok: true, kind: p.kind, id: p.id, next: content.next, analysis, newVersion: meta.version + 1, note: p.note };
}

export interface RestoreVersionInput extends EditInput {
  /** Todas las versiones de la definición, de la 1 a la vigente. */
  versions: readonly DefVersion[];
}

/**
 * Volver a una versión anterior (administración): NO borra nada; crea una versión nueva con el contenido de la elegida. Mismas
 * reglas que editar, con `payload = { kind, id, toVersion, expectedRev, basis?, note? }`.
 */
export function checkRestoreVersion({ versions, payload, ...rest }: RestoreVersionInput): EditResult {
  const raw = isRecord(payload) ? payload : {};
  if (!Number.isInteger(raw.toVersion)) return { ok: false, reason: "solicitud-invalida" };
  const target = versions.find((v) => v.version === raw.toVersion);
  if (!target || !isRecord(target.definition)) return { ok: false, reason: "definicion-invalida", details: [`No existe la versión ${String(raw.toVersion)}.`] };
  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note : `Vuelve a la versión ${target.version}`;
  return checkEditDef({ ...rest, payload: { ...raw, def: target.definition, note } });
}

// ---------------------------------------------------------------- inventario de registros históricos (Q251)

/**
 * Qué registro histórico puede llevar la versión de contenido de la definición que usó. Inventario VERIFICADO en el código en G2 P0:
 * hoy ninguno la guarda (los eventos solo llevan ids; las tablas, quién y cuándo). Desde v12 las columnas `def_version` existen y los
 * campos nuevos se rellenarán HACIA DELANTE; las filas anteriores no se rellenan ni se infieren (`backfilled: false`).
 */
export interface HistoricalRecord {
  record: string;
  /** Dónde vive: tabla SQLite, evento del registro o memoria de la sala. */
  store: { type: "tabla"; table: string } | { type: "evento"; event: string } | { type: "memoria"; where: string };
  /** Qué guarda hoy. */
  today: string;
  /** Dónde irá la versión usada, o por qué no hace falta. */
  version: { field: string } | { notNeeded: string };
  backfilled: false;
}

export const HISTORICAL_RECORDS: readonly HistoricalRecord[] = [
  { record: "Fabricar una receta", store: { type: "evento", event: "craft" }, today: "recipe, consumed, produced", version: { field: "recipeVersion" }, backfilled: false },
  { record: "Subir de nivel practicando", store: { type: "evento", event: "skill-level" }, today: "skill, level, recipe", version: { field: "skillVersion" }, backfilled: false },
  { record: "Aprender enseñado", store: { type: "evento", event: "skill-taught" }, today: "teacher, skill, level", version: { field: "skillVersion" }, backfilled: false },
  { record: "Recibir una habilidad concedida", store: { type: "evento", event: "skill-granted" }, today: "player, skill, level", version: { field: "skillVersion" }, backfilled: false },
  { record: "Cumplir una misión", store: { type: "evento", event: "mission-complete" }, today: "mission", version: { field: "missionVersion" }, backfilled: false },
  { record: "Construir un edificio", store: { type: "evento", event: "build" }, today: "structure, project, consumed", version: { field: "structureVersion" }, backfilled: false },
  { record: "Nivel de una persona en una habilidad", store: { type: "tabla", table: "player_skill" }, today: "level, source, at", version: { field: "def_version" }, backfilled: false },
  { record: "Edificio construido", store: { type: "tabla", table: "structure" }, today: "built_at, built_by", version: { field: "def_version" }, backfilled: false },
  { record: "Misión cumplida", store: { type: "tabla", table: "mission" }, today: "completed_at, completed_by", version: { field: "def_version" }, backfilled: false },
  { record: "Oferta de enseñanza", store: { type: "memoria", where: "WorldRoom.offers (no se persiste; caduca a los 60 s)" }, today: "id, from, to, skill, level, expiresAt", version: { field: "skillVersion" }, backfilled: false },
  { record: "Aportación a una tarea", store: { type: "evento", event: "contribute" }, today: "project, task, resource, amount, from, requested", version: { notNeeded: "la tarea se identifica por recurso y lo aportado no se invalida al editar (Q244)" }, backfilled: false },
  { record: "Veces fabricadas por receta", store: { type: "tabla", table: "craft_count" }, today: "player, recipe, n", version: { notNeeded: "es un contador agregado por receta; la práctica sigue contando aunque cambie la receta (Q196)" }, backfilled: false },
];
