import { schema, t, type SchemaType } from "@colyseus/schema";
import type { MissionDef, ProjectDef } from "./world-config.ts";

// Estado sincronizado: lo modifica solo el servidor; el cliente lo recibe tipado
// pasando WorldState a client.join(). De los nodos solo se sincronizan las
// unidades; posición, recurso y máximo están en la configuración.

export const Player = schema({
  name: t.string(),
  x: t.int16(),
  y: t.int16(),
  /** false durante el plazo de reconexión tras un corte inesperado. */
  connected: t.boolean(),
  /** Inventario individual: recurso → cantidad. */
  inventory: t.map("uint16"),
}, "Player");
export type Player = SchemaType<typeof Player>;

/** Un aporte reciente, para la actividad del proyecto. */
export const Contribution = schema({
  name: t.string(),
  taskId: t.string(),
  resource: t.string(),
  amount: t.uint16(),
  /** Hora del servidor (ms desde 1970). */
  at: t.float64(),
}, "Contribution");
export type Contribution = SchemaType<typeof Contribution>;

/** Totales aportados por un jugador: recurso → cantidad. */
export const ContributorTotals = schema({
  totals: t.map("uint16"),
}, "ContributorTotals");
export type ContributorTotals = SchemaType<typeof ContributorTotals>;

/** Estado de una tarea (M5b): avance automático y última revisión humana. */
export const TaskState = schema({
  /** Definición (F1a): los clientes leen las tareas del estado, no de /config. */
  title: t.string(),
  resource: t.string(),
  required: t.uint16(),
  acceptance: t.string(),
  /** Fecha objetivo vigente «AAAA-MM-DD» o "" (F1b). */
  dueDate: t.string(),
  /** Veces que se ha replanificado. */
  reschedules: t.uint16(),
  /** "pendiente" | "en-curso" | "completada" | "aprobada" | "rechazada" */
  status: t.string(),
  /** Última revisión: "" (ninguna), "aprobada" o "rechazada". */
  decision: t.string(),
  reviewedBy: t.string(),
  reviewedAt: t.float64(),
  note: t.string(),
}, "TaskState");
export type TaskState = SchemaType<typeof TaskState>;

export const ProjectState = schema({
  /** Definición (F1a). */
  name: t.string(),
  description: t.string(),
  /** "configuracion" (content/world.json) | "panel" (creado por la administración). */
  origin: t.string(),
  createdBy: t.string(),
  createdAt: t.float64(),
  /** "abierto" | "cerrado" (ya no admite aportes). */
  phase: t.string(),
  closedBy: t.string(),
  /** Completar exige todas las tareas aprobadas (Q162). */
  requiresApproval: t.boolean(),
  /** Fecha objetivo vigente «AAAA-MM-DD» o "" (F1b). */
  dueDate: t.string(),
  reschedules: t.uint16(),
  /** Con estructura: "en-curso" | "listo" | "construido". Sin estructura: "en-curso" | "en-revision" | "completado". */
  status: t.string(),
  /** Clasificación de realidad (Q163): en el MVP siempre "VIRTUAL". */
  reality: t.string(),
  /** Quién puede revisar tareas (Q161). */
  coordinators: t.array("string"),
  /** Estado de cada tarea por id. */
  tasks: t.map(TaskState),
  /** Aportado por recurso (= progreso de la tarea de ese recurso). */
  progress: t.map("uint16"),
  /** Quién aportó qué: nombre → totales. */
  contributors: t.map(ContributorTotals),
  /** Últimos aportes, del más antiguo al más reciente (máximo 10). */
  recent: t.array(Contribution),
}, "ProjectState");
export type ProjectState = SchemaType<typeof ProjectState>;

export const StructureState = schema({
  built: t.boolean(),
  builtBy: t.string(),
  builtAt: t.float64(),
}, "StructureState");
export type StructureState = SchemaType<typeof StructureState>;

export const MissionState = schema({
  /** Definición (F1a). */
  name: t.string(),
  description: t.string(),
  /** "item-in-community" | "project-completed" */
  objectiveKind: t.string(),
  /** Objeto o proyecto del objetivo. */
  objectiveTarget: t.string(),
  /** Cantidad (solo item-in-community). */
  objectiveAmount: t.uint16(),
  origin: t.string(),
  createdBy: t.string(),
  /** "pendiente" | "completada" */
  status: t.string(),
  completedBy: t.string(),
  completedAt: t.float64(),
}, "MissionState");
export type MissionState = SchemaType<typeof MissionState>;

export const WorldState = schema({
  players: t.map(Player),
  /** Unidades disponibles por id de nodo. */
  nodes: t.map("uint16"),
  /** Inventario de la comunidad: recurso → cantidad. */
  community: t.map("uint16"),
  communityName: t.string(),
  /** Proyectos por id. */
  projects: t.map(ProjectState),
  structures: t.map(StructureState),
  missions: t.map(MissionState),
}, "WorldState");
export type WorldState = SchemaType<typeof WorldState>;

/** Definición de un proyecto reconstruida desde el estado sincronizado (F1a). */
export function projectDefFromState(id: string, p: ProjectState): ProjectDef {
  return {
    id, name: p.name, description: p.description, reality: p.reality as ProjectDef["reality"],
    coordinators: [...p.coordinators], buildRequiresApproval: p.requiresApproval,
    ...(p.dueDate ? { dueDate: p.dueDate } : {}),
    tasks: [...p.tasks.entries()].map(([taskId, task]) => ({
      id: taskId, title: task.title, resource: task.resource, required: task.required, acceptance: task.acceptance,
      ...(task.dueDate ? { dueDate: task.dueDate } : {}),
    })),
  };
}

/** Definición de una misión reconstruida desde el estado sincronizado (F1a). */
export function missionDefFromState(id: string, m: MissionState): MissionDef {
  const objective: MissionDef["objective"] = m.objectiveKind === "project-completed"
    ? { kind: "project-completed", project: m.objectiveTarget }
    : { kind: "item-in-community", item: m.objectiveTarget, amount: m.objectiveAmount };
  return { id, name: m.name, description: m.description, objective };
}
