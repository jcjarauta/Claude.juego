import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorize, checkContribution, checkReview, projectStatus, taskStatus, type ContributionInput, type ProjectDef, type ReviewInput,
} from "../src/index.ts";

const project: ProjectDef = {
  id: "construir-taller",
  name: "Construir taller",
  description: "",
  tasks: [
    { id: "madera", title: "Aportar madera", resource: "madera", required: 20, acceptance: "Aportar 20 de madera" },
    { id: "piedra", title: "Aportar piedra", resource: "piedra", required: 15, acceptance: "Aportar 15 de piedra" },
  ],
  reality: "VIRTUAL",
  coordinators: ["ana"],
  buildRequiresApproval: false,
};

const input = (over: Partial<ContributionInput> = {}): ContributionInput => ({
  projects: [project],
  projectId: "construir-taller",
  taskId: "madera",
  from: "player",
  amount: 5,
  contributed: () => 0,
  balance: () => 10,
  ...over,
});

test("aportar: acepta un aporte válido desde el inventario o desde la comunidad", () => {
  const r = checkContribution(input());
  assert.equal(r.ok && r.amount, 5);
  const fromCommunity = checkContribution(input({ from: "community" }));
  assert.equal(fromCommunity.ok && fromCommunity.from, "community");
});

test("aportar: lo que excede lo que falta se recorta (Q153)", () => {
  const r = checkContribution(input({ amount: 10, contributed: () => 17 }));
  assert.ok(r.ok);
  assert.equal(r.amount, 3);
  assert.equal(r.requested, 10);
});

test("aportar: rechazos con motivo", () => {
  assert.deepEqual(checkContribution(input({ taskId: "oro" })), { ok: false, reason: "tarea-desconocida" });
  assert.deepEqual(checkContribution(input({ projectId: "otro" })), { ok: false, reason: "tarea-desconocida" });
  assert.deepEqual(checkContribution(input({ from: "bea" })), { ok: false, reason: "origen-no-permitido" });
  assert.deepEqual(checkContribution(input({ contributed: () => 20 })), { ok: false, reason: "tarea-completa" });
  assert.deepEqual(checkContribution(input({ balance: () => 4 })), { ok: false, reason: "saldo-insuficiente" });
  for (const amount of [0, -3, 2.5, "5", 5000]) {
    assert.deepEqual(checkContribution(input({ amount })), { ok: false, reason: "solicitud-invalida" });
  }
});

test("estado del proyecto: listo solo con todas las tareas completas", () => {
  assert.equal(projectStatus(project, () => 0), "en-curso");
  assert.equal(projectStatus(project, (r) => (r === "madera" ? 20 : 14)), "en-curso");
  assert.equal(projectStatus(project, (r) => (r === "madera" ? 20 : 15)), "listo");
});

test("permisos: cualquiera aporta; solo los coordinadores revisan (Q161)", () => {
  assert.equal(authorize("bea", "contribute", project), true);
  assert.equal(authorize("ana", "review", project), true);
  assert.equal(authorize("bea", "review", project), false);
  assert.equal(authorize("Ana", "review", project), false, "el nombre se compara exacto");
});

test("estado de tarea: pendiente → en curso → completada → aprobada o rechazada", () => {
  const task = project.tasks[0]!;
  assert.equal(taskStatus(task, 0), "pendiente");
  assert.equal(taskStatus(task, 5), "en-curso");
  assert.equal(taskStatus(task, 20), "completada");
  assert.equal(taskStatus(task, 20, ""), "completada");
  assert.equal(taskStatus(task, 20, "aprobada"), "aprobada");
  assert.equal(taskStatus(task, 20, "rechazada"), "rechazada");
  assert.equal(taskStatus(task, 5, "aprobada"), "en-curso", "una revisión no adelanta una tarea sin completar");
});

const review = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  projects: [project],
  actor: "ana",
  projectId: "construir-taller",
  taskId: "madera",
  decision: "aprobada",
  note: "  Cantidades comprobadas  ",
  contributed: () => 20,
  ...over,
});

test("revisar: acepta al coordinador con la tarea completada y recorta la nota", () => {
  const r = checkReview(review());
  assert.ok(r.ok);
  assert.equal(r.note, "Cantidades comprobadas");
  assert.equal(r.decision, "aprobada");
  assert.equal(checkReview(review({ decision: "rechazada" })).ok, true);
});

test("revisar: rechazos con motivo", () => {
  assert.deepEqual(checkReview(review({ taskId: "oro" })), { ok: false, reason: "tarea-desconocida" });
  assert.deepEqual(checkReview(review({ actor: "bea" })), { ok: false, reason: "sin-permiso" });
  assert.deepEqual(checkReview(review({ decision: "quizá" })), { ok: false, reason: "solicitud-invalida" });
  for (const note of ["", "   ", 7, undefined, "x".repeat(501)]) {
    assert.deepEqual(checkReview(review({ note })), { ok: false, reason: "nota-invalida" });
  }
  assert.equal(checkReview(review({ note: "x".repeat(500) })).ok, true);
  assert.deepEqual(checkReview(review({ contributed: () => 19 })), { ok: false, reason: "tarea-sin-completar" });
});
