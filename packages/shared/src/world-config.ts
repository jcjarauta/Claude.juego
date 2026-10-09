// Configuración del mundo (Q144: el contenido es datos, no código).
// El servidor la valida al arrancar y el cliente la recibe ya validada.

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
}

/** Proyecto comunitario (Q144: los proyectos, y en el futuro las misiones, son configuración). */
export interface ProjectDef {
  id: string;
  name: string;
  description: string;
  /** Una tarea por recurso dentro del proyecto: el progreso de la tarea es el inventario del proyecto. */
  tasks: TaskDef[];
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

export interface MissionDef {
  id: string;
  name: string;
  description: string;
  /** Único tipo del MVP; otros llegarán como configuración (Q144). */
  objective: { kind: "item-in-community"; item: string; amount: number };
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

export function validateWorldConfig(input: unknown): ValidationResult {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);

  if (!isObject(input)) return { ok: false, errors: ["la configuración no es un objeto"] };
  const { map, spawn, moveCooldownMs, collectCooldownMs, inventoryMax, regenIntervalMs, session, community, projects, structures, items, recipes, missions, resources, zones, nodes } = input;

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

  const projectIds = new Set<string>();
  if (!Array.isArray(projects)) fail("projects debe ser una lista");
  else projects.forEach((p, i) => {
    if (!isObject(p) || typeof p.id !== "string" || !ID.test(p.id)) return fail(`projects[${i}]: id inválido`);
    if (projectIds.has(p.id)) fail(`projects: id duplicado "${p.id}"`);
    projectIds.add(p.id);
    if (typeof p.name !== "string" || !p.name) fail(`projects[${i}] "${p.id}": name obligatorio`);
    if (typeof p.description !== "string") fail(`projects[${i}] "${p.id}": description debe ser texto`);
    if (!Array.isArray(p.tasks) || p.tasks.length === 0) return fail(`projects[${i}] "${p.id}": tasks debe ser una lista no vacía`);
    const taskIds = new Set<string>();
    const taskResources = new Set<string>();
    p.tasks.forEach((t, j) => {
      const where = `projects[${i}].tasks[${j}]`;
      if (!isObject(t) || typeof t.id !== "string" || !ID.test(t.id)) return fail(`${where}: id inválido`);
      if (taskIds.has(t.id)) fail(`${where}: id duplicado "${t.id}"`);
      taskIds.add(t.id);
      if (typeof t.title !== "string" || !t.title) fail(`${where}: title obligatorio`);
      if (typeof t.resource !== "string" || !resourceIds.has(t.resource)) fail(`${where}: recurso desconocido "${String(t.resource)}"`);
      else if (taskResources.has(t.resource)) fail(`${where}: el recurso "${t.resource}" ya lo usa otra tarea del proyecto`);
      else taskResources.add(t.resource);
      if (!isInt(t.required, 1, 10000)) fail(`${where}: required debe ser un entero 1–10000`);
    });
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
    if (!isObject(m) || typeof m.id !== "string" || !ID.test(m.id)) return fail(`missions[${i}]: id inválido`);
    if (missionIds.has(m.id)) fail(`missions: id duplicado "${m.id}"`);
    missionIds.add(m.id);
    if (typeof m.name !== "string" || !m.name) fail(`missions[${i}] "${m.id}": name obligatorio`);
    if (typeof m.description !== "string") fail(`missions[${i}] "${m.id}": description debe ser texto`);
    const o = m.objective;
    if (!isObject(o) || o.kind !== "item-in-community" || typeof o.item !== "string" || !itemIds.has(o.item) || !isInt(o.amount, 1, 1000)) {
      fail(`missions[${i}] "${m.id}": objective debe ser { kind: "item-in-community", item conocido, amount 1–1000 }`);
    }
  });

  if (!isObject(spawn) || !inside(spawn.x, spawn.y)) fail("spawn: fuera del mapa");
  else if (nodeCells.has(`${spawn.x},${spawn.y}`)) fail("spawn: la casilla de aparición está bloqueada por un nodo");

  return errors.length ? { ok: false, errors } : { ok: true, config: input as unknown as WorldConfig };
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
