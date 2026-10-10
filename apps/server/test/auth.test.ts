import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@colyseus/sdk";
import { MESSAGE, ROOM_NAME, WorldState } from "@juego/shared";
import { openStore } from "../src/store.ts";
import { fixture, joinWorld, sessionFor, sleep, startServer, tempDb, waitFor, type TestPlayer } from "./helpers.ts";

// Mundo de prueba (regeneración 1/s): aparición (0,0) junto al árbol (1,0); coordinadora: ana.
const WORLD = fixture("regen-world.json");
const PROJECT = "construir-taller";
// Contraseñas de prueba generadas aquí; solo existen en bases temporales.
const secret = () => `prueba-${randomUUID()}`;

const post = (url: string, path: string, body: unknown) => fetch(`${url}${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
});

test("TP-03: sin sesión válida no se entra; el nombre sale de la cuenta; cerrar sesión invalida el token", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const client = new Client(server.url);
    await assert.rejects(client.join(ROOM_NAME, {}, WorldState), /sesion-invalida/);
    await assert.rejects(client.join(ROOM_NAME, { token: "inventado-inventado-inventado" }, WorldState), /sesion-invalida/);
    await assert.rejects(client.join(ROOM_NAME, { token: "x", view: "panel" }, WorldState), /sesion-invalida/);

    // Opciones del cliente con otro nombre: se ignoran.
    const token = await sessionFor(server.url, "ana");
    const room = await client.join(ROOM_NAME, { token, name: "bea" } as never, WorldState);
    await waitFor(() => Boolean(room.state.players.get(room.sessionId)));
    assert.equal(room.state.players.get(room.sessionId)!.name, "ana");
    await room.leave();

    const res = await post(server.url, "/api/salir", { token });
    assert.equal(res.status, 200);
    await assert.rejects(client.join(ROOM_NAME, { token }, WorldState), /sesion-invalida/);
  } finally {
    await server.kill();
  }
});

test("TP-03: nadie revisa como coordinadora sin su contraseña; las cuentas no se pueden suplantar", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const anaPassword = secret();
    await sessionFor(server.url, "ana", anaPassword);
    await assert.rejects(sessionFor(server.url, "ana", secret()), /credenciales-invalidas/);
    await assert.rejects(sessionFor(server.url, "ANA", secret()), /credenciales-invalidas/, "tampoco con mayúsculas (Q155)");

    const luis = await joinWorld(server.url, "luis");
    luis.room.send(MESSAGE.review, { requestId: randomUUID(), projectId: PROJECT, taskId: "madera", decision: "aprobada", note: "Bien" });
    await waitFor(() => luis.rejections.includes("sin-permiso"));
    await luis.room.leave();
  } finally {
    await server.kill();
  }
});

test("endpoints de cuentas: validación, códigos HTTP y bloqueo tras 5 fallos", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const password = secret();
    const status = async (path: string, body: unknown) => {
      const res = await post(server.url, path, body);
      return [res.status, ((await res.json()) as { error?: string }).error];
    };
    assert.deepEqual(await status("/api/registro", { name: "eva", password, adult: false }), [400, "edad-no-declarada"]);
    assert.deepEqual(await status("/api/registro", { name: "eva", password: "corta", adult: true }), [400, "contrasena-invalida"]);
    assert.deepEqual(await status("/api/registro", "{no es json"), [400, "solicitud-invalida"]);
    assert.deepEqual(await status("/api/registro", { name: "eva", password: "x".repeat(5000), adult: true }), [400, "solicitud-invalida"], "cuerpo > 4 KB");
    assert.deepEqual(await status("/api/registro", { name: "eva", password, adult: true }), [200, undefined]);
    assert.deepEqual(await status("/api/registro", { name: "Eva", password, adult: true }), [409, "nombre-ocupado"]);
    for (let i = 0; i < 5; i++) assert.deepEqual(await status("/api/sesion", { name: "eva", password: "incorrecta" }), [401, "credenciales-invalidas"]);
    assert.deepEqual(await status("/api/sesion", { name: "eva", password }), [429, "demasiados-intentos"]);
  } finally {
    await server.kill();
  }
});

test("logs estructurados sin contraseñas ni tokens", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const password = secret();
    const token = await sessionFor(server.url, "ana", password);
    await post(server.url, "/api/sesion", { name: "ana", password: "incorrecta" });
    await assert.rejects(new Client(server.url).join(ROOM_NAME, { token: "inventado-inventado-inventado" }, WorldState));
    await sleep(200);
    const output = server.output();
    assert.equal(output.includes(password), false, "la contraseña no aparece en los logs");
    assert.equal(output.includes(token), false, "el token no aparece en los logs");
    const lines = output.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as { level: string; type: string });
    for (const type of ["arranque", "registro", "inicio-sesion", "sesion-invalida"]) {
      assert.ok(lines.some((l) => l.type === type), `falta el registro «${type}»`);
    }
  } finally {
    await server.kill();
  }
});

test("Q167: una ráfaga de operaciones se limita a 8 por segundo y la auditoría sigue cuadrando", async () => {
  const dbPath = tempDb();
  const server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: dbPath });
  try {
    const ana: TestPlayer = await joinWorld(server.url, "ana");
    ana.room.send(MESSAGE.move, { dx: 1, dy: 0 }); // mirar al árbol
    for (let i = 0; i < 3; i++) {
      const before = ana.me().inventory.get("madera") ?? 0;
      let last = 0;
      await waitFor(() => {
        if ((ana.me().inventory.get("madera") ?? 0) > before) return true;
        if (Date.now() - last > 150) { ana.room.send(MESSAGE.collect, { requestId: randomUUID() }); last = Date.now(); }
        return false;
      }, 6000);
    }
    await sleep(1100); // cubo lleno
    for (let i = 0; i < 50; i++) {
      ana.room.send(MESSAGE.contribute, { requestId: randomUUID(), projectId: PROJECT, taskId: "madera", from: "player", amount: 1 });
    }
    await waitFor(() => ana.rejections.filter((r) => r === "demasiadas-solicitudes").length >= 40);
    await sleep(300);
    assert.equal(ana.room.state.projects.get(PROJECT)!.progress.get("madera"), 3, "solo cuentan los aportes con saldo");
    await ana.room.leave();
  } finally {
    await server.kill();
  }
  const store = openStore(dbPath);
  assert.equal(store.audit().balanced, true);
  store.close();
});
