// Datos de prueba para recorrer la interfaz a mano o con el guion scripts/ui-smoke.js (G3b).
// Uso (dos terminales; todo con base de datos temporal, nunca la tuya):
//   1) servidor:  PORT=2568 DB_PATH=<base temporal> WORLD_CONFIG=apps/server/test/fixtures/ui-world.json node apps/server/src/index.ts
//   2) siembra:   node scripts/ui-seed.ts http://127.0.0.1:2568
// Crea un mundo de prueba con el Taller y el Molino ya construidos, la habilidad «Molinero» (Aprendiz y Oficial),
// existencias en el almacén y tres cuentas de PRUEBA (contraseña fija de prueba, solo válida en esa base).
import { randomUUID } from "node:crypto";
import { Client } from "@colyseus/sdk";
import { MESSAGE, ROOM_NAME, WorldState, type MoveMessage } from "@juego/shared";
import { sleep, waitFor } from "../apps/server/test/helpers.ts";

const url = process.argv[2] ?? "http://127.0.0.1:2568";
const PASSWORD = "prueba-ui-g3b-clave";

async function login(name: string): Promise<string> {
  const post = (path: string) => fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, password: PASSWORD, adult: true }) });
  let res = await post("/api/registro");
  if (res.status === 409) res = await post("/api/sesion");
  const data = await res.json() as { token?: string; error?: string };
  if (!data.token) throw new Error(`${name}: ${data.error ?? res.status}`);
  return data.token;
}
type Room = Awaited<ReturnType<Client["join"]>> & { state: WorldState };
async function join(name: string, view?: "panel") {
  const room = await new Client(url).join(ROOM_NAME, { token: await login(name), ...(view ? { view } : {}) }, WorldState) as unknown as Room;
  await waitFor(() => Boolean(view ? room.state?.projects?.size : room.state?.players?.get(room.sessionId)));
  return room;
}
const send = (room: Room, type: string, fields: Record<string, unknown>) => room.send(type, { requestId: randomUUID(), ...fields });
const named = <T extends { name: string }>(m: Map<string, T>, name: string) => [...m.entries()].find(([, e]) => e.name === name)?.[0];

const R = { dx: 1, dy: 0 }, D = { dx: 0, dy: 1 }, U = { dx: 0, dy: -1 };
const me = (room: Room) => room.state.players.get(room.sessionId)!;
async function go(room: Room, moves: MoveMessage[]) {
  for (const move of moves) {
    const { x, y } = me(room);
    room.send(MESSAGE.move, move);
    await waitFor(() => me(room).x === x + move.dx && me(room).y === y + move.dy, 3000);
    await sleep(130);
  }
}
/** Mirar hacia un nodo bloqueado (el movimiento falla pero fija la dirección) y recolectar hasta tener `amount`. */
async function collect(room: Room, face: MoveMessage, resource: string, amount: number) {
  room.send(MESSAGE.move, face);
  await sleep(200);
  let last = 0;
  await waitFor(() => {
    if ((me(room).inventory.get(resource) ?? 0) >= amount) return true;
    if (Date.now() - last > 140) { room.send(MESSAGE.collect, { requestId: randomUUID() }); last = Date.now(); }
    return false;
  }, 40000);
}

const admin = await join("coordinacion", "panel");

// Diseño desde el panel: objeto, construcción, recetas y habilidad.
send(admin, MESSAGE.createItem, { name: "Harina" });
await waitFor(() => admin.state.items.size === 2);
await sleep(400);
send(admin, MESSAGE.createConstruction, { name: "Molino", description: "Molino de prueba.", x: 8, y: 1, width: 2, height: 1, color: "#3366cc", tasks: [{ title: "Madera del molino", resource: "madera", required: 2 }] });
await waitFor(() => Boolean(named(admin.state.structures, "Molino")));
const harina = named(admin.state.items, "Harina")!;
const molino = named(admin.state.structures, "Molino")!;
await sleep(400);
for (const [name, input] of [["Moler a mano", "madera"], ["Moler", "piedra"]] as const) {
  send(admin, MESSAGE.createRecipe, { name, structureId: molino, verb: "moler", inputs: { [input]: 1 }, output: { item: harina, amount: 1 } });
  await sleep(400);
}
await waitFor(() => admin.state.recipes.size === 3);
send(admin, MESSAGE.createSkill, {
  name: "Molinero", description: "Muele el grano.",
  levels: [{ name: "Aprendiz", recipe: named(admin.state.recipes, "Moler a mano"), times: 2 }, { name: "Oficial", recipe: named(admin.state.recipes, "Moler"), times: 2 }],
});
await waitFor(() => admin.state.skills.size === 1);
const skill = [...admin.state.skills.keys()][0]!;

// Siembra con «ana»: recolectar, aportar y construir el Taller y el Molino; dejar existencias en el almacén.
const ana = await join("ana");
await go(ana, [R]);                                   // (3,2): junto a los árboles (4,2) y (4,3)
await collect(ana, R, "madera", 12);
send(ana, MESSAGE.contribute, { projectId: "construir-taller", taskId: "madera", from: "player", amount: 4 });
send(ana, MESSAGE.contribute, { projectId: molino, taskId: "madera", from: "player", amount: 2 });
await sleep(600);
await go(ana, [U, R, R]);                             // (5,1): encima de la roca (5,2)
await collect(ana, D, "piedra", 6);
send(ana, MESSAGE.contribute, { projectId: "construir-taller", taskId: "piedra", from: "player", amount: 2 });
await sleep(600);
await go(ana, [R, R]);                                // (7,1): junto al Molino (8,1)
send(ana, MESSAGE.build, { structureId: molino });
await sleep(600);
await go(ana, [D, D, D]);                             // (7,4): junto al Taller (8,4)
send(ana, MESSAGE.build, { structureId: "taller" });
await sleep(600);
send(ana, MESSAGE.transfer, { resource: "madera", amount: 3, to: "community" });
await sleep(400);
send(ana, MESSAGE.transfer, { resource: "piedra", amount: 2, to: "community" });
await sleep(400);
await login("bea");
send(admin, MESSAGE.grantSkill, { name: "bea", skill, level: 2 }); // bea: Oficial en Molinero (puede enseñar Aprendiz)
await sleep(600);
const built = ["taller", molino].map((id) => admin.state.structures.get(id)?.built);
await ana.leave();
await admin.leave();

console.log(JSON.stringify({
  url, contraseña: PASSWORD, cuentas: ["coordinacion (administración)", "ana", "bea (Oficial en Molinero)"],
  construidos: { taller: built[0], molino: built[1] }, nota: "cuentas y contraseña SOLO de prueba, válidas únicamente en esa base temporal",
}, null, 2));
process.exit(0);
