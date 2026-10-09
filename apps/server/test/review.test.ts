import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { MESSAGE, type MoveMessage, type ReviewDecision } from "@juego/shared";
import { fixture, joinWorld, sleep, startServer, tempDb, waitFor, type TestPlayer } from "./helpers.ts";

// Mundo de prueba (regeneración 1/s): aparición (0,0); árbol (1,0) de 5 madera; roca (3,3) de 1 piedra;
// solar del taller 1x1 en (2,1). Proyecto: 4 madera y 1 piedra; coordinadora: ana.
const WORLD = fixture("regen-world.json");
// El mismo mundo con buildRequiresApproval: true.
const APPROVAL_WORLD = fixture("approval-world.json");
const PROJECT = "construir-taller";

const DOWN = { dx: 0, dy: 1 };
const RIGHT = { dx: 1, dy: 0 };

const project = (p: TestPlayer) => p.room.state.projects.get(PROJECT)!;
const task = (p: TestPlayer, id: string) => project(p).tasks.get(id)!;
const inv = (p: TestPlayer, id: string) => p.me().inventory.get(id) ?? 0;

async function walk(p: TestPlayer, steps: MoveMessage[]) {
  for (const step of steps) {
    const { x, y } = p.me();
    p.room.send(MESSAGE.move, step);
    await waitFor(() => p.me().x === x + step.dx && p.me().y === y + step.dy, 2000);
    await sleep(110);
  }
}

async function collect(p: TestPlayer, resource: string) {
  const before = inv(p, resource);
  let lastSent = 0;
  await waitFor(() => {
    if (inv(p, resource) > before) return true;
    if (Date.now() - lastSent > 150) {
      p.room.send(MESSAGE.collect, { requestId: randomUUID() });
      lastSent = Date.now();
    }
    return false;
  }, 6000);
  await sleep(110);
}

function contribute(p: TestPlayer, taskId: string, amount: number) {
  p.room.send(MESSAGE.contribute, { requestId: randomUUID(), projectId: PROJECT, taskId, from: "player", amount });
}

function review(p: TestPlayer, taskId: string, decision: ReviewDecision | string, note: unknown, requestId = randomUUID()) {
  p.room.send(MESSAGE.review, { requestId, projectId: PROJECT, taskId, decision, note });
}

/** Completa la tarea de madera con dos aportes de ana (3 + 1). */
async function completeWood(ana: TestPlayer) {
  for (let i = 0; i < 3; i++) await collect(ana, "madera");
  contribute(ana, "madera", 3);
  await waitFor(() => task(ana, "madera").status === "en-curso");
  await collect(ana, "madera");
  contribute(ana, "madera", 1);
  await waitFor(() => task(ana, "madera").status === "completada");
}

test("TP-16: revisar exige coordinador, nota y tarea completada; todos ven la decisión; persiste con su evidencia", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  const ana = await joinWorld(server.url, "ana");
  const bea = await joinWorld(server.url, "bea");
  assert.equal(project(bea).reality, "VIRTUAL");
  assert.deepEqual([...project(bea).coordinators], ["ana"]);
  assert.equal(task(bea, "madera").status, "pendiente");

  review(bea, "madera", "aprobada", "Bien");
  await waitFor(() => bea.rejections.includes("sin-permiso"));
  review(ana, "madera", "aprobada", "Bien");
  await waitFor(() => ana.rejections.includes("tarea-sin-completar"));
  review(ana, "madera", "aprobada", "   ");
  await waitFor(() => ana.rejections.includes("nota-invalida"));
  review(ana, "madera", "quizá", "Bien");
  review(ana, "oro", "aprobada", "Bien");
  await waitFor(() => ana.rejections.includes("solicitud-invalida") && ana.rejections.includes("tarea-desconocida"));

  await completeWood(ana);
  await waitFor(() => task(bea, "madera").status === "completada");
  assert.equal(task(bea, "piedra").status, "pendiente");

  // Rechazar deja constancia sin mover recursos; el mismo requestId no se aplica dos veces.
  const rejectId = randomUUID();
  review(ana, "madera", "rechazada", "Revisar el recuento", rejectId);
  await waitFor(() => task(bea, "madera").status === "rechazada");
  assert.equal(task(bea, "madera").reviewedBy, "ana");
  assert.equal(task(bea, "madera").note, "Revisar el recuento");
  assert.equal(project(bea).progress.get("madera"), 4);
  const rejectionsBefore = ana.rejections.length;
  review(ana, "madera", "rechazada", "Revisar el recuento", rejectId);
  await sleep(300);
  assert.equal(ana.rejections.length, rejectionsBefore);

  review(ana, "madera", "aprobada", "  Recuento correcto  ");
  await waitFor(() => task(bea, "madera").status === "aprobada");
  assert.equal(task(bea, "madera").note, "Recuento correcto");
  assert.ok(task(bea, "madera").reviewedAt > 0);
  await server.kill(); // caída brusca

  // Historial y evidencia en el registro de eventos.
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const reviews = db.prepare("SELECT actor, data FROM event WHERE type = 'task-review' ORDER BY id").all() as { actor: string; data: string }[];
  const lastContribution = db.prepare(`SELECT MAX(id) AS id FROM event WHERE type = 'contribute' AND json_extract(data, '$.task') = 'madera'`).get() as { id: number };
  db.close();
  assert.equal(reviews.length, 2, "una revisión por requestId distinto");
  const last = JSON.parse(reviews[1]!.data);
  assert.equal(reviews[1]!.actor, "ana");
  assert.equal(last.decision, "aprobada");
  assert.deepEqual(last.evidence, { contributions: 2, lastEventId: Number(lastContribution.id) });

  // TP-09: la revisión sobrevive al reinicio.
  server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const eva = await joinWorld(server.url, "eva");
    assert.equal(task(eva, "madera").status, "aprobada");
    assert.equal(task(eva, "madera").reviewedBy, "ana");
    assert.equal(task(eva, "madera").note, "Recuento correcto");
    assert.equal(task(eva, "piedra").status, "pendiente");
    await eva.room.leave();
  } finally {
    await server.kill();
  }
});

test("Q162: con aprobación obligatoria no se construye hasta aprobar todas las tareas", async () => {
  const server = await startServer({ WORLD_CONFIG: APPROVAL_WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    await completeWood(ana);
    await walk(ana, [DOWN, RIGHT, DOWN, RIGHT]); // (0,0) → (2,2), junto a la roca y al taller
    await collect(ana, "piedra");
    contribute(ana, "piedra", 1);
    await waitFor(() => project(ana).status === "listo");

    ana.room.send(MESSAGE.build, { requestId: randomUUID(), structureId: "taller" });
    await waitFor(() => ana.rejections.includes("tareas-sin-aprobar"));
    review(ana, "madera", "aprobada", "Correcto");
    review(ana, "piedra", "rechazada", "Falta comprobar");
    await waitFor(() => task(ana, "piedra").status === "rechazada");
    ana.room.send(MESSAGE.build, { requestId: randomUUID(), structureId: "taller" });
    await waitFor(() => ana.rejections.filter((r) => r === "tareas-sin-aprobar").length === 2);

    review(ana, "piedra", "aprobada", "Comprobado");
    await waitFor(() => task(ana, "piedra").status === "aprobada");
    ana.room.send(MESSAGE.build, { requestId: randomUUID(), structureId: "taller" });
    await waitFor(() => ana.room.state.structures.get("taller")!.built);
    assert.equal(project(ana).status, "construido");
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});
