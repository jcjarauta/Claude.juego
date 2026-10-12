import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cascadePlan, HISTORICAL_RECORDS, MESSAGE } from "@juego/shared";
import { canonicalHash } from "../src/projects/hash.ts";
import { MIGRATIONS, openStore, SCHEMA_VERSION } from "../src/store.ts";
import { makeView } from "../../../packages/shared/test/edit-fixtures.ts";
import { fixture, joinWorld, sleep, startServer, tempDb, waitFor } from "./helpers.ts";

// G2, P0 (TP-32): migración v11 → v12, recuperación desde la copia, hash determinista e inventario de registros históricos.
// TODAS las bases de estas pruebas son temporales (tempDb): jamás se toca la base de la persona responsable.

const WORLD = fixture("regen-world.json");
const send = (p: { room: { send(type: string, payload: unknown): void } }, type: string, fields: Record<string, unknown> = {}) => p.room.send(type, { requestId: randomUUID(), ...fields });

/** Una base en v11 con datos en las tablas que ganan columna. */
function makeV11(path: string) {
  const db = new DatabaseSync(path);
  for (let v = 1; v <= 11; v++) db.exec(MIGRATIONS[v]!);
  db.exec("PRAGMA user_version = 11");
  db.exec(`INSERT INTO item_def (id, definition, created_by, created_at) VALUES ('sal-1', '{"id":"sal-1","name":"Sal"}', 'ana', 1)`);
  db.exec("INSERT INTO player_skill (player, skill, level, source, at) VALUES ('ana', 'molinero', 2, 'practica', 10)");
  db.exec("INSERT INTO structure (id, built_at, built_by) VALUES ('taller', 20, 'ana')");
  db.exec("INSERT INTO mission (id, completed_at, completed_by) VALUES ('primera', 30, 'ana')");
  db.exec(`INSERT INTO event (at, type, actor, request_id, data) VALUES (40, 'craft', 'ana', 'r1', '{"recipe":"herramienta","consumed":{"madera":2},"produced":{"herramienta":1}}')`);
  db.close();
}

const columns = (db: DatabaseSync, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[]);

test("migración v11 → v12: crea versiones y revisiones, añade columnas nulas, no inventa versiones, conserva todo y hace copia", () => {
  const path = tempDb();
  assert.ok(resolve(path).startsWith(resolve(tmpdir())), "la base de la prueba es temporal");
  makeV11(path);
  const store = openStore(path);
  assert.equal(SCHEMA_VERSION, 12);
  assert.equal(store.schemaVersion(), 12);
  assert.ok(existsSync(`${path}.v11.bak`), "copia antes de migrar");
  assert.deepEqual([store.getAllDefVersions(), store.getDefRevs()], [[], []], "ninguna definición tiene versiones extra ni revisiones propias");
  store.close();

  const db = new DatabaseSync(path);
  for (const table of ["player_skill", "structure", "mission"]) {
    const col = columns(db, table).find((c) => c.name === "def_version");
    assert.ok(col, `${table}.def_version existe`);
    assert.equal(col!.notnull, 0, `${table}.def_version admite nulo`);
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE def_version IS NOT NULL`).get() as { n: number }).n, 0, `${table}: ninguna fila anterior recibe versión inventada`);
  }
  // el contenido anterior está intacto
  assert.deepEqual(db.prepare("SELECT player, skill, level, source, at FROM player_skill").all().map((r) => ({ ...r })), [{ player: "ana", skill: "molinero", level: 2, source: "practica", at: 10 }]);
  assert.deepEqual(db.prepare("SELECT id, built_at, built_by FROM structure").all().map((r) => ({ ...r })), [{ id: "taller", built_at: 20, built_by: "ana" }]);
  assert.deepEqual(db.prepare("SELECT id, completed_at, completed_by FROM mission").all().map((r) => ({ ...r })), [{ id: "primera", completed_at: 30, completed_by: "ana" }]);
  assert.equal((db.prepare("SELECT data FROM event WHERE request_id = 'r1'").get() as { data: string }).data, '{"recipe":"herramienta","consumed":{"madera":2},"produced":{"herramienta":1}}', "el evento anterior no gana ningún campo de versión");
  assert.throws(() => db.exec("INSERT INTO def_version (kind, id, version, definition, changed_by, changed_at) VALUES ('objeto', 'sal-1', 1, '{}', 'ana', 1)"), "la v1 no vive en def_version: nunca se pisa");
  assert.throws(() => db.exec("INSERT INTO def_rev (kind, id, rev, changed_by, changed_at, change) VALUES ('objeto', 'sal-1', 1, 'ana', 1, 'x')"), "sin fila, la revisión vale 1");
  db.close();

  const again = openStore(path);
  assert.equal(again.schemaVersion(), 12, "reabrir no migra de nuevo");
  assert.deepEqual(again.getItemDefs().map((i) => i.def.id), ["sal-1"], "la v1 sigue en su tabla");
  again.close();
});

test("versiones y revisiones: se añaden en orden, la v1 no se toca y la revisión de concurrencia sube sola con cualquier cambio", () => {
  const store = openStore(tempDb());
  store.addDefVersion("objeto", "sal-1", 2, { id: "sal-1", name: "Sal fina" }, "ana", 5, "afinar");
  store.addDefVersion("objeto", "sal-1", 3, { id: "sal-1", name: "Sal gorda" }, "luis", 6);
  assert.deepEqual(store.getDefVersions("objeto", "sal-1").map((v) => [v.version, (v.definition as { name: string }).name, v.changedBy, v.note]), [[2, "Sal fina", "ana", "afinar"], [3, "Sal gorda", "luis", ""]]);
  assert.deepEqual(store.getDefVersions("objeto", "otra"), []);
  assert.throws(() => store.addDefVersion("objeto", "sal-1", 3, {}, "ana", 7), "una versión no se repite");
  assert.deepEqual([store.bumpDefRev("objeto", "sal-1", "ana", 8, "editada"), store.bumpDefRev("objeto", "sal-1", "luis", 9, "archivada"), store.bumpDefRev("receta", "x", "ana", 9, "retirada")], [2, 3, 2]);
  assert.deepEqual(store.getDefRevs().filter((r) => r.id === "sal-1").map((r) => [r.rev, r.changedBy, r.change]), [[3, "luis", "archivada"]]);
  // versión de contenido y revisión de concurrencia son contadores distintos: aquí la revisión (3) va por delante de la versión (3 vs 2 → distintas fuentes)
  assert.equal(store.getDefVersions("objeto", "sal-1").at(-1)!.version, 3);
  store.close();
});

test("recuperación desde la copia *.v11.bak (solo con bases temporales): se vuelve a v11, se reabre y se migra de nuevo sin perder lo anterior", () => {
  const path = tempDb();
  assert.ok(resolve(path).startsWith(resolve(tmpdir())), "NUNCA se prueba la recuperación sobre una base que no sea temporal");
  makeV11(path);
  const store = openStore(path);
  store.addDefVersion("objeto", "sal-1", 2, { id: "sal-1", name: "Sal fina" }, "ana", 5);
  store.bumpDefRev("objeto", "sal-1", "ana", 5, "editada");
  store.close();
  // Procedimiento documentado: con el servidor parado, se sustituye la base por la copia y se vuelve a abrir.
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
  copyFileSync(`${path}.v11.bak`, path);
  const raw = new DatabaseSync(path);
  assert.equal((raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 11, "la copia está en v11");
  assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'def_version'").get(), undefined, "y no conoce las tablas nuevas");
  raw.close();
  const recovered = openStore(path);
  assert.equal(recovered.schemaVersion(), 12, "al reabrir se migra de nuevo");
  assert.deepEqual(recovered.getItemDefs().map((i) => i.def.name), ["Sal"], "los datos anteriores a la migración siguen");
  assert.deepEqual([recovered.getAllDefVersions(), recovered.getDefRevs()], [[], []], "lo escrito después de migrar se pierde, como se espera al volver a la copia");
  assert.deepEqual(recovered.getPlayerSkills("ana"), { molinero: 2 });
  recovered.close();
});

// ---------------------------------------------------------------- hash determinista

test("el hash es determinista: mismo texto canónico → misma firma de 32 hex; cualquier cambio la cambia", () => {
  const a = cascadePlan(makeView({ stock: { harina: 0 } }), "objeto", "harina");
  const b = cascadePlan(makeView({ reverse: true, stock: { harina: 0 } }), "objeto", "harina");
  assert.match(canonicalHash(a.canonical), /^[0-9a-f]{32}$/);
  assert.equal(canonicalHash(a.canonical), canonicalHash(b.canonical), "el orden de carga no cambia la firma");
  assert.equal(canonicalHash(a.canonical), canonicalHash(a.canonical));
  assert.notEqual(canonicalHash(a.canonical), canonicalHash(cascadePlan(makeView({ stock: { harina: 1 } }), "objeto", "harina").canonical), "una existencia distinta cambia la firma");
  assert.notEqual(canonicalHash("a"), canonicalHash("b"));
});

// ---------------------------------------------------------------- inventario de registros históricos (Q251), sobre una sala real

test("inventario: desde P1 los registros nuevos guardan la versión usada (solo hacia delante); las columnas existen y lo anterior sigue sin versión", async () => {
  const dbPath = tempDb();
  assert.ok(resolve(dbPath).startsWith(resolve(tmpdir())));
  const server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const ana = await joinWorld(server.url, "ana");
    await sleep(150);
    send(ana, MESSAGE.createSkill, { name: "Carpintero", description: "", levels: [{ name: "Aprendiz", recipe: "herramienta", times: 1 }] });
    await waitFor(() => ana.room.state.skills.size === 1);
    const [skillId] = [...ana.room.state.skills.keys()];
    await sleep(150);
    send(ana, MESSAGE.grantSkill, { name: "ana", skill: skillId, level: 1 });
    await waitFor(() => ana.room.state.players.get(ana.room.sessionId)!.skills.get(skillId!) === 1);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
  const db = new DatabaseSync(dbPath);
  const events = db.prepare("SELECT type, data FROM event WHERE type IN ('skill-created', 'skill-granted')").all() as { type: string; data: string }[];
  const granted = JSON.parse(events.find((e) => e.type === "skill-granted")!.data) as Record<string, unknown>;
  // Desde P1 el evento nuevo lleva la versión de la habilidad usada; los eventos anteriores a v12 (ver la prueba de migración) no la llevan.
  assert.deepEqual(Object.keys(granted).sort(), ["level", "player", "skill", "skillVersion"], "el evento nuevo guarda la versión usada");
  assert.equal(granted.skillVersion, 1);
  const row = db.prepare("SELECT level, source, def_version FROM player_skill WHERE player = 'ana'").get() as { level: number; source: string; def_version: number | null };
  assert.deepEqual({ ...row }, { level: 1, source: "concesion", def_version: 1 }, "la fila nueva guarda la versión usada");
  // cada tabla del inventario con campo def_version lo tiene de verdad
  for (const r of HISTORICAL_RECORDS) {
    assert.equal(r.backfilled, false, `${r.record}: no se rellena hacia atrás`);
    const field = "field" in r.version ? r.version.field : undefined;
    if (r.store.type === "tabla" && field) assert.ok(columns(db, r.store.table).some((c) => c.name === field), `${r.store.table}.${field}`);
    if (r.store.type === "tabla" && "notNeeded" in r.version) assert.ok(columns(db, r.store.table).length > 0, `${r.store.table} existe`);
  }
  assert.equal(HISTORICAL_RECORDS.filter((r) => "field" in r.version).length, 10);
  assert.equal(HISTORICAL_RECORDS.filter((r) => "notNeeded" in r.version).length, 2);
  db.close();
});
