import { makeId, BUILD_LIMITS, footprintProblems, validateItemDef, validateRecipeDef, validateStructureDef, type ItemDef, type PlacementContext, type ProjectDef, type RecipeDef, type StructureDef } from "./world-config.ts";
import { authorize, checkCreateProject, type CreateResult } from "./projects.ts";

// Editor de construcciones (F2a, Q186–Q188): la administración crea desde el panel estructuras
// (con su proyecto y su solar), objetos y recetas, con la misma validación que la configuración.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Mapa para colocar solares: tamaño, nodos, aparición y los solares ya existentes. */
export interface MapContext {
  width: number;
  height: number;
  /** Casillas «x,y» ocupadas por nodos de recurso. */
  nodeCells: ReadonlySet<string>;
  spawn: { x: number; y: number };
  /** Solares y edificios vigentes (los retirados no cuentan). */
  structures: readonly StructureDef[];
}

/** Contexto de colocación para validar un solar nuevo (o para la previsualización del panel). */
export function placementContext(map: MapContext): PlacementContext {
  return {
    width: map.width,
    height: map.height,
    occupied: (x, y) => {
      if (map.nodeCells.has(`${x},${y}`)) return `la casilla ${x},${y} la ocupa un nodo`;
      if (map.spawn.x === x && map.spawn.y === y) return "cubre el punto de aparición";
      const other = map.structures.find((s) => x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height);
      return other ? `la casilla ${x},${y} ya la ocupa «${other.name}»` : undefined;
    },
  };
}

/** ¿Cabe un solar ahí? Lista de motivos legibles (vacía = cabe). Usada por el servidor y por la previsualización. */
export function solarProblems(rect: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }, map: MapContext): string[] {
  return footprintProblems(rect, placementContext(map), BUILD_LIMITS.side);
}

export interface CreateConstructionInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  resourceIds: ReadonlySet<string>;
  resourceName: ReadonlyMap<string, string>;
  openProjects: number;
  existingProjectIds: ReadonlySet<string>;
  /** Construcciones vigentes creadas desde el panel. */
  constructions: number;
  map: MapContext;
  idSuffix: string;
}

/** Crear una construcción: un proyecto y su estructura con solar (F2a). */
export function checkCreateConstruction(input: CreateConstructionInput): CreateResult<{ project: ProjectDef; structure: StructureDef }> {
  const { actor, admins, payload, resourceIds, resourceName, openProjects, existingProjectIds, constructions, map, idSuffix } = input;
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  if (constructions >= BUILD_LIMITS.constructions) return { ok: false, reason: "demasiadas-construcciones" };
  const project = checkCreateProject({ actor, admins, payload, resourceIds, resourceName, openProjects, existingIds: existingProjectIds, idSuffix });
  if (!project.ok && project.reason !== "definicion-invalida") return project;
  const raw = isRecord(payload) ? payload : {};
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const id = makeId(name, idSuffix);
  const structure = { id, name, projectId: id, x: raw.x, y: raw.y, width: raw.width, height: raw.height, color: raw.color };
  const errors = [
    ...(project.ok ? [] : project.details ?? []),
    ...validateStructureDef(structure, { placement: placementContext(map), projectIds: new Set([id]), maxSide: BUILD_LIMITS.side, where: "construcción" }),
  ];
  if (errors.length || !project.ok) return { ok: false, reason: "definicion-invalida", details: errors };
  return { ok: true, def: { project: project.def, structure: structure as StructureDef } };
}

export interface CreateItemInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  resourceIds: ReadonlySet<string>;
  itemIds: ReadonlySet<string>;
  /** Objetos creados desde el panel. */
  created: number;
  idSuffix: string;
}

/** Crear un objeto fabricable (Q157, F2a): solo nombre; vive en el almacén común. */
export function checkCreateItem(input: CreateItemInput): CreateResult<ItemDef> {
  const { actor, admins, payload, resourceIds, itemIds, created, idSuffix } = input;
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  if (created >= BUILD_LIMITS.items) return { ok: false, reason: "demasiados-objetos" };
  const raw = isRecord(payload) ? payload : {};
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const def = { id: makeId(name, idSuffix), name };
  const errors = validateItemDef(def, { itemIds, resourceIds, where: "objeto" });
  if (errors.length) return { ok: false, reason: "definicion-invalida", details: errors };
  return { ok: true, def };
}

export interface CreateRecipeInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  resourceIds: ReadonlySet<string>;
  itemIds: ReadonlySet<string>;
  /** Estructuras donde se puede fabricar (de la configuración o del panel, no retiradas). */
  structureIds: ReadonlySet<string>;
  /** Recetas creadas desde el panel. */
  created: number;
  existingIds: ReadonlySet<string>;
  idSuffix: string;
}

/** Crear una receta (F2a): 1–4 recursos del almacén común → un objeto, en un edificio. */
export function checkCreateRecipe(input: CreateRecipeInput): CreateResult<RecipeDef> {
  const { actor, admins, payload, resourceIds, itemIds, structureIds, created, existingIds, idSuffix } = input;
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  if (created >= BUILD_LIMITS.recipes) return { ok: false, reason: "demasiadas-recetas" };
  const raw = isRecord(payload) ? payload : {};
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const id = makeId(name, idSuffix);
  if (existingIds.has(id)) return { ok: false, reason: "solicitud-invalida" };
  const output = isRecord(raw.output) ? { item: raw.output.item, amount: raw.output.amount } : raw.output;
  const def = { id, name, structureId: raw.structureId, inputs: raw.inputs, output };
  const errors = validateRecipeDef(def, { resourceIds, itemIds, structureIds, limits: "panel", where: "receta" });
  if (errors.length) return { ok: false, reason: "definicion-invalida", details: errors };
  return { ok: true, def: def as unknown as RecipeDef };
}

