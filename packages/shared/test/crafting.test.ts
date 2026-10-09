import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBuild, checkCraft, inFootprint, isNextTo, missionSatisfied, type MissionDef, type RecipeDef, type StructureDef } from "../src/index.ts";

const taller: StructureDef = { id: "taller", name: "Taller", projectId: "p", x: 5, y: 5, width: 3, height: 2, color: "#a0522d" };
const receta: RecipeDef = { id: "herramienta", name: "Herramienta", structureId: "taller", inputs: { madera: 3, piedra: 2 }, output: { item: "herramienta", amount: 1 } };
const mision: MissionDef = { id: "m", name: "Primera herramienta", description: "", objective: { kind: "item-in-community", item: "herramienta", amount: 1 } };

test("huella: dentro, junto a ella (incluidas diagonales) y lejos", () => {
  assert.equal(inFootprint({ x: 7, y: 6 }, taller), true);
  assert.equal(isNextTo({ x: 7, y: 6 }, taller), false, "dentro no es «junto a»");
  for (const p of [{ x: 4, y: 4 }, { x: 8, y: 7 }, { x: 6, y: 4 }, { x: 4, y: 6 }]) assert.equal(isNextTo(p, taller), true);
  for (const p of [{ x: 3, y: 5 }, { x: 9, y: 6 }, { x: 6, y: 8 }]) assert.equal(isNextTo(p, taller), false);
});

test("construir: requisitos y motivos (Q156)", () => {
  const ok = { structure: taller, projectReady: true, built: false, position: { x: 4, y: 5 }, others: [] };
  assert.equal(checkBuild(ok).ok, true);
  assert.deepEqual(checkBuild({ ...ok, structure: undefined }), { ok: false, reason: "estructura-desconocida" });
  assert.deepEqual(checkBuild({ ...ok, built: true }), { ok: false, reason: "ya-construido" });
  assert.deepEqual(checkBuild({ ...ok, projectReady: false }), { ok: false, reason: "proyecto-sin-terminar" });
  assert.deepEqual(checkBuild({ ...ok, position: { x: 0, y: 0 } }), { ok: false, reason: "lejos-del-solar" });
  assert.deepEqual(checkBuild({ ...ok, others: [{ x: 6, y: 6 }] }), { ok: false, reason: "solar-ocupado" });
});

test("fabricar: requisitos y motivos (Q157)", () => {
  const stock = (id: string) => ({ madera: 3, piedra: 2 })[id] ?? 0;
  const ok = { recipe: receta, structure: taller, structureBuilt: true, position: { x: 8, y: 6 }, stock };
  assert.equal(checkCraft(ok).ok, true);
  assert.deepEqual(checkCraft({ ...ok, recipe: undefined }), { ok: false, reason: "receta-desconocida" });
  assert.deepEqual(checkCraft({ ...ok, structureBuilt: false }), { ok: false, reason: "taller-sin-construir" });
  assert.deepEqual(checkCraft({ ...ok, position: { x: 0, y: 0 } }), { ok: false, reason: "lejos-del-taller" });
  assert.deepEqual(checkCraft({ ...ok, stock: (id) => (id === "piedra" ? 1 : 3) }), { ok: false, reason: "faltan-materiales" });
});

test("misión: se cumple con al menos la cantidad pedida del objeto en la comunidad", () => {
  assert.equal(missionSatisfied(mision, () => 0), false);
  assert.equal(missionSatisfied(mision, (id) => (id === "herramienta" ? 1 : 0)), true);
});
