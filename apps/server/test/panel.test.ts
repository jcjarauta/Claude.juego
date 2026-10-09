import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MAX_PANELS, MAX_PLAYERS, MESSAGE, type ContributionSource } from "@juego/shared";
import { fixture, joinPanel, joinWorld, sleep, startServer, waitFor, type TestPanel, type TestPlayer } from "./helpers.ts";

// Mundo de prueba: aparición (0,0) junto al árbol (1,0); proyecto de 4 madera y 1 piedra; coordinadora: ana.
const WORLD = fixture("regen-world.json");
const PROJECT = "construir-taller";

type Viewer = TestPlayer | TestPanel;
const project = (v: Viewer) => v.room.state.projects.get(PROJECT)!;
const progress = (v: Viewer, resource: string) => project(v).progress.get(resource) ?? 0;
const community = (v: Viewer, id: string) => v.room.state.community.get(id) ?? 0;
const inv = (p: TestPlayer, id: string) => p.me().inventory.get(id) ?? 0;

async function collectWood(p: TestPlayer) {
  const before = inv(p, "madera");
  let lastSent = 0;
  await waitFor(() => {
    if (inv(p, "madera") > before) return true;
    if (Date.now() - lastSent > 150) {
      p.room.send(MESSAGE.collect, { requestId: randomUUID() });
      lastSent = Date.now();
    }
    return false;
  }, 6000);
  await sleep(110);
}

function contribute(v: Viewer, amount: number, from: ContributionSource) {
  v.room.send(MESSAGE.contribute, { requestId: randomUUID(), projectId: PROJECT, taskId: "madera", from, amount });
}

test("TP-15: el panel no tiene personaje; sus aportes y revisiones llegan al mundo y viceversa", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinPanel(server.url, "luis");
    assert.equal(luis.room.state.players.size, 1, "el panel ve el mundo pero no aparece en él");
    assert.equal(ana.room.state.players.size, 1);
    assert.equal(project(luis).tasks.get("madera")!.status, "pendiente");

    // Acciones de mundo desde el panel: rechazadas sin efecto.
    luis.room.send(MESSAGE.move, { dx: 1, dy: 0 });
    luis.room.send(MESSAGE.collect, { requestId: randomUUID() });
    luis.room.send(MESSAGE.transfer, { requestId: randomUUID(), resource: "madera", amount: 1, to: "community" });
    luis.room.send(MESSAGE.build, { requestId: randomUUID(), structureId: "taller" });
    luis.room.send(MESSAGE.craft, { requestId: randomUUID(), recipeId: "herramienta" });
    await waitFor(() => luis.rejections.filter((r) => r === "sin-personaje").length === 5);

    // Del mundo al panel: ana deposita en la comunidad; luis aporta desde el panel.
    await collectWood(ana);
    await collectWood(ana);
    ana.room.send(MESSAGE.transfer, { requestId: randomUUID(), resource: "madera", amount: 1, to: "community" });
    await waitFor(() => community(luis, "madera") === 1);
    contribute(luis, 1, "community");
    await waitFor(() => progress(ana, "madera") === 1 && community(ana, "madera") === 0);
    assert.equal(project(ana).contributors.get("luis")?.totals.get("madera"), 1);
    assert.equal(project(ana).recent.at(-1)?.name, "luis");
    assert.equal(project(ana).tasks.get("madera")!.status, "en-curso");

    // Del mundo al panel: ana aporta con su personaje.
    contribute(ana, 1, "player");
    await waitFor(() => progress(luis, "madera") === 2);

    // luis no tiene inventario ni es coordinador.
    contribute(luis, 1, "player");
    await waitFor(() => luis.rejections.includes("saldo-insuficiente"));
    luis.room.send(MESSAGE.review, { requestId: randomUUID(), projectId: PROJECT, taskId: "madera", decision: "aprobada", note: "Bien" });
    await waitFor(() => luis.rejections.includes("sin-permiso"));

    // ana también abre el panel: aporta desde su inventario (su personaje lo ve) y revisa como coordinadora.
    const anaPanel = await joinPanel(server.url, "ana");
    await collectWood(ana);
    await collectWood(ana);
    await waitFor(() => inv(ana, "madera") === 2);
    contribute(anaPanel, 2, "player");
    await waitFor(() => inv(ana, "madera") === 0 && progress(ana, "madera") === 4);
    await waitFor(() => project(anaPanel).tasks.get("madera")!.status === "completada");
    anaPanel.room.send(MESSAGE.review, { requestId: randomUUID(), projectId: PROJECT, taskId: "madera", decision: "aprobada", note: "Recuento correcto" });
    await waitFor(() => project(ana).tasks.get("madera")!.status === "aprobada");
    assert.equal(project(luis).tasks.get("madera")!.reviewedBy, "ana");

    await anaPanel.room.leave();
    await luis.room.leave();
    await ana.room.leave();
  } finally {
    await server.kill();
  }
});

test("TP-15 plazas: los paneles no ocupan plaza de jugador y tienen su propio límite", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD });
  try {
    const players: TestPlayer[] = [];
    for (let i = 1; i <= MAX_PLAYERS; i++) players.push(await joinWorld(server.url, `p${i}`));
    await assert.rejects(joinWorld(server.url, "p5"), /mundo-lleno/, "un quinto jugador no entra");

    const panels: TestPanel[] = [];
    for (let i = 1; i <= MAX_PANELS; i++) panels.push(await joinPanel(server.url, `panel${i}`));
    await assert.rejects(joinPanel(server.url, "panel5"), "un quinto panel no entra");
    assert.equal(panels[0]!.room.state.players.size, MAX_PLAYERS);

    // Al salir un panel queda su plaza libre; al salir un jugador, la suya.
    await panels.pop()!.room.leave();
    await sleep(200);
    panels.push(await joinPanel(server.url, "panel5"));
    await players.pop()!.room.leave();
    await waitFor(() => panels[0]!.room.state.players.size === MAX_PLAYERS - 1);
    players.push(await joinWorld(server.url, "p5"));
    for (const v of [...players, ...panels]) await v.room.leave();
  } finally {
    await server.kill();
  }
});
