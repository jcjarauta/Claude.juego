import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Callbacks } from "@colyseus/sdk";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let nextPort = 3100 + Math.floor(Math.random() * 500);

export const NODE_ID = "arbol-1";
export const tempDb = () => join(mkdtempSync(join(tmpdir(), "spike-bl02-")), "test.db");

export function startServer({ dbPath, port = nextPort++, env = {} }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(root, "server", "index.js")], {
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DB_PATH: dbPath, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => reject(new Error(`El servidor no arrancó:\n${output}`)), 15000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes("LISTO")) {
        clearTimeout(timer);
        resolve({
          url: `http://127.0.0.1:${port}`,
          port,
          // Parada brusca: simula una caída; nada se guarda al salir.
          kill: () => new Promise((done) => { proc.once("exit", done); proc.kill("SIGKILL"); }),
        });
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.once("exit", (code) => { clearTimeout(timer); if (!output.includes("LISTO")) reject(new Error(`Servidor terminó (${code}):\n${output}`)); });
  });
}

export async function joinWorld(url, name) {
  const client = new Client(url);
  const room = await client.join("world", { name });
  const rejections = [];
  room.onMessage("rejected", (msg) => rejections.push(msg.reason));
  await waitFor(() => room.state.players?.get(room.sessionId) && room.state.nodes?.get(NODE_ID));
  return { room, rejections, callbacks: Callbacks.get(room), me: () => room.state.players.get(room.sessionId), node: () => room.state.nodes.get(NODE_ID) };
}

export async function waitFor(predicate, timeoutMs = 5000, stepMs = 5) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: tiempo agotado");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Camina paso a paso, esperando la confirmación del servidor en cada casilla.
export async function walkTo(player, tx, ty) {
  while (player.me().x !== tx || player.me().y !== ty) {
    const { x, y } = player.me();
    const dx = Math.sign(tx - x);
    const dy = dx !== 0 ? 0 : Math.sign(ty - y);
    player.room.send("move", { dx, dy });
    await waitFor(() => player.me().x === x + dx && player.me().y === y + dy, 2000);
    await sleep(110);
  }
}

export async function collect(player) {
  const before = player.me().madera;
  player.room.send("collect", { nodeId: NODE_ID });
  await waitFor(() => player.me().madera === before + 1, 2000);
}
