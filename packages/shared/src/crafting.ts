import type { RejectReason } from "./contracts.ts";
import type { Position } from "./movement.ts";
import type { MissionDef, RecipeDef, StructureDef } from "./world-config.ts";

// Reglas puras de construcción, fabricación y misiones (M5). El servidor las aplica
// dentro de una transacción con los datos leídos de la base de datos.

export interface Footprint {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const inFootprint = (p: Position, f: Footprint) =>
  p.x >= f.x && p.x < f.x + f.width && p.y >= f.y && p.y < f.y + f.height;

/** Fuera de la huella y a distancia 1 (incluidas diagonales) de alguna de sus casillas. */
export const isNextTo = (p: Position, f: Footprint) =>
  !inFootprint(p, f) && p.x >= f.x - 1 && p.x <= f.x + f.width && p.y >= f.y - 1 && p.y <= f.y + f.height;

export interface BuildInput {
  structure: StructureDef | undefined;
  projectReady: boolean;
  /** Con buildRequiresApproval: falta alguna tarea por aprobar (Q162). */
  approvalMissing?: boolean;
  built: boolean;
  position: Position;
  /** Posiciones de los demás jugadores (para no construir encima de nadie). */
  others: readonly Position[];
}

export type BuildResult = { ok: true; structure: StructureDef } | { ok: false; reason: RejectReason };

/** Q156: proyecto listo, sin construir, junto al solar y con el solar libre. */
export function checkBuild({ structure, projectReady, approvalMissing, built, position, others }: BuildInput): BuildResult {
  if (!structure) return { ok: false, reason: "estructura-desconocida" };
  if (built) return { ok: false, reason: "ya-construido" };
  if (!projectReady) return { ok: false, reason: "proyecto-sin-terminar" };
  if (approvalMissing) return { ok: false, reason: "tareas-sin-aprobar" };
  if (!isNextTo(position, structure)) return { ok: false, reason: "lejos-del-solar" };
  if (others.some((o) => inFootprint(o, structure))) return { ok: false, reason: "solar-ocupado" };
  return { ok: true, structure };
}

export interface CraftInput {
  recipe: RecipeDef | undefined;
  structure: StructureDef | undefined;
  structureBuilt: boolean;
  position: Position;
  /** Existencias del almacén de la comunidad. */
  stock: (id: string) => number;
}

export type CraftResult = { ok: true; recipe: RecipeDef } | { ok: false; reason: RejectReason };

/** Q157: taller construido, jugador junto a él y materiales en el almacén común. */
export function checkCraft({ recipe, structure, structureBuilt, position, stock }: CraftInput): CraftResult {
  if (!recipe || !structure) return { ok: false, reason: "receta-desconocida" };
  if (!structureBuilt) return { ok: false, reason: "taller-sin-construir" };
  if (!isNextTo(position, structure)) return { ok: false, reason: "lejos-del-taller" };
  if (Object.entries(recipe.inputs).some(([resource, amount]) => stock(resource) < amount)) {
    return { ok: false, reason: "faltan-materiales" };
  }
  return { ok: true, recipe };
}

export interface MissionContext {
  /** Existencias del almacén de la comunidad. */
  stock: (id: string) => number;
  /** Proyecto completado (construido, o con sus tareas completas y aprobadas si se exige; F1a). */
  projectCompleted: (projectId: string) => boolean;
}

/** Objetivo de la misión cumplido con el estado actual (Q158, Q174). */
export function missionSatisfied(mission: MissionDef, { stock, projectCompleted }: MissionContext): boolean {
  const { objective } = mission;
  if (objective.kind === "item-in-community") return stock(objective.item) >= objective.amount;
  return projectCompleted(objective.project);
}
