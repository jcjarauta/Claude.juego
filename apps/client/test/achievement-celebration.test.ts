import { test } from "node:test";
import assert from "node:assert/strict";
import { cardText, celebrationText, nextCard, planCelebration } from "../src/achievement-celebration.ts";

// G3d, P2: qué se emite al conseguir logros nuevos. Una tanda → un aviso, una tarjeta, un destello; las preferencias deciden.

test("celebración: un logro → un aviso relevante que se anuncia, tarjeta y destello (Todas)", () => {
  const plan = planCelebration(["Primer edificio"], "todas");
  assert.equal(plan.events.length, 1);
  assert.deepEqual(plan.events[0], { kind: "logro", importance: "relevante", own: true, priority: 1, text: "¡Logro conseguido: Primer edificio!" });
  assert.deepEqual([plan.card, plan.flash], [true, true]);
});

test("celebración: varios a la vez → UN resumen anunciado, una línea por logro en el historial (sin anunciarse), una tarjeta y un destello", () => {
  const names = ["Primera misión", "Misiones del conjunto inicial", "Primer aporte"];
  const plan = planCelebration(names, "todas");
  const announced = plan.events.filter((e) => e.importance === "relevante");
  const history = plan.events.filter((e) => e.importance === "normal");
  assert.equal(announced.length, 1, "un solo aviso");
  assert.equal(announced[0]!.text, "Has conseguido 3 logros nuevos: Primera misión, Misiones del conjunto inicial y Primer aporte.");
  assert.deepEqual(history.map((e) => e.text), names.map((n) => `Logro conseguido: ${n}.`));
  assert.ok(history.every((e) => e.priority === undefined), "el historial no fija prioridad de anuncio (rutina)");
  assert.deepEqual([plan.card, plan.flash], [true, true], "una tarjeta y un destello por tanda, no uno por logro");
});

test("celebración: el resumen nombra como máximo tres logros y cuenta el resto", () => {
  assert.equal(celebrationText(["a", "b", "c", "d", "e"]), "Has conseguido 5 logros nuevos: a, b y c y 2 más.");
  assert.equal(celebrationText(["a", "b"]), "Has conseguido 2 logros nuevos: a y b.");
});

test("preferencia «Solo texto»: aviso e historial, sin tarjeta ni destello", () => {
  const plan = planCelebration(["A", "B"], "solo-texto");
  assert.ok(plan.events.length > 0);
  assert.deepEqual([plan.card, plan.flash], [false, false]);
});

test("preferencia «Ninguna»: no se emite nada (el logro queda en «Nuevos» de la pestaña sin avisar)", () => {
  assert.deepEqual(planCelebration(["A"], "ninguna"), { events: [], card: false, flash: false });
  assert.deepEqual(planCelebration(["A", "B", "C"], "ninguna"), { events: [], card: false, flash: false });
});

test("sin logros nuevos no se celebra nada, sea cual sea la preferencia", () => {
  for (const mode of ["todas", "solo-texto", "ninguna"] as const) assert.deepEqual(planCelebration([], mode), { events: [], card: false, flash: false });
});

test("tarjeta única: se reutiliza (nunca se apilan), recuerda el último y cuenta «y N más»", () => {
  let card = nextCard(null, ["Primer edificio"]);
  assert.deepEqual(card, { last: "Primer edificio", total: 1 });
  assert.deepEqual(cardText(card!), { text: "Logro conseguido: Primer edificio", more: "" });
  card = nextCard(card, ["Primera misión", "Primer aporte"]);
  assert.deepEqual(card, { last: "Primer aporte", total: 3 }, "la misma tarjeta, con el último y el total");
  assert.deepEqual(cardText(card!), { text: "Logro conseguido: Primer aporte", more: "y 2 más" });
  assert.equal(nextCard(card, []), card, "una tanda vacía no la toca");
  assert.equal(nextCard(null, []), null);
  // al cerrarla se reinicia
  assert.deepEqual(nextCard(null, ["Otro"]), { last: "Otro", total: 1 });
});
