// Prueba de carga (umbral de docs/pruebas.md §3): 4 clientes durante SOAK_MINUTES (15 por
// defecto) caminan hacia el nodo con unidades más cercano, recolectan, aportan al proyecto lo
// que aún necesita (desde su inventario o desde el almacén común) y depositan en la comunidad
// al llenar el inventario. Cada 5 s se detienen y se exige que todos vean el mismo
// estado (posiciones, inventarios, nodos y comunidad). Al final se audita la base de datos:
// lo recolectado según el registro de eventos debe coincidir con lo que hay en inventarios.
// M5b: además, un panel profesional (sin personaje) con el nombre del coordinador aporta desde
// el almacén común y revisa tareas completadas; su vista también debe coincidir.
// F1a: al empezar, ese panel (administración) crea un proyecto y una misión; los bots aportan
// a todos los proyectos abiertos.
// No forma parte de `npm.cmd test`; se ejecuta con `npm.cmd run soak`.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { addDays, blockedBy, isNextTo, isTaskDone, localDay, MESSAGE, solarProblems, structureDefFromState, type MoveMessage, type WorldConfig } from "@juego/shared";
import { openStore } from "../apps/server/src/store.ts";
import { joinPanel, joinWorld, sleep, startServer, tempDb, waitFor, type TestPanel, type TestPlayer } from "../apps/server/test/helpers.ts";

const minutes = Number(process.env.SOAK_MINUTES ?? 15);
const CHECK_EVERY_MS = 5000;
const config = JSON.parse(readFileSync(new URL("../content/world.json", import.meta.url), "utf8")) as WorldConfig;
const STEPS: MoveMessage[] = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
const randomStep = () => STEPS[Math.floor(Math.random() * STEPS.length)]!;

const dbPath = tempDb();
const server = await startServer({ DB_PATH: dbPath });
const bots: TestPlayer[] = [];
for (const name of ["bot1", "bot2", "bot3", "bot4"]) bots.push(await joinWorld(server.url, name));
const project = config.projects[0];
const panel: TestPanel = await joinPanel(server.url, project?.coordinators[0] ?? "panel");
const viewers: { room: TestPlayer["room"] }[] = [...bots, panel];

// Proyecto y misión creados desde el panel (F1a): sin tocar la configuración ni reiniciar.
const POZO = "Pozo de la aldea";
panel.room.send(MESSAGE.createProject, {
  requestId: randomUUID(), name: POZO, description: "Creado por el soak.", requiresApproval: false, dueDate: addDays(localDay(), 30),
  // F1c: la madera depende de la piedra (los aportes prematuros se rechazan sin efecto).
  tasks: [{ title: "Madera para el brocal", resource: "madera", required: 30, dueDate: addDays(localDay(), 20), dependsOn: ["piedra"] }, { title: "Piedra para el pozo", resource: "piedra", required: 20, dueDate: addDays(localDay(), 15) }],
});
await waitFor(() => [...panel.room.state.projects.values()].some((p) => p.name === POZO), 5000);
const pozoId = [...panel.room.state.projects.entries()].find(([, p]) => p.name === POZO)![0];
panel.room.send(MESSAGE.createMission, { requestId: randomUUID(), name: "Agua para la aldea", description: "", objective: { kind: "project-completed", project: pozoId } });
await waitFor(() => [...panel.room.state.missions.values()].some((m) => m.name === "Agua para la aldea"), 5000);
// F1b: una replanificación con motivo.
panel.room.send(MESSAGE.reschedule, { requestId: randomUUID(), projectId: pozoId, dueDate: addDays(localDay(), 45), reason: "Soak: ampliamos el plazo" });
await waitFor(() => panel.room.state.projects.get(pozoId)!.reschedules === 1, 5000);
// F1c: el panel se apunta a la piedra, asigna a un bot a la madera y comenta.
panel.room.send(MESSAGE.assign, { requestId: randomUUID(), projectId: pozoId, taskId: "piedra", name: panel.room.state.projects.get(pozoId)!.coordinators[0] });
panel.room.send(MESSAGE.assign, { requestId: randomUUID(), projectId: pozoId, taskId: "madera", name: "bot1" });
panel.room.send(MESSAGE.comment, { requestId: randomUUID(), projectId: pozoId, taskId: "madera", text: "Primero la piedra, luego la madera." });
await waitFor(() => panel.room.state.projects.get(pozoId)!.tasks.get("madera")!.comments === 1, 5000);

// F2a/F2b: el panel crea una cadena de producción: Molino (madera + piedra → harina + salvado) y Horno
// (2 harina → pan, con el Molino construido). Los bots construyen y fabrican en cualquier edificio del estado.
// Los solares se buscan con la misma regla que el servidor.
const nodeCells = new Set(config.nodes.map((n) => `${n.x},${n.y}`));
const taller = config.structures[0];
function freeSpot(from: number): { x: number; y: number; width: number; height: number } {
  const structures = [...panel.room.state.structures.entries()].map(([id, s]) => structureDefFromState(id, s));
  for (let dy = 0; dy < 20; dy++) {
    for (let dx = 0; dx < 20; dx++) {
      const candidate = { x: (taller?.x ?? 10) + dx - 3, y: (taller?.y ?? 10) + from + dy, width: 2, height: 2 };
      if (!solarProblems(candidate, { width: config.map.width, height: config.map.height, nodeCells, spawn: config.spawn, structures, side: config.buildLimits.side }).length) return candidate;
    }
  }
  throw new Error("no hay un solar libre para la cadena del soak");
}
const named = <T extends { name: string }>(entries: Map<string, T>, name: string) => [...entries.entries()].find(([, e]) => e.name === name)?.[0];
async function createAndWait<T>(send: () => void, find: () => T | undefined): Promise<T> {
  await sleep(300); // el limitador admite 8 operaciones por segundo y sesión (Q167)
  send();
  await waitFor(() => find() !== undefined, 5000);
  return find()!;
}
const MOLINO = "Molino del soak";
const HORNO = "Horno del soak";
const molinoId = await createAndWait(() => panel.room.send(MESSAGE.createConstruction, {
  requestId: randomUUID(), name: MOLINO, description: "", ...freeSpot(3), color: "#3366cc",
  tasks: [{ title: "Madera del molino", resource: "madera", required: 6 }, { title: "Piedra del molino", resource: "piedra", required: 4 }],
}), () => named(panel.room.state.structures, MOLINO));
const hornoId = await createAndWait(() => panel.room.send(MESSAGE.createConstruction, {
  requestId: randomUUID(), name: HORNO, description: "", ...freeSpot(3), color: "#cc6633",
  tasks: [{ title: "Madera del horno", resource: "madera", required: 4 }, { title: "Piedra del horno", resource: "piedra", required: 3 }],
}), () => named(panel.room.state.structures, HORNO));
const itemId = (name: string) => createAndWait(() => panel.room.send(MESSAGE.createItem, { requestId: randomUUID(), name }), () => named(panel.room.state.items, name));
const harinaId = await itemId("Harina del soak");
const salvadoId = await itemId("Salvado del soak");
const panId = await itemId("Pan del soak");
await createAndWait(() => panel.room.send(MESSAGE.createRecipe, {
  requestId: randomUUID(), name: "Moler", structureId: molinoId, verb: "moler", inputs: { madera: 1, piedra: 1 },
  output: { item: harinaId, amount: 1 }, byproducts: [{ item: salvadoId, amount: 1 }],
}), () => named(panel.room.state.recipes, "Moler"));
await createAndWait(() => panel.room.send(MESSAGE.createRecipe, {
  requestId: randomUUID(), name: "Hornear", structureId: hornoId, verb: "hornear", alsoNeeds: [molinoId], inputs: { [harinaId]: 2 },
  output: { item: panId, amount: 1 },
}), () => named(panel.room.state.recipes, "Hornear"));

let running = true;
let paused = false;
const sent = { moves: 0, collects: 0, transfers: 0, contributions: 0, builds: 0, crafts: 0, panelContributions: 0, reviews: 0 };
const structure = config.structures[0];
const recipe = config.recipes[0];

/** Paso hacia una casilla junto a la huella de la estructura. */
function stepToward(me: { x: number; y: number }, target: { x: number; y: number }): MoveMessage {
  if (Math.random() < 0.2) return randomStep();
  return Math.abs(target.x - me.x) >= Math.abs(target.y - me.y)
    ? { dx: Math.sign(target.x - me.x), dy: 0 }
    : { dx: 0, dy: Math.sign(target.y - me.y) };
}

/** Un paso del bot: depositar si está lleno, recolectar si tiene un nodo al lado, o acercarse. */
async function act(bot: TestPlayer) {
  const me = bot.me();
  const { state } = bot.room;
  // Construir un edificio cuyo proyecto está listo, o fabricar donde hay materiales en el almacén común
  // (cualquier edificio del estado, también el creado desde el panel).
  for (const [structureId, st] of state.structures) {
    const projectState = state.projects.get(st.projectId);
    const ready = projectState?.status === "listo" && projectState.phase !== "cerrado";
    const recipeEntry = st.built
      ? [...state.recipes.entries()].find(([, r]) => r.structureId === structureId
        && [...r.alsoNeeds].every((id) => state.structures.get(id)?.built)
        && [...r.inputs.entries()].every(([res, n]) => (state.community.get(res) ?? 0) >= n))
      : undefined;
    if (!(ready && !st.built) && !recipeEntry) continue;
    const footprint = { x: st.x, y: st.y, width: st.width, height: st.height };
    if (isNextTo(me, footprint)) {
      if (!st.built) {
        bot.room.send(MESSAGE.build, { requestId: randomUUID(), structureId });
        sent.builds++;
      } else {
        bot.room.send(MESSAGE.craft, { requestId: randomUUID(), recipeId: recipeEntry![0] });
        sent.crafts++;
      }
      return 300;
    }
    bot.room.send(MESSAGE.move, stepToward(me, { x: st.x - 1, y: st.y + st.height }));
    sent.moves++;
    return 130;
  }
  // Aportar a cualquier proyecto abierto (los de la configuración y los creados en el panel).
  for (const [projectId, projectState] of bot.room.state.projects) {
    if (projectState.phase === "cerrado") continue;
    for (const [taskId, task] of projectState.tasks) {
      if (task.required - (projectState.progress.get(task.resource) ?? 0) <= 0) continue;
      // Las tareas bloqueadas por dependencias (F1c) se saltan, como haría una persona.
      const done = (id: string) => isTaskDone(projectState.tasks.get(id)?.status ?? "", projectState.requiresApproval);
      if (blockedBy({ dependsOn: [...task.dependsOn] }, done).length) continue;
      const held = me.inventory.get(task.resource) ?? 0;
      const common = bot.room.state.community.get(task.resource) ?? 0;
      const from = held > 0 && Math.random() < 0.5 ? "player" : common > 0 && Math.random() < 0.2 ? "community" : undefined;
      if (!from) continue;
      bot.room.send(MESSAGE.contribute, {
        requestId: randomUUID(), projectId, taskId, from, amount: from === "player" ? held : common,
      });
      sent.contributions++;
      return 300;
    }
  }
  // Con el taller construido se deposita antes (a partir de 3) para que haya materiales que fabricar.
  const threshold = [...state.structures.values()].some((st) => st.built) ? 3 : config.inventoryMax;
  const full = config.resources.find((r) => (me.inventory.get(r.id) ?? 0) >= threshold);
  if (full) {
    bot.room.send(MESSAGE.transfer, { requestId: randomUUID(), resource: full.id, amount: me.inventory.get(full.id), to: "community" });
    sent.transfers++;
    return 300;
  }
  const available = config.nodes.filter((n) => (bot.room.state.nodes.get(n.id) ?? 0) > 0);
  const distance = (n: { x: number; y: number }) => Math.max(Math.abs(n.x - me.x), Math.abs(n.y - me.y));
  const target = available.sort((a, b) => distance(a) - distance(b))[0];
  if (target && distance(target) === 1) {
    bot.room.send(MESSAGE.collect, { requestId: randomUUID() });
    sent.collects++;
    return config.collectCooldownMs + 50;
  }
  // Acercarse (con algo de azar para salir de bloqueos) o pasear si no hay nodos con unidades.
  const step = !target || Math.random() < 0.2
    ? randomStep()
    : Math.abs(target.x - me.x) >= Math.abs(target.y - me.y)
      ? { dx: Math.sign(target.x - me.x), dy: 0 }
      : { dx: 0, dy: Math.sign(target.y - me.y) };
  bot.room.send(MESSAGE.move, step);
  sent.moves++;
  return 130;
}

/** Un paso del panel: aportar 1 desde la comunidad a una tarea incompleta o revisar una completa. */
function panelAct(): number {
  const state = panel.room.state;
  const projectState = project && state.projects.get(project.id);
  if (!project || !projectState) return 1000;
  for (const task of project.tasks) {
    const remaining = task.required - (projectState.progress.get(task.resource) ?? 0);
    if (remaining > 0 && (state.community.get(task.resource) ?? 0) > 0 && Math.random() < 0.5) {
      panel.room.send(MESSAGE.contribute, { requestId: randomUUID(), projectId: project.id, taskId: task.id, from: "community", amount: 1 });
      sent.panelContributions++;
      return 1000;
    }
    const taskState = projectState.tasks.get(task.id);
    if (remaining <= 0 && taskState?.decision !== "aprobada" && Math.random() < 0.3) {
      const decision = taskState?.decision === "" && Math.random() < 0.5 ? "rechazada" : "aprobada";
      panel.room.send(MESSAGE.review, { requestId: randomUUID(), projectId: project.id, taskId: task.id, decision, note: `soak: ${decision}` });
      sent.reviews++;
      return 1000;
    }
  }
  return 1000;
}

const workers = [...bots.map(async (bot) => {
  while (running) {
    if (paused) { await sleep(50); continue; }
    await sleep(await act(bot));
  }
}), (async () => {
  while (running) {
    if (paused) { await sleep(50); continue; }
    await sleep(panelAct());
  }
})()];

/** Vista completa de un cliente (bot o panel): jugadores con inventario, nodos, comunidad, proyectos y tareas. */
function fullSnapshot(viewer: { room: TestPlayer["room"] }): string {
  const { state } = viewer.room;
  const players = [...state.players.values()]
    .map((p) => `${p.name}@${p.x},${p.y}${p.connected ? "" : "(desc)"}[${[...p.inventory.entries()].sort().join(";")}]`)
    .sort();
  const nodes = [...state.nodes.entries()].sort().join(";");
  const community = [...state.community.entries()].sort().join(";");
  const structures = [...state.structures.entries()].map(([id, s]) => `${id}:${s.x},${s.y}:${s.built}:${s.builtBy}`).sort().join(";") + "|" + [...state.items.keys()].sort().join(",") + "|" + [...state.recipes.keys()].sort().join(",");
  const missions = [...state.missions.entries()].map(([id, m]) => `${id}:${m.status}:${m.completedBy}`).sort().join(";");
  const projects = [...state.projects.entries()].map(([id, p]) =>
    `${id}:${p.status}:${p.phase}:${p.dueDate}/${p.reschedules}:${[...p.progress.entries()].sort().join(";")}:${[...p.contributors.entries()].map(([n, c]) => `${n}=${[...c.totals.entries()].sort().join(",")}`).sort().join("/")}:${p.recent.length}:${[...p.tasks.entries()].map(([t, s]) => `${t}=${s.status}/${s.reviewedBy}/${s.reviewedAt}/${[...s.assignees].join("+")}/${s.comments}`).sort().join(",")}`);
  return `${players.join(" ")} | ${nodes} | ${community} | ${projects.join(" ")} | ${structures} | ${missions}`;
}

const deadline = Date.now() + minutes * 60_000;
let checks = 0;
let failures = 0;
let maxConvergeMs = 0;
console.log(`soak: ${minutes} min, ${bots.length} clientes recolectando, aportando y depositando + 1 panel aportando y revisando, comprobación cada ${CHECK_EVERY_MS / 1000} s`);

while (Date.now() < deadline) {
  await sleep(CHECK_EVERY_MS);
  paused = true;
  await sleep(200); // dejar que lleguen las respuestas en vuelo
  const t0 = performance.now();
  try {
    await waitFor(() => viewers.every((v) => fullSnapshot(v) === fullSnapshot(bots[0]!)), 2000);
    maxConvergeMs = Math.max(maxConvergeMs, performance.now() - t0);
  } catch {
    failures++;
    console.log(`  DIVERGENCIA en la comprobación ${checks + 1}:\n    ${viewers.map(fullSnapshot).join("\n    ")}`);
  }
  checks++;
  paused = false;
  if (checks % 12 === 0) {
    console.log(`  ${Math.round(checks * CHECK_EVERY_MS / 60000)} min: ${checks} comprobaciones, ${failures} divergencias; enviados ${JSON.stringify(sent)}`);
  }
}

running = false;
await Promise.all(workers);
const rejections = bots.reduce((n, b) => n + b.rejections.length, 0);
const panelRejections = panel.rejections.length;
const projectSummary = project ? (() => {
  const { state } = bots[0]!.room;
  const p = state.projects.get(project.id)!;
  return {
    status: p.status, progress: Object.fromEntries(p.progress.entries()),
    built: structure ? state.structures.get(structure.id)?.built : null,
    mission: config.missions[0] ? state.missions.get(config.missions[0].id)?.status : null,
    tools: recipe ? state.community.get(recipe.output.item) ?? 0 : null,
    molino: { built: state.structures.get(molinoId)?.built, status: state.projects.get(molinoId)?.status, harina: state.community.get(harinaId) ?? 0, salvado: state.community.get(salvadoId) ?? 0 },
    horno: { built: state.structures.get(hornoId)?.built, status: state.projects.get(hornoId)?.status, pan: state.community.get(panId) ?? 0 },
    tasks: Object.fromEntries([...p.tasks.entries()].map(([id, t]) => [id, `${t.status}${t.reviewedBy ? ` (${t.reviewedBy})` : ""}`])),
    pozo: { status: state.projects.get(pozoId)?.status, dueDate: state.projects.get(pozoId)?.dueDate, reschedules: state.projects.get(pozoId)?.reschedules, progress: Object.fromEntries(state.projects.get(pozoId)?.progress.entries() ?? []) },
    missions: Object.fromEntries([...state.missions.values()].map((m) => [m.name, m.status])),
  };
})() : null;
const connected = bots.every((b) => b.me().connected);
for (const v of viewers) await v.room.leave();
await server.kill();

const store = openStore(dbPath);
const audit = store.audit();
store.close();
const conserved = audit.balanced;

const result = { minutes, checks, failures, sent, rejections, panelRejections, maxConvergeMs: Math.round(maxConvergeMs), allConnected: connected, project: projectSummary, audit, conserved };
console.log(`RESULTADO ${JSON.stringify(result)}`);
// Ninguna tarea puede recibir más de lo requerido (recorte, Q153).
const withinRequired = !project || project.tasks.every((t) => Number(projectSummary?.progress[t.resource] ?? 0) <= t.required);
console.log(`PROGRESO_DENTRO_DE_LO_REQUERIDO ${withinRequired}`);
process.exit(failures === 0 && connected && conserved && withinRequired ? 0 : 1);
