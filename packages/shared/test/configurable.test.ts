import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorize, checkCloseProject, checkContribution, checkCreateMission, checkCreateProject, makeId, MAX_MISSIONS, PANEL_LIMITS,
  type CreateMissionInput, type CreateProjectInput, type ProjectDef,
} from "../src/index.ts";

// F1a: proyectos y misiones creados desde el panel (FUT-05, Q171–Q174).

const resourceIds = new Set(["madera", "piedra", "fibra"]);
const resourceName = new Map([["madera", "madera"], ["piedra", "piedra"], ["fibra", "fibra"]]);

const create = (over: Partial<CreateProjectInput> = {}, payload: Record<string, unknown> = {}): ReturnType<typeof checkCreateProject> => checkCreateProject({
  actor: "admin", admins: ["admin"], resourceIds, resourceName, openProjects: 1, existingIds: new Set(), idSuffix: "a1b2",
  payload: {
    requestId: "r1", name: "Huerto de la aldea", description: "Cercar y sembrar.",
    tasks: [{ title: "Aportar madera", resource: "madera", required: 10 }, { title: "Aportar fibra", resource: "fibra", required: 4, acceptance: "Hay 4 de fibra" }],
    ...payload,
  },
  ...over,
});

test("ids estables a partir del nombre", () => {
  assert.equal(makeId("Huerto de la Aldea", "A1B2"), "huerto-de-la-aldea-a1b2");
  assert.equal(makeId("¡Construcción ñandú!", "zz"), "construccion-nandu-zz");
  assert.equal(makeId("   ", "x9"), "p-x9");
  assert.match(makeId("x".repeat(80), "abcdef"), /^[a-z0-9-]{1,40}$/);
});

test("crear proyecto: la administración crea un proyecto VIRTUAL con valores por defecto", () => {
  const r = create();
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r));
  assert.equal(r.def.id, "huerto-de-la-aldea-a1b2");
  assert.equal(r.def.reality, "VIRTUAL");
  assert.deepEqual(r.def.coordinators, ["admin"], "por defecto coordina quien lo crea");
  assert.equal(r.def.buildRequiresApproval, false);
  assert.deepEqual(r.def.tasks.map((t) => [t.id, t.acceptance]), [["madera", "Aportar 10 de madera"], ["fibra", "Hay 4 de fibra"]]);
  const approval = create({}, { requiresApproval: true, coordinators: ["bea", "bea", "ana"] });
  assert.ok(approval.ok);
  assert.equal(approval.def.buildRequiresApproval, true);
  assert.deepEqual(approval.def.coordinators, ["bea", "ana"]);
});

test("crear proyecto: permiso, límite de abiertos, id repetido y definición inválida con detalle", () => {
  assert.deepEqual(create({ actor: "bea" }), { ok: false, reason: "sin-permiso" });
  assert.deepEqual(create({ openProjects: PANEL_LIMITS.openProjects }), { ok: false, reason: "demasiados-proyectos" });
  assert.deepEqual(create({ existingIds: new Set(["huerto-de-la-aldea-a1b2"]) }), { ok: false, reason: "solicitud-invalida" });
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ name: "" }, /name obligatorio/],
    [{ name: "x".repeat(61) }, /name obligatorio/],
    [{ description: "x".repeat(501) }, /description/],
    [{ tasks: [] }, /tasks debe ser una lista de 1 a 8/],
    [{ tasks: [{ title: "Oro", resource: "oro", required: 1 }] }, /recurso desconocido "oro"/],
    [{ tasks: [{ title: "A", resource: "madera", required: 1 }, { title: "B", resource: "madera", required: 2 }] }, /id duplicado|ya lo usa/],
    [{ tasks: [{ title: "A", resource: "madera", required: 1001 }] }, /required debe ser un entero 1–1000/],
    [{ tasks: [{ title: " ", resource: "madera", required: 1 }] }, /title obligatorio/],
    [{ tasks: [{ title: "A", resource: "madera", required: 1, acceptance: "x".repeat(201) }] }, /acceptance/],
    [{ coordinators: ["no válido!"] }, /coordinators/],
    [{ requiresApproval: "sí" }, /buildRequiresApproval/],
  ];
  for (const [payload, message] of cases) {
    const r = create({}, payload);
    assert.equal(r.ok, false, JSON.stringify(payload));
    if (!r.ok) {
      assert.equal(r.reason, "definicion-invalida");
      assert.match(String(r.details), message, JSON.stringify(payload));
    }
  }
});

const huerto: ProjectDef = {
  id: "huerto-a1b2", name: "Huerto", description: "", reality: "VIRTUAL", coordinators: ["admin"], buildRequiresApproval: false,
  tasks: [{ id: "madera", title: "Madera", resource: "madera", required: 2, acceptance: "Aportar 2" }],
};

test("cerrar proyecto: solo administración, solo proyectos del panel y una vez; cerrado no admite aportes", () => {
  const base = { actor: "admin", admins: ["admin"], project: huerto, fromConfig: false, closed: false };
  assert.deepEqual(checkCloseProject(base), { ok: true });
  assert.deepEqual(checkCloseProject({ ...base, actor: "bea" }), { ok: false, reason: "sin-permiso" });
  assert.deepEqual(checkCloseProject({ ...base, project: undefined }), { ok: false, reason: "proyecto-desconocido" });
  assert.deepEqual(checkCloseProject({ ...base, fromConfig: true }), { ok: false, reason: "proyecto-de-serie" });
  assert.deepEqual(checkCloseProject({ ...base, closed: true }), { ok: false, reason: "proyecto-cerrado" });
  const contribution = checkContribution({
    projects: [huerto], projectId: huerto.id, taskId: "madera", from: "player", amount: 1,
    contributed: () => 0, balance: () => 5, closed: (id) => id === huerto.id,
  });
  assert.deepEqual(contribution, { ok: false, reason: "proyecto-cerrado" });
});

const mission = (over: Partial<CreateMissionInput> = {}, payload: Record<string, unknown> = {}) => checkCreateMission({
  actor: "admin", admins: ["admin"], itemIds: new Set(["herramienta"]), openProjectIds: new Set([huerto.id]),
  missions: 1, existingIds: new Set(), idSuffix: "m1",
  payload: { requestId: "r2", name: "Huerto listo", description: "Completad el huerto.", objective: { kind: "project-completed", project: huerto.id }, ...payload },
  ...over,
});

test("crear misión: objetivo proyecto completado u objeto en la comunidad; permisos y validación", () => {
  const r = mission();
  assert.ok(r.ok);
  assert.deepEqual(r.def, { id: "huerto-listo-m1", name: "Huerto listo", description: "Completad el huerto.", objective: { kind: "project-completed", project: huerto.id } });
  const item = mission({}, { objective: { kind: "item-in-community", item: "herramienta", amount: 3, sobra: true } });
  assert.ok(item.ok);
  assert.deepEqual(item.def.objective, { kind: "item-in-community", item: "herramienta", amount: 3 }, "se descartan campos extra");

  assert.deepEqual(mission({ actor: "bea" }), { ok: false, reason: "sin-permiso" });
  assert.deepEqual(mission({ missions: MAX_MISSIONS }), { ok: false, reason: "demasiadas-misiones" });
  for (const objective of [
    { kind: "project-completed", project: "no-existe" },
    { kind: "item-in-community", item: "espada", amount: 1 },
    { kind: "item-in-community", item: "herramienta", amount: 0 },
    { kind: "otro" },
  ]) {
    const bad = mission({}, { objective });
    assert.equal(bad.ok, false, JSON.stringify(objective));
    if (!bad.ok) assert.equal(bad.reason, "definicion-invalida");
  }
});

test("permisos de mundo: solo la administración (Q171)", () => {
  assert.equal(authorize("admin", "create-project", { admins: ["admin"] }), true);
  assert.equal(authorize("Admin", "create-project", { admins: ["admin"] }), false);
  assert.equal(authorize("bea", "close-project", { admins: ["admin"] }), false);
  assert.equal(authorize("admin", "create-mission", { admins: [] }), false);
});
