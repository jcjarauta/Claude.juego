import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MESSAGE, PANEL_LIMITS, type CreateMissionMessage, type CreateProjectMessage } from "@juego/shared";
import { MIGRATIONS, openStore, SCHEMA_VERSION } from "../src/store.ts";
import { fixture, joinPanel, joinWorld, sleep, startServer, tempDb, waitFor, type TestPanel, type TestPlayer } from "./helpers.ts";

// F1a (FUT-05): proyectos y misiones creados desde el panel. Mundo de prueba: aparición (0,0) junto al
// árbol (1,0) de 5 madera (regenera 1/s); administración: ana; proyecto de la configuración: construir-taller.
const WORLD = fixture("regen-world.json");

type Viewer = TestPlayer | TestPanel;
const projectNamed = (v: Viewer, name: string) => [...v.room.state.projects.entries()].find(([, p]) => p.name === name);
const inv = (p: TestPlayer, id: string) => p.me().inventory.get(id) ?? 0;

function createProject(v: Viewer, fields: Partial<CreateProjectMessage>, requestId = randomUUID()) {
  v.room.send(MESSAGE.createProject, { requestId, name: "Huerto", description: "Sembrar la aldea.", tasks: [{ title: "Aportar madera", resource: "madera", required: 2 }], ...fields });
}

function createMission(v: Viewer, fields: Partial<CreateMissionMessage>) {
  v.room.send(MESSAGE.createMission, { requestId: randomUUID(), name: "Misión", description: "", ...fields });
}

async function collectWood(p: TestPlayer) {
  const before = inv(p, "madera");
  let last = 0;
  await waitFor(() => {
    if (inv(p, "madera") > before) return true;
    if (Date.now() - last > 150) { p.room.send(MESSAGE.collect, { requestId: randomUUID() }); last = Date.now(); }
    return false;
  }, 6000);
  await sleep(110);
}

const contribute = (v: Viewer, projectId: string, amount = 1) =>
  v.room.send(MESSAGE.contribute, { requestId: randomUUID(), projectId, taskId: "madera", from: "player", amount });

test("TP-17: la administración crea proyectos que todos ven al momento; se juegan, se completan y se cierran", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    const bea = await joinWorld(server.url, "bea");
    const luis = await joinPanel(server.url, "luis");
    ana.room.send(MESSAGE.move, { dx: 1, dy: 0 }); // mirar al árbol

    createProject(luis, { name: "Intruso" });
    await waitFor(() => luis.rejections.includes("sin-permiso"));
    createProject(ana, { tasks: [] });
    createProject(ana, { tasks: [{ title: "Oro", resource: "oro", required: 1 }] });
    await waitFor(() => ana.rejections.filter((r) => r === "definicion-invalida").length === 2);

    const requestId = randomUUID();
    createProject(ana, {}, requestId);
    await waitFor(() => Boolean(projectNamed(bea, "Huerto")) && Boolean(projectNamed(luis, "Huerto")));
    const [id, huerto] = projectNamed(bea, "Huerto")!;
    assert.match(id, /^huerto-[0-9a-f]{6}$/);
    assert.deepEqual(
      { origin: huerto.origin, createdBy: huerto.createdBy, phase: huerto.phase, reality: huerto.reality, coordinators: [...huerto.coordinators], status: huerto.status },
      { origin: "panel", createdBy: "ana", phase: "abierto", reality: "VIRTUAL", coordinators: ["ana"], status: "en-curso" },
    );
    const task = huerto.tasks.get("madera")!;
    assert.deepEqual([task.title, task.resource, task.required, task.acceptance], ["Aportar madera", "madera", 2, "Aportar 2 de madera"]);
    const projects = bea.room.state.projects.size;
    createProject(ana, {}, requestId); // mismo requestId: sin efecto
    await sleep(300);
    assert.equal(bea.room.state.projects.size, projects);

    // Dos jugadores lo completan; el taller de la configuración sigue igual.
    await collectWood(ana);
    contribute(ana, id);
    await waitFor(() => bea.room.state.projects.get(id)!.progress.get("madera") === 1);
    await collectWood(ana);
    contribute(ana, id);
    await waitFor(() => bea.room.state.projects.get(id)!.status === "completado");
    assert.equal(bea.room.state.projects.get("construir-taller")!.status, "en-curso");

    // Cerrar: solo la administración, solo proyectos del panel, una vez.
    luis.room.send(MESSAGE.closeProject, { requestId: randomUUID(), projectId: id });
    await waitFor(() => luis.rejections.filter((r) => r === "sin-permiso").length === 2);
    ana.room.send(MESSAGE.closeProject, { requestId: randomUUID(), projectId: "construir-taller" });
    await waitFor(() => ana.rejections.includes("proyecto-de-serie"));
    ana.room.send(MESSAGE.closeProject, { requestId: randomUUID(), projectId: id });
    await waitFor(() => bea.room.state.projects.get(id)!.phase === "cerrado");
    assert.equal(bea.room.state.projects.get(id)!.closedBy, "ana");
    ana.room.send(MESSAGE.closeProject, { requestId: randomUUID(), projectId: id });
    await waitFor(() => ana.rejections.includes("proyecto-cerrado"));
    await collectWood(ana);
    contribute(ana, id);
    await waitFor(() => ana.rejections.filter((r) => r === "proyecto-cerrado").length === 2);

    // Límite de proyectos abiertos (el taller cuenta): se crean hasta 20 y el siguiente se rechaza.
    for (let i = 0; i < PANEL_LIMITS.openProjects - 1; i++) {
      createProject(ana, { name: `Proyecto ${i}` });
      await sleep(150); // dentro del límite de frecuencia
    }
    await waitFor(() => [...bea.room.state.projects.values()].filter((p) => p.phase === "abierto").length === PANEL_LIMITS.openProjects);
    createProject(ana, { name: "Uno de más" });
    await waitFor(() => ana.rejections.includes("demasiados-proyectos"));

    for (const v of [ana, bea, luis]) await v.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-18 y TP-09: misión «proyecto completado» creada en el panel; se cumple al aprobar y todo persiste tras una caída", async () => {
  const dbPath = tempDb();
  let server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  const ana = await joinWorld(server.url, "ana");
  const bea = await joinPanel(server.url, "bea");
  ana.room.send(MESSAGE.move, { dx: 1, dy: 0 });

  createProject(ana, { name: "Pozo", requiresApproval: true, coordinators: ["bea"], tasks: [{ title: "Madera para el brocal", resource: "madera", required: 1, acceptance: "Brocal de madera" }] });
  await waitFor(() => Boolean(projectNamed(bea, "Pozo")));
  const [pozo] = projectNamed(bea, "Pozo")!;
  createProject(ana, { name: "Fantasma", coordinators: ["nadie"] });
  await waitFor(() => ana.rejections.includes("definicion-invalida"), 2000);

  createMission(ana, { name: "Agua para todos", description: "Terminad el pozo.", objective: { kind: "project-completed", project: pozo } });
  createMission(ana, { name: "Dos herramientas", objective: { kind: "item-in-community", item: "herramienta", amount: 2 } });
  createMission(bea, { name: "Intrusa", objective: { kind: "project-completed", project: pozo } });
  await waitFor(() => bea.room.state.missions.size === 3 && bea.rejections.includes("sin-permiso"));
  const missionNamed = (name: string) => [...bea.room.state.missions.entries()].find(([, m]) => m.name === name)!;
  const [aguaId, agua] = missionNamed("Agua para todos");
  assert.deepEqual([agua.status, agua.objectiveKind, agua.objectiveTarget, agua.origin, agua.createdBy], ["pendiente", "project-completed", pozo, "panel", "ana"]);
  assert.deepEqual([missionNamed("Dos herramientas")[1].objectiveTarget, missionNamed("Dos herramientas")[1].objectiveAmount], ["herramienta", 2]);

  await collectWood(ana);
  contribute(ana, pozo);
  await waitFor(() => bea.room.state.projects.get(pozo)!.status === "en-revision");
  assert.equal(bea.room.state.missions.get(aguaId)!.status, "pendiente", "falta la aprobación");
  bea.room.send(MESSAGE.review, { requestId: randomUUID(), projectId: pozo, taskId: "madera", decision: "aprobada", note: "Brocal comprobado" });
  await waitFor(() => bea.room.state.missions.get(aguaId)!.status === "completada");
  assert.equal(bea.room.state.projects.get(pozo)!.status, "completado");
  assert.equal(bea.room.state.missions.get(aguaId)!.completedBy, "bea", "la cumple quien aprueba la última tarea");
  await server.kill(); // caída brusca

  server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const eva = await joinPanel(server.url, "eva");
    const [, again] = projectNamed(eva, "Pozo")!;
    assert.deepEqual([again.status, again.phase, again.origin, [...again.coordinators], again.tasks.get("madera")!.acceptance],
      ["completado", "abierto", "panel", ["bea"], "Brocal de madera"]);
    assert.equal(eva.room.state.missions.get(aguaId)!.status, "completada");
    assert.equal(eva.room.state.missions.get(aguaId)!.name, "Agua para todos");
    assert.equal(eva.room.state.missions.get("primera-herramienta")!.objectiveKind, "item-in-community", "las de la configuración siguen");
    await eva.room.leave();
  } finally {
    await server.kill();
  }
  const store = openStore(dbPath);
  assert.equal(store.audit().balanced, true);
  assert.equal(store.getProjectDefs().length, 1);
  assert.equal(store.getMissionDefs().length, 2);
  store.close();
});

test("migración v5 → v6: conserva los datos y crea las tablas de definiciones", () => {
  const path = tempDb();
  const v5 = new DatabaseSync(path);
  for (const v of [1, 2, 3, 4, 5]) v5.exec(MIGRATIONS[v]!);
  v5.exec("PRAGMA user_version = 5");
  v5.exec("INSERT INTO inventory VALUES ('community', 'main', 'madera', 4)");
  v5.close();
  const store = openStore(path);
  assert.equal(store.schemaVersion(), SCHEMA_VERSION);
  assert.ok(existsSync(`${path}.v5.bak`));
  assert.equal(store.getAmount({ type: "community", id: "main" }, "madera"), 4);
  assert.deepEqual(store.getProjectDefs(), []);
  store.close();
});
