import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContribution, projectStatus, type ContributionInput, type ProjectDef } from "../src/index.ts";

const project: ProjectDef = {
  id: "construir-taller",
  name: "Construir taller",
  description: "",
  tasks: [
    { id: "madera", title: "Aportar madera", resource: "madera", required: 20 },
    { id: "piedra", title: "Aportar piedra", resource: "piedra", required: 15 },
  ],
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
