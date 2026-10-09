import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client, type Room } from "@colyseus/sdk";
import { MESSAGE, ROOM_NAME, type RejectReason, type RejectedMessage } from "@juego/shared";

const serverEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
export const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

let nextPort = 3600 + Math.floor(Math.random() * 400);

export interface RunningServer {
  url: string;
  kill: () => Promise<void>;
}

function runServer(env: Record<string, string>) {
  const port = nextPort++;
  const proc = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (c) => { output += c; });
  proc.stderr.on("data", (c) => { output += c; });
  return { proc, port, output: () => output };
}

export function startServer(env: Record<string, string> = {}): Promise<RunningServer> {
  const { proc, port, output } = runServer(env);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`El servidor no arrancó:\n${output()}`)), 15000);
    const check = () => {
      if (!output().includes("LISTO")) return;
      clearTimeout(timer);
      proc.stdout.off("data", check);
      resolve({
        url: `http://127.0.0.1:${port}`,
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

export interface TestPlayer {
  room: Room;
  rejections: RejectReason[];
  me: () => { x: number; y: number; name: string };
}

export async function joinWorld(url: string, name: string): Promise<TestPlayer> {
  const client = new Client(url);
  const room = await client.join(ROOM_NAME, { name });
  const rejections: RejectReason[] = [];
  room.onMessage(MESSAGE.rejected, (msg: RejectedMessage) => rejections.push(msg.reason));
  await waitFor(() => Boolean(room.state?.players?.get(room.sessionId)));
  return { room, rejections, me: () => room.state.players.get(room.sessionId) };
}

export async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: tiempo agotado");
    await new Promise((r) => setTimeout(r, 5));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
