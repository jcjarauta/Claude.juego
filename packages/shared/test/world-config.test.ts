import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateWorldConfig, createWorldIndex, type WorldConfig } from "../src/index.ts";

const base = (): WorldConfig => ({
  map: { width: 10, height: 8, tileSize: 32, defaultZoneName: "Camino", defaultColor: "#333333" },
  spawn: { x: 1, y: 1 },
  moveCooldownMs: 100,
  collectCooldownMs: 1000,
  inventoryMax: 10,
  regenIntervalMs: 120000,
  session: { reconnectSeconds: 10 },
  community: { id: "aldea", name: "Aldea" },
  projects: [{
    id: "construir-taller", name: "Construir taller", description: "",
    tasks: [{ id: "madera", title: "Aportar madera", resource: "madera", required: 20 }],
  }],
  resources: [{ id: "madera", name: "Madera", color: "#8d5a2b", shape: "triangle" }],
  zones: [{ id: "bosque", name: "Bosque", x: 0, y: 0, width: 5, height: 5, color: "#1f4d2b" }],
  nodes: [{ id: "arbol-1", resource: "madera", x: 3, y: 3, max: 3 }],
});

const errorsOf = (cfg: unknown) => {
  const r = validateWorldConfig(cfg);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors.join(" | ");
};

test("acepta una configuración correcta", () => {
  assert.equal(validateWorldConfig(base()).ok, true);
});

test("el mundo del MVP (content/world.json) es válido", () => {
  const cfg = JSON.parse(readFileSync(new URL("../../../content/world.json", import.meta.url), "utf8"));
  const r = validateWorldConfig(cfg);
  assert.equal(r.ok, true, r.ok ? "" : r.errors.join("\n"));
  assert.equal(cfg.map.width, 40);
  assert.equal(cfg.map.height, 30);
});

test("rechaza un mapa sin dimensiones válidas", () => {
  const cfg = base() as unknown as Record<string, unknown>;
  cfg.map = { tileSize: 32 };
  assert.match(String(errorsOf(cfg)), /map:/);
});

test("rechaza zonas fuera del mapa", () => {
  const cfg = base();
  cfg.zones[0]!.width = 20;
  assert.match(String(errorsOf(cfg)), /zones\[0\] "bosque": fuera del mapa/);
});

test("rechaza nodos fuera del mapa o en la misma casilla", () => {
  const cfg = base();
  cfg.nodes.push({ id: "arbol-2", resource: "madera", x: 3, y: 3, max: 3 });
  cfg.nodes.push({ id: "arbol-3", resource: "madera", x: 99, y: 0, max: 3 });
  const errors = String(errorsOf(cfg));
  assert.match(errors, /casilla 3,3 ocupada/);
  assert.match(errors, /"arbol-3": fuera del mapa/);
});

test("rechaza ids duplicados y recursos desconocidos", () => {
  const cfg = base();
  cfg.nodes.push({ id: "arbol-1", resource: "oro", x: 6, y: 6, max: 3 });
  const errors = String(errorsOf(cfg));
  assert.match(errors, /id duplicado "arbol-1"/);
  assert.match(errors, /recurso desconocido "oro"/);
});

test("rechaza un punto de aparición bloqueado o fuera del mapa", () => {
  const blocked = base();
  blocked.spawn = { x: 3, y: 3 };
  assert.match(String(errorsOf(blocked)), /aparición está bloqueada/);
  const outside = base();
  outside.spawn = { x: -1, y: 0 };
  assert.match(String(errorsOf(outside)), /spawn: fuera del mapa/);
});

test("rechaza un plazo de reconexión ausente o fuera de rango", () => {
  const missing = base() as unknown as Record<string, unknown>;
  delete missing.session;
  assert.match(String(errorsOf(missing)), /session.reconnectSeconds/);
  const tooLong = base();
  tooLong.session.reconnectSeconds = 3600;
  assert.match(String(errorsOf(tooLong)), /session.reconnectSeconds/);
});

test("rechaza parámetros de recursos fuera de rango", () => {
  const cfg = base();
  cfg.inventoryMax = 0;
  cfg.regenIntervalMs = 10;
  const errors = String(errorsOf(cfg));
  assert.match(errors, /inventoryMax/);
  assert.match(errors, /regenIntervalMs/);
});

test("rechaza proyectos mal definidos y una comunidad sin nombre", () => {
  const cfg = base();
  cfg.community.name = "";
  cfg.projects[0]!.tasks.push({ id: "madera", title: "", resource: "madera", required: 0 });
  cfg.projects[0]!.tasks.push({ id: "oro", title: "Oro", resource: "oro", required: 1 });
  cfg.projects.push({ ...cfg.projects[0]!, tasks: [] });
  const errors = String(errorsOf(cfg));
  assert.match(errors, /community: id y name obligatorios/);
  assert.match(errors, /id duplicado "madera"/);
  assert.match(errors, /el recurso "madera" ya lo usa otra tarea/);
  assert.match(errors, /required debe ser un entero/);
  assert.match(errors, /recurso desconocido "oro"/);
  assert.match(errors, /projects: id duplicado "construir-taller"/);
});

test("rechaza un recurso sin forma válida", () => {
  const cfg = base() as unknown as { resources: Record<string, unknown>[] };
  cfg.resources[0]!.shape = "estrella";
  assert.match(String(errorsOf(cfg)), /resources\[0\]: shape debe ser/);
});

test("el índice del mundo responde zona y bloqueo", () => {
  const index = createWorldIndex(base());
  assert.equal(index.zoneNameAt(1, 1), "Bosque");
  assert.equal(index.zoneNameAt(8, 7), "Camino");
  assert.equal(index.isBlocked(3, 3), true);
  assert.equal(index.isBlocked(4, 3), false);
});
