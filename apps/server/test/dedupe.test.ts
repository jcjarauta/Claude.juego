import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { openStore, COMMUNITY } from "../src/store.ts";
import { dedupeDefinitions } from "../src/dedupe.ts";
import { tempDb } from "./helpers.ts";

// F2b: limpieza de objetos y recetas con nombre repetido en una base existente.

test("dedupe: borra los duplicados sin uso, conserva el más antiguo y los que están en uso, y hace copia", () => {
  const path = tempDb();
  const store = openStore(path);
  const item = (id: string, name: string, at: number) => store.addItemDef({ id, name }, "ana", at);
  item("harina-a", "Harina", 1);
  item("harina-b", "Harina", 2); // duplicado sin uso
  item("harina-c", "harina", 3); // duplicado con existencias
  item("pan-a", "Pan", 4);
  item("pan-b", "Pan", 5); // duplicado usado por una receta
  store.transaction(() => store.addAmount(COMMUNITY, "harina-c", 2));
  const recipe = (id: string, name: string, at: number, extra: Record<string, unknown> = {}) =>
    store.addRecipeDef({ id, name, structureId: "taller", inputs: { madera: 1 }, output: { item: "harina-a", amount: 1 }, ...extra } as never, "ana", at);
  recipe("moler-a", "Moler", 6);
  recipe("moler-b", "Moler", 7); // duplicada sin uso
  recipe("moler-c", "Moler", 8); // duplicada fabricada
  recipe("pan-r", "Hacer pan", 9, { output: { item: "pan-b", amount: 1 } });
  store.transaction(() => store.event("craft", "ana", "r1", { recipe: "moler-c", consumed: { madera: 1 }, produced: { "harina-a": 1 } }));
  store.close();

  const dry = dedupeDefinitions(path, false);
  assert.equal(dry.deleted, 0);
  const action = (id: string) => dry.lines.find((l) => l.id === id)!;
  assert.deepEqual(["harina-b", "harina-c", "pan-b", "moler-b", "moler-c"].map((id) => action(id).action), ["borrar", "conservar", "conservar", "borrar", "conservar"]);
  assert.match(action("harina-c").reason!, /existencias/);
  assert.match(action("pan-b").reason!, /receta/);
  assert.match(action("moler-c").reason!, /fabricado/);
  assert.equal(openStore(path).getItemDefs().length, 5, "sin --apply no se borra nada");

  const done = dedupeDefinitions(path, true);
  assert.equal(done.deleted, 2);
  assert.ok(done.backup && existsSync(done.backup));
  const after = openStore(path);
  assert.deepEqual(after.getItemDefs().map((r) => r.def.id).sort(), ["harina-a", "harina-c", "pan-a", "pan-b"]);
  assert.deepEqual(after.getRecipeDefs().map((r) => r.def.id).sort(), ["moler-a", "moler-c", "pan-r"]);
  after.close();
  assert.equal(dedupeDefinitions(path, true).deleted, 0, "repetirlo no cambia nada");
});

test("dedupe: una base sin duplicados o sin migrar se trata con claridad", () => {
  const path = tempDb();
  openStore(path).close();
  assert.deepEqual(dedupeDefinitions(path, true), { lines: [], deleted: 0 });
  assert.throws(() => dedupeDefinitions(`${path}.no-existe`, false), /No existe/);
});
