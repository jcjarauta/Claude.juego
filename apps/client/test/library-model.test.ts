import { test } from "node:test";
import assert from "node:assert/strict";
import { currentVersion, historyRows, libraryRows, nameInVersion, type LibraryState } from "../src/library-model.ts";
import { sectionFromHash } from "../src/sections.ts";

// G2, P2 (TP-32): modelo puro de la Biblioteca y elección de sección por #hash.

const entry = (name: string, origin: string, version = 1, rev = 1) => ({ name, origin, version, rev });
const state: LibraryState = {
  items: new Map([["harina", { ...entry("Harina", "panel", 3, 5), archived: false }], ["pan", { ...entry("pan", "configuracion"), archived: true }]]),
  recipes: new Map([["moler", { ...entry("Moler", "panel", 2, 2), archived: false }]]),
  skills: new Map(),
  missions: new Map([["m1", { ...entry("Diez panes", "panel"), archived: false, status: "pendiente" }], ["m2", { ...entry("Primera", "configuracion"), archived: false, status: "completada" }], ["m3", { ...entry("Vieja", "panel"), archived: true, status: "pendiente" }]]),
  structures: new Map([
    ["molino", { ...entry("Molino", "panel", 2, 4), built: true, retired: false }],
    ["horno", { ...entry("Horno", "panel"), built: false, retired: false }],
    ["faro", { ...entry("Faro", "panel", 1, 3), built: true, retired: true }],
  ]),
  projects: new Map([["molino", { phase: "abierto" }], ["horno", { phase: "cerrado" }], ["faro", { phase: "abierto" }]]),
};

test("las filas llevan versión, origen y estado en texto, ordenadas por nombre sin distinguir mayúsculas", () => {
  const items = libraryRows(state, "objeto");
  assert.deepEqual(items.map((r) => [r.name, r.version, r.origin, r.status, r.rev, r.hasHistory]), [
    ["Harina", "v3", "Panel", "Activo", 5, true],
    ["pan", "v1", "Configuración", "Archivado", 1, false],
  ]);
  assert.deepEqual(libraryRows(state, "mision").map((r) => [r.name, r.status]), [["Diez panes", "Pendiente"], ["Primera", "Cumplida"], ["Vieja", "Archivada"]]);
  assert.deepEqual(libraryRows(state, "construccion").map((r) => [r.name, r.status]), [["Faro", "Retirado"], ["Horno", "Sin construir"], ["Molino", "Construido"]]);
  assert.deepEqual(libraryRows(state, "habilidad"), []);
  assert.equal(libraryRows(state, "receta")[0]!.version, "v2");
});

test("solo lo creado en el panel tiene historial; lo de la configuración no se edita", () => {
  assert.equal(libraryRows(state, "objeto").find((r) => r.id === "pan")!.hasHistory, false);
  assert.equal(libraryRows(state, "mision").find((r) => r.id === "m2")!.hasHistory, false);
  assert.ok(libraryRows(state, "construccion").every((r) => r.hasHistory));
});

test("la tabla del historial marca la versión vigente y dice quién, cuándo y con qué nombre", () => {
  const rows = historyRows({
    version: 2, rev: 4,
    versions: [
      { version: 1, definition: { id: "x", name: "Harina" }, changedBy: "ana", changedAt: 1000, note: "Versión original" },
      { version: 2, definition: { id: "x", name: "Harina fina" }, changedBy: "luis", changedAt: 2000, note: "" },
    ],
  }, (at) => `fecha ${at}`);
  assert.deepEqual(rows, [["v1", "Harina", "ana", "fecha 1000", "Versión original"], ["v2 (vigente)", "Harina fina", "luis", "fecha 2000", "—"]]);
  assert.equal(nameInVersion({ project: { name: "Molino" }, structure: {} }), "Molino");
  assert.equal(nameInVersion(null), "—");
});

test("el #hash elige la sección y cae en la primera si no existe o no está disponible", () => {
  const ids = ["proyectos", "biblioteca", "cadenas"];
  assert.equal(sectionFromHash("#biblioteca", ids), "biblioteca");
  assert.equal(sectionFromHash("#diseno", ids), "proyectos", "un participante no tiene «diseno»");
  assert.equal(sectionFromHash("", ids), "proyectos");
  assert.equal(sectionFromHash("#%E2%82%AC", ids), "proyectos");
});

test("la pantalla avisa de lo que no se puede editar y por qué (el servidor decide siempre)", () => {
  const why = (kind: Parameters<typeof libraryRows>[1], id: string) => { const r = libraryRows(state, kind).find((x) => x.id === id)!; return [r.editable, r.whyNot]; };
  assert.deepEqual(why("objeto", "harina"), [true, ""]);
  assert.deepEqual(why("objeto", "pan"), [false, "viene de la configuración"]);
  assert.deepEqual(why("mision", "m1"), [true, ""]);
  assert.deepEqual(why("mision", "m2"), [false, "viene de la configuración"]);
  assert.deepEqual(why("mision", "m3"), [false, "restáurala antes en Diseño"]);
  assert.deepEqual(why("construccion", "molino"), [false, "ya está construido"]);
  assert.deepEqual(why("construccion", "horno"), [false, "su proyecto está cerrado"]);
  assert.deepEqual(why("construccion", "faro"), [false, "está retirado"]);
  assert.deepEqual([currentVersion(state, "objeto", "harina"), currentVersion(state, "objeto", "no-existe"), currentVersion(state, "construccion", "molino")], [3, 1, 2]);
});

test("qué acciones admite cada fila: archivar en cascada, retirar y restaurar edificios", () => {
  const flags = (kind: Parameters<typeof libraryRows>[1], id: string) => { const r = libraryRows(state, kind).find((x) => x.id === id)!; return [r.archivable, r.retirable, r.restorable]; };
  assert.deepEqual(flags("objeto", "harina"), [true, false, false]);
  assert.deepEqual(flags("objeto", "pan"), [false, false, false], "lo archivado ya no se archiva");
  assert.deepEqual(flags("mision", "m2"), [true, false, false], "también lo de la configuración se archiva");
  assert.deepEqual(flags("mision", "m3"), [false, false, false]);
  assert.deepEqual(flags("construccion", "molino"), [false, true, false], "un edificio construido se puede retirar");
  assert.deepEqual(flags("construccion", "horno"), [false, true, false]);
  assert.deepEqual(flags("construccion", "faro"), [false, false, true], "uno retirado solo se restaura");
});
