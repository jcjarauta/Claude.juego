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

export interface WorldConfig {
  map: { width: number; height: number; tileSize: number; defaultZoneName: string; defaultColor: string };
  spawn: { x: number; y: number };
  moveCooldownMs: number;
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
  const { map, spawn, moveCooldownMs, resources, zones, nodes } = input;

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
