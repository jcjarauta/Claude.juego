import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { achievedIds, achievementSnapshotFromState, creditText, evaluateAchievements, MESSAGE, type AchievementState, type MoveMessage } from "@juego/shared";
import { fixture, joinWorld, sleep, startServer, tempDb, waitFor, type TestPlayer } from "./helpers.ts";

// G3d, P0 (TP-30): los logros calculados sobre el estado de una SALA REAL (mismos datos que ve la interfaz). Mundo de prueba 6×5:
// aparición (0,0), árbol (1,0), administración: ana. ana crea el proyecto y la misión; luis aporta y construye.
const WORLD = fixture("regen-world.json");
const send = (p: TestPlayer, type: string, fields: Record<string, unknown> = {}) => p.room.send(type, { requestId: randomUUID(), ...fields });
const states = (p: TestPlayer): AchievementState[] => evaluateAchievements(achievementSnapshotFromState(p.room.state, p.room.sessionId));
const get = (list: readonly AchievementState[], id: string) => list.find((s) => s.id === id)!;
const wood = (p: TestPlayer) => p.me().inventory.get("madera") ?? 0;

async function collectWood(p: TestPlayer) {
  const before = wood(p);
  let last = 0;
  await waitFor(() => {
    if (wood(p) > before) return true;
    if (Date.now() - last > 150) { send(p, MESSAGE.collect); last = Date.now(); }
    return false;
  }, 6000);
  await sleep(110);
}

async function walk(p: TestPlayer, steps: MoveMessage[]) {
  for (const step of steps) {
    const { x, y } = p.me();
    p.room.send(MESSAGE.move, step);
    await waitFor(() => p.me().x === x + step.dx && p.me().y === y + step.dy, 2000);
    await sleep(110);
  }
}

test("TP-30: los logros se derivan del estado de una sala real (construir, misión, aporte a un proyecto ajeno) y las dos sesiones ven lo mismo", async () => {
  const server = await startServer({ WORLD_CONFIG: WORLD, DB_PATH: tempDb() });
  try {
    const ana = await joinWorld(server.url, "ana");
    const luis = await joinWorld(server.url, "luis");

    // Estado inicial: nada conseguido salvo lo que no depende de la persona (nada).
    assert.deepEqual(achievedIds(states(ana)), []);
    assert.deepEqual(achievedIds(states(luis)), []);

    // ana (administración) crea un edificio con un proyecto de 2 de madera y una misión que pide completarlo.
    send(ana, MESSAGE.createConstruction, { name: "Molino", description: "", x: 4, y: 0, width: 1, height: 1, color: "#3366cc", tasks: [{ title: "Madera", resource: "madera", required: 2 }] });
    await waitFor(() => [...luis.room.state.structures.values()].some((s) => s.name === "Molino"));
    const [molinoId, molino] = [...luis.room.state.structures.entries()].find(([, s]) => s.name === "Molino")!;
    await sleep(1100); // el limitador admite 8 operaciones por segundo
    send(ana, MESSAGE.createMission, { name: "Molino en marcha", description: "", objective: { kind: "project-completed", project: molino.projectId } });
    await waitFor(() => [...luis.room.state.missions.values()].some((m) => m.name === "Molino en marcha"));

    // Aportan las dos personas (una unidad cada una): ninguna construyó aún.
    await collectWood(ana);
    await collectWood(luis);
    send(ana, MESSAGE.contribute, { projectId: molino.projectId, taskId: "madera", from: "player", amount: 1 });
    send(luis, MESSAGE.contribute, { projectId: molino.projectId, taskId: "madera", from: "player", amount: 1 });
    await waitFor(() => luis.room.state.projects.get(molino.projectId)!.status === "listo");

    // Antes de construir: aportes y cooperación ya constan; edificio y misión, no.
    const beforeBuild = states(luis);
    assert.equal(get(beforeBuild, "primer-aporte@1").status, "conseguido");
    assert.equal(get(beforeBuild, "aporte-ajeno@1").status, "conseguido", "luis aportó a un proyecto creado por ana");
    assert.equal(get(states(ana), "aporte-ajeno@1").status, "pendiente", "ana aportó a su propio proyecto");
    assert.equal(get(beforeBuild, "primer-edificio@1").status, "pendiente");
    assert.equal(get(beforeBuild, "proyecto-colectivo@1").status, "en-progreso");
    assert.deepEqual(get(beforeBuild, "proyecto-colectivo@1").progress, { done: 2, total: 3 });

    // luis construye (junto al solar, en diagonal) y la misión se completa.
    await walk(luis, [{ dx: 0, dy: 1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 1, dy: 0 }]);
    send(luis, MESSAGE.build, { structureId: molinoId });
    await waitFor(() => luis.room.state.structures.get(molinoId)!.built);
    await waitFor(() => [...ana.room.state.missions.values()].some((m) => m.status === "completada"));

    for (const who of [ana, luis]) {
      const list = states(who);
      const building = get(list, "primer-edificio@1");
      assert.equal(building.status, "conseguido");
      // Tres papeles distintos: creó ana, construyó luis, aportaron ana y luis (alfabético). El texto no atribuye todo a luis.
      assert.deepEqual(building.credits, [{ what: "Molino", creadoPor: "ana", ejecutadoPor: "luis", aportaron: ["ana", "luis"] }]);
      assert.equal(creditText(building.credits[0]!, "Construido"), "Molino: Creado por ana. Construido por luis con la aportación de ana y luis.");
      const mission = get(list, "primera-mision@1");
      assert.equal(mission.status, "conseguido");
      assert.equal(mission.credits[0]!.creadoPor, "ana");
      assert.equal(mission.credits[0]!.ejecutadoPor, "luis");
      assert.deepEqual(mission.credits[0]!.aportaron, ["ana", "luis"], "las aportaciones salen del proyecto de la misión, no solo de quien la completó");
      // El conjunto inicial (el Taller de la configuración, sin construir) no se completa por construir uno del panel.
      const initial = get(list, "edificios-iniciales@1");
      assert.equal(initial.status, "pendiente");
      assert.deepEqual(initial.progress, { done: 0, total: 1 });
      assert.equal(initial.set, "conjunto inicial");
    }
    // Lo verificable por la comunidad es igual en las dos sesiones.
    const community = (list: AchievementState[]) => JSON.stringify(list.filter((s) => s.group === "comunidad"));
    assert.equal(community(states(ana)), community(states(luis)));
    await ana.room.leave();
    await luis.room.leave();
  } finally {
    await server.kill();
  }
});
