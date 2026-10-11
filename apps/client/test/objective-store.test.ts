import { test } from "node:test";
import assert from "node:assert/strict";
import { loadObjective, objectiveKey, parseObjective, saveObjective } from "../src/objective-store.ts";

// G3c, P1: el objetivo activo se guarda en el navegador (Q224). Lectura tolerante: lo corrupto es «sin objetivo».

test("objetivo guardado: los cuatro tipos viajan y vuelven iguales, con su ruta elegida", () => {
  for (const o of [
    { kind: "mission", id: "m1" },
    { kind: "task", project: "p", task: "t", route: "moler>hornear" },
    { kind: "item", item: "pan", amount: 2 },
    { kind: "skill", skill: "molinero", level: 2 },
  ] as const) assert.deepEqual(parseObjective(JSON.stringify(o)), o);
});

test("objetivo guardado: ausente, corrupto, de forma desconocida o fuera de rango es «sin objetivo»", () => {
  for (const bad of [undefined, null, "", "no json", "[]", "42", '{"kind":"otro"}', '{"kind":"mission"}', '{"kind":"item","item":"pan","amount":0}',
    '{"kind":"item","item":"pan","amount":1.5}', '{"kind":"skill","skill":"s","level":9999}', '{"kind":"task","project":"p"}', { kind: "mission", id: 7 }]) {
    assert.equal(parseObjective(bad), undefined, JSON.stringify(bad));
  }
});

test("objetivo guardado: un almacenamiento que falla o no existe no rompe nada", () => {
  const key = objectiveKey("aldea", "ana");
  assert.equal(key, "engremiat.objetivo.aldea.ana");
  const throwing = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); }, removeItem() { throw new Error("bloqueado"); } };
  assert.equal(loadObjective(key, throwing), undefined);
  assert.equal(saveObjective(key, { kind: "mission", id: "m" }, throwing), false);
  assert.equal(saveObjective(key, undefined, undefined as unknown as Storage), false);
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  assert.equal(saveObjective(key, { kind: "mission", id: "m" }, storage), true);
  assert.deepEqual(loadObjective(key, storage), { kind: "mission", id: "m" });
  assert.equal(saveObjective(key, undefined, storage), true);
  assert.equal(loadObjective(key, storage), undefined);
});
