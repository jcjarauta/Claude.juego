import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineServer, defineRoom, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@juego/shared";
import { WorldRoom } from "./rooms/WorldRoom.ts";
import { mkdirSync } from "node:fs";
import { openStore } from "./store.ts";
import { loadWorld, setStore } from "./world.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const port = Number(process.env.PORT ?? 2567);
// 127.0.0.1 por defecto; HOST=0.0.0.0 para jugar en LAN.
const host = process.env.HOST ?? "127.0.0.1";
const worldPath = process.env.WORLD_CONFIG ?? join(root, "content", "world.json");
const publicDir = join(root, "apps", "client", "public");
// Base de datos del mundo; las pruebas usan una temporal con DB_PATH.
const dbPath = process.env.DB_PATH ?? join(root, "data", "world.db");

function loadOrExit() {
  try {
    return loadWorld(worldPath);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
const world = loadOrExit();
mkdirSync(dirname(dbPath), { recursive: true });
const store = openStore(dbPath);
setStore(store);

// Lo mínimo que se usa de la respuesta de Express (Express llega como dependencia de Colyseus, sin tipos).
interface HttpResponse {
  type(contentType: string): HttpResponse;
  status(code: number): HttpResponse;
  send(body: unknown): unknown;
  json(body: unknown): unknown;
}

// Solo se sirven estos archivos del cliente: lista cerrada, sin rutas arbitrarias.
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/bundle.js": { file: "bundle.js", type: "text/javascript; charset=utf-8" },
  "/bundle.js.map": { file: "bundle.js.map", type: "application/json" },
};

const server = defineServer({
  greet: false,
  transport: new WebSocketTransport(),
  rooms: { [ROOM_NAME]: defineRoom(WorldRoom) },
  express: (app) => {
    app.get("/config", (_req: unknown, res: HttpResponse) => res.json(world.config));
    for (const [route, { file, type }] of Object.entries(STATIC_FILES)) {
      app.get(route, async (_req: unknown, res: HttpResponse) => {
        try {
          res.type(type).send(await readFile(join(publicDir, file)));
        } catch {
          res.status(404).send("No encontrado. ¿Has ejecutado npm.cmd run build?");
        }
      });
    }
  },
});

server.onShutdown(() => store.close());
await server.listen(port, host);
await matchMaker.createRoom(ROOM_NAME, {});
console.log(`LISTO http://${host}:${port}`);
