import { test } from "node:test";
import assert from "node:assert/strict";
import { groupVisible, layoutLabels, type LabelGroup, type Rect } from "../src/ui/label-layout.ts";

// G3c, P2: colocación de etiquetas del mapa. Por prioridad; la que choca se oculta; la preferencia filtra por grupo.

const r = (x: number, y: number, w = 40, h = 14): Rect => ({ x, y, w, h });
const item = (group: LabelGroup, rect: Rect) => ({ group, rect });

test("etiquetas: sin choques se muestran todas", () => {
  const shown = layoutLabels([item("propia", r(0, 0)), item("edificio", r(100, 0)), item("persona", r(0, 100)), item("cantidad", r(100, 100))], "todas");
  assert.deepEqual(shown, [true, true, true, true]);
});

test("etiquetas: si dos chocan gana la de mayor prioridad (propia > destino > edificio > persona > cantidad)", () => {
  const overlap = r(10, 10);
  assert.deepEqual(layoutLabels([item("persona", overlap), item("propia", overlap)], "todas"), [false, true]);
  assert.deepEqual(layoutLabels([item("cantidad", overlap), item("persona", overlap), item("edificio", overlap)], "todas"), [false, false, true]);
  assert.deepEqual(layoutLabels([item("edificio", overlap), item("destino", overlap)], "todas"), [false, true]);
});

test("etiquetas: el orden de entrada no decide, la prioridad sí; empate de prioridad → gana la primera", () => {
  const a = item("persona", r(0, 0)); const b = item("persona", r(5, 5));
  assert.deepEqual(layoutLabels([a, b], "todas"), [true, false]);
  assert.deepEqual(layoutLabels([b, a], "todas"), [true, false]);
});

test("etiquetas: tocarse por el borde con margen cuenta como choque; con espacio suficiente no", () => {
  assert.deepEqual(layoutLabels([item("edificio", r(0, 0, 40, 14)), item("persona", r(41, 0, 40, 14))], "todas", 2), [true, false]);
  assert.deepEqual(layoutLabels([item("edificio", r(0, 0, 40, 14)), item("persona", r(45, 0, 40, 14))], "todas", 2), [true, true]);
});

test("preferencia: «solo edificios» deja edificios y destino; «ninguna» oculta todo; «todas» muestra todo", () => {
  const groups: LabelGroup[] = ["propia", "destino", "edificio", "persona", "cantidad"];
  const items = groups.map((g, i) => item(g, r(i * 100, 0)));
  assert.deepEqual(layoutLabels(items, "edificios"), [false, true, true, false, false]);
  assert.deepEqual(layoutLabels(items, "ninguna"), [false, false, false, false, false]);
  assert.deepEqual(layoutLabels(items, "todas"), [true, true, true, true, true]);
  assert.equal(groupVisible("edificios", "edificio"), true);
  assert.equal(groupVisible("edificios", "persona"), false);
});

test("etiquetas: una oculta por el filtro no tapa a otra que sí se muestra", () => {
  const overlap = r(10, 10);
  // «cantidad» está oculta por «edificios»: no ocupa sitio, así que el edificio se muestra aunque coincidan.
  assert.deepEqual(layoutLabels([item("cantidad", overlap), item("edificio", overlap)], "edificios"), [false, true]);
});
