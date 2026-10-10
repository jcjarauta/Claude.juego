// Configuración del mundo (Q144: el contenido es datos, no código).
// El servidor la valida al arrancar y el cliente la recibe ya validada.

import { isValidName } from "./contracts.ts";
import { dueDateErrors } from "./management.ts";

export const RESOURCE_SHAPES = ["triangle", "square", "diamond", "circle"] as const;
export type ResourceShape = (typeof RESOURCE_SHAPES)[number];

export interface ResourceDef {
  id: string;
  name: string;
  color: string;
  /** Forma con la que se dibuja: el recurso no se distingue solo por el color (accesibilidad). */
  shape: ResourceShape;
}

export interface ZoneDef {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface NodeDef {
  id: string;
  resource: string;
  x: number;
  y: number;
  max: number;
}

export interface TaskDef {
  id: string;
  title: string;
  resource: string;
  required: number;
  /** Criterio de aceptación legible; el verificable es resource + required. Por defecto «Aportar N de X». */
  acceptance: string;
  /** Fecha objetivo opcional «AAAA-MM-DD» (F1b, Q176); no posterior a la del proyecto. */
  dueDate?: string;
}

/** Clasificación de realidad de un proyecto (CLAUDE.md §9, AUD-05). */
export const REALITIES = ["VIRTUAL", "SIMULACION", "REAL"] as const;
export type Reality = (typeof REALITIES)[number];
/** En el MVP solo se admiten proyectos virtuales (Q163). */
export const MVP_REALITIES: readonly Reality[] = ["VIRTUAL"];

/** Proyecto comunitario (Q144: los proyectos, y en el futuro las misiones, son configuración). */
export interface ProjectDef {
  id: string;
  name: string;
  description: string;
  /** Una tarea por recurso dentro del proyecto: el progreso de la tarea es el inventario del proyecto. */
  tasks: TaskDef[];
  /** Por defecto "VIRTUAL". */
  reality: Reality;
  /** Nombres que pueden revisar tareas (Q161: por nombre hasta las cuentas de M6). Por defecto, ninguno. */
  coordinators: string[];
  /** Si es true, construir exige todas las tareas aprobadas (Q162). Por defecto false. */
  buildRequiresApproval: boolean;
  /** Fecha objetivo opcional «AAAA-MM-DD» (F1b, Q176). */
  dueDate?: string;
}

/** Estructura que se levanta al completar un proyecto (M5). */
export interface StructureDef {
  id: string;
  name: string;
  projectId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/** Objeto fabricado (Q157): no se recolecta; vive en el almacén de la comunidad. */
export interface ItemDef {
  id: string;
  name: string;
}

/** Receta: consume recursos del almacén común y deja el producto en él. */
export interface RecipeDef {
  id: string;
  name: string;
  structureId: string;
  inputs: Record<string, number>;
  output: { item: string; amount: number };
}

/** Objetivos de misión (Q144, Q174): objeto en el almacén común o proyecto completado. */
export type MissionObjective =
  | { kind: "item-in-community"; item: string; amount: number }
  | { kind: "project-completed"; project: string };
export const MISSION_OBJECTIVE_KINDS = ["item-in-community", "project-completed"] as const;

export interface MissionDef {
  id: string;
  name: string;
  description: string;
  objective: MissionObjective;
}

export interface WorldConfig {
  map: { width: number; height: number; tileSize: number; defaultZoneName: string; defaultColor: string };
  spawn: { x: number; y: number };
  moveCooldownMs: number;
  /** Intervalo mínimo entre recolecciones de un jugador. */
  collectCooldownMs: number;
  /** Máximo por recurso en el inventario individual. */
  inventoryMax: number;
  /** Cada cuánto recupera un nodo 1 unidad (reloj del mundo). */
  regenIntervalMs: number;
  /** Segundos que se conserva a un jugador tras un corte inesperado antes de retirarlo. */
  session: { reconnectSeconds: number };
  community: { id: string; name: string };
  /** Cuentas con rol de administración: crean proyectos y misiones desde el panel (Q171). Por defecto, ninguna. */
  admins: string[];
  projects: ProjectDef[];
  structures: StructureDef[];
  items: ItemDef[];
  recipes: RecipeDef[];
  missions: MissionDef[];
  resources: ResourceDef[];
  zones: ZoneDef[];
  nodes: NodeDef[];
}

export type ValidationResult =
  | { ok: true; config: WorldConfig }
  | { ok: false; errors: string[] };

const COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9-]{1,40}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isText = (v: unknown, max: number, required = true): v is string =>
  typeof v === "string" && v.length <= max && (!required || v.trim().length > 0);

/** Límites de los proyectos y misiones creados desde el panel (F1a). */
export const PANEL_LIMITS = { name: 60, description: 500, tasks: 8, required: 1000, acceptance: 200, openProjects: 20, coordinators: 10 } as const;

export interface ProjectValidationContext {
  resourceIds: ReadonlySet<string>;
  /** "config": content/world.json; "panel": límites más estrictos (PANEL_LIMITS). */
  limits: "config" | "panel";
  /** Prefijo de los mensajes de error. */
  where: string;
}

/** Valida una definición de proyecto (configuración o panel) y devuelve la lista de errores. */
export function validateProjectDef(p: unknown, { resourceIds, limits, where }: ProjectValidationContext): string[] {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);
  const panel = limits === "panel";
  if (!isObject(p) || typeof p.id !== "string" || !ID.test(p.id)) return [`${where}: id inválido`];
  const at = `${where} "${p.id}"`;
  if (!isText(p.name, panel ? PANEL_LIMITS.name : 200)) fail(`${at}: name obligatorio${panel ? ` (máximo ${PANEL_LIMITS.name})` : ""}`);
  if (!isText(p.description, panel ? PANEL_LIMITS.description : 2000, false)) fail(`${at}: description debe ser texto${panel ? ` (máximo ${PANEL_LIMITS.description})` : ""}`);
  const maxTasks = panel ? PANEL_LIMITS.tasks : 50;
  if (!Array.isArray(p.tasks) || p.tasks.length === 0 || p.tasks.length > maxTasks) {
    fail(`${at}: tasks debe ser una lista de 1 a ${maxTasks} tareas`);
    return errors;
  }
  const taskIds = new Set<string>();
  const taskResources = new Set<string>();
  p.tasks.forEach((t, j) => {
    const tw = `${where}.tasks[${j}]`;
    if (!isObject(t) || typeof t.id !== "string" || !ID.test(t.id)) return fail(`${tw}: id inválido`);
    if (taskIds.has(t.id)) fail(`${tw}: id duplicado "${t.id}"`);
    taskIds.add(t.id);
    if (!isText(t.title, panel ? PANEL_LIMITS.name : 200)) fail(`${tw}: title obligatorio`);
    if (typeof t.resource !== "string" || !resourceIds.has(t.resource)) fail(`${tw}: recurso desconocido "${String(t.resource)}"`);
    else if (taskResources.has(t.resource)) fail(`${tw}: el recurso "${t.resource}" ya lo usa otra tarea del proyecto`);
    else taskResources.add(t.resource);
    if (!isInt(t.required, 1, panel ? PANEL_LIMITS.required : 10000)) fail(`${tw}: required debe ser un entero 1–${panel ? PANEL_LIMITS.required : 10000}`);
    if (t.acceptance !== undefined && !isText(t.acceptance, PANEL_LIMITS.acceptance)) {
      fail(`${tw}: acceptance debe ser un texto de 1–${PANEL_LIMITS.acceptance} caracteres`);
    }
  });
  if (p.reality !== undefined) {
    if (!REALITIES.includes(p.reality as Reality)) fail(`${at}: reality debe ser ${REALITIES.join(", ")}`);
    else if (!MVP_REALITIES.includes(p.reality as Reality)) fail(`${at}: en el MVP solo se admiten proyectos VIRTUAL (AUD-05)`);
  }
  if (p.coordinators !== undefined && (!Array.isArray(p.coordinators) || !p.coordinators.every(isValidName)
    || (panel && p.coordinators.length > PANEL_LIMITS.coordinators))) {
    fail(`${at}: coordinators debe ser una lista de nombres válidos`);
  }
  if (p.buildRequiresApproval !== undefined && typeof p.buildRequiresApproval !== "boolean") {
    fail(`${at}: buildRequiresApproval debe ser true o false`);
  }
  for (const e of dueDateErrors(p, where)) fail(e);
  return errors;
}

export interface MissionValidationContext {
  itemIds: ReadonlySet<string>;
  projectIds: ReadonlySet<string>;
  where: string;
}

/** Valida una definición de misión (configuración o panel) y devuelve la lista de errores. */
export function validateMissionDef(m: unknown, { itemIds, projectIds, where }: MissionValidationContext): string[] {
  if (!isObject(m) || typeof m.id !== "string" || !ID.test(m.id)) return [`${where}: id inválido`];
  const errors: string[] = [];
  const at = `${where} "${m.id}"`;
  if (!isText(m.name, PANEL_LIMITS.name)) errors.push(`${at}: name obligatorio (máximo ${PANEL_LIMITS.name})`);
  if (!isText(m.description, PANEL_LIMITS.description, false)) errors.push(`${at}: description debe ser texto (máximo ${PANEL_LIMITS.description})`);
  const o = m.objective;
  const valid = isObject(o) && (
    (o.kind === "item-in-community" && typeof o.item === "string" && itemIds.has(o.item) && isInt(o.amount, 1, 1000))
    || (o.kind === "project-completed" && typeof o.project === "string" && projectIds.has(o.project) && Object.keys(o).length === 2)
  );
  if (!valid) {
    errors.push(`${at}: objective debe ser { kind: "item-in-community", item conocido, amount 1–1000 } o { kind: "project-completed", project conocido }`);
  }
  return errors;
}

/** Identificador estable a partir de un nombre: minúsculas sin acentos, guiones y un sufijo aleatorio. */
export function makeId(name: string, suffix: string): string {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "");
  return `${slug || "p"}-${suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "0"}`;
}

export function validateWorldConfig(input: unknown): ValidationResult {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);

  if (!isObject(input)) return { ok: false, errors: ["la configuración no es un objeto"] };
  const { map, spawn, moveCooldownMs, collectCooldownMs, inventoryMax, regenIntervalMs, session, community, admins, projects, structures, items, recipes, missions, resources, zones, nodes } = input;

  if (!isObject(map) || !isInt(map.width, 1, 1000) || !isInt(map.height, 1, 1000) || !isInt(map.tileSize, 8, 128)) {
    fail("map: width y height deben ser enteros 1–1000 y tileSize 8–128");
    return { ok: false, errors };
  }
  if (typeof map.defaultZoneName !== "string" || !map.defaultZoneName) fail("map.defaultZoneName obligatorio");
  if (typeof map.defaultColor !== "string" || !COLOR.test(map.defaultColor)) fail("map.defaultColor debe ser #rrggbb");
  const width = map.width;
  const height = map.height;
  const inside = (x: unknown, y: unknown) => isInt(x, 0, width - 1) && isInt(y, 0, height - 1);

  if (!isInt(moveCooldownMs, 0, 10000)) fail("moveCooldownMs debe ser un entero 0–10000");
  if (!isInt(collectCooldownMs, 0, 60000)) fail("collectCooldownMs debe ser un entero 0–60000");
  if (!isInt(inventoryMax, 1, 1000)) fail("inventoryMax debe ser un entero 1–1000");
  if (!isInt(regenIntervalMs, 50, 86_400_000)) fail("regenIntervalMs debe ser un entero 50–86400000");
  if (!isObject(session) || !isInt(session.reconnectSeconds, 0, 300)) fail("session.reconnectSeconds debe ser un entero 0–300");

  const resourceIds = new Set<string>();
  if (!Array.isArray(resources) || resources.length === 0) fail("resources debe ser una lista no vacía");
  else resources.forEach((r, i) => {
    if (!isObject(r) || typeof r.id !== "string" || !ID.test(r.id)) return fail(`resources[${i}]: id inválido`);
    if (resourceIds.has(r.id)) fail(`resources: id duplicado "${r.id}"`);
    resourceIds.add(r.id);
    if (typeof r.name !== "string" || !r.name) fail(`resources[${i}]: name obligatorio`);
    if (typeof r.color !== "string" || !COLOR.test(r.color)) fail(`resources[${i}]: color debe ser #rrggbb`);
    if (!RESOURCE_SHAPES.includes(r.shape as ResourceShape)) fail(`resources[${i}]: shape debe ser ${RESOURCE_SHAPES.join(", ")}`);
  });

  const zoneIds = new Set<string>();
  if (!Array.isArray(zones)) fail("zones debe ser una lista");
  else zones.forEach((z, i) => {
    if (!isObject(z) || typeof z.id !== "string" || !ID.test(z.id)) return fail(`zones[${i}]: id inválido`);
    if (zoneIds.has(z.id)) fail(`zones: id duplicado "${z.id}"`);
    zoneIds.add(z.id);
    if (typeof z.name !== "string" || !z.name) fail(`zones[${i}]: name obligatorio`);
    if (typeof z.color !== "string" || !COLOR.test(z.color)) fail(`zones[${i}]: color debe ser #rrggbb`);
    if (!isInt(z.width, 1) || !isInt(z.height, 1) || !inside(z.x, z.y)
      || (z.x as number) + z.width > width || (z.y as number) + z.height > height) {
      fail(`zones[${i}] "${z.id}": fuera del mapa`);
    }
  });

  const nodeIds = new Set<string>();
  const nodeCells = new Set<string>();
  if (!Array.isArray(nodes)) fail("nodes debe ser una lista");
  else nodes.forEach((n, i) => {
    if (!isObject(n) || typeof n.id !== "string" || !ID.test(n.id)) return fail(`nodes[${i}]: id inválido`);
    if (nodeIds.has(n.id)) fail(`nodes: id duplicado "${n.id}"`);
    nodeIds.add(n.id);
    if (typeof n.resource !== "string" || !resourceIds.has(n.resource)) fail(`nodes[${i}] "${n.id}": recurso desconocido "${String(n.resource)}"`);
    if (!isInt(n.max, 1, 1000)) fail(`nodes[${i}] "${n.id}": max debe ser entero 1–1000`);
    if (!inside(n.x, n.y)) return fail(`nodes[${i}] "${n.id}": fuera del mapa`);
    const cell = `${n.x},${n.y}`;
    if (nodeCells.has(cell)) fail(`nodes[${i}] "${n.id}": casilla ${cell} ocupada por otro nodo`);
    nodeCells.add(cell);
  });

  if (!isObject(community) || typeof community.id !== "string" || !ID.test(community.id) || typeof community.name !== "string" || !community.name) {
    fail("community: id y name obligatorios");
  }

  if (admins !== undefined && (!Array.isArray(admins) || !admins.every(isValidName))) fail("admins debe ser una lista de nombres válidos");

  const projectIds = new Set<string>();
  if (!Array.isArray(projects)) fail("projects debe ser una lista");
  else projects.forEach((p, i) => {
    for (const e of validateProjectDef(p, { resourceIds, limits: "config", where: `projects[${i}]` })) fail(e);
    if (isObject(p) && typeof p.id === "string") {
      if (projectIds.has(p.id)) fail(`projects: id duplicado "${p.id}"`);
      projectIds.add(p.id);
    }
  });

  const structureIds = new Set<string>();
  if (!Array.isArray(structures)) fail("structures debe ser una lista");
  else structures.forEach((st, i) => {
    if (!isObject(st) || typeof st.id !== "string" || !ID.test(st.id)) return fail(`structures[${i}]: id inválido`);
    if (structureIds.has(st.id)) fail(`structures: id duplicado "${st.id}"`);
    structureIds.add(st.id);
    if (typeof st.name !== "string" || !st.name) fail(`structures[${i}] "${st.id}": name obligatorio`);
    if (typeof st.projectId !== "string" || !projectIds.has(st.projectId)) fail(`structures[${i}] "${st.id}": proyecto desconocido "${String(st.projectId)}"`);
    if (typeof st.color !== "string" || !COLOR.test(st.color)) fail(`structures[${i}] "${st.id}": color debe ser #rrggbb`);
    if (!isInt(st.width, 1, 20) || !isInt(st.height, 1, 20) || !inside(st.x, st.y)
      || (st.x as number) + st.width > width || (st.y as number) + st.height > height) {
      return fail(`structures[${i}] "${st.id}": fuera del mapa`);
    }
    for (let x = st.x as number; x < (st.x as number) + st.width; x++) {
      for (let y = st.y as number; y < (st.y as number) + st.height; y++) {
        if (nodeCells.has(`${x},${y}`)) fail(`structures[${i}] "${st.id}": la casilla ${x},${y} la ocupa un nodo`);
        if (isObject(spawn) && spawn.x === x && spawn.y === y) fail(`structures[${i}] "${st.id}": cubre el punto de aparición`);
      }
    }
  });

  const itemIds = new Set<string>();
  if (!Array.isArray(items)) fail("items debe ser una lista");
  else items.forEach((it, i) => {
    if (!isObject(it) || typeof it.id !== "string" || !ID.test(it.id)) return fail(`items[${i}]: id inválido`);
    if (itemIds.has(it.id) || resourceIds.has(it.id)) fail(`items: id duplicado o igual a un recurso "${it.id}"`);
    itemIds.add(it.id);
    if (typeof it.name !== "string" || !it.name) fail(`items[${i}] "${it.id}": name obligatorio`);
  });

  const recipeIds = new Set<string>();
  if (!Array.isArray(recipes)) fail("recipes debe ser una lista");
  else recipes.forEach((r, i) => {
    if (!isObject(r) || typeof r.id !== "string" || !ID.test(r.id)) return fail(`recipes[${i}]: id inválido`);
    if (recipeIds.has(r.id)) fail(`recipes: id duplicado "${r.id}"`);
    recipeIds.add(r.id);
    if (typeof r.name !== "string" || !r.name) fail(`recipes[${i}] "${r.id}": name obligatorio`);
    if (typeof r.structureId !== "string" || !structureIds.has(r.structureId)) fail(`recipes[${i}] "${r.id}": estructura desconocida "${String(r.structureId)}"`);
    if (!isObject(r.inputs) || Object.keys(r.inputs).length === 0) fail(`recipes[${i}] "${r.id}": inputs obligatorio`);
    else for (const [res, amount] of Object.entries(r.inputs)) {
      if (!resourceIds.has(res)) fail(`recipes[${i}] "${r.id}": recurso desconocido "${res}"`);
      if (!isInt(amount, 1, 1000)) fail(`recipes[${i}] "${r.id}": cantidad de "${res}" debe ser un entero 1–1000`);
    }
    if (!isObject(r.output) || typeof r.output.item !== "string" || !itemIds.has(r.output.item)) fail(`recipes[${i}] "${r.id}": objeto de salida desconocido`);
    else if (!isInt(r.output.amount, 1, 100)) fail(`recipes[${i}] "${r.id}": output.amount debe ser un entero 1–100`);
  });

  const missionIds = new Set<string>();
  if (!Array.isArray(missions)) fail("missions debe ser una lista");
  else missions.forEach((m, i) => {
    for (const e of validateMissionDef(m, { itemIds, projectIds, where: `missions[${i}]` })) fail(e);
    if (isObject(m) && typeof m.id === "string") {
      if (missionIds.has(m.id)) fail(`missions: id duplicado "${m.id}"`);
      missionIds.add(m.id);
    }
  });

  if (!isObject(spawn) || !inside(spawn.x, spawn.y)) fail("spawn: fuera del mapa");
  else if (nodeCells.has(`${spawn.x},${spawn.y}`)) fail("spawn: la casilla de aparición está bloqueada por un nodo");

  if (errors.length) return { ok: false, errors };
  return { ok: true, config: withDefaults(input as unknown as WorldConfig) };
}

/** Completa los campos opcionales de los proyectos sin modificar la entrada. */
function withDefaults(config: WorldConfig): WorldConfig {
  const resourceName = new Map(config.resources.map((r) => [r.id, r.name.toLowerCase()]));
  return {
    ...config,
    admins: config.admins ?? [],
    projects: config.projects.map((p) => withProjectDefaults(p, resourceName)),
  };
}

/** Valores por defecto de un proyecto (realidad, coordinadores, aprobación y criterio de cada tarea). */
export function withProjectDefaults(p: ProjectDef, resourceName: ReadonlyMap<string, string>): ProjectDef {
  return {
    ...p,
    reality: p.reality ?? "VIRTUAL",
    coordinators: p.coordinators ?? [],
    buildRequiresApproval: p.buildRequiresApproval ?? false,
    tasks: p.tasks.map((t) => ({ ...t, acceptance: t.acceptance ?? `Aportar ${t.required} de ${resourceName.get(t.resource) ?? t.resource}` })),
  };
}

/** Consultas sobre una configuración ya validada. */
export function createWorldIndex(config: WorldConfig) {
  const blocked = new Set(config.nodes.map((n) => `${n.x},${n.y}`));
  return {
    width: config.map.width,
    height: config.map.height,
    isBlocked: (x: number, y: number) => blocked.has(`${x},${y}`),
    zoneNameAt(x: number, y: number): string {
      // La última zona declarada gana si se solapan.
      for (let i = config.zones.length - 1; i >= 0; i--) {
        const z = config.zones[i]!;
        if (x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height) return z.name;
      }
      return config.map.defaultZoneName;
    },
  };
}

export type WorldIndex = ReturnType<typeof createWorldIndex>;
