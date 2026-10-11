import { levelBadge, type AchievementSnapshot, type LevelBadge } from "./achievements.ts";
import { practiceProgress } from "./skills.ts";
import { skillDefFromState, type WorldState } from "./state.ts";

// Instantánea del estado sincronizado para los logros (G3d). La usan el cliente (con la sala) y las pruebas (con una sala real):
// el modelo se prueba con exactamente los mismos datos que ve la interfaz.

const record = (m: { entries(): IterableIterator<[string, number]> }): Record<string, number> => Object.fromEntries(m.entries());

export function achievementSnapshotFromState(state: WorldState, sessionId: string): AchievementSnapshot {
  const me = state.players.get(sessionId);
  if (!me) throw new Error("achievementSnapshotFromState(): el jugador propio aún no está en el estado");
  return {
    me: { name: me.name, skills: record(me.skills), crafts: record(me.crafts) },
    stock: record(state.community),
    structures: [...state.structures.entries()].map(([id, s]) => ({ id, name: s.name, origin: s.origin, built: s.built, builtBy: s.builtBy, projectId: s.projectId })),
    missions: [...state.missions.entries()].map(([id, m]) => ({
      id, name: m.name, origin: m.origin, createdBy: m.createdBy, completed: m.status === "completada", completedBy: m.completedBy,
      objective: m.objectiveKind === "project-completed" ? { kind: "project-completed", project: m.objectiveTarget } : { kind: "item-in-community", item: m.objectiveTarget, amount: m.objectiveAmount },
    })),
    projects: [...state.projects.entries()].map(([id, p]) => ({
      id, name: p.name, origin: p.origin, createdBy: p.createdBy, closed: p.phase === "cerrado",
      contributors: Object.fromEntries([...p.contributors.entries()].map(([name, c]) => [name, [...c.totals.values()].reduce((n, v) => n + v, 0)])),
      tasks: [...p.tasks.values()].map((t) => ({ resource: t.resource, required: t.required, contributed: p.progress.get(t.resource) ?? 0 })),
    })),
    skills: [...state.skills.entries()].map(([id, k]) => ({ id, name: k.name, levels: k.levels.map((l) => l.name) })),
  };
}

// ---------------------------------------------------------------- insignias de nivel del jugador

export interface SkillBadgeInfo {
  id: string;
  name: string;
  level: number;
  badge: LevelBadge;
  /** Progreso hacia el siguiente nivel en texto («Para Oficial: «Moler a mano» 1 de 3»), o undefined si ya está en el último. */
  next?: string;
}

/** Una insignia por habilidad del mundo, con forma y texto, y el progreso al siguiente nivel (`practiceProgress`). */
export function skillBadgesFromState(state: WorldState, sessionId: string): SkillBadgeInfo[] {
  const me = state.players.get(sessionId);
  if (!me) return [];
  return [...state.skills.entries()].map(([id, k]) => {
    const def = skillDefFromState(id, k);
    const level = me.skills.get(id) ?? 0;
    const progress = practiceProgress(def, level, (recipe) => me.crafts.get(recipe) ?? 0);
    const recipeName = progress ? state.recipes.get(progress.recipe)?.name ?? progress.recipe : "";
    return {
      id, name: def.name, level, badge: levelBadge(level, def.levels.map((l) => l.name)),
      ...(progress ? { next: `Para ${progress.name}: «${recipeName}» ${progress.done} de ${progress.times}` } : {}),
    };
  });
}
