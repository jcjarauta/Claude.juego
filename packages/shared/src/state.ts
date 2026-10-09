import { schema, t, type SchemaType } from "@colyseus/schema";

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
  /** "en-curso" | "listo" (todas las tareas completas) | "construido" (M5). */
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
