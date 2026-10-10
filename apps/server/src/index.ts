import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineServer, defineRoom, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, type AccountError } from "@juego/shared";
import { createAccounts, type AccountResult } from "./accounts.ts";
import { log } from "./log.ts";
import { WorldRoom } from "./rooms/WorldRoom.ts";
import { mkdirSync } from "node:fs";
import { openStore } from "./store.ts";
import { createProjectCore } from "./projects/core.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { loadWorld, setAccounts, setStore } from "./world.ts";

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
const accounts = createAccounts(store);
setAccounts(accounts);
/** Una consulta de historia por segundo y cuenta (con margen de 2 seguidas). */
const historyLimiter = createRateLimiter(2, 1);

// Lo mínimo que se usa de la petición y la respuesta de Express (llega como dependencia de Colyseus, sin tipos).
interface HttpRequest extends AsyncIterable<Buffer> {
  body?: unknown;
  params?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
}

interface HttpResponse {
  type(contentType: string): HttpResponse;
  set(header: string, value: string): HttpResponse;
  status(code: number): HttpResponse;
  send(body: unknown): unknown;
  json(body: unknown): unknown;
}

// Solo se sirven estos archivos del cliente: lista cerrada, sin rutas arbitrarias.
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/bundle.js": { file: "bundle.js", type: "text/javascript; charset=utf-8" },
  "/bundle.js.map": { file: "bundle.js.map", type: "application/json" },
  // Panel profesional (M5b).
  "/panel": { file: "panel.html", type: "text/html; charset=utf-8" },
  "/panel.js": { file: "panel.js", type: "text/javascript; charset=utf-8" },
  "/panel.js.map": { file: "panel.js.map", type: "application/json" },
};

const MAX_BODY_BYTES = 4096;

/** Cuerpo JSON de una petición, con límite de tamaño (sin depender de express.json). */
async function readJson(req: HttpRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) return req.body as Record<string, unknown>;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("cuerpo-demasiado-grande");
    chunks.push(chunk);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("cuerpo-invalido");
  return parsed as Record<string, unknown>;
}

const STATUS: Partial<Record<AccountError, number>> = { "nombre-ocupado": 409, "credenciales-invalidas": 401, "demasiados-intentos": 429 };

/** Endpoint de cuentas: nunca registra contraseñas ni tokens. */
function accountEndpoint(type: string, action: (body: Record<string, unknown>) => Promise<AccountResult>) {
  return async (req: HttpRequest, res: HttpResponse) => {
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      return res.status(400).json({ error: "solicitud-invalida" });
    }
    try {
      const result = await action(body);
      if (!result.ok) {
        log("warn", type, { error: result.error });
        return res.status(STATUS[result.error] ?? 400).json({ error: result.error });
      }
      log("info", type, { account: result.account.id });
      return res.json({ token: result.token, name: result.account.name });
    } catch (err) {
      log("error", type, { message: (err as Error).message });
      return res.status(500).json({ error: "solicitud-invalida" });
    }
  };
}

const server = defineServer({
  greet: false,
  transport: new WebSocketTransport(),
  rooms: { [ROOM_NAME]: defineRoom(WorldRoom) },
  express: (app) => {
    app.get("/config", (_req: unknown, res: HttpResponse) => res.json(world.config));
    // Cuentas locales (M6, RF-003).
    app.post("/api/registro", accountEndpoint("registro", (b) => accounts.register({ name: b.name, password: b.password, adult: b.adult })));
    app.post("/api/sesion", accountEndpoint("inicio-sesion", (b) => accounts.login({ name: b.name, password: b.password })));
    // Historia de un proyecto para las gráficas (F1b, Q179): token en la cabecera, nunca en la URL.
    app.get("/api/proyectos/:id/historia", (req: HttpRequest, res: HttpResponse) => {
      const header = req.headers.authorization;
      const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;
      const account = accounts.verify(token);
      if (!account) return res.status(401).json({ error: "sesion-invalida" });
      if (!historyLimiter.take(account.id, Date.now())) return res.status(429).json({ error: "demasiadas-solicitudes" });
      // Lectura: un núcleo propio sobre el mismo almacén (sin escritura, sin estado de sala).
      const history = createProjectCore(store, world.config).history(req.params?.id ?? "");
      if (!history) return res.status(404).json({ error: "proyecto-desconocido" });
      return res.json(history);
    });
    // Hilo de comentarios de una tarea (F1c, Q184): mismo control que la historia.
    app.get("/api/proyectos/:id/tareas/:tarea/comentarios", (req: HttpRequest, res: HttpResponse) => {
      const header = req.headers.authorization;
      const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;
      const account = accounts.verify(token);
      if (!account) return res.status(401).json({ error: "sesion-invalida" });
      if (!historyLimiter.take(`c:${account.id}`, Date.now())) return res.status(429).json({ error: "demasiadas-solicitudes" });
      const thread = createProjectCore(store, world.config).comments(req.params?.id ?? "", req.params?.tarea ?? "");
      if (!thread) return res.status(404).json({ error: "tarea-desconocida" });
      return res.json(thread);
    });
    app.post("/api/salir", async (req: HttpRequest, res: HttpResponse) => {
      try {
        accounts.logout((await readJson(req)).token);
      } catch { /* cuerpo inválido: no hay sesión que cerrar */ }
      return res.json({ ok: true });
    });
    for (const [route, { file, type }] of Object.entries(STATIC_FILES)) {
      app.get(route, async (_req: unknown, res: HttpResponse) => {
        try {
          // no-cache: el navegador revalida siempre; así no mezcla una página nueva con un bundle viejo.
          res.type(type).set("Cache-Control", "no-cache").send(await readFile(join(publicDir, file)));
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
log("info", "arranque", { host, port, schema: store.schemaVersion() });
console.log(`LISTO http://${host}:${port}`);
