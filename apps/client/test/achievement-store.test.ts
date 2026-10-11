import { test } from "node:test";
import assert from "node:assert/strict";
import {
  achievementKey, addLocalRecognition, applyAchieved, badgeCount, emptyStore, loadStore, markConsulted, markStartingConsulted, newOnes, parseStore, saveStore,
  SCHEMA_VERSION, serializeStore, startingOnes, type AchievementStore,
} from "../src/achievement-store.ts";

// G3d, P1: almacén local de los logros. Registro de ESTE navegador: versionado, tolerante, notificado ≠ consultado y primera visita
// sin celebrar ni contar en la insignia.

const A = "primer-edificio@1", B = "primera-mision@1", C = "primer-aporte@1";

test("almacén: vacío por omisión; datos corruptos, ajenos o de otra forma dan un almacén vacío y nunca lanzan", () => {
  assert.deepEqual(parseStore(undefined).store, emptyStore());
  for (const bad of [null, "", "no json", "[]", "42", '"texto"', 7, []]) assert.deepEqual(parseStore(bad).store, emptyStore(), JSON.stringify(bad));
  const mixed = parseStore({ schemaVersion: 1, initialized: "sí", vistos: [1, "a@1", null, "a@1"], notificados: "x", consultados: { a: 1 }, libro: { ensenado: -3, aprendido: 2.5 } }).store;
  assert.deepEqual([mixed.initialized, mixed.vistos, mixed.notificados, mixed.consultados, mixed.libro], [false, ["a@1"], [], [], { ensenado: 0, aprendido: 0 }]);
});

test("almacén: lo guardado viaja y vuelve igual; un almacenamiento que falla o no existe no rompe nada", () => {
  const store: AchievementStore = { ...emptyStore(), initialized: true, vistos: [A, B], notificados: [A, B], consultados: [A], preexistentes: [B], libro: { ensenado: 2, aprendido: 1 } };
  assert.deepEqual(parseStore(serializeStore(store)).store, store);
  const key = achievementKey("aldea", "ana");
  assert.equal(key, "engremiat.logros.aldea.ana");
  const throwing = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } };
  assert.deepEqual(loadStore(key, throwing).store, emptyStore());
  assert.equal(saveStore(key, { store, readOnly: false }, throwing), false);
  assert.equal(saveStore(key, { store, readOnly: false }, undefined as unknown as Storage), false);
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.equal(saveStore(key, { store, readOnly: false }, storage), true);
  assert.deepEqual(loadStore(key, storage).store, store);
});

// --------------------------------------------------------------- primera visita (precisión 8)

test("primera visita: lo ya conseguido pasa a vistos, notificados y preexistentes, sin celebrar y SIN marcar como consultado", () => {
  const first = applyAchieved(emptyStore(), [A, B]);
  assert.deepEqual(first.nuevos, [], "no hay celebración");
  assert.equal(first.store.initialized, true);
  assert.deepEqual([first.store.vistos, first.store.notificados, first.store.preexistentes], [[A, B], [A, B], [A, B]]);
  assert.deepEqual(first.store.consultados, [], "no se marcan como consultados automáticamente");
  assert.deepEqual(newOnes(first.store), [], "los preexistentes no son «nuevos»");
  assert.equal(badgeCount(first.store), 0, "y no cuentan en la insignia");
  assert.deepEqual(startingOnes(first.store), [A, B], "pero se pueden consultar aparte");
});

test("después de la primera visita: lo que se consigue es nuevo, se notifica una vez y cuenta en la insignia hasta que se consulta", () => {
  let s = applyAchieved(emptyStore(), [A]).store;
  const next = applyAchieved(s, [A, B]);
  assert.deepEqual(next.nuevos, [B]);
  s = next.store;
  assert.deepEqual(newOnes(s), [B]);
  assert.equal(badgeCount(s), 1);
  // el mismo estado otra vez: no vuelve a ser nuevo
  const again = applyAchieved(s, [A, B]);
  assert.deepEqual(again.nuevos, []);
  assert.equal(badgeCount(again.store), 1, "sigue sin consultar: la insignia no se apaga sola");
});

test("notificado ≠ consultado: ser notificado no apaga la insignia; solo marcar como visto lo hace", () => {
  let s = applyAchieved(emptyStore(), []).store;
  s = applyAchieved(s, [A, B, C]).store;
  assert.deepEqual([s.notificados.length, s.consultados.length, badgeCount(s)], [3, 0, 3]);
  s = markConsulted(s, [A]);
  assert.deepEqual([newOnes(s), badgeCount(s)], [[B, C], 2]);
  s = markConsulted(s, [B, C]);
  assert.equal(badgeCount(s), 0);
  assert.deepEqual(s.notificados, [A, B, C], "consultar no borra lo notificado");
});

test("preexistentes: marcarlos como vistos es aparte y no cambia la insignia", () => {
  let s = applyAchieved(emptyStore(), [A]).store;
  s = applyAchieved(s, [A, B]).store;
  const before = badgeCount(s);
  const marked = markStartingConsulted(s);
  assert.equal(badgeCount(marked), before, "la insignia cuenta solo los nuevos");
  assert.deepEqual(marked.consultados, [A]);
  assert.deepEqual(newOnes(marked), [B]);
});

test("un logro que deja de constar se mantiene en vistos (registro de este navegador) y no vuelve a ser nuevo al reaparecer", () => {
  let s = applyAchieved(emptyStore(), []).store;
  s = applyAchieved(s, [A]).store;
  s = applyAchieved(s, []).store;
  assert.deepEqual(s.vistos, [A]);
  assert.deepEqual(applyAchieved(s, [A]).nuevos, [], "ya se notificó");
});

// --------------------------------------------------------------- versionado y migración (precisión 9)

test("versionado: un almacén de una versión anterior se migra en memoria con la tabla de migraciones", () => {
  const old = { schemaVersion: 1, initialized: true, vistos: ["x@1"], notificados: ["x@1"], consultados: [], preexistentes: [] };
  const migrated = parseStore(old, {
    schema: 3,
    migrations: {
      1: (raw) => ({ ...raw, schemaVersion: 2, libro: { ensenado: 4, aprendido: 0 } }),
      2: (raw) => ({ ...raw, schemaVersion: 3, vistos: [...(raw.vistos as string[]), "y@1"] }),
    },
  });
  assert.equal(migrated.readOnly, false);
  assert.equal(migrated.store.schemaVersion, 3);
  assert.deepEqual(migrated.store.libro, { ensenado: 4, aprendido: 0 });
  assert.deepEqual(migrated.store.vistos, ["x@1", "y@1"]);
});

test("versionado: una migración que falla da un almacén vacío, nunca una excepción", () => {
  const r = parseStore({ schemaVersion: 1, vistos: ["x@1"] }, { schema: 2, migrations: { 1: () => { throw new Error("rota"); } } });
  assert.deepEqual(r.store, emptyStore());
});

test("versionado: un id reemplazado NO hereda el estado del anterior (se reevalúa) y queda anotado como retirado", () => {
  const raw = { schemaVersion: 1, initialized: true, vistos: ["x@1", A], notificados: ["x@1", A], consultados: ["x@1"], preexistentes: ["x@1"] };
  const r = parseStore(raw, { superseded: { "x@1": "x@2" } });
  assert.deepEqual([r.store.vistos, r.store.notificados, r.store.consultados, r.store.preexistentes], [[A], [A], [], []]);
  assert.deepEqual(r.store.retirados, ["x@1"]);
  // y al aplicar lo conseguido, un id retirado nunca vuelve a entrar
  const applied = applyAchieved(emptyStore(), [A]);
  assert.ok(!applied.store.vistos.includes("x@1"));
});

test("versionado: los ids desconocidos se conservan sin mostrarse (ni contar) y una versión posterior se lee sin poder sobrescribirse", () => {
  const future = { schemaVersion: SCHEMA_VERSION + 1, initialized: true, vistos: [A, "nuevo-de-otra-version@9"], notificados: [A, "nuevo-de-otra-version@9"], consultados: [], preexistentes: [] };
  const r = parseStore(future);
  assert.equal(r.readOnly, true);
  assert.equal(r.store.schemaVersion, SCHEMA_VERSION + 1, "no se «degrada» el número");
  assert.ok(r.store.vistos.includes("nuevo-de-otra-version@9"), "el id desconocido se conserva");
  assert.deepEqual(newOnes(r.store), [A], "pero no se muestra ni cuenta: solo ids del catálogo conocido");
  assert.equal(badgeCount(r.store), 1);
  const mem = new Map<string, string>([["k", JSON.stringify(future)]]);
  assert.equal(saveStore("k", r, { setItem: (k, v) => void mem.set(k, v) }), false, "no se escribe encima");
  assert.equal(mem.get("k"), JSON.stringify(future));
});

test("libro local: enseñar y aprender se cuentan aparte y no tocan los logros", () => {
  let s = emptyStore();
  s = addLocalRecognition(s, "ensenado");
  s = addLocalRecognition(addLocalRecognition(s, "aprendido"), "aprendido");
  assert.deepEqual(s.libro, { ensenado: 1, aprendido: 2 });
  assert.deepEqual([s.vistos, s.notificados, badgeCount(s)], [[], [], 0]);
});
