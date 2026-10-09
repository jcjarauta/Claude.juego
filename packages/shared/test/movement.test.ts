import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMove, type MoveRules } from "../src/index.ts";

const rules: MoveRules = {
  width: 5,
  height: 4,
  isBlocked: (x, y) => x === 2 && y === 1,
  cooldownMs: 100,
};
const at = { x: 1, y: 1 };

test("acepta un paso ortogonal válido", () => {
  assert.deepEqual(applyMove(at, { dx: 0, dy: 1 }, rules, undefined, 0), { ok: true, x: 1, y: 2 });
  assert.deepEqual(applyMove(at, { dx: -1, dy: 0 }, rules, 0, 100), { ok: true, x: 0, y: 1 });
});

test("rechaza diagonales, saltos y quedarse quieto", () => {
  for (const msg of [{ dx: 1, dy: 1 }, { dx: 2, dy: 0 }, { dx: 0, dy: 0 }]) {
    assert.deepEqual(applyMove(at, msg, rules, undefined, 0), { ok: false, reason: "movimiento-invalido" });
  }
});

test("rechaza datos con tipos inválidos", () => {
  for (const msg of [null, "derecha", 7, { dx: "1", dy: 0 }, { dx: 0.5, dy: 0 }, {}]) {
    assert.deepEqual(applyMove(at, msg, rules, undefined, 0), { ok: false, reason: "movimiento-invalido" });
  }
});

test("rechaza moverse más rápido de lo permitido", () => {
  assert.deepEqual(applyMove(at, { dx: 0, dy: 1 }, rules, 1000, 1050), { ok: false, reason: "movimiento-demasiado-rapido" });
});

test("rechaza salir del mapa", () => {
  assert.deepEqual(applyMove({ x: 0, y: 0 }, { dx: -1, dy: 0 }, rules, undefined, 0), { ok: false, reason: "fuera-del-mapa" });
  assert.deepEqual(applyMove({ x: 4, y: 3 }, { dx: 0, dy: 1 }, rules, undefined, 0), { ok: false, reason: "fuera-del-mapa" });
});

test("rechaza entrar en una casilla bloqueada", () => {
  assert.deepEqual(applyMove(at, { dx: 1, dy: 0 }, rules, undefined, 0), { ok: false, reason: "casilla-bloqueada" });
});
