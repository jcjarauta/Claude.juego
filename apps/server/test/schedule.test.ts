import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { localDay, MESSAGE, type HistoryResponse } from "@juego/shared";
import { MIGRATIONS, openStore, SCHEMA_VERSION } from "../src/store.ts";
import { fixture, joinPanel, joinWorld, sessionFor, sleep, startServer, tempDb, waitFor, type TestPlayer } from "./helpers.ts";

// F1b: fechas objetivo, replanificación (TP-19) e historia para gráficas (TP-20).
// Mundo de prueba: aparición (0,0) junto al árbol (1,0); administración: ana.
const WORLD = fixture("regen-world.json");

const projectNamed = (p: { room: TestPlayer["room"] }, name: string) => [...p.room.state.projects.entries()].find(([, s]) => s.name === name);
const reschedule = (p: { room: TestPlayer["room"] }, fields: Record<string, unknown>) =>
  p.room.send(MESSAGE.reschedule, { requestId: randomUUID(), reason: "Nos falta madera", ...fields });

test("TP-19: fechas al crear, replanificación con permiso y motivo, y persistencia", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  const ana = await joinWorld(server.url, "ana");
  const bea = await joinPanel(server.url, "bea");
  ana.room.send(MESSAGE.createProject, {
    requestId: randomUUID(), name: "Sin fecha", description: "", tasks: [{ title: "Madera", resource: "madera", required: 1, dueDate: "2026-02-30" }],
  });
  await waitFor(() => ana.rejections.includes("definicion-invalida"));
  ana.room.send(MESSAGE.createProject, {
    requestId: randomUUID(), name: "Huerto", description: "", dueDate: "2026-11-30", coordinators: ["ana"],
    tasks: [{ title: "Madera", resource: "madera", required: 2, dueDate: "2026-11-15" }, { title: "Piedra", resource: "piedra", required: 1 }],
  });
  await waitFor(() => Boolean(projectNamed(bea, "Huerto")));
  const [id, huerto] = projectNamed(bea, "Huerto")!;
  assert.deepEqual([huerto.dueDate, huerto.reschedules, huerto.tasks.get("madera")!.dueDate, huerto.tasks.get("piedra")!.dueDate], ["2026-11-30", 0, "2026-11-15", ""]);
  assert.equal(bea.room.state.projects.get("construir-taller")!.dueDate, "", "los proyectos sin fecha siguen igual");

  reschedule(bea, { projectId: id, taskId: "madera", dueDate: "2026-11-20" });
  await waitFor(() => bea.rejections.includes("sin-permiso"));
  reschedule(ana, { projectId: id, taskId: "madera", dueDate: "2026-11-20", reason: "  " });
  await waitFor(() => ana.rejections.includes("motivo-invalido"));
  reschedule(ana, { projectId: id, taskId: "madera", dueDate: "2026-12-01" });
  await waitFor(() => ana.rejections.includes("fecha-invalida"));
  reschedule(ana, { projectId: id, taskId: "madera", dueDate: "2026-11-20" });
  await waitFor(() => bea.room.state.projects.get(id)!.tasks.get("madera")!.dueDate === "2026-11-20");
  assert.equal(bea.room.state.projects.get(id)!.tasks.get("madera")!.reschedules, 1);
  reschedule(ana, { projectId: id, dueDate: "2026-11-19" }); // el proyecto no puede vencer antes que su tarea
  await waitFor(() => ana.rejections.filter((r) => r === "fecha-invalida").length === 2);
  reschedule(ana, { projectId: id, dueDate: "2026-12-15", reason: "Ampliamos el plazo" });
  await waitFor(() => bea.room.state.projects.get(id)!.dueDate === "2026-12-15");
  assert.equal(bea.room.state.projects.get(id)!.reschedules, 1);
  await sleep(200);
  await server.kill(); // caída brusca

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const events = db.prepare("SELECT actor, data FROM event WHERE type = 'schedule-changed' ORDER BY id").all() as { actor: string; data: string }[];
  db.close();
  assert.deepEqual(events.map((e) => [e.actor, JSON.parse(e.data).task, JSON.parse(e.data).reason]), [["ana", "madera", "Nos falta madera"], ["ana", "", "Ampliamos el plazo"]]);

  server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const eva = await joinPanel(server.url, "eva");
    const again = eva.room.state.projects.get(id)!;
    assert.deepEqual([again.dueDate, again.reschedules, again.tasks.get("madera")!.dueDate, again.tasks.get("madera")!.reschedules],
      ["2026-12-15", 1, "2026-11-20", 1]);
    await eva.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-20: historia por día solo con sesión, coherente con los aportes, y con límite de frecuencia", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    ana.room.send(MESSAGE.move, { dx: 1, dy: 0 });
    for (let i = 0; i < 2; i++) {
      const before = ana.me().inventory.get("madera") ?? 0;
      let last = 0;
      await waitFor(() => {
        if ((ana.me().inventory.get("madera") ?? 0) > before) return true;
        if (Date.now() - last > 150) { ana.room.send(MESSAGE.collect, { requestId: randomUUID() }); last = Date.now(); }
        return false;
      }, 6000);
      await sleep(110);
    }
    ana.room.send(MESSAGE.contribute, { requestId: randomUUID(), projectId: "construir-taller", taskId: "madera", from: "player", amount: 2 });
    await waitFor(() => ana.room.state.projects.get("construir-taller")!.progress.get("madera") === 2);
    ana.room.send(MESSAGE.reschedule, { requestId: randomUUID(), projectId: "construir-taller", dueDate: "2026-12-01", reason: "Primera fecha" });
    await waitFor(() => ana.room.state.projects.get("construir-taller")!.dueDate === "2026-12-01");

    const url = `${server.url}/api/proyectos/construir-taller/historia`;
    assert.equal((await fetch(url)).status, 401, "sin token");
    assert.equal((await fetch(url, { headers: { authorization: "Bearer inventado-inventado-inventado" } })).status, 401);
    const token = await sessionFor(server.url, "bea");
    const auth = { headers: { authorization: `Bearer ${token}` } };
    const res = await fetch(url, auth);
    assert.equal(res.status, 200);
    const history = (await res.json()) as HistoryResponse;
    assert.equal(history.projectId, "construir-taller");
    assert.deepEqual(history.days, [{ day: localDay(), amount: 2 }]);
    assert.deepEqual(history.schedule.map((s) => [s.taskId, s.dueDate, s.by, s.reason]), [["", "2026-12-01", "ana", "Primera fecha"]]);
    assert.equal((await fetch(`${server.url}/api/proyectos/no-existe/historia`, auth)).status, 404);
    const burst = await Promise.all(Array.from({ length: 4 }, () => fetch(url, auth).then((r) => r.status)));
    assert.ok(burst.includes(429), `ráfaga limitada: ${burst}`);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("migración v6 → v7: conserva los datos y crea el historial de replanificaciones", () => {
  const path = tempDb();
  const v6 = new DatabaseSync(path);
  for (const v of [1, 2, 3, 4, 5, 6]) v6.exec(MIGRATIONS[v]!);
  v6.exec("PRAGMA user_version = 6");
  v6.exec("INSERT INTO project_def (id, definition, created_by, created_at) VALUES ('p', '{}', 'ana', 1)");
  v6.close();
  const store = openStore(path);
  assert.equal(store.schemaVersion(), SCHEMA_VERSION);
  assert.ok(existsSync(`${path}.v6.bak`));
  assert.equal(store.getProjectDefs().length, 1);
  assert.deepEqual(store.getScheduleChanges("p"), []);
  store.close();
});

test("rendimiento: la historia agrega 50 000 aportes por día en menos de 1 s", () => {
  const store = openStore(tempDb());
  store.transaction(() => {
    for (let i = 0; i < 50_000; i++) {
      store.event("contribute", `bot${i % 4}`, `c${i}`, { project: "grande", task: "madera", resource: "madera", amount: 1, from: "player" });
    }
  });
  const t0 = performance.now();
  const days = store.contributionsByDay("grande");
  const elapsed = performance.now() - t0;
  console.log(`  historia de 50 000 aportes: ${elapsed.toFixed(0)} ms, ${days.length} días`);
  assert.equal(days.reduce((n, d) => n + d.amount, 0), 50_000);
  assert.ok(elapsed < 1000);
  store.close();
});
