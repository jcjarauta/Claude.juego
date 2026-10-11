import type { RejectReason } from "./contracts.ts";
import { nameKey } from "./construction.ts";
import { authorize } from "./projects.ts";
import { DEFAULT_BUILD_LIMITS, HARD_BUILD_LIMITS, type BuildLimits, type ItemDef, type MissionDef, type RecipeDef, type SkillDef } from "./world-config.ts";

// Diseño (G1, Q237–Q241): límites editables, escalas de niveles y archivado de definiciones. Reglas puras: el servidor las aplica
// dentro de una transacción y el panel las usa para explicar qué pasará. Las definiciones siguen siendo inmutables (Q187): archivar
// y restaurar solo cambian una marca; nada se borra.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- límites editables (Q237, Q238)

export const LIMIT_KEYS = Object.keys(DEFAULT_BUILD_LIMITS) as (keyof BuildLimits)[];

/** Etiquetas del panel: qué limita cada valor. */
export const LIMIT_LABELS: Readonly<Record<keyof BuildLimits, string>> = {
  constructions: "Construcciones creadas desde el panel",
  items: "Objetos creados desde el panel",
  recipes: "Recetas creadas desde el panel",
  side: "Lado máximo de un solar (casillas)",
  recipeInputs: "Entradas distintas por receta",
  inputAmount: "Unidades máximas por entrada",
  outputAmount: "Unidades máximas de la salida y de cada subproducto",
  byproducts: "Subproductos por receta",
  alsoNeeds: "Edificios extra por receta",
  skills: "Habilidades creadas desde el panel",
  skillLevels: "Niveles por habilidad",
  recipeSkills: "Habilidades exigidas por receta",
  plannerDepth: "Planificador: profundidad máxima de una cadena",
  plannerRoutes: "Planificador: rutas que se comparan como máximo",
};

export type UpdateLimitsResult =
  | { ok: true; limits: BuildLimits; changed: boolean }
  | { ok: false; reason: RejectReason; details?: string[] };

export interface UpdateLimitsInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  /** Límites vigentes. */
  current: BuildLimits;
  /** Los de la configuración (a los que vuelve «restaurar por omisión»). */
  defaults: BuildLimits;
}

/**
 * Cambiar límites (administración): `{ limits: { recipeInputs: 12 } }` cambia solo esos (cada uno entre 1 y su techo) y
 * `{ reset: true }` vuelve a los de la configuración. Bajar un límite por debajo de lo creado no borra nada: solo impide crear más.
 */
export function checkUpdateLimits({ actor, admins, payload, current, defaults }: UpdateLimitsInput): UpdateLimitsResult {
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  const raw = isRecord(payload) ? payload : {};
  if (raw.reset === true) return { ok: true, limits: { ...defaults }, changed: JSON.stringify(current) !== JSON.stringify(defaults) };
  if (!isRecord(raw.limits)) return { ok: false, reason: "solicitud-invalida" };
  const next: BuildLimits = { ...current };
  const errors: string[] = [];
  for (const [key, value] of Object.entries(raw.limits)) {
    if (!(key in HARD_BUILD_LIMITS)) { errors.push(`límite desconocido «${key}»`); continue; }
    const k = key as keyof BuildLimits;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > HARD_BUILD_LIMITS[k]) errors.push(`${LIMIT_LABELS[k]}: debe ser un entero de 1 a ${HARD_BUILD_LIMITS[k]}`);
    else next[k] = value as number;
  }
  if (errors.length) return { ok: false, reason: "definicion-invalida", details: errors };
  if (Object.keys(raw.limits).length === 0) return { ok: false, reason: "solicitud-invalida" };
  return { ok: true, limits: next, changed: JSON.stringify(current) !== JSON.stringify(next) };
}

// ---------------------------------------------------------------- escalas de niveles (Q239)

export interface SkillScale {
  id: string;
  name: string;
  levels: readonly string[];
}

/** Escalas predefinidas: solo son plantillas de nombres; lo que se guarda es la lista de niveles. */
export const SKILL_SCALES: readonly SkillScale[] = [
  { id: "aprendiz-oficial-maestro", name: "Aprendiz · Oficial · Maestro", levels: ["Aprendiz", "Oficial", "Maestro"] },
  { id: "bronce-plata-oro", name: "Bronce · Plata · Oro", levels: ["Bronce", "Plata", "Oro"] },
  { id: "basico-experto", name: "Básico · Experto", levels: ["Básico", "Experto"] },
  { id: "cinco-grados", name: "Novato · Aprendiz · Competente · Experto · Maestro", levels: ["Novato", "Aprendiz", "Competente", "Experto", "Maestro"] },
  { id: "numerica-5", name: "Nivel 1 a 5", levels: ["Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4", "Nivel 5"] },
];

/** Los niveles de una escala recortados al límite vigente de niveles por habilidad. */
export function scaleLevels(scale: SkillScale, maxLevels: number): string[] {
  return scale.levels.slice(0, Math.max(1, maxLevels));
}

// ---------------------------------------------------------------- archivar y restaurar (Q240, Q241)

export const DEFINITION_KINDS = ["objeto", "receta", "habilidad", "mision"] as const;
export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

/** Lo que las reglas necesitan saber del mundo: definiciones con su estado de archivo y las existencias. */
export interface DesignView {
  items: readonly { def: ItemDef; archived: boolean }[];
  recipes: readonly { def: RecipeDef; archived: boolean }[];
  skills: readonly { def: SkillDef; archived: boolean }[];
  missions: readonly { def: MissionDef; archived: boolean }[];
  /** Nombres de los recursos (un objeto no puede llamarse como un recurso). */
  resourceNames: readonly string[];
  /** Existencias del almacén común de un objeto. */
  stock: (id: string) => number;
}

const nameOf = (view: DesignView, kind: DefinitionKind, id: string): string | undefined =>
  (kind === "objeto" ? view.items : kind === "receta" ? view.recipes : kind === "habilidad" ? view.skills : view.missions).find((e) => e.def.id === id)?.def.name;

const entryOf = (view: DesignView, kind: DefinitionKind, id: string) =>
  (kind === "objeto" ? view.items : kind === "receta" ? view.recipes : kind === "habilidad" ? view.skills : view.missions).find((e) => e.def.id === id);

const itemName = (view: DesignView, id: string) => view.items.find((i) => i.def.id === id)?.def.name ?? id;

/** Lo ACTIVO que usa una definición (lo que impide archivarla), en texto. */
export function usedBy(view: DesignView, kind: DefinitionKind, id: string): string[] {
  const out: string[] = [];
  if (kind === "objeto") {
    for (const { def, archived } of view.recipes) {
      if (archived) continue;
      const uses = id in def.inputs ? "entrada" : def.output.item === id ? "salida" : def.byproducts?.some((b) => b.item === id) ? "subproducto" : "";
      if (uses) out.push(`la receta «${def.name}» lo usa como ${uses}`);
    }
    for (const { def, archived } of view.missions) {
      if (!archived && def.objective.kind === "item-in-community" && def.objective.item === id) out.push(`la misión «${def.name}» lo pide`);
    }
    const stock = view.stock(id);
    if (stock > 0) out.push(`hay ${stock} en el almacén de la comunidad`);
  } else if (kind === "receta") {
    for (const { def, archived } of view.skills) {
      if (archived) continue;
      const level = def.levels.findIndex((l) => l.practice.recipe === id);
      if (level >= 0) out.push(`es la práctica del nivel «${def.levels[level]!.name}» de la habilidad «${def.name}»`);
    }
  } else if (kind === "habilidad") {
    for (const { def, archived } of view.recipes) {
      if (!archived && def.requiresSkills?.some((q) => q.skill === id)) out.push(`la receta «${def.name}» la exige`);
    }
  }
  return out;
}

export type ArchiveResult = { ok: true } | { ok: false; reason: RejectReason; details?: string[] };

export interface ArchiveInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  view: DesignView;
}

const parseTarget = (payload: unknown): { kind: DefinitionKind; id: string } | undefined => {
  const raw = isRecord(payload) ? payload : {};
  return DEFINITION_KINDS.includes(raw.kind as DefinitionKind) && typeof raw.id === "string" && raw.id !== "" ? { kind: raw.kind as DefinitionKind, id: raw.id } : undefined;
};

/** Archivar: administración, definición conocida y activa, y sin nada activo que la use (se lista lo que la usa). */
export function checkArchive({ actor, admins, payload, view }: ArchiveInput): ArchiveResult {
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  const target = parseTarget(payload);
  if (!target) return { ok: false, reason: "solicitud-invalida" };
  const entry = entryOf(view, target.kind, target.id);
  if (!entry) return { ok: false, reason: "definicion-invalida", details: ["No existe esa definición."] };
  if (entry.archived) return { ok: false, reason: "definicion-invalida", details: [`«${entry.def.name}» ya está archivada.`] };
  const uses = usedBy(view, target.kind, target.id);
  if (uses.length) return { ok: false, reason: "definicion-en-uso", details: uses.map((u) => `No se puede archivar «${entry.def.name}»: ${u}.`) };
  return { ok: true };
}

/** De qué depende una definición (para restaurarla): lo archivado que necesita. */
export function archivedDependencies(view: DesignView, kind: DefinitionKind, id: string): string[] {
  const out: string[] = [];
  const archivedItem = (itemId: string) => view.items.find((i) => i.def.id === itemId)?.archived === true;
  const archivedSkill = (skillId: string) => view.skills.find((s) => s.def.id === skillId)?.archived === true;
  const archivedRecipe = (recipeId: string) => view.recipes.find((r) => r.def.id === recipeId)?.archived === true;
  if (kind === "receta") {
    const def = view.recipes.find((r) => r.def.id === id)?.def;
    if (def) {
      for (const itemId of [...Object.keys(def.inputs), def.output.item, ...(def.byproducts ?? []).map((b) => b.item)]) if (archivedItem(itemId)) out.push(`el objeto «${itemName(view, itemId)}» está archivado`);
      for (const q of def.requiresSkills ?? []) if (archivedSkill(q.skill)) out.push(`la habilidad «${nameOf(view, "habilidad", q.skill) ?? q.skill}» está archivada`);
    }
  } else if (kind === "habilidad") {
    const def = view.skills.find((s) => s.def.id === id)?.def;
    for (const level of def?.levels ?? []) if (archivedRecipe(level.practice.recipe)) out.push(`la receta de práctica «${nameOf(view, "receta", level.practice.recipe) ?? level.practice.recipe}» está archivada`);
  } else if (kind === "mision") {
    const def = view.missions.find((m) => m.def.id === id)?.def;
    if (def?.objective.kind === "item-in-community" && archivedItem(def.objective.item)) out.push(`el objeto «${itemName(view, def.objective.item)}» está archivado`);
  }
  return out;
}

/** Restaurar: administración, definición archivada, nombre libre entre las activas y dependencias activas. */
export function checkRestore({ actor, admins, payload, view }: ArchiveInput): ArchiveResult {
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  const target = parseTarget(payload);
  if (!target) return { ok: false, reason: "solicitud-invalida" };
  const entry = entryOf(view, target.kind, target.id);
  if (!entry) return { ok: false, reason: "definicion-invalida", details: ["No existe esa definición."] };
  if (!entry.archived) return { ok: false, reason: "definicion-invalida", details: [`«${entry.def.name}» no está archivada.`] };
  const details: string[] = [];
  const key = nameKey(entry.def.name);
  const kind = target.kind;
  const same = (kind === "objeto" ? view.items : kind === "receta" ? view.recipes : kind === "habilidad" ? view.skills : view.missions) as readonly { def: { id: string; name: string }; archived: boolean }[];
  if (kind !== "mision" && same.some((e) => e.def.id !== target.id && !e.archived && nameKey(e.def.name) === key)) details.push(`Ya hay un elemento activo llamado «${entry.def.name}»: archívalo antes o restaura otro.`);
  if (kind === "objeto" && view.resourceNames.some((n) => nameKey(n) === key)) details.push(`«${entry.def.name}» coincide con el nombre de un recurso.`);
  for (const d of archivedDependencies(view, target.kind, target.id)) details.push(`No se puede restaurar «${entry.def.name}»: ${d}. Restaura antes lo que necesita.`);
  if (details.length) return { ok: false, reason: "definicion-en-uso", details };
  return { ok: true };
}

// ---------------------------------------------------------------- posibles duplicados

export interface DuplicateGroup {
  kind: DefinitionKind;
  /** Nombres que se parecen, con su id. */
  entries: { id: string; name: string }[];
  /** «igual» (mismo nombre sin tildes ni mayúsculas) o «contenido» (uno dentro de otro). */
  reason: "igual" | "contenido";
}

/** Elementos ACTIVOS de un tipo cuyos nombres se parecen: mismo nombre normalizado o uno contenido en otro (≥ 4 letras). */
export function similarNames(kind: DefinitionKind, entries: readonly { id: string; name: string; archived: boolean }[]): DuplicateGroup[] {
  const active = entries.filter((e) => !e.archived).map((e) => ({ id: e.id, name: e.name, key: nameKey(e.name) })).sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!, b = active[j]!;
      const pair = `${a.id}|${b.id}`;
      if (seen.has(pair)) continue;
      const reason = a.key === b.key ? "igual" : Math.min(a.key.length, b.key.length) >= 4 && (a.key.includes(b.key) || b.key.includes(a.key)) ? "contenido" : undefined;
      if (!reason) continue;
      seen.add(pair);
      groups.push({ kind, reason, entries: [{ id: a.id, name: a.name }, { id: b.id, name: b.name }] });
    }
  }
  return groups;
}
