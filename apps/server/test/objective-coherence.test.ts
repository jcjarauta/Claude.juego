import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  classifyRejection, evaluateObjective, isNextTo, MESSAGE, rejectionStillExplained, snapshotFromState,
  type Objective, type Step, type WorldConfig,
} from "@juego/shared";
import { fixture, joinWorld, sleep, startServer, tempDb, waitFor, type TestPlayer } from "./helpers.ts";

// G3c, P0 (TP-29): coherencia del modelo del objetivo con el SERVIDOR REAL. El modelo usa las mismas reglas que el servidor;
// aquí se comprueba que, sobre el mismo estado sincronizado y sin concurrencia, DISPONIBLE se acepta y BLOQUEADO se rechaza con
// el motivo equivalente, y que con concurrencia el rechazo se clasifica como estado desactualizado.
const WORLD = fixture("regen-world.json");
const config = JSON.parse(readFileSync(WORLD, "utf8")) as WorldConfig;
const MISSION: Objective = { kind: "mission", id: "primera-herramienta" };

const stepOf = (p: TestPlayer, o: Objective = MISSION): Step => evaluateObjective(o, snapshotFromState(p.room.state, config, p.room.sessionId));
const send = (p: TestPlayer, type: string, fields: Record<string, unknown> = {}) => p.room.send(type, { requestId: randomUUID(), ...fields });

/** Casillas por las que no se puede pasar: nodos y edificios construidos. */
function blocked(p: TestPlayer): Set<string> {
  const cells = new Set(config.nodes.map((n) => `${n.x},${n.y}`));
  for (const s of p.room.state.structures.values()) {
    if (!s.built) continue;
    for (let x = s.x; x < s.x + s.width; x++) for (let y = s.y; y < s.y + s.height; y++) cells.add(`${x},${y}`);
  }
  return cells;
}

/** Camino más corto (anchura) hasta una casilla que cumpla `goal`. */
function route(p: TestPlayer, goal: (x: number, y: number) => boolean): { dx: number; dy: number }[] {
  const { width, height } = config.map;
  const wall = blocked(p);
  const start = { x: p.me().x, y: p.me().y };
  const prev = new Map<string, { from: string; dx: number; dy: number }>();
  const queue = [start];
  const seen = new Set([`${start.x},${start.y}`]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (goal(cur.x, cur.y)) {
      const path: { dx: number; dy: number }[] = [];
      let key = `${cur.x},${cur.y}`;
      while (prev.has(key)) { const e = prev.get(key)!; path.unshift({ dx: e.dx, dy: e.dy }); key = e.from; }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = cur.x + dx, y = cur.y + dy, k = `${x},${y}`;
      if (x < 0 || y < 0 || x >= width || y >= height || seen.has(k) || wall.has(k)) continue;
      seen.add(k);
      prev.set(k, { from: `${cur.x},${cur.y}`, dx, dy });
      queue.push({ x, y });
    }
  }
  throw new Error("sin camino");
}

async function walkTo(p: TestPlayer, goal: (x: number, y: number) => boolean) {
  for (const m of route(p, goal)) {
    const { x, y } = p.me();
    p.room.send(MESSAGE.move, m);
    await waitFor(() => p.me().x === x + m.dx && p.me().y === y + m.dy, 2000);
    await sleep(120);
  }
}

/** Ejecuta el paso tal como lo propone el modelo. Devuelve cuando el servidor ha podido responder. */
async function perform(p: TestPlayer, step: Step) {
  const a = step.action;
  assert.ok(a, `el paso «${step.text}» no tiene acción`);
  if (a.type === "go") {
    if (a.resource) {
      const nodes = config.nodes.filter((n) => n.resource === a.resource);
      return walkTo(p, (x, y) => nodes.some((n) => Math.max(Math.abs(n.x - x), Math.abs(n.y - y)) === 1));
    }
    const s = p.room.state.structures.get(a.structure!)!;
    return walkTo(p, (x, y) => isNextTo({ x, y }, { x: s.x, y: s.y, width: s.width, height: s.height }));
  }
  if (a.type === "collect") send(p, MESSAGE.collect);
  else if (a.type === "deposit") send(p, MESSAGE.transfer, { resource: a.resource, amount: a.amount, to: "community" });
  else if (a.type === "contribute") send(p, MESSAGE.contribute, { projectId: a.project, taskId: a.task, from: a.from, amount: a.amount });
  else if (a.type === "build") send(p, MESSAGE.build, { structureId: a.structure });
  else if (a.type === "craft") send(p, MESSAGE.craft, { recipeId: a.recipe });
  else assert.fail(`acción inesperada ${a.type}`);
  await sleep(260);
}

test("TP-29: siguiendo solo el objetivo (misión), cada paso DISPONIBLE es aceptado por el servidor y la misión se completa", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: tempDb() });
  try {
    const ana = await joinWorld(server.url, "ana");
    const log: string[] = [];
    for (let i = 0; i < 80; i++) {
      const step = stepOf(ana);
      log.push(`${step.status} ${step.type}: ${step.text}`);
      if (step.status === "COMPLETADO") break;
      if (step.status === "BLOQUEADO" && step.requirements.some((r) => r.code.startsWith("sin-unidades"))) { await sleep(1100); continue; } // el nodo se regenera
      assert.equal(step.status, "DISPONIBLE", `paso ${i}: ${step.text} / ${step.why} (${log.join(" | ")})`);
      const before = ana.rejections.length;
      await perform(ana, step);
      assert.deepEqual(ana.rejections.slice(before), [], `el servidor rechazó un paso DISPONIBLE: «${step.text}»`);
    }
    await waitFor(() => [...ana.room.state.missions.values()][0]!.status === "completada", 3000);
    assert.equal(stepOf(ana).status, "COMPLETADO");
    assert.ok(log.some((l) => l.includes("build")), `se construyó el taller siguiendo el objetivo: ${log.join(" | ")}`);
    assert.ok(log.some((l) => l.includes("craft")), "se fabricó la herramienta siguiendo el objetivo");
    assert.deepEqual(ana.rejections, [], "ningún rechazo en todo el recorrido");
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-29: un paso BLOQUEADO se rechaza con el motivo equivalente (taller sin construir, materiales)", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: tempDb() });
  try {
    const ana = await joinWorld(server.url, "ana");
    // El modelo ve el taller sin construir como requisito de la ruta de la herramienta…
    const plan = stepOf(ana, { kind: "item", item: "herramienta", amount: 1 });
    assert.ok(plan.requirements.some((r) => r.code === "sin-construir:taller"), JSON.stringify(plan.requirements));
    // …y el servidor lo confirma al intentar fabricar.
    send(ana, MESSAGE.craft, { recipeId: "herramienta" });
    await waitFor(() => ana.rejections.includes("taller-sin-construir"));
    assert.equal(classifyRejection("taller-sin-construir", true), "bloqueo-confirmado");
    // El modelo no propone fabricar mientras el taller no exista: propone lo que lo desbloquea.
    assert.notEqual(plan.type, "craft");
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-29: con cambios concurrentes el rechazo se clasifica como estado desactualizado y el paso se recalcula", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: tempDb() });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinWorld(server.url, "luis");
    // luis deposita 3 de madera en el almacén.
    for (let i = 0; i < 3; i++) { send(luis, MESSAGE.collect); await sleep(160); }
    await waitFor(() => (luis.me().inventory.get("madera") ?? 0) === 3);
    send(luis, MESSAGE.transfer, { resource: "madera", amount: 3, to: "community" });
    await waitFor(() => (ana.room.state.community.get("madera") ?? 0) === 3);

    // ana ve que puede aportar desde el almacén (DISPONIBLE según el último estado)…
    const task: Objective = { kind: "task", project: "construir-taller", task: "madera" };
    const stale = stepOf(ana, task);
    assert.equal(stale.status, "DISPONIBLE");
    assert.equal(stale.action?.from, "community");
    // …pero antes de actuar, luis se lleva esa madera al proyecto.
    send(luis, MESSAGE.contribute, { projectId: "construir-taller", taskId: "madera", from: "community", amount: 3 });
    await waitFor(() => (ana.room.state.community.get("madera") ?? 0) === 0);
    // La acción de ana, basada en el estado antiguo, es rechazada por el servidor.
    send(ana, MESSAGE.contribute, { projectId: "construir-taller", taskId: "madera", from: "community", amount: stale.action!.amount });
    await waitFor(() => ana.rejections.length > 0);
    const reason = ana.rejections[0]!;
    assert.equal(reason, "saldo-insuficiente");
    // Con el estado nuevo el modelo ya no recomienda lo mismo: la causa ya no es «la de antes».
    const fresh = stepOf(ana, task);
    assert.equal(rejectionStillExplained(stale, fresh), false);
    assert.equal(classifyRejection(reason, rejectionStillExplained(stale, fresh)), "estado-desactualizado");
    assert.notEqual(fresh.key, stale.key, "se recalcula: ahora toca conseguir madera");
    await ana.room.leave();
    await luis.room.leave();
  } finally {
    await server.kill();
  }
});
