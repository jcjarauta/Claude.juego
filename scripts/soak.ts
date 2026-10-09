// Prueba de carga (umbral de docs/pruebas.md §3): 4 clientes durante SOAK_MINUTES (15 por
// defecto) caminan hacia el nodo con unidades más cercano, recolectan, aportan al proyecto lo
// que aún necesita (desde su inventario o desde el almacén común) y depositan en la comunidad
// al llenar el inventario. Cada 5 s se detienen y se exige que todos vean el mismo
// estado (posiciones, inventarios, nodos y comunidad). Al final se audita la base de datos:
// lo recolectado según el registro de eventos debe coincidir con lo que hay en inventarios.
// No forma parte de `npm.cmd test`; se ejecuta con `npm.cmd run soak`.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { MESSAGE, type MoveMessage, type WorldConfig } from "@juego/shared";
import { openStore } from "../apps/server/src/store.ts";
import { joinWorld, sleep, startServer, tempDb, waitFor, type TestPlayer } from "../apps/server/test/helpers.ts";

const minutes = Number(process.env.SOAK_MINUTES ?? 15);
const CHECK_EVERY_MS = 5000;
const config = JSON.parse(readFileSync(new URL("../content/world.json", import.meta.url), "utf8")) as WorldConfig;
const STEPS: MoveMessage[] = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
const randomStep = () => STEPS[Math.floor(Math.random() * STEPS.length)]!;

const dbPath = tempDb();
const server = await startServer({ DB_PATH: dbPath });
const bots: TestPlayer[] = [];
for (const name of ["bot1", "bot2", "bot3", "bot4"]) bots.push(await joinWorld(server.url, name));

let running = true;
let paused = false;
const sent = { moves: 0, collects: 0, transfers: 0, contributions: 0 };
const project = config.projects[0];

/** Un paso del bot: depositar si está lleno, recolectar si tiene un nodo al lado, o acercarse. */
async function act(bot: TestPlayer) {
  const me = bot.me();
  const projectState = project && bot.room.state.projects.get(project.id);
  if (project && projectState) {
    for (const task of project.tasks) {
      if (task.required - (projectState.progress.get(task.resource) ?? 0) <= 0) continue;
      const held = me.inventory.get(task.resource) ?? 0;
      const common = bot.room.state.community.get(task.resource) ?? 0;
      const from = held > 0 && Math.random() < 0.5 ? "player" : common > 0 && Math.random() < 0.2 ? "community" : undefined;
      if (!from) continue;
      bot.room.send(MESSAGE.contribute, {
        requestId: randomUUID(), projectId: project.id, taskId: task.id, from, amount: from === "player" ? held : common,
      });
      sent.contributions++;
      return 300;
    }
  }
  const full = config.resources.find((r) => (me.inventory.get(r.id) ?? 0) >= config.inventoryMax);
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

const workers = bots.map(async (bot) => {
  while (running) {
    if (paused) { await sleep(50); continue; }
    await sleep(await act(bot));
  }
});

/** Vista completa de un cliente: jugadores con inventario, nodos y comunidad. */
function fullSnapshot(bot: TestPlayer): string {
  const { state } = bot.room;
  const players = [...state.players.values()]
    .map((p) => `${p.name}@${p.x},${p.y}${p.connected ? "" : "(desc)"}[${[...p.inventory.entries()].sort().join(";")}]`)
    .sort();
  const nodes = [...state.nodes.entries()].sort().join(";");
  const community = [...state.community.entries()].sort().join(";");
  const projects = [...state.projects.entries()].map(([id, p]) =>
    `${id}:${p.status}:${[...p.progress.entries()].sort().join(";")}:${[...p.contributors.entries()].map(([n, c]) => `${n}=${[...c.totals.entries()].sort().join(",")}`).sort().join("/")}:${p.recent.length}`);
  return `${players.join(" ")} | ${nodes} | ${community} | ${projects.join(" ")}`;
}

const deadline = Date.now() + minutes * 60_000;
let checks = 0;
let failures = 0;
let maxConvergeMs = 0;
console.log(`soak: ${minutes} min, ${bots.length} clientes recolectando, aportando y depositando, comprobación cada ${CHECK_EVERY_MS / 1000} s`);

while (Date.now() < deadline) {
  await sleep(CHECK_EVERY_MS);
  paused = true;
  await sleep(200); // dejar que lleguen las respuestas en vuelo
  const t0 = performance.now();
  try {
    await waitFor(() => bots.every((b) => fullSnapshot(b) === fullSnapshot(bots[0]!)), 2000);
    maxConvergeMs = Math.max(maxConvergeMs, performance.now() - t0);
  } catch {
    failures++;
    console.log(`  DIVERGENCIA en la comprobación ${checks + 1}:\n    ${bots.map(fullSnapshot).join("\n    ")}`);
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
const projectSummary = project ? (() => {
  const p = bots[0]!.room.state.projects.get(project.id)!;
  return { status: p.status, progress: Object.fromEntries(p.progress.entries()) };
})() : null;
const connected = bots.every((b) => b.me().connected);
for (const b of bots) await b.room.leave();
await server.kill();

const store = openStore(dbPath);
const audit = store.audit();
store.close();
const resources = new Set([...Object.keys(audit.collected), ...Object.keys(audit.inInventories)]);
const conserved = [...resources].every((r) => (audit.collected[r] ?? 0) === (audit.inInventories[r] ?? 0));

const result = { minutes, checks, failures, sent, rejections, maxConvergeMs: Math.round(maxConvergeMs), allConnected: connected, project: projectSummary, audit, conserved };
console.log(`RESULTADO ${JSON.stringify(result)}`);
// Ninguna tarea puede recibir más de lo requerido (recorte, Q153).
const withinRequired = !project || project.tasks.every((t) => Number(projectSummary?.progress[t.resource] ?? 0) <= t.required);
console.log(`PROGRESO_DENTRO_DE_LO_REQUERIDO ${withinRequired}`);
process.exit(failures === 0 && connected && conserved && withinRequired ? 0 : 1);
