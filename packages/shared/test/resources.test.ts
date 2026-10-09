import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCollect, checkTransfer, regenerate, type CollectInput, type NodeView } from "../src/index.ts";

const nodes: NodeView[] = [
  { id: "arbol-1", resource: "madera", x: 2, y: 1, units: 3 },   // derecha de (1,1)
  { id: "roca-1", resource: "piedra", x: 1, y: 2, units: 2 },    // abajo de (1,1)
  { id: "mata-1", resource: "fibra", x: 5, y: 5, units: 3 },     // lejos
];
const input = (over: Partial<CollectInput> = {}): CollectInput => ({
  position: { x: 1, y: 1 },
  facing: undefined,
  nodes,
  held: () => 0,
  inventoryMax: 10,
  lastCollectAt: undefined,
  now: 10_000,
  cooldownMs: 1000,
  ...over,
});

test("recolectar: sin dirección se elige el primer nodo adyacente en orden de configuración", () => {
  const r = checkCollect(input());
  assert.equal(r.ok && r.node.id, "arbol-1");
});

test("recolectar: se prefiere el nodo hacia el que mira el jugador", () => {
  const r = checkCollect(input({ facing: { dx: 0, dy: 1 } }));
  assert.equal(r.ok && r.node.id, "roca-1");
});

test("recolectar: si el nodo de enfrente está agotado se usa otro adyacente con unidades", () => {
  const withEmpty = nodes.map((n) => (n.id === "roca-1" ? { ...n, units: 0 } : n));
  const r = checkCollect(input({ nodes: withEmpty, facing: { dx: 0, dy: 1 } }));
  assert.equal(r.ok && r.node.id, "arbol-1");
});

test("recolectar: los rechazos tienen motivo", () => {
  assert.deepEqual(checkCollect(input({ position: { x: 8, y: 8 } })), { ok: false, reason: "nodo-lejos" });
  const empty = nodes.map((n) => ({ ...n, units: 0 }));
  assert.deepEqual(checkCollect(input({ nodes: empty })), { ok: false, reason: "nodo-agotado" });
  assert.deepEqual(checkCollect(input({ held: () => 10 })), { ok: false, reason: "inventario-lleno" });
  assert.deepEqual(checkCollect(input({ lastCollectAt: 9_500 })), { ok: false, reason: "recoleccion-demasiado-rapida" });
});

test("recolectar: la casilla propia y las diagonales cuentan como adyacentes solo a distancia 1", () => {
  const diagonal: NodeView[] = [{ id: "d", resource: "madera", x: 2, y: 2, units: 1 }];
  assert.equal(checkCollect(input({ nodes: diagonal })).ok, true);
  const far: NodeView[] = [{ id: "f", resource: "madera", x: 3, y: 1, units: 1 }];
  assert.equal(checkCollect(input({ nodes: far })).ok, false);
});

const known = new Set(["madera", "piedra", "fibra"]);

test("transferir: acepta una cantidad dentro del saldo hacia la comunidad", () => {
  assert.deepEqual(
    checkTransfer({ resource: "madera", amount: 3, to: "community", knownResources: known, balance: () => 3 }),
    { ok: true, resource: "madera", amount: 3, to: "community" },
  );
});

test("transferir: rechaza saldo insuficiente, destino no permitido y datos inválidos", () => {
  const base = { knownResources: known, balance: () => 2 };
  assert.deepEqual(checkTransfer({ ...base, resource: "madera", amount: 3, to: "community" }), { ok: false, reason: "saldo-insuficiente" });
  assert.deepEqual(checkTransfer({ ...base, resource: "madera", amount: 1, to: "player" }), { ok: false, reason: "destino-no-permitido" });
  for (const bad of [{ resource: "oro", amount: 1 }, { resource: "madera", amount: 0 }, { resource: "madera", amount: -2 }, { resource: "madera", amount: 1.5 }, { resource: 7, amount: 1 }]) {
    assert.deepEqual(checkTransfer({ ...base, ...bad, to: "community" }), { ok: false, reason: "solicitud-invalida" });
  }
});

test("regenerar: suma una unidad por intervalo completo y no supera el máximo", () => {
  assert.deepEqual(regenerate({ units: 0, max: 3, lastRegenAt: 0 }, 250, 100), { units: 2, lastRegenAt: 200, changed: true });
  assert.deepEqual(regenerate({ units: 2, max: 3, lastRegenAt: 0 }, 1000, 100), { units: 3, lastRegenAt: 1000, changed: true });
  assert.deepEqual(regenerate({ units: 1, max: 3, lastRegenAt: 0 }, 99, 100), { units: 1, lastRegenAt: 0, changed: false });
});

test("regenerar: un nodo lleno mantiene su marca al día", () => {
  assert.deepEqual(regenerate({ units: 3, max: 3, lastRegenAt: 0 }, 5000, 100), { units: 3, lastRegenAt: 5000, changed: false });
});
