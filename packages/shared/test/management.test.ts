import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, boardColumn, checkCreateProject, checkReschedule, cumulativeSeries, daysBetween, isOverdue, isValidDate, localDay,
  projectMetrics, validateProjectDef, type ProjectDef, type RescheduleInput,
} from "../src/index.ts";

// F1b: fechas objetivo, replanificación, tablero e indicadores (Q176–Q179).

test("fechas: formato y días que existen; aritmética de días", () => {
  for (const ok of ["2026-10-10", "2024-02-29", "2026-12-31"]) assert.equal(isValidDate(ok), true, ok);
  for (const bad of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-1-5", "10/10/2026", "", 20261010, undefined]) assert.equal(isValidDate(bad), false, String(bad));
  assert.equal(daysBetween("2026-10-10", "2026-10-17"), 7);
  assert.equal(daysBetween("2026-10-10", "2026-10-03"), -7);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2, "sin errores por cambio de hora");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(localDay(new Date(2026, 9, 5, 23, 59)), "2026-10-05");
});

test("vencida: con fecha pasada y sin terminar", () => {
  assert.equal(isOverdue("2026-10-09", false, "2026-10-10"), true);
  assert.equal(isOverdue("2026-10-10", false, "2026-10-10"), false, "el mismo día aún no está vencida");
  assert.equal(isOverdue("2026-10-09", true, "2026-10-10"), false);
  assert.equal(isOverdue(undefined, false, "2026-10-10"), false);
  assert.equal(isOverdue("", false, "2026-10-10"), false);
});

test("tablero: una columna por estado; lo desconocido va a pendiente", () => {
  for (const s of ["pendiente", "en-curso", "completada", "aprobada", "rechazada"]) assert.equal(boardColumn(s), s);
  assert.equal(boardColumn(""), "pendiente");
  assert.equal(boardColumn("otra"), "pendiente");
});

test("serie acumulada ordenada por día", () => {
  assert.deepEqual(cumulativeSeries([{ day: "2026-10-03", amount: 2 }, { day: "2026-10-01", amount: 5 }, { day: "2026-10-02", amount: 0 }]),
    [{ day: "2026-10-01", total: 5 }, { day: "2026-10-02", total: 5 }, { day: "2026-10-03", total: 7 }]);
  assert.deepEqual(cumulativeSeries([]), []);
});

test("indicadores: avance limitado a lo requerido, estados, ritmo de 7 días y retraso", () => {
  const tasks = [
    { resource: "madera", required: 10, status: "aprobada" },
    { resource: "piedra", required: 10, status: "en-curso" },
    { resource: "fibra", required: 5, status: "pendiente" },
  ];
  const progress = (r: string) => ({ madera: 12, piedra: 4, fibra: 0 })[r] ?? 0;
  const history = [
    { day: "2026-10-01", amount: 6 }, { day: "2026-10-04", amount: 4 }, { day: "2026-10-09", amount: 6 }, { day: "2026-10-11", amount: 9 },
  ];
  const m = projectMetrics({ tasks, progress, dueDate: "2026-10-08", done: false, today: "2026-10-10", history });
  assert.equal(m.required, 25);
  assert.equal(m.contributed, 14, "lo aportado de más no cuenta");
  assert.equal(m.percent, 56);
  assert.deepEqual(m.byColumn, { pendiente: 1, "en-curso": 1, completada: 0, aprobada: 1, rechazada: 0 });
  assert.equal(m.last7, 10, "del 4 al 10 incluidos; el 11 es futuro");
  assert.equal(m.daysLeft, -2);
  assert.equal(m.overdue, true);
  const done = projectMetrics({ tasks, progress, dueDate: "2026-10-08", done: true, today: "2026-10-10" });
  assert.equal(done.daysLeft, null);
  assert.equal(done.overdue, false);
  assert.equal(done.last7, null, "sin historia no hay ritmo");
  assert.equal(projectMetrics({ tasks: [], progress, done: false, today: "2026-10-10" }).percent, 0);
});

const base = (over: Record<string, unknown> = {}) => ({
  id: "huerto-a1", name: "Huerto", description: "", tasks: [{ id: "madera", title: "Madera", resource: "madera", required: 2, ...over.task as object }],
  ...over,
});

test("validación de fechas en la definición (configuración y panel)", () => {
  const ctx = { resourceIds: new Set(["madera"]), limits: "panel" as const, where: "proyecto" };
  assert.deepEqual(validateProjectDef(base({ dueDate: "2026-11-01", task: { dueDate: "2026-10-20" } }), ctx), []);
  assert.match(String(validateProjectDef(base({ dueDate: "2026-02-30" }), ctx)), /dueDate debe ser una fecha/);
  assert.match(String(validateProjectDef(base({ task: { dueDate: "mañana" } }), ctx)), /tasks\[0\]: dueDate debe ser una fecha/);
  assert.match(String(validateProjectDef(base({ dueDate: "2026-10-01", task: { dueDate: "2026-10-20" } }), ctx)), /no puede ser posterior a la del proyecto/);
  const created = checkCreateProject({
    actor: "admin", admins: ["admin"], resourceIds: new Set(["madera"]), resourceName: new Map([["madera", "madera"]]),
    openProjects: 0, existingIds: new Set(), idSuffix: "x1",
    payload: { name: "Huerto", description: "", dueDate: "2026-11-01", tasks: [{ title: "Madera", resource: "madera", required: 2, dueDate: "2026-10-20" }] },
  });
  assert.ok(created.ok);
  assert.equal(created.def.dueDate, "2026-11-01");
  assert.equal(created.def.tasks[0]!.dueDate, "2026-10-20");
});

const huerto: ProjectDef = {
  id: "huerto-a1", name: "Huerto", description: "", reality: "VIRTUAL", coordinators: ["coordi"], buildRequiresApproval: false,
  tasks: [{ id: "madera", title: "Madera", resource: "madera", required: 2, acceptance: "x" }, { id: "piedra", title: "Piedra", resource: "piedra", required: 1, acceptance: "y" }],
};

const reschedule = (over: Partial<RescheduleInput> = {}) => checkReschedule({
  actor: "coordi", admins: ["admin"], project: huerto, closed: false, taskId: "madera", dueDate: "2026-10-20", reason: "  Falta madera  ",
  projectDue: "2026-11-01", taskDues: { madera: "2026-10-15", piedra: "" }, ...over,
});

test("replanificar: coordinación o administración, fecha coherente y motivo (Q177)", () => {
  assert.deepEqual(reschedule(), { ok: true, project: huerto, taskId: "madera", dueDate: "2026-10-20", reason: "Falta madera" });
  assert.equal(reschedule({ actor: "admin" }).ok, true);
  assert.deepEqual(reschedule({ actor: "bea" }), { ok: false, reason: "sin-permiso" });
  assert.deepEqual(reschedule({ project: undefined }), { ok: false, reason: "proyecto-desconocido" });
  assert.deepEqual(reschedule({ taskId: "oro" }), { ok: false, reason: "tarea-desconocida" });
  assert.deepEqual(reschedule({ closed: true }), { ok: false, reason: "proyecto-cerrado" });
  assert.deepEqual(reschedule({ dueDate: "2026-02-30" }), { ok: false, reason: "fecha-invalida" });
  assert.deepEqual(reschedule({ dueDate: "2026-11-02" }), { ok: false, reason: "fecha-invalida" }, "una tarea no vence después que su proyecto");
  for (const reason of ["", "   ", 3, "x".repeat(501)]) assert.deepEqual(reschedule({ reason }), { ok: false, reason: "motivo-invalido" });
  // El proyecto: no antes que ninguna de sus tareas.
  assert.equal(reschedule({ taskId: "", dueDate: "2026-10-15" }).ok, true);
  assert.deepEqual(reschedule({ taskId: undefined, dueDate: "2026-10-14" }), { ok: false, reason: "fecha-invalida" });
});
