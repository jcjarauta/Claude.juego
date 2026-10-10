import { nameKey } from "./construction.ts";
import { authorize, type CreateResult } from "./projects.ts";
import type { Position } from "./movement.ts";
import { DEFAULT_BUILD_LIMITS, makeId, validateSkillDef, type BuildLimits, type RecipeDef, type SkillDef } from "./world-config.ts";

// Habilidades (F2c, Q195–Q199): niveles permanentes que se ganan practicando, por concesión o enseñados con aceptación.
// Reglas puras: el servidor las aplica dentro de una transacción; el cliente solo las usa para explicar qué falta.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Distancia máxima (casillas, diagonales incluidas) para enseñar, límite de ofertas por minuto y caducidad (Q198). */
export const TEACH_DISTANCE = 2;
export const TEACH_PER_MINUTE = 3;
export const TEACH_OFFER_MS = 60_000;

/** Niveles de una persona: habilidad → nivel (0 o ausente = no la tiene). */
export type SkillLevels = Readonly<Record<string, number>>;

export const skillLevelOf = (levels: SkillLevels, skill: string): number => levels[skill] ?? 0;

/** Nombre de un nivel («Oficial»); «sin nivel» para 0. */
export function skillLevelName(def: SkillDef, level: number): string {
  return level <= 0 ? "sin nivel" : def.levels[level - 1]?.name ?? `nivel ${level}`;
}

/** Habilidades que faltan para una receta, con texto legible: «Molinero (Oficial); tienes Aprendiz». Vacío = cumple. */
export function missingSkills(recipe: Pick<RecipeDef, "requiresSkills">, skills: ReadonlyMap<string, SkillDef>, levelOf: (skill: string) => number): string[] {
  const missing: string[] = [];
  for (const q of recipe.requiresSkills ?? []) {
    const def = skills.get(q.skill);
    const have = levelOf(q.skill);
    if (have >= q.level) continue;
    const need = def ? `${def.name} (${skillLevelName(def, q.level)})` : q.skill;
    missing.push(`${need}; ${have > 0 && def ? `tienes ${skillLevelName(def, have)}` : "no la tienes"}`);
  }
  return missing;
}

/** Habilidades que exige una receta, en texto: «Molinero (Oficial) y Panadero (Aprendiz)». */
export function skillRequirementText(recipe: Pick<RecipeDef, "requiresSkills">, skills: ReadonlyMap<string, SkillDef>): string {
  return (recipe.requiresSkills ?? []).map((q) => {
    const def = skills.get(q.skill);
    return def ? `${def.name} (${skillLevelName(def, q.level)})` : q.skill;
  }).join(" y ");
}

/**
 * Nivel tras fabricar la receta `crafted` (Q196): si el siguiente nivel se practica con ella y ya se ha fabricado `times`
 * veces (contando esta), se sube; después se comprueba el siguiente con las cuentas que ya hubiera. `count` ya incluye esta fabricación.
 */
export function levelAfterCraft(def: SkillDef, current: number, crafted: string, count: (recipe: string) => number): number {
  let level = current;
  if (def.levels[level]?.practice.recipe !== crafted) return level;
  while (level < def.levels.length && count(def.levels[level]!.practice.recipe) >= def.levels[level]!.practice.times) level++;
  return level;
}

/** Siguiente paso de práctica de una persona en una habilidad, o undefined si ya tiene el último nivel. */
export function practiceProgress(def: SkillDef, level: number, count: (recipe: string) => number) {
  const next = def.levels[level];
  if (!next) return undefined;
  return { nextLevel: level + 1, name: next.name, recipe: next.practice.recipe, times: next.practice.times, done: Math.min(count(next.practice.recipe), next.practice.times) };
}

export interface CreateSkillInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  recipes: ReadonlyMap<string, RecipeDef>;
  existingIds: ReadonlySet<string>;
  /** Nombres de las habilidades que ya existen. */
  takenNames: readonly string[];
  /** Habilidades creadas desde el panel. */
  created: number;
  limits?: BuildLimits;
  idSuffix: string;
}

/** Crear una habilidad (administración): nombre, descripción y niveles con su práctica (Q195–Q197). */
export function checkCreateSkill(input: CreateSkillInput): CreateResult<SkillDef> {
  const { actor, admins, payload, recipes, existingIds, takenNames, created, idSuffix } = input;
  const limits = input.limits ?? DEFAULT_BUILD_LIMITS;
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  if (created >= limits.skills) return { ok: false, reason: "demasiadas-habilidades" };
  const raw = isRecord(payload) ? payload : {};
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const id = makeId(name, idSuffix);
  if (existingIds.has(id)) return { ok: false, reason: "solicitud-invalida" };
  const levels = Array.isArray(raw.levels)
    ? raw.levels.map((lv) => (isRecord(lv)
      ? { name: typeof lv.name === "string" ? lv.name.trim() : lv.name, practice: { recipe: lv.recipe, times: lv.times } }
      : lv))
    : raw.levels;
  const def: Record<string, unknown> = { id, name, description: typeof raw.description === "string" ? raw.description.trim() : "", levels };
  const errors = validateSkillDef(def, { recipes, limits: "panel", buildLimits: limits, where: "habilidad" });
  if (name && takenNames.some((n) => nameKey(n) === nameKey(name))) errors.push(`ya existe una habilidad llamada «${name}»`);
  if (errors.length) return { ok: false, reason: "definicion-invalida", details: errors };
  return { ok: true, def: def as unknown as SkillDef };
}

export interface GrantSkillInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  skills: ReadonlyMap<string, SkillDef>;
  /** Cuenta destinataria tal como está registrada, o undefined si no existe. */
  account: string | undefined;
  currentLevel: number;
}

/** Conceder un nivel (administración): solo sube, nunca baja (Q197). */
export function checkGrantSkill(input: GrantSkillInput): CreateResult<{ target: string; skill: string; level: number }> {
  const { actor, admins, payload, skills, account, currentLevel } = input;
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  const raw = isRecord(payload) ? payload : {};
  const def = typeof raw.skill === "string" ? skills.get(raw.skill) : undefined;
  if (!account || !def || !Number.isInteger(raw.level) || (raw.level as number) < 1 || (raw.level as number) > def.levels.length) {
    return { ok: false, reason: "solicitud-invalida" };
  }
  const level = raw.level as number;
  if (level <= currentLevel) {
    return { ok: false, reason: "definicion-invalida", details: [`${account} ya tiene ${skillLevelName(def, currentLevel)} en ${def.name}: conceder solo sube de nivel`] };
  }
  return { ok: true, def: { target: account, skill: def.id, level } };
}

const near = (a: Position, b: Position) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= TEACH_DISTANCE;

export interface TeachInput {
  teacher: string;
  learner: string;
  skill: SkillDef | undefined;
  teacherLevel: number;
  learnerLevel: number;
  teacherAt: Position | undefined;
  learnerAt: Position | undefined;
  /** Ambas personas conectadas con personaje. */
  bothConnected: boolean;
}

export type TeachResult = { ok: true; toLevel: number } | { ok: false; reason: "oferta-invalida"; details: string[] };

/** Enseñar (Q198): cerca, conectados y solo hasta un nivel por debajo del maestro, de un nivel en un nivel. */
export function checkTeach({ teacher, learner, skill, teacherLevel, learnerLevel, teacherAt, learnerAt, bothConnected }: TeachInput): TeachResult {
  const no = (detail: string): TeachResult => ({ ok: false, reason: "oferta-invalida", details: [detail] });
  if (!skill) return no("Esa habilidad no existe.");
  if (teacher === learner) return no("No puedes enseñarte a ti mismo.");
  if (!bothConnected || !teacherAt || !learnerAt) return no(`${learner} no está conectado.`);
  if (!near(teacherAt, learnerAt)) return no(`${learner} está lejos: acércate a ${TEACH_DISTANCE} casillas o menos.`);
  const toLevel = learnerLevel + 1;
  if (toLevel > skill.levels.length) return no(`${learner} ya tiene el último nivel de ${skill.name}.`);
  if (toLevel > teacherLevel - 1) {
    return no(teacherLevel <= 1
      ? `Con ${skillLevelName(skill, teacherLevel)} en ${skill.name} aún no puedes enseñar: hace falta el nivel siguiente.`
      : `Solo puedes enseñar hasta ${skillLevelName(skill, teacherLevel - 1)} en ${skill.name} (un nivel por debajo del tuyo); ${learner} ya lo tiene.`);
  }
  return { ok: true, toLevel };
}
