import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MESSAGE, type CommentsResponse, type MoveMessage } from "@juego/shared";
import { MIGRATIONS, openStore, SCHEMA_VERSION } from "../src/store.ts";
import { fixture, joinPanel, joinWorld, sessionFor, sleep, startServer, tempDb, waitFor, type TestPanel, type TestPlayer } from "./helpers.ts";

// F1c: responsables (TP-21), dependencias (TP-22) y comentarios (TP-23).
// Mundo de prueba (regeneración 1/s): aparición (0,0) junto al árbol (1,0); roca (3,3); administración: ana.
const WORLD = fixture("regen-world.json");
const DOWN = { dx: 0, dy: 1 };
const RIGHT = { dx: 1, dy: 0 };

type Viewer = TestPlayer | TestPanel;
const projectNamed = (v: Viewer, name: string) => [...v.room.state.projects.entries()].find(([, p]) => p.name === name);
const task = (v: Viewer, projectId: string, taskId: string) => v.room.state.projects.get(projectId)!.tasks.get(taskId)!;
const send = (v: Viewer, type: string, fields: Record<string, unknown>) => v.room.send(type, { requestId: randomUUID(), ...fields });
const inv = (p: TestPlayer, id: string) => p.me().inventory.get(id) ?? 0;

async function collect(p: TestPlayer, resource: string) {
  const before = inv(p, resource);
  let last = 0;
  await waitFor(() => {
    if (inv(p, resource) > before) return true;
    if (Date.now() - last > 150) { p.room.send(MESSAGE.collect, { requestId: randomUUID() }); last = Date.now(); }
    return false;
  }, 6000);
  await sleep(110);
}

async function walk(p: TestPlayer, steps: MoveMessage[]) {
  for (const step of steps) {
    const { x, y } = p.me();
    p.room.send(MESSAGE.move, step);
    await waitFor(() => p.me().x === x + step.dx && p.me().y === y + step.dy, 2000);
    await sleep(110);
  }
}

async function createProject(ana: TestPlayer, viewer: Viewer, name: string, extra: Record<string, unknown> = {}) {
  send(ana, MESSAGE.createProject, {
    name, description: "", coordinators: ["ana"],
    tasks: [{ title: "Madera", resource: "madera", required: 1, dependsOn: ["piedra"] }, { title: "Piedra", resource: "piedra", required: 1 }],
    ...extra,
  });
  await waitFor(() => Boolean(projectNamed(viewer, name)));
  return projectNamed(viewer, name)![0];
}

test("TP-21 y TP-23: responsables y comentarios en vivo, con permisos; persisten; hilo por HTTP con token", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  const ana = await joinWorld(server.url, "ana");
  const bea = await joinWorld(server.url, "bea");
  const luis = await joinPanel(server.url, "luis");
  await sessionFor(server.url, "eva");
  const id = await createProject(ana, luis, "Pozo");
  assert.deepEqual([...task(luis, id, "madera").dependsOn], ["piedra"]);

  // Responsables.
  send(bea, MESSAGE.assign, { projectId: id, taskId: "madera", name: "bea" });
  await waitFor(() => [...task(luis, id, "madera").assignees].join() === "bea");
  send(bea, MESSAGE.assign, { projectId: id, taskId: "madera", name: "luis" });
  await waitFor(() => bea.rejections.includes("sin-permiso"));
  send(ana, MESSAGE.assign, { projectId: id, taskId: "madera", name: "nadie" });
  await waitFor(() => ana.rejections.includes("solicitud-invalida"));
  send(ana, MESSAGE.assign, { projectId: id, taskId: "madera", name: "luis" });
  send(ana, MESSAGE.assign, { projectId: id, taskId: "madera", name: "ana" });
  await waitFor(() => task(luis, id, "madera").assignees.length === 3);
  send(ana, MESSAGE.assign, { projectId: id, taskId: "madera", name: "eva" });
  await waitFor(() => ana.rejections.includes("demasiados-responsables"));
  send(bea, MESSAGE.unassign, { projectId: id, taskId: "madera", name: "bea" });
  await waitFor(() => [...task(luis, id, "madera").assignees].join() === "luis,ana");

  // Comentarios.
  send(bea, MESSAGE.comment, { projectId: id, taskId: "madera", text: "  ¿Quién trae la piedra?  " });
  await waitFor(() => task(luis, id, "madera").comments === 1);
  assert.deepEqual([task(luis, id, "madera").lastCommentBy, task(luis, id, "madera").lastCommentText], ["bea", "¿Quién trae la piedra?"]);
  send(luis, MESSAGE.comment, { projectId: id, taskId: "madera", text: "Yo, mañana" });
  await waitFor(() => task(bea, id, "madera").comments === 2 && task(bea, id, "madera").lastCommentBy === "luis");
  send(luis, MESSAGE.comment, { projectId: id, taskId: "madera", text: "   " });
  send(luis, MESSAGE.comment, { projectId: id, taskId: "oro", text: "Hola" });
  await waitFor(() => luis.rejections.includes("comentario-invalido") && luis.rejections.includes("tarea-desconocida"));

  const url = `${server.url}/api/proyectos/${id}/tareas/madera/comentarios`;
  assert.equal((await fetch(url)).status, 401);
  const auth = { headers: { authorization: `Bearer ${await sessionFor(server.url, "eva")}` } };
  const thread = (await (await fetch(url, auth)).json()) as CommentsResponse;
  assert.deepEqual(thread.comments.map((c) => `${c.by}: ${c.text}`), ["bea: ¿Quién trae la piedra?", "luis: Yo, mañana"]);
  assert.equal((await fetch(`${server.url}/api/proyectos/${id}/tareas/oro/comentarios`, auth)).status, 404);
  await sleep(200);
  await server.kill(); // caída brusca

  server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const eva = await joinPanel(server.url, "eva");
    const again = task(eva, id, "madera");
    assert.deepEqual([[...again.assignees].join(), again.comments, again.lastCommentText, [...again.dependsOn].join()], ["luis,ana", 2, "Yo, mañana", "piedra"]);
    await eva.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-22: una tarea bloqueada rechaza aportes hasta que termina su requisito (también con aprobación)", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinPanel(server.url, "luis");
    send(ana, MESSAGE.createProject, {
      name: "Ciclo", description: "", tasks: [{ title: "A", resource: "madera", required: 1, dependsOn: ["piedra"] }, { title: "B", resource: "piedra", required: 1, dependsOn: ["madera"] }],
    });
    await waitFor(() => ana.rejections.includes("definicion-invalida"));
    const pozo = await createProject(ana, luis, "Pozo");
    const balsa = await createProject(ana, luis, "Balsa", { requiresApproval: true });

    // Madera depende de piedra: con madera en la mano, el aporte se rechaza sin efecto.
    ana.room.send(MESSAGE.move, RIGHT); // mirar al árbol
    await collect(ana, "madera");
    await collect(ana, "madera");
    send(ana, MESSAGE.contribute, { projectId: pozo, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => ana.rejections.includes("tarea-bloqueada"));
    assert.equal(inv(ana, "madera"), 2, "el aporte bloqueado no gasta nada");
    assert.equal(luis.room.state.projects.get(pozo)!.progress.get("madera") ?? 0, 0);

    // Replanificar madera antes que piedra (de la que depende) no vale.
    send(ana, MESSAGE.reschedule, { projectId: pozo, taskId: "piedra", dueDate: "2026-12-10", reason: "Plazo" });
    await waitFor(() => task(luis, pozo, "piedra").dueDate === "2026-12-10");
    send(ana, MESSAGE.reschedule, { projectId: pozo, taskId: "madera", dueDate: "2026-12-01", reason: "Antes" });
    await waitFor(() => ana.rejections.includes("fecha-invalida"));

    // Se termina piedra en los dos proyectos; en Pozo madera se desbloquea sola.
    await walk(ana, [DOWN, RIGHT, DOWN, RIGHT]); // (2,2), junto a la roca
    await collect(ana, "piedra");
    send(ana, MESSAGE.contribute, { projectId: pozo, taskId: "piedra", from: "player", amount: 1 });
    await waitFor(() => task(luis, pozo, "piedra").status === "completada");
    send(ana, MESSAGE.contribute, { projectId: pozo, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => luis.room.state.projects.get(pozo)!.status === "completado");

    // En Balsa (aprobación obligatoria) piedra completa no basta: hay que aprobarla.
    await collect(ana, "piedra");
    send(ana, MESSAGE.contribute, { projectId: balsa, taskId: "piedra", from: "player", amount: 1 });
    await waitFor(() => task(luis, balsa, "piedra").status === "completada");
    send(ana, MESSAGE.contribute, { projectId: balsa, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => ana.rejections.filter((r) => r === "tarea-bloqueada").length === 2);
    send(ana, MESSAGE.review, { projectId: balsa, taskId: "piedra", decision: "aprobada", note: "Piedra comprobada" });
    await waitFor(() => task(luis, balsa, "piedra").status === "aprobada");
    send(ana, MESSAGE.contribute, { projectId: balsa, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => (luis.room.state.projects.get(balsa)!.progress.get("madera") ?? 0) === 1);
    assert.equal(inv(ana, "madera"), 0);
    for (const v of [ana, luis]) await v.room.leave();
  } finally {
    await server.kill();
  }
});

test("migración v7 → v8: conserva los datos y crea responsables y comentarios", () => {
  const path = tempDb();
  const v7 = new DatabaseSync(path);
  for (const v of [1, 2, 3, 4, 5, 6, 7]) v7.exec(MIGRATIONS[v]!);
  v7.exec("PRAGMA user_version = 7");
  v7.exec("INSERT INTO schedule_change (project_id, task_id, due_date, changed_by, changed_at, reason) VALUES ('p', '', '2026-12-01', 'ana', 1, 'x')");
  v7.close();
  const store = openStore(path);
  assert.equal(store.schemaVersion(), SCHEMA_VERSION);
  assert.ok(existsSync(`${path}.v7.bak`));
  assert.equal(store.getScheduleChanges("p").length, 1);
  assert.deepEqual(store.getAssignees("p"), {});
  assert.deepEqual(store.commentSummary("p"), {});
  store.close();
});
