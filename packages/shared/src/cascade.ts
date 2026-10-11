import { canonical } from "./canonical.ts";
import { usedBy, type DefinitionKind, type DesignView } from "./design.ts";
import type { EditView } from "./versions.ts";

// Archivado en cascada (G2, Q247 y Q253). Se calcula sobre el GRAFO COMPLETO de dependencias: nodos objeto, receta, habilidad,
// misión y edificio; una arista «A → B» significa «A necesita que B esté activo». Para archivar B hay que archivar antes todo lo que
// depende de B, y así transitivamente. El plan da el orden, los bloqueos (con el camino que los provoca) y una forma canónica
// determinista; el servidor la firma con un hash y, al ejecutar, vuelve a calcularla DENTRO de la transacción y compara.

export type NodeKind = DefinitionKind | "edificio";

export interface GraphNode {
  kind: NodeKind;
  id: string;
  name: string;
  archived: boolean;
  /** Revisión de concurrencia (0 si no consta, p. ej. lo de la configuración). */
  rev: number;
}

export interface GraphEdge {
  /** Quien necesita… */
  from: string;
  /** …a este. Las claves son `tipo:id`. */
  to: string;
  why: "usa" | "produce" | "exige" | "practica" | "pide" | "fabrica-en";
}

export interface DependencyGraph {
  nodes: ReadonlyMap<string, GraphNode>;
  edges: readonly GraphEdge[];
}

export const keyOf = (kind: NodeKind, id: string) => `${kind}:${id}`;
const KIND_RANK: Record<NodeKind, number> = { mision: 0, receta: 1, habilidad: 2, objeto: 3, edificio: 4 };

/** El grafo completo de dependencias del mundo (activo y archivado). */
export function dependencyGraph(view: EditView): DependencyGraph {
  const nodes = new Map<string, GraphNode>();
  const add = (kind: NodeKind, id: string, name: string, archived: boolean) => nodes.set(keyOf(kind, id), { kind, id, name, archived, rev: kind === "edificio" ? view.meta("construccion", id)?.rev ?? 0 : view.meta(kind, id)?.rev ?? 0 });
  for (const e of view.items) add("objeto", e.def.id, e.def.name, e.archived);
  for (const e of view.recipes) add("receta", e.def.id, e.def.name, e.archived);
  for (const e of view.skills) add("habilidad", e.def.id, e.def.name, e.archived);
  for (const e of view.missions) add("mision", e.def.id, e.def.name, e.archived);
  for (const e of view.structures) add("edificio", e.def.id, e.def.name, e.retired);
  const edges: GraphEdge[] = [];
  const edge = (from: string, to: string, why: GraphEdge["why"]) => { if (nodes.has(to)) edges.push({ from, to, why }); };
  for (const { def } of view.recipes) {
    const from = keyOf("receta", def.id);
    for (const item of Object.keys(def.inputs)) edge(from, keyOf("objeto", item), "usa");
    edge(from, keyOf("objeto", def.output.item), "produce");
    for (const b of def.byproducts ?? []) edge(from, keyOf("objeto", b.item), "produce");
    for (const q of def.requiresSkills ?? []) edge(from, keyOf("habilidad", q.skill), "exige");
    edge(from, keyOf("edificio", def.structureId), "fabrica-en");
    for (const s of def.alsoNeeds ?? []) edge(from, keyOf("edificio", s), "fabrica-en");
  }
  for (const { def } of view.skills) for (const level of def.levels) edge(keyOf("habilidad", def.id), keyOf("receta", level.practice.recipe), "practica");
  for (const { def } of view.missions) if (def.objective.kind === "item-in-community") edge(keyOf("mision", def.id), keyOf("objeto", def.objective.item), "pide");
  return { nodes, edges: edges.sort((a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`)) };
}

/** La misma vista con ciertas definiciones marcadas como archivadas (para comprobar el estado DESPUÉS de un lote). */
export function withArchived(view: EditView, batch: ReadonlySet<string>): EditView {
  const mark = <T extends { def: { id: string }; archived: boolean }>(kind: DefinitionKind, list: readonly T[]) => list.map((e) => (batch.has(keyOf(kind, e.def.id)) ? { ...e, archived: true } : e));
  return { ...view, items: mark("objeto", view.items), recipes: mark("receta", view.recipes), skills: mark("habilidad", view.skills), missions: mark("mision", view.missions) };
}

export interface PlanNode {
  kind: DefinitionKind;
  id: string;
  name: string;
}

export interface PlanBlocker {
  node: PlanNode;
  reason: string;
  /** Camino desde lo que se quiere archivar hasta el nodo que bloquea. */
  path: string[];
}

export interface CascadePlan {
  root: PlanNode;
  /** Todo el cierre transitivo, en el orden en que se archiva (lo que depende primero, la raíz la última). */
  order: PlanNode[];
  blockers: PlanBlocker[];
  /** Nodos que forman un ciclo entre sí (se archivan juntos en el lote). */
  cycles: string[];
  /** Forma canónica determinista: claves y nodos ordenados, `rev`, estado y existencias; sin actor ni hora. */
  canonical: string;
  /** ¿Se puede ejecutar? Sin bloqueos y con la raíz activa. */
  executable: boolean;
}

const asKind = (k: NodeKind): DefinitionKind | undefined => (k === "edificio" ? undefined : k);

/**
 * Plan para archivar `kind:id` y todo lo que depende de ello. No cambia nada. Bloqueos: existencias de un objeto, una habilidad con
 * personas que la tienen o con práctica registrada, y misiones ya cumplidas (hechos históricos que no se archivan en bloque).
 */
export function cascadePlan(view: EditView, kind: DefinitionKind, id: string): CascadePlan {
  const graph = dependencyGraph(view);
  const rootKey = keyOf(kind, id);
  const root = graph.nodes.get(rootKey);
  const nodeOf = (n: GraphNode): PlanNode => ({ kind: n.kind as DefinitionKind, id: n.id, name: n.name });
  if (!root || root.archived) {
    const fallback: PlanNode = { kind, id, name: root?.name ?? id };
    return { root: fallback, order: [], blockers: [{ node: fallback, reason: root ? "ya está archivada" : "no existe", path: [fallback.name] }], cycles: [], canonical: canonical({ root: rootKey, unavailable: true }), executable: false };
  }
  // dependientes: quien tiene una arista hacia B (solo activos y solo tipos archivables)
  const dependents = new Map<string, string[]>();
  for (const e of graph.edges) {
    const from = graph.nodes.get(e.from)!, to = graph.nodes.get(e.to)!;
    if (from.archived || to.archived || !asKind(from.kind)) continue;
    (dependents.get(e.to) ?? dependents.set(e.to, []).get(e.to)!).push(e.from);
  }
  // cierre transitivo con el camino que lleva a cada nodo
  const parent = new Map<string, string | undefined>([[rootKey, undefined]]);
  const queue = [rootKey];
  while (queue.length) {
    const current = queue.shift()!;
    for (const dep of (dependents.get(current) ?? []).sort()) {
      if (parent.has(dep)) continue;
      parent.set(dep, current);
      queue.push(dep);
    }
  }
  const members = [...parent.keys()];
  const pathTo = (key: string): string[] => {
    const path: string[] = [];
    for (let k: string | undefined = key; k; k = parent.get(k)) path.unshift(graph.nodes.get(k)!.name);
    return path.reverse();
  };
  // orden de archivado: Kahn sobre «quien depende archiva primero»; desempate fijo por tipo e id
  const inSet = new Set(members);
  const blockedBy = new Map<string, Set<string>>(members.map((m) => [m, new Set()]));
  for (const e of graph.edges) if (inSet.has(e.from) && inSet.has(e.to) && e.from !== e.to) blockedBy.get(e.to)!.add(e.from);
  const compare = (a: string, b: string) => {
    const x = graph.nodes.get(a)!, y = graph.nodes.get(b)!;
    return KIND_RANK[x.kind] - KIND_RANK[y.kind] || x.id.localeCompare(y.id);
  };
  const order: string[] = [];
  const done = new Set<string>();
  const cycles: string[] = [];
  while (done.size < members.length) {
    const ready = members.filter((m) => !done.has(m) && [...blockedBy.get(m)!].every((d) => done.has(d))).sort(compare);
    if (ready.length) { order.push(ready[0]!); done.add(ready[0]!); continue; }
    // ciclo: solo forman parte de él los nodos que se alcanzan a sí mismos entre los que quedan; se toma el menor y se anota
    const rest = members.filter((m) => !done.has(m)).sort(compare);
    const reachesItself = (start: string) => {
      const seen = new Set<string>();
      const stack = [...blockedBy.get(start)!].filter((d) => !done.has(d));
      while (stack.length) {
        const n = stack.pop()!;
        if (n === start) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const d of blockedBy.get(n)!) if (!done.has(d)) stack.push(d);
      }
      return false;
    };
    const loop = rest.filter(reachesItself);
    cycles.push(...loop.filter((m) => !cycles.includes(m)));
    const pick = (loop.length ? loop : rest)[0]!;
    order.push(pick); done.add(pick);
  }
  // La raíz se archiva la última salvo que forme parte de un ciclo
  const orderedKeys = cycles.includes(rootKey) ? order : [...order.filter((k) => k !== rootKey), rootKey];
  // bloqueos
  const blockers: PlanBlocker[] = [];
  const holders = (skill: string) => view.players.filter((p) => (p.skills[skill] ?? 0) > 0).length;
  for (const key of orderedKeys) {
    const n = graph.nodes.get(key)!;
    const path = pathTo(key);
    if (n.kind === "objeto" && view.stock(n.id) > 0) blockers.push({ node: nodeOf(n), reason: `hay ${view.stock(n.id)} de «${n.name}» en el almacén de la comunidad`, path });
    if (n.kind === "habilidad") {
      const def = view.skills.find((s) => s.def.id === n.id)!.def;
      const n1 = holders(n.id);
      if (n1) blockers.push({ node: nodeOf(n), reason: `${n1} ${n1 === 1 ? "persona tiene" : "personas tienen"} la habilidad «${n.name}»`, path });
      const practiced = view.players.filter((p) => def.levels.some((l) => (p.crafts[l.practice.recipe] ?? 0) > 0)).length;
      if (practiced && !n1) blockers.push({ node: nodeOf(n), reason: `${practiced} ${practiced === 1 ? "persona lleva" : "personas llevan"} práctica de «${n.name}»`, path });
    }
    if (n.kind === "mision" && view.completedMissions.has(n.id)) blockers.push({ node: nodeOf(n), reason: `la misión «${n.name}» ya está cumplida (es un hecho histórico)`, path });
  }
  // lo que quedaría usándolo aun archivado todo el lote
  const after = withArchived(view, new Set(orderedKeys));
  for (const key of orderedKeys) {
    const n = graph.nodes.get(key)!;
    for (const use of usedBy(after as DesignView, n.kind as DefinitionKind, n.id).filter((u) => !u.startsWith("hay "))) blockers.push({ node: nodeOf(n), reason: use, path: pathTo(key) });
  }
  const plan = orderedKeys.map((k) => nodeOf(graph.nodes.get(k)!));
  const facts = {
    root: rootKey,
    order: orderedKeys.map((k) => { const n = graph.nodes.get(k)!; return { k, rev: n.rev, archived: n.archived }; }),
    stock: Object.fromEntries(orderedKeys.filter((k) => graph.nodes.get(k)!.kind === "objeto").map((k) => [k, view.stock(graph.nodes.get(k)!.id)])),
    holders: Object.fromEntries(orderedKeys.filter((k) => graph.nodes.get(k)!.kind === "habilidad").map((k) => [k, holders(graph.nodes.get(k)!.id)])),
    completed: orderedKeys.filter((k) => graph.nodes.get(k)!.kind === "mision" && view.completedMissions.has(graph.nodes.get(k)!.id)),
    blockers: blockers.map((b) => `${keyOf(b.node.kind, b.node.id)}|${b.reason}`).sort(),
    cycles: [...cycles].sort(),
  };
  return { root: nodeOf(root), order: plan, blockers, cycles, canonical: canonical(facts), executable: blockers.length === 0 };
}
