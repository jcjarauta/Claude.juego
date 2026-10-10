import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedBy, checkAssign, checkComment, checkContribution, checkCreateProject, checkReschedule, criticalChain, dependencyErrors, isTaskDone,
  validateProjectDef, MAX_ASSIGNEES, type AssignInput, type ProjectDef,
} from "../src/index.ts";

// F1c: dependencias, responsables y comentarios (Q181–Q184).

test("dependencias: ids conocidos, sin repetir, sin autorreferencia ni ciclos, fechas coherentes", () => {
  assert.deepEqual(dependencyErrors([{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c", dependsOn: ["a", "b"] }], "p"), []);
  assert.match(String(dependencyErrors([{ id: "a", dependsOn: ["a"] }], "p")), /no puede depender de sí misma/);
  assert.match(String(dependencyErrors([{ id: "a", dependsOn: ["x"] }], "p")), /desconocida "x"/);
  assert.match(String(dependencyErrors([{ id: "a" }, { id: "b", dependsOn: ["a", "a"] }], "p")), /repite/);
  assert.match(String(dependencyErrors([{ id: "a", dependsOn: "b" }, { id: "b" }], "p")), /debe ser una lista/);
  assert.match(String(dependencyErrors([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }], "p")), /ciclo/);
  assert.match(String(dependencyErrors([{ id: "a", dependsOn: ["c"] }, { id: "b", dependsOn: ["a"] }, { id: "c", dependsOn: ["b"] }], "p")), /ciclo/);
  assert.match(String(dependencyErrors([{ id: "a", dueDate: "2026-11-10" }, { id: "b", dependsOn: ["a"], dueDate: "2026-11-05" }], "p")),
    /no puede vencer antes que la tarea "a"/);
  assert.deepEqual(dependencyErrors([{ id: "a", dueDate: "2026-11-05" }, { id: "b", dependsOn: ["a"], dueDate: "2026-11-05" }], "p"), [], "el mismo día vale");
});

test("tarea terminada, bloqueo y cadena crítica", () => {
  assert.equal(isTaskDone("completada", false), true);
  assert.equal(isTaskDone("completada", true), false, "con aprobación obligatoria falta aprobar");
  assert.equal(isTaskDone("aprobada", true), true);
  assert.equal(isTaskDone("rechazada", false), false);
  const done = new Set(["a"]);
  assert.deepEqual(blockedBy({ dependsOn: ["a", "b"] }, (id) => done.has(id)), ["b"]);
  assert.deepEqual(blockedBy({}, () => false), []);
  const tasks = [{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c", dependsOn: ["b"] }, { id: "d", dependsOn: ["a"] }, { id: "e" }];
  assert.deepEqual(criticalChain(tasks, () => false), ["a", "b", "c"]);
  assert.deepEqual(criticalChain(tasks, (id) => id === "a"), ["b", "c"], "lo terminado sale de la cadena");
  assert.deepEqual(criticalChain([{ id: "a" }, { id: "b" }], () => false), [], "sin dependencias no hay cadena");
});

const pozo: ProjectDef = {
  id: "pozo", name: "Pozo", description: "", reality: "VIRTUAL", coordinators: ["coordi"], buildRequiresApproval: false,
  tasks: [
    { id: "madera", title: "Madera", resource: "madera", required: 2, acceptance: "x" },
    { id: "piedra", title: "Piedra", resource: "piedra", required: 1, acceptance: "y", dependsOn: ["madera"] },
  ],
};

test("validación y creación con dependencias; aportar a una tarea bloqueada", () => {
  const ctx = { resourceIds: new Set(["madera", "piedra"]), limits: "panel" as const, where: "proyecto" };
  assert.deepEqual(validateProjectDef(pozo, ctx), []);
  const cyclic = { ...pozo, tasks: [{ ...pozo.tasks[0]!, dependsOn: ["piedra"] }, pozo.tasks[1]!] };
  assert.match(String(validateProjectDef(cyclic, ctx)), /ciclo/);
  const created = checkCreateProject({
    actor: "admin", admins: ["admin"], resourceIds: ctx.resourceIds, resourceName: new Map(), openProjects: 0, existingIds: new Set(), idSuffix: "z",
    payload: { name: "Pozo", description: "", tasks: [{ title: "Madera", resource: "madera", required: 2, dependsOn: [] }, { title: "Piedra", resource: "piedra", required: 1, dependsOn: ["madera"] }] },
  });
  assert.ok(created.ok);
  assert.equal(created.def.tasks[0]!.dependsOn, undefined, "una lista vacía es «sin dependencias»");
  assert.deepEqual(created.def.tasks[1]!.dependsOn, ["madera"]);
  const contribution = checkContribution({
    projects: [pozo], projectId: "pozo", taskId: "piedra", from: "player", amount: 1, contributed: () => 0, balance: () => 5,
    blocked: (_p, t) => t === "piedra",
  });
  assert.deepEqual(contribution, { ok: false, reason: "tarea-bloqueada" });
});

test("replanificar respeta las dependencias", () => {
  const base = { actor: "coordi", admins: [], project: pozo, closed: false, reason: "Motivo", projectDue: "", taskDues: { madera: "2026-11-10", piedra: "2026-11-15" } };
  assert.deepEqual(checkReschedule({ ...base, taskId: "piedra", dueDate: "2026-11-09" }), { ok: false, reason: "fecha-invalida" }, "antes que su requisito");
  assert.deepEqual(checkReschedule({ ...base, taskId: "madera", dueDate: "2026-11-16" }), { ok: false, reason: "fecha-invalida" }, "después que la que depende de ella");
  assert.equal(checkReschedule({ ...base, taskId: "madera", dueDate: "2026-11-15" }).ok, true);
});

const assign = (over: Partial<AssignInput> = {}) => checkAssign({
  actor: "bea", admins: ["admin"], project: pozo, closed: false, taskId: "madera", target: "bea", assign: true, assignees: [], taskDone: false, ...over,
});

test("responsables: apuntarse, asignar con rol, límite de 3 y tareas terminadas (Q181)", () => {
  assert.deepEqual(assign(), { ok: true, project: pozo, taskId: "madera", target: "bea", changed: true });
  assert.deepEqual(assign({ assignees: ["bea"] }), { ok: true, project: pozo, taskId: "madera", target: "bea", changed: false }, "ya apuntada: sin cambios");
  assert.deepEqual(assign({ assign: false }), { ok: true, project: pozo, taskId: "madera", target: "bea", changed: false });
  assert.deepEqual(assign({ target: "eva" }), { ok: false, reason: "sin-permiso" }, "sin rol no se asigna a otros");
  assert.equal(assign({ actor: "coordi", target: "eva" }).ok, true);
  assert.equal(assign({ actor: "admin", target: "eva" }).ok, true);
  assert.deepEqual(assign({ assignees: ["a", "b", "c"] }), { ok: false, reason: "demasiados-responsables" });
  assert.equal(MAX_ASSIGNEES, 3);
  assert.deepEqual(assign({ taskDone: true }), { ok: false, reason: "tarea-completa" });
  assert.deepEqual(assign({ closed: true }), { ok: false, reason: "proyecto-cerrado" });
  assert.deepEqual(assign({ taskId: "oro" }), { ok: false, reason: "tarea-desconocida" });
  assert.deepEqual(assign({ project: undefined }), { ok: false, reason: "proyecto-desconocido" });
  assert.deepEqual(assign({ target: "no válido!" }), { ok: false, reason: "solicitud-invalida" });
});

test("comentarios: 1–500 caracteres tras recortar (Q184)", () => {
  assert.deepEqual(checkComment("  ¿Quién trae la piedra?  "), { ok: true, text: "¿Quién trae la piedra?" });
  for (const bad of ["", "   ", 5, undefined, "x".repeat(501)]) assert.deepEqual(checkComment(bad), { ok: false, reason: "comentario-invalido" });
  assert.equal(checkComment("x".repeat(500)).ok, true);
});
