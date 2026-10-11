import { test } from "node:test";
import assert from "node:assert/strict";
import { createFeed } from "../src/feed.ts";

// Fuente única de eventos del cliente (G3b, P3): un evento llega a la vez al historial y a las notificaciones.

test("feed: una oferta crítica sigue pendiente aunque el historial supere los 200 eventos", () => {
  const feed = createFeed();
  feed.emit({ kind: "oferta", importance: "critica", key: "oferta:o1", text: "ana te ofrece enseñarte Molinero.", actions: [{ id: "aceptar", label: "Aceptar" }] });
  for (let i = 0; i < 250; i++) feed.emit({ kind: "mundo", importance: "normal", text: `evento ${i}` });
  assert.equal(feed.log.size(), 200);
  assert.equal(feed.center.get("oferta:o1")?.state, "pendiente");
  assert.ok(!feed.log.list().some((e) => e.event.text.startsWith("ana te ofrece")), "el historial expulsó lo más antiguo");
});

test("feed: descartar solo oculta; resolver cierra la operación; ninguna borra el historial", () => {
  const feed = createFeed();
  feed.emit({ kind: "oferta", importance: "critica", key: "oferta:a", text: "oferta a" });
  feed.emit({ kind: "oferta", importance: "critica", key: "oferta:b", text: "oferta b" });
  feed.center.dismiss("oferta:a");
  feed.resolve("oferta:b");
  assert.equal(feed.center.get("oferta:a")?.state, "descartada");
  assert.equal(feed.center.get("oferta:b")?.state, "resuelta");
  assert.equal(feed.center.pending().length, 0);
  assert.equal(feed.log.size(), 2);
});

test("feed: las acciones de una notificación llegan al manejador registrado", () => {
  const feed = createFeed();
  const calls: string[] = [];
  feed.setActionHandler((key, action) => { calls.push(`${key}:${action}`); });
  feed.act("oferta:o9", "rechazar");
  assert.deepEqual(calls, ["oferta:o9:rechazar"]);
});

test("feed: markOwn/recentOwn reconocen una acción propia reciente", () => {
  let t = 1000;
  const feed = createFeed(() => t);
  assert.equal(feed.recentOwn("fabricacion"), false);
  feed.markOwn("fabricacion");
  t += 3000;
  assert.equal(feed.recentOwn("fabricacion"), true);
  t += 2000;
  assert.equal(feed.recentOwn("fabricacion"), false);
});
