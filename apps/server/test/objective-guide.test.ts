import { test } from "node:test";
import assert from "node:assert/strict";
import { directionText, nearby, nearbySummary, NEARBY_RADIUS, STATUS_HELP, tipsFor, type Snapshot, type Step } from "@juego/shared";

// G3c, P3 (TP-29): «Qué hay cerca» (alternativa textual del mapa) y consejos por situación. Modelos puros.

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    me: { name: "ana", x: 10, y: 10, inventory: {}, skills: {}, crafts: {} },
    inventoryMax: 10, stock: {},
    nodes: [
      { id: "a", resource: "madera", x: 12, y: 10, units: 3 },
      { id: "b", resource: "madera", x: 10, y: 11, units: 1 },
      { id: "c", resource: "piedra", x: 10, y: 14, units: 0 },
      { id: "d", resource: "fibra", x: 30, y: 10, units: 5 },
    ],
    resources: { madera: "Madera", piedra: "Piedra", fibra: "Fibra" }, items: {}, recipes: [],
    structures: [
      { def: { id: "taller", name: "Taller", projectId: "p", x: 13, y: 8, width: 2, height: 2, color: "#fff" }, built: true },
      { def: { id: "molino", name: "Molino", projectId: "q", x: 10, y: 10, width: 1, height: 1, color: "#fff" }, built: false },
    ],
    skills: [], projects: [], missions: [],
    others: [{ name: "bea", x: 8, y: 9, connected: true, skills: {} }, { name: "cai", x: 9, y: 9, connected: false, skills: {} }, { name: "dan", x: 30, y: 30, connected: true, skills: {} }],
    offers: [],
    ...over,
  };
}

test("cerca: lo que hay a ≤ 8 casillas por cercanía (sin agotados, desconectados ni lejanos); a igual distancia, edificios, recursos y personas", () => {
  const n = nearby(snap());
  assert.deepEqual(n.entries.map((e) => `${e.distance}:${e.kind}:${e.label}`), [
    "0:edificio:Molino (solar sin construir)",
    "1:recurso:Madera (1 unidad)",
    "2:recurso:Madera (3 unidades)",
    "2:persona:bea",
    "3:edificio:Taller",
  ]);
  assert.equal(n.entries[0]!.direction, "estás dentro");
  assert.equal(n.entries[1]!.direction, "1 casilla al sur");
  assert.equal(n.entries.find((e) => e.label === "bea")!.direction, "2 casillas al oeste y 1 casilla al norte");
  assert.equal(n.entries.find((e) => e.label === "Taller")!.direction, "3 casillas al este y 1 casilla al norte", "dirección al punto más cercano de su huella");
});

test("cerca: el destino activo siempre va primero, aunque esté fuera del radio, con su dirección", () => {
  const far = nearby(snap(), { x: 30, y: 10, label: "Fibra" });
  assert.equal(far.destination?.outsideRadius, true);
  assert.equal(far.destination?.distance, 20);
  assert.equal(far.destination?.text, "Fibra, a 20 casillas al este (fuera del radio de la lista).");
  assert.equal(far.entries.some((e) => e.label.startsWith("Fibra")), false, "no entra en la lista por estar lejos");
  const near = nearby(snap(), { x: 12, y: 10, label: "Madera" });
  assert.equal(near.destination?.outsideRadius, false);
  assert.equal(near.destination?.text, "Madera, a 2 casillas al este.");
  const here = nearby(snap(), { x: 10, y: 10, label: "Molino" });
  assert.equal(here.destination?.text, "Molino: estás en el destino.");
  assert.equal(nearby(snap()).destination, undefined);
});

test("cerca: empates estables (mismo orden con las mismas entradas) y radio ajustable", () => {
  const s = snap({ nodes: [{ id: "x", resource: "madera", x: 11, y: 10, units: 2 }, { id: "y", resource: "madera", x: 9, y: 10, units: 2 }] });
  const a = nearby(s).entries.map((e) => e.label + e.direction);
  const b = nearby(s).entries.map((e) => e.label + e.direction);
  assert.deepEqual(a, b);
  assert.equal(NEARBY_RADIUS, 8);
  assert.equal(nearby(snap(), undefined, 1).entries.length, 2);
  assert.equal(nearby(snap({ others: [], structures: [], nodes: [] })).entries.length, 0);
});

const step = (over: Partial<Step>): Step => ({ key: "k", status: "DISPONIBLE", type: "none", text: "t", why: "", requirements: [], alternatives: [], ...over });

test("consejos: sin objetivo se invita a elegir uno; con paso, los consejos dependen de lo que bloquea", () => {
  assert.match(tipsFor(undefined, snap())[0]!, /Elegir objetivo/);
  const edificio = tipsFor(step({ status: "BLOQUEADO", requirements: [{ code: "sin-construir:molino", text: "x", how: "y" }] }), snap());
  assert.ok(edificio.some((t) => t.includes("edificio sin construir")));
  const habilidad = tipsFor(step({ status: "BLOQUEADO", requirements: [{ code: "habilidad:m:2", text: "x", how: "y" }] }), snap());
  assert.ok(habilidad.some((t) => t.includes("habilidad se gana")));
  assert.ok(tipsFor(step({ type: "choose-route" }), snap()).some((t) => t.includes("varias formas")));
  assert.ok(tipsFor(step({ type: "deposit" }), snap()).some((t) => t.includes("almacén")));
  assert.ok(tipsFor(step({ status: "NO_VERIFICADO" }), snap()).some((t) => t.includes("Sin verificar")));
  assert.ok(tipsFor(step({ status: "BLOQUEADO", requirements: [{ code: "sin-unidades:madera", text: "x", how: "y" }] }), snap()).some((t) => t.includes("regeneran")));
});

test("resumen hablado (tecla L): destino primero, tres elementos más cercanos y cuántos quedan; sin nada cerca lo dice", () => {
  const text = nearbySummary(nearby(snap(), { x: 30, y: 10, label: "Fibra" }));
  assert.match(text, /^Destino del objetivo: Fibra, a 20 casillas al este \(fuera del radio de la lista\)\. Cerca: Molino \(solar sin construir\), estás dentro; Madera \(1 unidad\), 1 casilla al sur; Madera \(3 unidades\), 2 casillas al este\. Hay 2 más en la pestaña Guía\.$/);
  assert.equal(nearbySummary(nearby(snap({ others: [], structures: [], nodes: [] }))), "No hay nada a 8 casillas o menos.");
  assert.equal(nearbySummary(nearby(snap(), undefined, 1)), "Cerca: Molino (solar sin construir), estás dentro; Madera (1 unidad), 1 casilla al sur.");
});

test("consejos: siempre los generales (consola y atajos) y el aviso de ofertas solo si las hay; el estado se explica con texto", () => {
  const base = tipsFor(step({}), snap());
  assert.ok(base.at(-2)!.includes("consola"));
  assert.ok(base.at(-1)!.includes("O objetivo") && base.at(-1)!.includes("L lo que hay cerca") && base.at(-1)!.includes("G logros"));
  assert.equal(base.some((t) => t.includes("ofertas de enseñanza")), false);
  assert.ok(tipsFor(step({}), snap({ offers: [{ id: "o", from: "bea", skill: "s", level: 1 }] })).some((t) => t.includes("ofertas de enseñanza")));
  assert.equal(STATUS_HELP.length, 4);
  assert.deepEqual(STATUS_HELP.map((t) => t.split(":")[0]), ["Disponible", "Bloqueado", "Sin verificar", "Completado"]);
  assert.equal(directionText({ x: 0, y: 0 }, { x: 0, y: 0 }), "estás en el destino");
});
