import { solarProblems, type ItemDef, type MissionDef, type ProjectDef, type RecipeDef, type SkillDef, type StructureDef } from "@juego/shared";
import type { LibraryKind } from "./library-model.ts";

// Modelo puro de «Duplicar» y de las plantillas (G2, Q245): cómo se llama una copia, qué mensaje de creación sale de una definición,
// dónde cabe un solar nuevo y qué rellena cada plantilla. No toca el DOM: se prueba con datos de mentira.

/** Lo que rellena un formulario de edición o de creación: la definición completa (la construcción lleva proyecto y estructura). */
export type Seed =
  | { kind: "objeto"; def: Pick<ItemDef, "name"> }
  | { kind: "mision"; def: Omit<MissionDef, "id"> }
  | { kind: "habilidad"; def: Omit<SkillDef, "id"> }
  | { kind: "receta"; def: Omit<RecipeDef, "id"> }
  | { kind: "construccion"; def: { project: Omit<ProjectDef, "id">; structure: Omit<StructureDef, "id" | "projectId"> } };

const COPY = " (copia)";

/** El nombre de una copia: «X (copia)», recortado para no pasar del máximo de 60 caracteres. */
export function copyName(name: string, max = 60): string {
  return name.length + COPY.length <= max ? `${name}${COPY}` : `${name.slice(0, max - COPY.length).trimEnd()}${COPY}`;
}

/** El mensaje de creación (`create-item`, `create-recipe`, `create-skill`, `create-mission`, `create-construction`) que sale de una definición. */
export function toCreatePayload(seed: Seed): Record<string, unknown> {
  if (seed.kind === "objeto") return { name: seed.def.name };
  if (seed.kind === "mision") return { name: seed.def.name, description: seed.def.description, objective: { ...seed.def.objective } };
  if (seed.kind === "habilidad") {
    return { name: seed.def.name, description: seed.def.description, levels: seed.def.levels.map((l) => ({ name: l.name, recipe: l.practice.recipe, times: l.practice.times })) };
  }
  if (seed.kind === "receta") {
    const r = seed.def;
    return {
      name: r.name, structureId: r.structureId, inputs: { ...r.inputs }, output: { ...r.output },
      ...(r.verb ? { verb: r.verb } : {}), ...(r.alsoNeeds?.length ? { alsoNeeds: [...r.alsoNeeds] } : {}),
      ...(r.byproducts?.length ? { byproducts: r.byproducts.map((b) => ({ ...b })) } : {}), ...(r.requiresSkills?.length ? { requiresSkills: r.requiresSkills.map((q) => ({ ...q })) } : {}),
    };
  }
  const { project, structure } = seed.def;
  return {
    name: structure.name, description: project.description, x: structure.x, y: structure.y, width: structure.width, height: structure.height, color: structure.color,
    tasks: project.tasks.map((t) => ({ title: t.title, resource: t.resource, required: t.required })),
    requiresApproval: project.buildRequiresApproval,
  };
}

export interface SolarMap {
  width: number;
  height: number;
  nodeCells: ReadonlySet<string>;
  spawn: { x: number; y: number };
  /** Solares y edificios vigentes (los retirados no cuentan). */
  structures: readonly StructureDef[];
  side: number;
}

/** La primera casilla (de arriba abajo y de izquierda a derecha) donde cabe un solar de `width` × `height`, o undefined si no hay. */
export function findFreeSolar(map: SolarMap, width: number, height: number): { x: number; y: number } | undefined {
  for (let y = 0; y + height <= map.height; y++) {
    for (let x = 0; x + width <= map.width; x++) {
      if (solarProblems({ x, y, width, height }, map).length === 0) return { x, y };
    }
  }
  return undefined;
}

export interface TemplateInfo {
  id: "objeto" | "receta-simple" | "mision-reunir" | "construccion-pequena";
  kind: LibraryKind;
  name: string;
  description: string;
}

/** Plantillas de arranque: rellenan el mismo formulario de creación; todo se puede cambiar antes de crear. */
export const TEMPLATES: readonly TemplateInfo[] = [
  { id: "objeto", kind: "objeto", name: "Objeto", description: "Un objeto fabricable con solo su nombre." },
  { id: "receta-simple", kind: "receta", name: "Receta simple de un paso", description: "Un recurso → un objeto, en el primer edificio disponible." },
  { id: "mision-reunir", kind: "mision", name: "Misión de reunir objetos", description: "Tener 5 unidades de un objeto en el almacén de la comunidad." },
  { id: "construccion-pequena", kind: "construccion", name: "Construcción pequeña", description: "Un solar de 1 × 1 en el primer hueco libre, con una tarea de 5 unidades." },
];

export interface TemplateWorld {
  resources: readonly { id: string; name: string }[];
  /** Objetos activos. */
  itemIds: readonly string[];
  /** Edificios vigentes, los construidos primero. */
  structureIds: readonly string[];
  map: SolarMap;
}

/** Lo que rellena una plantilla con lo que hay en el mundo (el primer recurso, objeto o edificio; la persona lo cambia). */
export function seedFromTemplate(id: TemplateInfo["id"], world: TemplateWorld): Seed | undefined {
  const resource = world.resources[0];
  if (id === "objeto") return { kind: "objeto", def: { name: "Objeto nuevo" } };
  if (id === "receta-simple") {
    return { kind: "receta", def: { name: "Receta nueva", structureId: world.structureIds[0] ?? "", inputs: resource ? { [resource.id]: 1 } : {}, output: { item: world.itemIds[0] ?? "", amount: 1 } } };
  }
  if (id === "mision-reunir") return { kind: "mision", def: { name: "Reunir objetos", description: "", objective: { kind: "item-in-community", item: world.itemIds[0] ?? "", amount: 5 } } };
  const spot = findFreeSolar(world.map, 1, 1);
  if (!spot || !resource) return undefined;
  return {
    kind: "construccion",
    def: {
      project: { name: "Construcción nueva", description: "", tasks: [{ id: resource.id, title: `Aportar ${resource.name.toLowerCase()}`, resource: resource.id, required: 5, acceptance: `Aportar 5 de ${resource.name.toLowerCase()}` }], reality: "VIRTUAL", coordinators: [], buildRequiresApproval: false },
      structure: { name: "Construcción nueva", x: spot.x, y: spot.y, width: 1, height: 1, color: "#8a6d3b" },
    },
  };
}
