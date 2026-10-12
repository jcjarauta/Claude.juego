import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@colyseus/sdk";
import { MESSAGE, ROOM_NAME, WorldState, type CascadePlanMessage, type HistoryMessage, type MoveMessage, type Player, type RejectedMessage } from "@juego/shared";
import { fixture, sessionFor, sleep, startServer, tempDb, waitFor } from "./helpers.ts";

// G2, P1 (TP-32): edición por versiones, concurrencia, historial, retirada de edificios y cascada, con el servidor REAL.
// Dos administradores (ana y luis); bea no lo es. Todas las bases son temporales (tempDb).

const RIGHT = { dx: 1, dy: 0 };
const DOWN = { dx: 0, dy: 1 };
const UP = { dx: 0, dy: -1 };

/** El mundo de prueba con dos administradores. */
function twoAdminsWorld(): string {
  const config = JSON.parse(readFileSync(fixture("regen-world.json"), "utf8")) as { admins: string[] };
  config.admins = ["ana", "luis"];
  const path = join(tmpdir(), `${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(config));
  return path;
}

interface Session {
  room: Awaited<ReturnType<Client["join"]>> & { state: WorldState };
  rejected: RejectedMessage[];
  history: HistoryMessage[];
  plans: CascadePlanMessage[];
  me: () => Player;
}

async function enter(url: string, name: string): Promise<Session> {
  const token = await sessionFor(url, name);
  const room = (await new Client(url).join(ROOM_NAME, { token }, WorldState)) as Session["room"];
  const s: Session = { room, rejected: [], history: [], plans: [], me: () => room.state.players.get(room.sessionId)! };
  room.onMessage(MESSAGE.rejected, (m: RejectedMessage) => s.rejected.push(m));
  room.onMessage(MESSAGE.history, (m: HistoryMessage) => s.history.push(m));
  room.onMessage(MESSAGE.cascadePlan, (m: CascadePlanMessage) => s.plans.push(m));
  await waitFor(() => Boolean(room.state?.players?.get(room.sessionId)));
  return s;
}

const send = (s: Session, type: string, fields: Record<string, unknown> = {}) => s.room.send(type, { requestId: randomUUID(), ...fields });
const last = (s: Session) => s.rejected.at(-1);
const reasons = (s: Session) => s.rejected.map((r) => r.reason);
const step = () => sleep(140); // el limitador admite 8 operaciones por segundo y sesión (Q167)

// ---------------------------------------------------------------------------------------------- objetos: versiones y concurrencia

test("TP-32: editar por versiones con dos administradores — expectedRev, análisis confirmado, archivar invalida, historial, volver atrás y persistencia", async () => {
  const dbPath = tempDb();
  const world = twoAdminsWorld();
  let server = await startServer({ WORLD_CONFIG: world, DB_PATH: dbPath });
  try {
    const ana = await enter(server.url, "ana");
    const luis = await enter(server.url, "luis");
    const bea = await enter(server.url, "bea");
    send(ana, MESSAGE.createItem, { name: "Harina" });
    await waitFor(() => [...luis.room.state.items.values()].some((i) => i.name === "Harina"));
    const id = [...luis.room.state.items.entries()].find(([, i]) => i.name === "Harina")![0];
    const item = (s: Session) => s.room.state.items.get(id)!;
    assert.deepEqual([item(luis).version, item(luis).rev, item(luis).name], [1, 1, "Harina"]);
    const edit = (s: Session, name: string, expectedRev: number, extra: Record<string, unknown> = {}) =>
      send(s, MESSAGE.editDef, { kind: "objeto", id, def: { name }, expectedRev, ...extra });

    // Sin permiso.
    await step();
    edit(bea, "Harina fina", 1);
    await waitFor(() => last(bea)?.reason === "sin-permiso");

    // Un cambio con efectos exige confirmar el análisis: sin la base se devuelve y no se aplica nada.
    await step();
    edit(ana, "Harina fina", 1);
    await waitFor(() => last(ana)?.reason === "analisis-desactualizado");
    const analysis = last(ana)!.analysis!;
    assert.match(analysis.avisos[0]!, /Cambia el nombre de «Harina» a «Harina fina»/);
    assert.match(analysis.basis, /^[0-9a-f]{32}$/);
    assert.equal(item(luis).name, "Harina", "sin confirmar no cambia");

    // Con la base correcta: versión 2 y revisión 2, en las dos sesiones.
    await step();
    edit(ana, "Harina fina", 1, { basis: analysis.basis, note: "afinar" });
    await waitFor(() => item(luis).version === 2 && item(ana).version === 2);
    assert.deepEqual([item(luis).name, item(luis).rev, item(ana).name, item(ana).rev], ["Harina fina", 2, "Harina fina", 2]);

    // Dos administradores: luis edita desde la revisión 1 (la que tenía abierta) → version-obsoleta, y no se pierde nada.
    await step();
    edit(luis, "Harina gorda", 1);
    await waitFor(() => last(luis)?.reason === "version-obsoleta");
    assert.match(last(luis)!.details![0]!, /revisión vigente es la 2 y tú tenías la 1: editada \(v2\) \(ana\)/);
    assert.equal(item(ana).name, "Harina fina");

    // Archivar con una revisión vieja se rechaza; con la vigente se aplica, sube la revisión y NO la versión de contenido.
    await step();
    send(luis, MESSAGE.archiveDef, { kind: "objeto", id, expectedRev: 1 });
    await waitFor(() => reasons(luis).filter((r) => r === "version-obsoleta").length === 2);
    assert.equal(item(ana).archived, false);
    await step();
    send(luis, MESSAGE.archiveDef, { kind: "objeto", id, expectedRev: 2 });
    await waitFor(() => item(ana).archived);
    assert.deepEqual([item(ana).version, item(ana).rev], [2, 3], "archivar sube la revisión (3) pero no la versión (2)");

    // Mientras luis archivaba, ana seguía con su formulario abierto sobre la revisión 2: ya no vale.
    await step();
    edit(ana, "Harina muy fina", 2);
    await waitFor(() => last(ana)?.reason === "version-obsoleta");
    assert.match(last(ana)!.details![0]!, /archivada \(luis\)/);
    await step();
    edit(ana, "Harina muy fina", 3);
    await waitFor(() => reasons(ana).filter((r) => r === "definicion-invalida").length === 1);
    assert.match(last(ana)!.details![0]!, /archivado.*restaura la definición/, "lo archivado no se edita");

    // Restaurar (rev 3 → 4) y ver el historial: solo la administración.
    await step();
    send(luis, MESSAGE.restoreDef, { kind: "objeto", id, expectedRev: 3 });
    await waitFor(() => !item(ana).archived && item(ana).rev === 4);
    await step();
    send(bea, MESSAGE.definitionHistory, { kind: "objeto", id });
    await waitFor(() => reasons(bea).filter((r) => r === "sin-permiso").length === 2);
    send(ana, MESSAGE.definitionHistory, { kind: "objeto", id });
    await waitFor(() => ana.history.length === 1);
    const h = ana.history[0]!;
    assert.deepEqual([h.version, h.rev, h.versions.map((v) => v.version), h.versions.map((v) => (v.definition as { name: string }).name), h.versions[1]!.changedBy, h.versions[1]!.note],
      [2, 4, [1, 2], ["Harina", "Harina fina"], "ana", "afinar"]);

    // Volver a la versión 1 crea la versión 3 con su contenido (nada se borra).
    await step();
    send(luis, MESSAGE.restoreVersion, { kind: "objeto", id, toVersion: 1, expectedRev: 4 });
    await waitFor(() => last(luis)?.reason === "analisis-desactualizado");
    await step();
    send(luis, MESSAGE.restoreVersion, { kind: "objeto", id, toVersion: 1, expectedRev: 4, basis: last(luis)!.analysis!.basis });
    await waitFor(() => item(ana).version === 3);
    assert.deepEqual([item(ana).name, item(ana).rev], ["Harina", 5]);

    // Persiste tras una caída brusca: nombre, versión, revisión e historial.
    await sleep(200);
    await server.kill();
    server = await startServer({ WORLD_CONFIG: world, DB_PATH: dbPath });
    const ana2 = await enter(server.url, "ana");
    await waitFor(() => ana2.room.state.items.has(id));
    const again = ana2.room.state.items.get(id)!;
    assert.deepEqual([again.name, again.version, again.rev, again.archived], ["Harina", 3, 5, false]);
    send(ana2, MESSAGE.definitionHistory, { kind: "objeto", id });
    await waitFor(() => ana2.history.length === 1);
    assert.deepEqual(ana2.history[0]!.versions.map((v) => (v.definition as { name: string }).name), ["Harina", "Harina fina", "Harina"]);
  } finally {
    await server.kill();
  }
  const db = new DatabaseSync(dbPath);
  assert.deepEqual(db.prepare("SELECT version FROM def_version WHERE id IS NOT NULL ORDER BY version").all().map((r) => Number(r.version)), [2, 3]);
  assert.equal(Number((db.prepare("SELECT rev FROM def_rev").get() as { rev: number }).rev), 5);
  assert.deepEqual(db.prepare("SELECT type FROM event WHERE type IN ('def-edited','def-version-restored','def-archived','def-restored') ORDER BY id").all().map((r) => r.type),
    ["def-edited", "def-archived", "def-restored", "def-version-restored"]);
  db.close();
});

// ---------------------------------------------------------------------------------------------- habilidades: niveles ocupados y versión usada

test("TP-32: editar una habilidad conserva los niveles ganados, no deja quitar los ocupados y los registros nuevos guardan la versión usada", async () => {
  const dbPath = tempDb();
  const server = await startServer({ WORLD_CONFIG: twoAdminsWorld(), DB_PATH: dbPath });
  try {
    const ana = await enter(server.url, "ana");
    send(ana, MESSAGE.createSkill, { name: "Carpintero", description: "", levels: [{ name: "Aprendiz", recipe: "herramienta", times: 1 }] });
    await waitFor(() => ana.room.state.skills.size === 1);
    const [id] = [...ana.room.state.skills.keys()];
    const skill = () => ana.room.state.skills.get(id!)!;
    await step();
    send(ana, MESSAGE.grantSkill, { name: "ana", skill: id, level: 1 });
    await waitFor(() => ana.me().skills.get(id!) === 1);

    const level = (name: string, times: number) => ({ name, practice: { recipe: "herramienta", times } });
    const two = { name: "Carpintero", description: "", levels: [level("Aprendiz", 1), level("Oficial", 2)] };
    await step();
    send(ana, MESSAGE.editDef, { kind: "habilidad", id, def: two, expectedRev: 1 });
    await waitFor(() => last(ana)?.reason === "analisis-desactualizado");
    assert.match(last(ana)!.analysis!.avisos.join(" "), /Se añade 1 nivel al final/);
    await step();
    send(ana, MESSAGE.editDef, { kind: "habilidad", id, def: two, expectedRev: 1, basis: last(ana)!.analysis!.basis });
    await waitFor(() => skill().version === 2);
    assert.deepEqual([skill().levels.length, skill().levels[1]!.name, ana.me().skills.get(id!)], [2, "Oficial", 1], "el nivel ganado se conserva");

    // Conceder el nivel 2 con la versión 2 vigente: el registro nuevo guarda la versión usada.
    await step();
    send(ana, MESSAGE.grantSkill, { name: "ana", skill: id, level: 2 });
    await waitFor(() => ana.me().skills.get(id!) === 2);
    // Ahora ana tiene el nivel 2: no se puede volver a una habilidad de un solo nivel.
    await step();
    send(ana, MESSAGE.editDef, { kind: "habilidad", id, def: { name: "Carpintero", description: "", levels: [level("Aprendiz", 1)] }, expectedRev: 2 });
    await waitFor(() => last(ana)?.reason === "definicion-en-uso");
    assert.match(last(ana)!.details![0]!, /nivel 2.*no puede quedarse con 1 nivel/);
    assert.equal(skill().levels.length, 2);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
  const db = new DatabaseSync(dbPath);
  const granted = db.prepare("SELECT data FROM event WHERE type = 'skill-granted' ORDER BY id").all().map((r) => JSON.parse(r.data as string) as Record<string, unknown>);
  assert.deepEqual(granted.map((g) => [g.level, g.skillVersion]), [[1, 1], [2, 2]], "cada concesión guarda la versión de la habilidad que se usó");
  assert.deepEqual({ ...(db.prepare("SELECT level, def_version FROM player_skill").get() as object) }, { level: 2, def_version: 2 });
  db.close();
});

// ---------------------------------------------------------------------------------------------- construcciones: editar, retirar y restaurar

test("TP-32: editar una construcción antes de construirla; retirar un edificio CONSTRUIDO conserva lo histórico; restaurar tiene reglas propias", async () => {
  const dbPath = tempDb();
  const server = await startServer({ WORLD_CONFIG: twoAdminsWorld(), DB_PATH: dbPath });
  const walk = async (p: Session, steps: MoveMessage[]) => {
    for (const s of steps) {
      const { x, y } = p.me();
      p.room.send(MESSAGE.move, s);
      await waitFor(() => p.me().x === x + s.dx && p.me().y === y + s.dy, 2000);
      await sleep(110);
    }
  };
  try {
    const ana = await enter(server.url, "ana");
    const luis = await enter(server.url, "luis");
    send(ana, MESSAGE.createConstruction, { name: "Molino", description: "", x: 4, y: 0, width: 1, height: 1, color: "#3366cc", tasks: [{ title: "Madera", resource: "madera", required: 1 }] });
    await waitFor(() => [...luis.room.state.structures.values()].some((s) => s.name === "Molino"));
    const [id] = [...luis.room.state.structures.entries()].find(([, s]) => s.name === "Molino")!;
    const structure = (s: Session) => s.room.state.structures.get(id)!;
    await step();
    send(ana, MESSAGE.createMission, { name: "Molino listo", description: "", objective: { kind: "project-completed", project: id } });
    await waitFor(() => luis.room.state.missions.size === 2);

    // Editar la construcción (renombrarla) mientras no está construida.
    const def = (name: string) => ({
      project: { id, name, description: "", tasks: [{ id: "madera", title: "Madera", resource: "madera", required: 1, acceptance: "Aportar 1 de madera" }], reality: "VIRTUAL", coordinators: ["ana"], buildRequiresApproval: false },
      structure: { id, name, projectId: id, x: 4, y: 0, width: 1, height: 1, color: "#3366cc" },
    });
    await step();
    // Renombrar no tiene avisos ni efectos (sin aportes ni recetas): se aplica sin pedir confirmación.
    send(luis, MESSAGE.editDef, { kind: "construccion", id, def: def("Molino grande"), expectedRev: 1 });
    await waitFor(() => structure(ana).name === "Molino grande");
    assert.deepEqual([structure(ana).version, ana.room.state.projects.get(id)!.name, ana.room.state.projects.get(id)!.version], [2, "Molino grande", 2]);

    // Aportar y construir (versión 2 vigente).
    ana.room.send(MESSAGE.move, RIGHT); // mira al árbol (1,0)
    await sleep(150);
    for (let i = 0; i < 40 && (ana.me().inventory.get("madera") ?? 0) < 1; i++) { send(ana, MESSAGE.collect); await sleep(200); }
    send(ana, MESSAGE.contribute, { projectId: id, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => ana.room.state.projects.get(id)!.status === "listo");
    await walk(ana, [DOWN, RIGHT, RIGHT, RIGHT]); // (3,1), en diagonal al solar (4,0)
    send(ana, MESSAGE.build, { structureId: id });
    await waitFor(() => structure(luis).built);
    assert.equal([...luis.room.state.missions.values()].find((m) => m.name === "Molino listo")!.status, "completada");
    // Construido: ya no se edita.
    await step();
    send(luis, MESSAGE.editDef, { kind: "construccion", id, def: { ...def("Molino enorme") }, expectedRev: structure(luis).rev });
    await waitFor(() => reasons(luis).includes("definicion-en-uso"));
    assert.match(last(luis)!.details![0]!, /ya está construido/);
    assert.equal(structure(ana).name, "Molino grande");

    // Retirar el edificio construido: análisis con lo operativo y lo histórico, y confirmación.
    await walk(ana, [UP]); // (3,0), junto a la casilla del molino
    ana.room.send(MESSAGE.move, RIGHT);
    await waitFor(() => ana.rejected.some((r) => r.reason === "casilla-bloqueada"));
    await step();
    const rev = structure(luis).rev;
    send(luis, MESSAGE.retireStructure, { structureId: id, expectedRev: rev });
    await waitFor(() => reasons(luis).filter((r) => r === "analisis-desactualizado").length >= 1);
    const analysis = luis.rejected.filter((r) => r.reason === "analisis-desactualizado").at(-1)!.analysis!;
    const historico = analysis.historico as { misionesCompletadas: string[]; aportaciones: string[] };
    assert.deepEqual([historico.aportaciones, structure(luis).retired], [["1 de madera"], false]);
    await step();
    send(luis, MESSAGE.retireStructure, { structureId: id, expectedRev: rev, basis: analysis.basis });
    await waitFor(() => structure(ana).retired);
    // Lo operativo cambió: el solar ya no bloquea. Lo histórico se conserva intacto.
    assert.deepEqual([structure(ana).built, structure(ana).builtBy, ana.room.state.projects.get(id)!.progress.get("madera"), [...ana.room.state.missions.values()].find((m) => m.name === "Molino listo")!.status],
      [true, "ana", 1, "completada"]);
    ana.room.send(MESSAGE.move, RIGHT);
    await waitFor(() => ana.me().x === 4, 2000);

    // Restaurar: reglas propias (revisión vigente y solar libre).
    await step();
    send(luis, MESSAGE.restoreStructure, { structureId: id, expectedRev: rev });
    await waitFor(() => reasons(luis).includes("version-obsoleta"));
    await step();
    send(luis, MESSAGE.restoreStructure, { structureId: id, expectedRev: structure(luis).rev });
    await waitFor(() => !structure(ana).retired);
    await walk(ana, [RIGHT]); // sale de la casilla (5,0)
    ana.room.send(MESSAGE.move, { dx: -1, dy: 0 });
    await waitFor(() => ana.rejected.filter((r) => r.reason === "casilla-bloqueada").length >= 2);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
  const db = new DatabaseSync(dbPath);
  assert.deepEqual({ ...(db.prepare("SELECT def_version FROM structure").get() as object) }, { def_version: 2 }, "el edificio construido guarda la versión usada");
  const build = JSON.parse((db.prepare("SELECT data FROM event WHERE type = 'build'").get() as { data: string }).data) as Record<string, unknown>;
  assert.equal(build.structureVersion, 2);
  const done = JSON.parse((db.prepare("SELECT data FROM event WHERE type = 'mission-complete'").get() as { data: string }).data) as Record<string, unknown>;
  assert.equal(done.missionVersion, 1);
  assert.deepEqual(db.prepare("SELECT type FROM event WHERE type IN ('structure-retired','structure-restored') ORDER BY id").all().map((r) => r.type), ["structure-retired", "structure-restored"]);
  db.close();
});

// ---------------------------------------------------------------------------------------------- cascada

test("TP-32: archivar en cascada — vista previa con firma, ejecución atómica y plan-desactualizado si algo cambió", async () => {
  const dbPath = tempDb();
  const server = await startServer({ WORLD_CONFIG: twoAdminsWorld(), DB_PATH: dbPath });
  try {
    const ana = await enter(server.url, "ana");
    const luis = await enter(server.url, "luis");
    const bea = await enter(server.url, "bea");
    const make = async (item: string) => {
      send(ana, MESSAGE.createItem, { name: item });
      await waitFor(() => [...luis.room.state.items.values()].some((i) => i.name === item));
      const id = [...luis.room.state.items.entries()].find(([, i]) => i.name === item)![0];
      await step();
      send(ana, MESSAGE.createRecipe, { name: `Hacer ${item}`, structureId: "taller", inputs: { madera: 1 }, output: { item: id, amount: 1 } });
      await waitFor(() => [...luis.room.state.recipes.values()].some((r) => r.name === `Hacer ${item}`));
      const recipe = [...luis.room.state.recipes.entries()].find(([, r]) => r.name === `Hacer ${item}`)![0];
      await step();
      send(ana, MESSAGE.createMission, { name: `Mucho ${item}`, description: "", objective: { kind: "item-in-community", item: id, amount: 5 } });
      await waitFor(() => [...luis.room.state.missions.values()].some((m) => m.name === `Mucho ${item}`));
      const mission = [...luis.room.state.missions.entries()].find(([, m]) => m.name === `Mucho ${item}`)![0];
      await step();
      return { id, recipe, mission };
    };
    const sal = await make("Sal");
    const azucar = await make("Azúcar");

    // Vista previa: el orden, sin bloqueos y con firma. Solo la administración la pide.
    send(bea, MESSAGE.cascadePreview, { kind: "objeto", id: sal.id });
    await waitFor(() => last(bea)?.reason === "sin-permiso");
    send(ana, MESSAGE.cascadePreview, { kind: "objeto", id: sal.id });
    await waitFor(() => ana.plans.length === 1);
    const plan = ana.plans[0]!;
    assert.deepEqual(plan.order.map((n) => n.name), ["Mucho Sal", "Hacer Sal", "Sal"]);
    assert.deepEqual([plan.executable, plan.blockers.length, /^[0-9a-f]{32}$/.test(plan.planHash)], [true, 0, true]);
    await step();
    send(luis, MESSAGE.cascadePreview, { kind: "objeto", id: sal.id });
    await waitFor(() => luis.plans.length === 1);
    assert.equal(luis.plans[0]!.planHash, plan.planHash, "el mismo estado da la misma firma para cualquiera");

    // Ejecutar: todo el lote o nada; con la firma de la vista previa.
    await step();
    send(bea, MESSAGE.archiveDef, { kind: "objeto", id: sal.id, cascade: { planHash: plan.planHash } });
    await waitFor(() => reasons(bea).filter((r) => r === "sin-permiso").length === 2);
    send(ana, MESSAGE.archiveDef, { kind: "objeto", id: sal.id, cascade: { planHash: plan.planHash }, expectedRev: 1 });
    await waitFor(() => luis.room.state.items.get(sal.id)!.archived);
    assert.deepEqual([luis.room.state.recipes.get(sal.recipe)!.archived, luis.room.state.missions.get(sal.mission)!.archived, luis.room.state.items.get(sal.id)!.rev], [true, true, 2]);

    // Plan que cambia entre la vista previa y la ejecución: luis archiva la receta de Azúcar a mano.
    await step();
    send(ana, MESSAGE.cascadePreview, { kind: "objeto", id: azucar.id });
    await waitFor(() => ana.plans.length === 2);
    const stale = ana.plans[1]!;
    assert.deepEqual(stale.order.map((n) => n.name), ["Mucho Azúcar", "Hacer Azúcar", "Azúcar"]);
    send(luis, MESSAGE.archiveDef, { kind: "receta", id: azucar.recipe, expectedRev: 1 });
    await waitFor(() => luis.room.state.recipes.get(azucar.recipe)!.archived);
    await step();
    send(ana, MESSAGE.archiveDef, { kind: "objeto", id: azucar.id, cascade: { planHash: stale.planHash } });
    await waitFor(() => last(ana)?.reason === "plan-desactualizado");
    assert.equal(luis.room.state.items.get(azucar.id)!.archived, false, "nada se aplica");
    assert.equal(luis.room.state.missions.get(azucar.mission)!.archived, false);
    await waitFor(() => ana.plans.length === 3);
    const fresh = ana.plans[2]!;
    assert.deepEqual(fresh.order.map((n) => n.name), ["Mucho Azúcar", "Azúcar"], "recibe el plan nuevo sin la receta ya archivada");
    await step();
    send(ana, MESSAGE.archiveDef, { kind: "objeto", id: azucar.id, cascade: { planHash: fresh.planHash } });
    await waitFor(() => luis.room.state.items.get(azucar.id)!.archived && luis.room.state.missions.get(azucar.mission)!.archived);
    await ana.room.leave();
  } finally {
    await server.kill();
  }
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM event WHERE type = 'def-cascade-archived'").get()!.n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM archive").get()!.n, 6, "tres de Sal y tres de Azúcar (la receta a mano)");
  db.close();
});
