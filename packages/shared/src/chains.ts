import { skillLevelName } from "./skills.ts";
import { recipeProducts, recipeVerb, type RecipeDef, type SkillDef } from "./world-config.ts";

// Cadenas de producción (F2b): descripción legible de las recetas y su diagrama de flechas.
// Reglas puras: el panel y el panel P del juego las leen del estado sincronizado; no deciden nada.

export interface ChainBuilding {
  id: string;
  name: string;
  built: boolean;
}

export interface ChainInputs {
  recipes: readonly RecipeDef[];
  /** Nombre y estado de un edificio, o undefined si ya no existe. */
  building: (id: string) => { name: string; built: boolean } | undefined;
  /** Nombre de un recurso u objeto. */
  entryName: (id: string) => string;
  /** ¿Es un objeto (se fabrica) y no un recurso (se recolecta)? */
  isItem: (id: string) => boolean;
  /** Existencias del almacén común, si se quiere saber qué falta. */
  stock?: (id: string) => number;
  /** Habilidades del mundo y nivel de quien mira (F2c); sin `skillLevel` solo se describen. */
  skills?: ReadonlyMap<string, SkillDef>;
  skillLevel?: (skill: string) => number;
}

export interface ChainEntry {
  id: string;
  name: string;
  /** Acción en minúsculas («moler»). */
  verb: string;
  building: ChainBuilding;
  extra: ChainBuilding[];
  inputs: { id: string; name: string; amount: number; item: boolean; have?: number }[];
  products: { id: string; name: string; amount: number; main: boolean }[];
  /** Habilidades exigidas (F2c): nombre, nivel mínimo y, si se conoce, el nivel de quien mira. */
  skills: { id: string; name: string; level: number; levelName: string; have?: number; haveName?: string }[];
}

/** Una entrada por receta, en el orden en que llegan. */
export function describeChains({ recipes, building, entryName, isItem, stock, skills, skillLevel }: ChainInputs): ChainEntry[] {
  const place = (id: string): ChainBuilding => ({ id, name: building(id)?.name ?? id, built: building(id)?.built ?? false });
  return recipes.map((r) => ({
    id: r.id,
    name: r.name,
    verb: recipeVerb(r).toLowerCase(),
    building: place(r.structureId),
    extra: (r.alsoNeeds ?? []).map(place),
    inputs: Object.entries(r.inputs).map(([id, amount]) => ({ id, name: entryName(id).toLowerCase(), amount, item: isItem(id), ...(stock ? { have: stock(id) } : {}) })),
    products: recipeProducts(r).map((p, i) => ({ id: p.item, name: entryName(p.item).toLowerCase(), amount: p.amount, main: i === 0 })),
    skills: (r.requiresSkills ?? []).map((q) => {
      const def = skills?.get(q.skill);
      const have = skillLevel?.(q.skill);
      return {
        id: q.skill, name: def?.name ?? q.skill, level: q.level, levelName: def ? skillLevelName(def, q.level) : `nivel ${q.level}`,
        ...(have !== undefined ? { have, haveName: def ? skillLevelName(def, have) : `nivel ${have}` } : {}),
      };
    }),
  }));
}

const marked = (b: ChainBuilding) => `${b.name}${b.built ? "" : " (sin construir)"}`;

/** Línea de texto de una receta: «Hornear — hornear en Horno, con Molino: 2 harina → 1 pan». */
export function chainLine(c: ChainEntry): string {
  const where = `${marked(c.building)}${c.extra.length ? `, con ${c.extra.map(marked).join(" y ")}` : ""}${c.skills.length ? `, con habilidad ${c.skills.map((s) => `${s.name} (${s.levelName})`).join(" y ")}` : ""}`;
  const inputs = c.inputs.map((i) => `${i.amount} ${i.name}`).join(" + ");
  const products = c.products.map((p) => `${p.amount} ${p.name}`).join(" + ");
  return `${c.name} — ${c.verb} en ${where}: ${inputs} → ${products}`;
}

/** Qué falta ahora para fabricar (vacío = se puede, salvo estar junto al edificio principal). Requiere `stock`. */
export function chainMissing(c: ChainEntry): string[] {
  const missing: string[] = [];
  for (const b of [c.building, ...c.extra]) if (!b.built) missing.push(`construir ${b.name}`);
  for (const s of c.skills) if (s.have !== undefined && s.have < s.level) missing.push(`ser ${s.levelName} en ${s.name} (${s.have > 0 ? `eres ${s.haveName}` : "no la tienes"})`);
  for (const i of c.inputs) if ((i.have ?? 0) < i.amount) missing.push(`${i.amount - (i.have ?? 0)} más de ${i.name}`);
  return missing;
}

// ---------------------------------------------------------------- diagrama

export interface DiagramNode {
  key: string;
  kind: "resource" | "recipe" | "item";
  label: string;
  /** Segunda línea (edificio) de las recetas. */
  sub?: string;
  built?: boolean;
  column: number;
  row: number;
}
export interface DiagramEdge {
  from: string;
  to: string;
  /** Cantidad que viaja por la flecha. */
  amount: number;
}
export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  columns: number;
  rows: number;
}

/**
 * Diagrama por capas, de izquierda a derecha: recursos → receta → objetos → receta → …
 * Un objeto ocupa la columna de su receta más profunda, de modo que toda flecha va hacia la derecha (no hay ciclos, Q190).
 */
export function chainDiagram(entries: readonly ChainEntry[]): Diagram {
  const byProduct = new Map<string, ChainEntry[]>();
  for (const e of entries) for (const p of e.products) byProduct.set(p.id, [...(byProduct.get(p.id) ?? []), e]);

  const levelOfRecipe = new Map<string, number>();
  const levelOfEntry = (id: string, trail: Set<string>): number => {
    const producers = byProduct.get(id);
    if (!producers) return 0; // recurso
    return Math.max(...producers.map((r) => levelOf(r, trail)));
  };
  const levelOf = (r: ChainEntry, trail: Set<string>): number => {
    const known = levelOfRecipe.get(r.id);
    if (known !== undefined) return known;
    if (trail.has(r.id)) return 1; // defensa: un ciclo no debería existir
    trail.add(r.id);
    const level = 1 + Math.max(0, ...r.inputs.map((i) => levelOfEntry(i.id, trail)));
    trail.delete(r.id);
    levelOfRecipe.set(r.id, level);
    return level;
  };
  for (const e of entries) levelOf(e, new Set());

  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const rowsIn = new Map<number, number>();
  const place = (node: Omit<DiagramNode, "row">) => {
    if (nodes.has(node.key)) return;
    const row = rowsIn.get(node.column) ?? 0;
    rowsIn.set(node.column, row + 1);
    nodes.set(node.key, { ...node, row });
  };
  for (const e of [...entries].sort((a, b) => levelOfRecipe.get(a.id)! - levelOfRecipe.get(b.id)!)) {
    const level = levelOfRecipe.get(e.id)!;
    place({ key: `r:${e.id}`, kind: "recipe", label: `${e.name} (${e.verb})`, sub: marked(e.building), built: e.building.built && e.extra.every((b) => b.built), column: 2 * level - 1 });
    for (const i of e.inputs) {
      if (!byProduct.has(i.id)) place({ key: `e:${i.id}`, kind: "resource", label: i.name, column: 0 });
      edges.push({ from: `e:${i.id}`, to: `r:${e.id}`, amount: i.amount });
    }
    for (const p of e.products) {
      place({ key: `e:${p.id}`, kind: "item", label: p.name, column: 2 * Math.max(...byProduct.get(p.id)!.map((r) => levelOfRecipe.get(r.id)!)) });
      edges.push({ from: `r:${e.id}`, to: `e:${p.id}`, amount: p.amount });
    }
  }
  // Un objeto consumido antes de colocarse (su receta es más profunda en el orden) ya está; los pendientes se colocan al final.
  for (const e of entries) for (const i of e.inputs) if (byProduct.has(i.id) && !nodes.has(`e:${i.id}`)) {
    place({ key: `e:${i.id}`, kind: "item", label: i.name, column: 2 * Math.max(...byProduct.get(i.id)!.map((r) => levelOfRecipe.get(r.id)!)) });
  }
  const all = [...nodes.values()];
  return { nodes: all, edges, columns: Math.max(0, ...all.map((n) => n.column)) + 1, rows: Math.max(0, ...rowsIn.values()) };
}
