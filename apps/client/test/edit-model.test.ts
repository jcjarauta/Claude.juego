import { test } from "node:test";
import assert from "node:assert/strict";
import { copyName, findFreeSolar, seedFromTemplate, TEMPLATES, toCreatePayload, type SolarMap } from "../src/edit-model.ts";

// G2, P5 (TP-32): duplicar y plantillas. Modelo puro: cómo se llama una copia, qué mensaje de creación sale de una definición,
// dónde cabe un solar y qué rellena cada plantilla.

const map = (structures: SolarMap["structures"] = []): SolarMap => ({ width: 6, height: 4, nodeCells: new Set(["0,0"]), spawn: { x: 1, y: 0 }, structures, side: 10 });
const building = (id: string, x: number, y: number, width = 1, height = 1) => ({ id, name: id, projectId: id, x, y, width, height, color: "#3366cc" });

test("el nombre de una copia añade «(copia)» y respeta el máximo de 60 caracteres", () => {
  assert.equal(copyName("Harina"), "Harina (copia)");
  const long = "x".repeat(60);
  assert.equal(copyName(long).length, 60);
  assert.ok(copyName(long).endsWith(" (copia)"));
  assert.equal(copyName("Harina", 10), "Ha (copia)");
});

test("de una definición sale el mensaje de creación de su tipo, sin ids ni lo que no se envía al crear", () => {
  assert.deepEqual(toCreatePayload({ kind: "objeto", def: { name: "Sal" } }), { name: "Sal" });
  assert.deepEqual(toCreatePayload({ kind: "mision", def: { name: "Pan", description: "d", objective: { kind: "item-in-community", item: "pan", amount: 5 } } }),
    { name: "Pan", description: "d", objective: { kind: "item-in-community", item: "pan", amount: 5 } });
  assert.deepEqual(toCreatePayload({ kind: "habilidad", def: { name: "Molinero", description: "", levels: [{ name: "Aprendiz", practice: { recipe: "moler", times: 2 } }] } }),
    { name: "Molinero", description: "", levels: [{ name: "Aprendiz", recipe: "moler", times: 2 }] }, "los niveles se envían como al crear: nombre, receta y veces");
  const recipe = toCreatePayload({ kind: "receta", def: { name: "Hornear", structureId: "horno", inputs: { harina: 1 }, output: { item: "pan", amount: 2 }, verb: "hornear", alsoNeeds: ["molino"], byproducts: [{ item: "salvado", amount: 1 }], requiresSkills: [{ skill: "panadero", level: 2 }] } });
  assert.deepEqual(recipe, { name: "Hornear", structureId: "horno", inputs: { harina: 1 }, output: { item: "pan", amount: 2 }, verb: "hornear", alsoNeeds: ["molino"], byproducts: [{ item: "salvado", amount: 1 }], requiresSkills: [{ skill: "panadero", level: 2 }] });
  assert.deepEqual(Object.keys(toCreatePayload({ kind: "receta", def: { name: "R", structureId: "t", inputs: {}, output: { item: "x", amount: 1 } } })).sort(), ["inputs", "name", "output", "structureId"], "los opcionales vacíos no se envían");
  const construction = toCreatePayload({
    kind: "construccion",
    def: {
      project: { name: "Faro", description: "Un faro", tasks: [{ id: "piedra", title: "Piedra", resource: "piedra", required: 3, acceptance: "Aportar 3 de piedra" }], reality: "VIRTUAL", coordinators: ["ana"], buildRequiresApproval: true },
      structure: { name: "Faro", x: 4, y: 2, width: 2, height: 1, color: "#aa5500" },
    },
  });
  assert.deepEqual(construction, { name: "Faro", description: "Un faro", x: 4, y: 2, width: 2, height: 1, color: "#aa5500", tasks: [{ title: "Piedra", resource: "piedra", required: 3 }], requiresApproval: true });
});

test("el primer hueco libre esquiva nodos, el punto de aparición y los edificios, y no sale del mapa", () => {
  assert.deepEqual(findFreeSolar(map(), 1, 1), { x: 2, y: 0 }, "(0,0) es un nodo y (1,0) es la aparición");
  assert.deepEqual(findFreeSolar(map([building("a", 2, 0), building("b", 3, 0)]), 1, 1), { x: 4, y: 0 });
  assert.deepEqual(findFreeSolar(map([building("a", 2, 0, 4, 1)]), 2, 2), { x: 0, y: 1 }, "un solar de 2×2 cabe más abajo");
  assert.equal(findFreeSolar(map(), 7, 1), undefined, "más ancho que el mapa");
  const full = Array.from({ length: 4 }, (_, y) => building(`f${y}`, 0, y, 6, 1));
  assert.equal(findFreeSolar(map(full), 1, 1), undefined, "mapa lleno");
});

test("hay cuatro plantillas y cada una rellena el formulario con valores de ejemplo del mundo", () => {
  assert.deepEqual(TEMPLATES.map((t) => [t.id, t.kind]), [["objeto", "objeto"], ["receta-simple", "receta"], ["mision-reunir", "mision"], ["construccion-pequena", "construccion"]]);
  const world = { resources: [{ id: "madera", name: "Madera" }, { id: "piedra", name: "Piedra" }], itemIds: ["harina", "pan"], structureIds: ["molino", "taller"], map: map() };
  assert.deepEqual(seedFromTemplate("objeto", world), { kind: "objeto", def: { name: "Objeto nuevo" } });
  assert.deepEqual(seedFromTemplate("receta-simple", world), { kind: "receta", def: { name: "Receta nueva", structureId: "molino", inputs: { madera: 1 }, output: { item: "harina", amount: 1 } } });
  assert.deepEqual(seedFromTemplate("mision-reunir", world), { kind: "mision", def: { name: "Reunir objetos", description: "", objective: { kind: "item-in-community", item: "harina", amount: 5 } } });
  const c = seedFromTemplate("construccion-pequena", world)!;
  assert.equal(c.kind, "construccion");
  assert.deepEqual(toCreatePayload(c), { name: "Construcción nueva", description: "", x: 2, y: 0, width: 1, height: 1, color: "#8a6d3b", tasks: [{ title: "Aportar madera", resource: "madera", required: 5 }], requiresApproval: false });
  // sin objetos ni edificios, la plantilla se rellena con huecos que la persona elige; sin sitio no hay construcción
  assert.deepEqual(seedFromTemplate("receta-simple", { ...world, itemIds: [], structureIds: [] }), { kind: "receta", def: { name: "Receta nueva", structureId: "", inputs: { madera: 1 }, output: { item: "", amount: 1 } } });
  assert.equal(seedFromTemplate("construccion-pequena", { ...world, map: map(Array.from({ length: 4 }, (_, y) => building(`f${y}`, 0, y, 6, 1))) }), undefined);
});
