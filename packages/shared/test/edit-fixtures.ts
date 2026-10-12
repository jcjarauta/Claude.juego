import {
  DEFAULT_BUILD_LIMITS,
  type ConstructionDef, type DefMeta, type EditableKind, type EditView, type ItemDef, type MissionDef, type PlayerFacts, type ProjectDef, type RecipeDef, type SkillDef, type StructureDef,
} from "../src/index.ts";

// Mundo de prueba para las reglas de G2 (versiones, retirada y cascada). Puro: sin red ni sala.
//   Objetos: harina, pan, sal.   Recetas: moler (piedra → harina, molino), hornear (harina → pan, horno), salar (madera → sal, molino).
//   Habilidad: molinero (Aprendiz: moler ×2, Oficial: moler ×5).   Misión: pan-10 (10 de pan).
//   Edificios: molino (construido), horno (sin construir, con 3 de madera aportados), taller (de la configuración, construido).

export const ADMINS = ["ana"];

const project = (id: string, name: string, tasks: ProjectDef["tasks"]): ProjectDef => ({ id, name, description: "", tasks, reality: "VIRTUAL", coordinators: ["ana"], buildRequiresApproval: false });
const structure = (id: string, name: string, x: number, y: number): StructureDef => ({ id, name, projectId: id, x, y, width: 2, height: 2, color: "#3366cc" });

export interface FixtureOptions {
  rev?: Record<string, number>;
  version?: Record<string, number>;
  origin?: Record<string, "configuracion" | "panel">;
  archived?: readonly string[];
  completed?: readonly string[];
  retired?: readonly string[];
  closedProjects?: readonly string[];
  stock?: Record<string, number>;
  players?: readonly PlayerFacts[];
  offers?: readonly { skill: string; level: number }[];
  contributed?: Record<string, number>;
  /** Invierte el orden de todas las listas (para probar que nada depende del orden de carga). */
  reverse?: boolean;
  lastChange?: Record<string, string>;
}

export const key = (kind: EditableKind | "habilidad", id: string) => `${kind}:${id}`;

export function makeView(o: FixtureOptions = {}): EditView {
  const archived = new Set(o.archived ?? []);
  const order = <T>(list: T[]) => (o.reverse ? [...list].reverse() : list);
  const items: ItemDef[] = [{ id: "harina", name: "Harina" }, { id: "pan", name: "Pan" }, { id: "sal", name: "Sal" }];
  const recipes: RecipeDef[] = [
    { id: "moler", name: "Moler", structureId: "molino", inputs: { piedra: 1 }, output: { item: "harina", amount: 1 }, verb: "moler" },
    { id: "hornear", name: "Hornear", structureId: "horno", inputs: { harina: 1 }, output: { item: "pan", amount: 1 }, verb: "hornear" },
    { id: "salar", name: "Salar", structureId: "molino", inputs: { madera: 1 }, output: { item: "sal", amount: 1 } },
  ];
  const skills: SkillDef[] = [{
    id: "molinero", name: "Molinero", description: "",
    levels: [{ name: "Aprendiz", practice: { recipe: "moler", times: 2 } }, { name: "Oficial", practice: { recipe: "moler", times: 5 } }],
  }];
  const missions: MissionDef[] = [{ id: "pan-10", name: "Diez panes", description: "", objective: { kind: "item-in-community", item: "pan", amount: 10 } }];
  const structures = [
    { def: structure("molino", "Molino", 4, 0), built: true, retired: (o.retired ?? []).includes("molino") },
    { def: structure("horno", "Horno", 8, 0), built: false, retired: (o.retired ?? []).includes("horno") },
    { def: structure("taller", "Taller", 12, 0), built: true, retired: false },
  ];
  const projects = [
    { def: project("molino", "Molino", [{ id: "madera", title: "Madera", resource: "madera", required: 4, acceptance: "Aportar 4 de madera" }]), closed: (o.closedProjects ?? []).includes("molino") },
    { def: project("horno", "Horno", [{ id: "madera", title: "Madera", resource: "madera", required: 6, acceptance: "Aportar 6 de madera" }, { id: "piedra", title: "Piedra", resource: "piedra", required: 2, acceptance: "Aportar 2 de piedra" }]), closed: (o.closedProjects ?? []).includes("horno") },
    { def: project("taller", "Taller", [{ id: "madera", title: "Madera", resource: "madera", required: 2, acceptance: "Aportar 2 de madera" }]), closed: false },
  ];
  const origin = (k: string): "configuracion" | "panel" => o.origin?.[k] ?? (k === key("construccion", "taller") ? "configuracion" : "panel");
  const meta = (kind: EditableKind, id: string): DefMeta | undefined => {
    const k = key(kind, id);
    const exists = kind === "objeto" ? items.some((x) => x.id === id) : kind === "receta" ? recipes.some((x) => x.id === id) : kind === "habilidad" ? skills.some((x) => x.id === id)
      : kind === "mision" ? missions.some((x) => x.id === id) : structures.some((x) => x.def.id === id);
    return exists ? { origin: origin(k), version: o.version?.[k] ?? 1, rev: o.rev?.[k] ?? 1 } : undefined;
  };
  const players: PlayerFacts[] = [...(o.players ?? [{ name: "ana", skills: { molinero: 1 }, crafts: { moler: 3 } }, { name: "bea", skills: {}, crafts: {} }])];
  return {
    items: order(items.map((def) => ({ def, archived: archived.has(key("objeto", def.id)) }))),
    recipes: order(recipes.map((def) => ({ def, archived: archived.has(key("receta", def.id)) }))),
    skills: order(skills.map((def) => ({ def, archived: archived.has(key("habilidad", def.id)) }))),
    missions: order(missions.map((def) => ({ def, archived: archived.has(key("mision", def.id)) }))),
    structures: order(structures),
    projects: order(projects),
    resourceNames: ["Madera", "Piedra"],
    resourceIds: new Set(["madera", "piedra"]),
    stock: (id) => o.stock?.[id] ?? 0,
    meta,
    lastChange: (kind, id) => o.lastChange?.[key(kind, id)],
    limits: DEFAULT_BUILD_LIMITS,
    map: { width: 30, height: 30, nodeCells: new Set(["20,20"]), spawn: { x: 0, y: 0 } },
    contributed: (projectId, resource) => o.contributed?.[`${projectId}:${resource}`] ?? (projectId === "horno" && resource === "madera" ? 3 : 0),
    players: order(players),
    offers: o.offers ?? [],
    completedMissions: new Set(o.completed ?? []),
  };
}

export const horno = (view: EditView): ConstructionDef => {
  const s = view.structures.find((x) => x.def.id === "horno")!.def;
  const p = view.projects.find((x) => x.def.id === "horno")!.def;
  return { project: p, structure: s };
};
