import type { Snapshot } from "./objective.ts";
import { itemDefFromState, missionDefFromState, projectDefFromState, recipeDefFromState, skillDefFromState, structureDefFromState, type WorldState } from "./state.ts";
import type { WorldConfig } from "./world-config.ts";

// Instantánea del estado sincronizado para el modelo del objetivo (G3c). La usan el cliente (con la sala) y las pruebas
// (con el estado de una sala real): así el modelo se prueba con exactamente los mismos datos que ve la interfaz.

const record = (m: { entries(): IterableIterator<[string, number]> }): Record<string, number> => Object.fromEntries(m.entries());

export function snapshotFromState(
  state: WorldState,
  config: Pick<WorldConfig, "resources" | "nodes" | "inventoryMax">,
  sessionId: string,
  offers: Snapshot["offers"] = [],
): Snapshot {
  const me = state.players.get(sessionId);
  if (!me) throw new Error("snapshotFromState(): el jugador propio aún no está en el estado");
  const items = Object.fromEntries([...state.items.entries()].map(([id, i]) => [id, itemDefFromState(id, i).name]));
  return {
    me: { name: me.name, x: me.x, y: me.y, inventory: record(me.inventory), skills: record(me.skills), crafts: record(me.crafts) },
    inventoryMax: config.inventoryMax,
    stock: record(state.community),
    nodes: config.nodes.map((n) => ({ id: n.id, resource: n.resource, x: n.x, y: n.y, units: state.nodes.get(n.id) ?? 0 })),
    resources: Object.fromEntries(config.resources.map((r) => [r.id, r.name])),
    items,
    recipes: [...state.recipes.entries()].map(([id, r]) => recipeDefFromState(id, r)),
    structures: [...state.structures.entries()].map(([id, s]) => ({ def: structureDefFromState(id, s), built: s.built })),
    skills: [...state.skills.entries()].map(([id, k]) => skillDefFromState(id, k)),
    projects: [...state.projects.entries()].map(([id, p]) => ({
      def: projectDefFromState(id, p),
      contributed: record(p.progress),
      decisions: Object.fromEntries([...p.tasks.entries()].map(([taskId, t]) => [taskId, (t.decision as "" | "aprobada" | "rechazada")])),
      closed: p.phase === "cerrado",
      completed: p.status === "construido" || p.status === "completado",
      approvalMissing: p.requiresApproval && [...p.tasks.values()].some((t) => t.decision !== "aprobada"),
    })),
    missions: [...state.missions.entries()].map(([id, m]) => ({ def: missionDefFromState(id, m), completed: m.status === "completada" })),
    others: [...state.players.entries()].filter(([id]) => id !== sessionId).map(([, p]) => ({ name: p.name, x: p.x, y: p.y, connected: p.connected, skills: record(p.skills) })),
    offers,
    // Límites del planificador vigentes (G1): los edita la administración desde el panel.
    ...(state.limits.get("plannerDepth") && state.limits.get("plannerRoutes") ? { planner: { depth: state.limits.get("plannerDepth")!, routes: state.limits.get("plannerRoutes")! } } : {}),
  };
}
