// Prueba de carga (umbral de docs/pruebas.md §3): 4 clientes caminando al azar durante
// SOAK_MINUTES (15 por defecto). Cada 5 s se detienen y se exige que todos vean el mismo
// estado. No forma parte de `npm.cmd test`; se ejecuta con `npm.cmd run soak`.
import { MESSAGE, type MoveMessage } from "@juego/shared";
import { joinWorld, sleep, snapshot, startServer, waitFor, type TestPlayer } from "../apps/server/test/helpers.ts";

const minutes = Number(process.env.SOAK_MINUTES ?? 15);
const CHECK_EVERY_MS = 5000;
const STEPS: MoveMessage[] = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

const server = await startServer();
const bots: TestPlayer[] = [];
for (const name of ["bot1", "bot2", "bot3", "bot4"]) bots.push(await joinWorld(server.url, name));

let walking = true;
let moves = 0;
const walkers = bots.map(async (bot) => {
  while (walking) {
    bot.room.send(MESSAGE.move, STEPS[Math.floor(Math.random() * STEPS.length)]!);
    moves++;
    await sleep(120 + Math.floor(Math.random() * 60));
  }
});

const deadline = Date.now() + minutes * 60_000;
let checks = 0;
let failures = 0;
let maxConvergeMs = 0;
console.log(`soak: ${minutes} min, ${bots.length} clientes, comprobación cada ${CHECK_EVERY_MS / 1000} s`);

while (Date.now() < deadline) {
  await sleep(CHECK_EVERY_MS);
  // Pausa breve: los bots no envían durante la comprobación.
  const paused = bots.map((b) => b.room.send.bind(b.room));
  for (const b of bots) b.room.send = (() => {}) as typeof b.room.send;
  const t0 = performance.now();
  try {
    await waitFor(() => bots.every((b) => snapshot(b) === snapshot(bots[0]!)), 2000);
    maxConvergeMs = Math.max(maxConvergeMs, performance.now() - t0);
  } catch {
    failures++;
    console.log(`  DIVERGENCIA en la comprobación ${checks + 1}:\n    ${bots.map(snapshot).join("\n    ")}`);
  }
  checks++;
  bots.forEach((b, i) => { b.room.send = paused[i]!; });
  if (checks % 12 === 0) console.log(`  ${Math.round(checks * CHECK_EVERY_MS / 60000)} min: ${checks} comprobaciones, ${failures} divergencias, ${moves} movimientos enviados`);
}

walking = false;
await Promise.all(walkers);
const rejections = bots.reduce((n, b) => n + b.rejections.length, 0);
const connected = bots.every((b) => b.me().connected);
for (const b of bots) await b.room.leave();
await server.kill();

const result = { minutes, checks, failures, moves, rejections, maxConvergeMs: Math.round(maxConvergeMs), allConnected: connected };
console.log(`RESULTADO ${JSON.stringify(result)}`);
process.exit(failures === 0 && connected ? 0 : 1);
