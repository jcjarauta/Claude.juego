import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { defineServer, defineRoom, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom } from "./WorldRoom.js";
import { openStore } from "./store.js";
import { context } from "./context.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 2567);
// 127.0.0.1 por defecto; HOST=0.0.0.0 para jugar en LAN.
const host = process.env.HOST ?? "127.0.0.1";
const dbPath = process.env.DB_PATH ?? join(root, "data", "spike.db");

const config = JSON.parse(readFileSync(join(root, "config", "world.json"), "utf8"));
if (process.env.REGEN_MS) config.regenIntervalMs = Number(process.env.REGEN_MS);

mkdirSync(dirname(dbPath), { recursive: true });
context.config = config;
context.store = openStore(dbPath);

const server = defineServer({
  greet: false,
  transport: new WebSocketTransport(),
  rooms: { world: defineRoom(WorldRoom) },
  express: (app) => {
    app.get("/config", (req, res) => res.json(config));
    app.use(express.static(join(root, "public")));
  },
});

await server.listen(port, host);
// Los clientes usan join(), nunca joinOrCreate(): un mundo lleno rechaza en vez de duplicarse.
await matchMaker.createRoom("world", {});
console.log(`LISTO http://${host}:${port}`);
