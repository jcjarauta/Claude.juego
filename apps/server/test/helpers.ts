import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type Room } from "@colyseus/sdk";
import { MESSAGE, ROOM_NAME, WorldState, type Player, type RejectReason, type RejectedMessage } from "@juego/shared";

const serverEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
export const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Base de datos temporal: las pruebas nunca tocan data/world.db. */
export const tempDb = () => join(mkdtempSync(join(tmpdir(), "juego-test-")), "world.db");

// Rango sin puertos bloqueados por fetch (p. ej. 3659 está en la lista de puertos prohibidos).
let nextPort = 42000 + Math.floor(Math.random() * 2000);

export interface RunningServer {
  url: string;
  kill: () => Promise<void>;
  /** Salida completa del proceso (logs incluidos). */
  output: () => string;
}

function runServer(env: Record<string, string>) {
  const port = nextPort++;
  const proc = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DB_PATH: tempDb(), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (c) => { output += c; });
  proc.stderr.on("data", (c) => { output += c; });
  return { proc, port, output: () => output };
}

/** Arranca un servidor de prueba; si el puerto elegido está ocupado, reintenta con otro. */
export async function startServer(env: Record<string, string> = {}, attempts = 3): Promise<RunningServer> {
  try {
    return await startServerOnce(env);
  } catch (err) {
    if (attempts > 1 && String((err as Error).message).includes("EADDRINUSE")) return startServer(env, attempts - 1);
    throw err;
  }
}

function startServerOnce(env: Record<string, string>): Promise<RunningServer> {
  const { proc, port, output } = runServer(env);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`El servidor no arrancó:\n${output()}`)), 15000);
    const check = () => {
      if (!output().includes("LISTO")) return;
      clearTimeout(timer);
      proc.stdout.off("data", check);
      resolve({
        url: `http://127.0.0.1:${port}`,
        output,
        kill: () => new Promise((done) => { proc.once("exit", () => done()); proc.kill("SIGKILL"); }),
      });
    };
    proc.stdout.on("data", check);
    proc.once("exit", (code) => { clearTimeout(timer); if (!output().includes("LISTO")) reject(new Error(`Servidor terminó (${code}):\n${output()}`)); });
  });
}

/** Arranca el servidor esperando que falle; devuelve código de salida y salida completa. */
export function startServerExpectingFailure(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  const { proc, output } = runServer(env);
  return new Promise((resolve) => proc.once("exit", (code) => resolve({ code, output: output() })));
}

/** Contraseña de las cuentas de prueba: solo existe en bases temporales. */
const TEST_PASSWORD = `prueba-${Math.random().toString(36).slice(2)}-clave`;

/** Crea la cuenta de prueba (o entra si ya existe) y devuelve su token de sesión. */
export async function sessionFor(url: string, name: string, password = TEST_PASSWORD): Promise<string> {
  const post = (path: string, body: unknown) => fetch(`${url}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  let res = await post("/api/registro", { name, password, adult: true });
  if (res.status === 409) res = await post("/api/sesion", { name, password });
  const data = await res.json() as { token?: string; error?: string };
  if (!data.token) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.token;
}

export interface TestPlayer {
  room: Room<unknown, WorldState>;
  rejections: RejectReason[];
  me: () => Player;
}

export async function joinWorld(url: string, name: string): Promise<TestPlayer> {
  const token = await sessionFor(url, name);
  const room = await new Client(url).join(ROOM_NAME, { token }, WorldState);
  const rejections: RejectReason[] = [];
  room.onMessage(MESSAGE.rejected, (msg: RejectedMessage) => rejections.push(msg.reason));
  await waitFor(() => Boolean(room.state?.players?.get(room.sessionId)));
  return { room, rejections, me: () => room.state.players.get(room.sessionId)! };
}

export interface TestPanel {
  room: Room<unknown, WorldState>;
  rejections: RejectReason[];
}

/** Entra como panel profesional (M5b): observador sin personaje. */
export async function joinPanel(url: string, name: string): Promise<TestPanel> {
  const token = await sessionFor(url, name);
  const room = await new Client(url).join(ROOM_NAME, { token, view: "panel" }, WorldState);
  const rejections: RejectReason[] = [];
  room.onMessage(MESSAGE.rejected, (msg: RejectedMessage) => rejections.push(msg.reason));
  await waitFor(() => Boolean(room.state?.projects?.size));
  return { room, rejections };
}

/** Vuelve a la sala con el token de una sesión cortada (como hace el SDK al reconectar). */
export async function reconnectWorld(url: string, reconnectionToken: string): Promise<TestPlayer> {
  const room = await new Client(url).reconnect(reconnectionToken, WorldState);
  const rejections: RejectReason[] = [];
  room.onMessage(MESSAGE.rejected, (msg: RejectedMessage) => rejections.push(msg.reason));
  await waitFor(() => Boolean(room.state?.players?.get(room.sessionId)));
  return { room, rejections, me: () => room.state.players.get(room.sessionId)! };
}

/** Vista de un cliente: nombre → posición y conexión, ordenada para comparar. */
export function snapshot(player: TestPlayer): string {
  const rows = [...player.room.state.players.values()].map((p) => `${p.name}@${p.x},${p.y}${p.connected ? "" : "(desc)"}`);
  return rows.sort().join(" ");
}

export async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: tiempo agotado");
    await new Promise((r) => setTimeout(r, 5));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
