import {
  CONTRIBUTION_SOURCES, NOTE_MAX, REVIEW_DECISIONS, type ContributionSource, type RejectReason, type ReviewDecision,
} from "./contracts.ts";
import {
  makeId, PANEL_LIMITS, validateMissionDef, validateProjectDef, withProjectDefaults,
  type MissionDef, type ProjectDef, type TaskDef,
} from "./world-config.ts";

// Reglas puras de proyectos. El servidor las aplica dentro de una transacción con
// los saldos leídos de la base de datos.

export interface ContributionInput {
  projects: readonly ProjectDef[];
  projectId: unknown;
  taskId: unknown;
  from: unknown;
  amount: unknown;
  /** Lo ya aportado al proyecto en ese recurso. */
  contributed: (projectId: string, resource: string) => number;
  /** Saldo del origen (inventario propio o de la comunidad) en ese recurso. */
  balance: (from: ContributionSource, resource: string) => number;
  /** Proyecto cerrado (F1a): ya no admite aportes. */
  closed?: (projectId: string) => boolean;
}

export type ContributionResult =
  | { ok: true; project: ProjectDef; task: TaskDef; from: ContributionSource; amount: number; requested: number }
  | { ok: false; reason: RejectReason };

export function checkContribution(input: ContributionInput): ContributionResult {
  const { projects, projectId, taskId, from, amount, contributed, balance, closed } = input;
  const project = projects.find((p) => p.id === projectId);
  const task = project?.tasks.find((t) => t.id === taskId);
  if (!project || !task) return { ok: false, reason: "tarea-desconocida" };
  if (closed?.(project.id)) return { ok: false, reason: "proyecto-cerrado" };
  if (!CONTRIBUTION_SOURCES.includes(from as ContributionSource)) return { ok: false, reason: "origen-no-permitido" };
  if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > 1000) return { ok: false, reason: "solicitud-invalida" };
  const source = from as ContributionSource;
  const requested = amount as number;
  const remaining = task.required - contributed(project.id, task.resource);
  if (remaining <= 0) return { ok: false, reason: "tarea-completa" };
  if (balance(source, task.resource) < requested) return { ok: false, reason: "saldo-insuficiente" };
  // Q153: lo que excede lo que falta no se aporta; se queda en su origen.
  return { ok: true, project, task, from: source, amount: Math.min(requested, remaining), requested };
}

/** Operaciones sobre un proyecto sujetas a permiso. */
export type ProjectOperation = "contribute" | "review";
/** Operaciones sobre el mundo (F1a): solo la administración (Q171). */
export type WorldOperation = "create-project" | "close-project" | "create-mission";

/**
 * Único punto de autorización del núcleo de proyectos (M5b, F1a). Hay una sola comunidad y
 * todos sus miembros aportan; solo los coordinadores revisan (Q161); solo la administración
 * crea proyectos y misiones o cierra proyectos (Q171). El actor es el nombre de la cuenta (M6).
 */
export function authorize(actor: string, operation: ProjectOperation, project: ProjectDef): boolean;
export function authorize(actor: string, operation: WorldOperation, scope: { admins: readonly string[] }): boolean;
export function authorize(actor: string, operation: ProjectOperation | WorldOperation, scope: ProjectDef | { admins: readonly string[] }): boolean {
  if (operation === "review") return (scope as ProjectDef).coordinators.includes(actor);
  if (operation === "contribute") return true;
  return (scope as { admins: readonly string[] }).admins.includes(actor);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : v);

export interface CreateProjectInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  resourceIds: ReadonlySet<string>;
  resourceName: ReadonlyMap<string, string>;
  /** Proyectos abiertos ahora (configuración y panel). */
  openProjects: number;
  existingIds: ReadonlySet<string>;
  /** Sufijo aleatorio del id (lo pone el servidor; las pruebas lo fijan). */
  idSuffix: string;
}

export type CreateResult<T> = { ok: true; def: T } | { ok: false; reason: RejectReason; details?: string[] };

/** Crear un proyecto desde el panel (F1a, Q171–Q173): permiso, límite y la misma validación que la configuración. */
export function checkCreateProject(input: CreateProjectInput): CreateResult<ProjectDef> {
  const { actor, admins, payload, resourceIds, resourceName, openProjects, existingIds, idSuffix } = input;
  if (!authorize(actor, "create-project", { admins })) return { ok: false, reason: "sin-permiso" };
  if (openProjects >= PANEL_LIMITS.openProjects) return { ok: false, reason: "demasiados-proyectos" };
  const raw = isRecord(payload) ? payload : {};
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const id = makeId(name, idSuffix);
  if (existingIds.has(id)) return { ok: false, reason: "solicitud-invalida" };
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks.map((t) => (isRecord(t)
      ? {
        id: typeof t.resource === "string" ? t.resource : "", title: trimmed(t.title), resource: t.resource, required: t.required,
        acceptance: t.acceptance === "" ? undefined : trimmed(t.acceptance), ...(t.dueDate ? { dueDate: t.dueDate } : {}),
      }
      : t))
    : raw.tasks;
  const coordinators = raw.coordinators === undefined ? [actor] : Array.isArray(raw.coordinators) ? [...new Set(raw.coordinators.map(trimmed))] : raw.coordinators;
  const candidate = {
    id, name, description: trimmed(raw.description ?? ""), tasks, reality: "VIRTUAL", coordinators,
    buildRequiresApproval: raw.requiresApproval ?? false,
    ...(raw.dueDate ? { dueDate: raw.dueDate } : {}),
  };
  const errors = validateProjectDef(candidate, { resourceIds, limits: "panel", where: "proyecto" });
  if (errors.length) return { ok: false, reason: "definicion-invalida", details: errors };
  return { ok: true, def: withProjectDefaults(candidate as unknown as ProjectDef, resourceName) };
}

export interface CloseProjectInput {
  actor: string;
  admins: readonly string[];
  project: ProjectDef | undefined;
  /** Proyecto de content/world.json: no se cierra desde el panel. */
  fromConfig: boolean;
  closed: boolean;
}

export function checkCloseProject({ actor, admins, project, fromConfig, closed }: CloseProjectInput): { ok: true } | { ok: false; reason: RejectReason } {
  if (!authorize(actor, "close-project", { admins })) return { ok: false, reason: "sin-permiso" };
  if (!project) return { ok: false, reason: "proyecto-desconocido" };
  if (fromConfig) return { ok: false, reason: "proyecto-de-serie" };
  if (closed) return { ok: false, reason: "proyecto-cerrado" };
  return { ok: true };
}

export interface CreateMissionInput {
  actor: string;
  admins: readonly string[];
  payload: unknown;
  itemIds: ReadonlySet<string>;
  /** Proyectos abiertos a los que puede apuntar una misión nueva. */
  openProjectIds: ReadonlySet<string>;
  missions: number;
  existingIds: ReadonlySet<string>;
  idSuffix: string;
}

export const MAX_MISSIONS = 50;

/** Crear una misión desde el panel (Q174): objetivo «proyecto completado» u «objeto en la comunidad». */
export function checkCreateMission(input: CreateMissionInput): CreateResult<MissionDef> {
  const { actor, admins, payload, itemIds, openProjectIds, missions, existingIds, idSuffix } = input;
  if (!authorize(actor, "create-mission", { admins })) return { ok: false, reason: "sin-permiso" };
  if (missions >= MAX_MISSIONS) return { ok: false, reason: "demasiadas-misiones" };
  const raw = isRecord(payload) ? payload : {};
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const id = makeId(name, idSuffix);
  if (existingIds.has(id)) return { ok: false, reason: "solicitud-invalida" };
  const o = isRecord(raw.objective) ? raw.objective : {};
  const objective = o.kind === "project-completed" ? { kind: o.kind, project: o.project }
    : o.kind === "item-in-community" ? { kind: o.kind, item: o.item, amount: o.amount } : o;
  const candidate = { id, name, description: trimmed(raw.description ?? ""), objective };
  const errors = validateMissionDef(candidate, { itemIds, projectIds: openProjectIds, where: "misión" });
  if (errors.length) return { ok: false, reason: "definicion-invalida", details: errors };
  return { ok: true, def: candidate as unknown as MissionDef };
}

/** Estado de una tarea: el avance es automático; aprobar o rechazar es una decisión humana. */
export type TaskStatus = "pendiente" | "en-curso" | "completada" | ReviewDecision;

export function taskStatus(task: TaskDef, contributed: number, decision?: ReviewDecision | ""): TaskStatus {
  if (contributed >= task.required) return decision || "completada";
  return contributed > 0 ? "en-curso" : "pendiente";
}

export interface ReviewInput {
  projects: readonly ProjectDef[];
  actor: string;
  projectId: unknown;
  taskId: unknown;
  decision: unknown;
  note: unknown;
  contributed: (projectId: string, resource: string) => number;
}

export type ReviewResult =
  | { ok: true; project: ProjectDef; task: TaskDef; decision: ReviewDecision; note: string }
  | { ok: false; reason: RejectReason };

/** Revisar exige rol de coordinador, una decisión válida, nota de 1–500 caracteres y la tarea completada. */
export function checkReview(input: ReviewInput): ReviewResult {
  const { projects, actor, projectId, taskId, decision, note, contributed } = input;
  const project = projects.find((p) => p.id === projectId);
  const task = project?.tasks.find((t) => t.id === taskId);
  if (!project || !task) return { ok: false, reason: "tarea-desconocida" };
  if (!authorize(actor, "review", project)) return { ok: false, reason: "sin-permiso" };
  if (!REVIEW_DECISIONS.includes(decision as ReviewDecision)) return { ok: false, reason: "solicitud-invalida" };
  const text = typeof note === "string" ? note.trim() : "";
  if (!text || text.length > NOTE_MAX) return { ok: false, reason: "nota-invalida" };
  if (contributed(project.id, task.resource) < task.required) return { ok: false, reason: "tarea-sin-completar" };
  return { ok: true, project, task, decision: decision as ReviewDecision, note: text };
}

export type ProjectStatus = "en-curso" | "listo";

/** «listo» cuando todas las tareas tienen lo requerido (construir es M5). */
export function projectStatus(project: ProjectDef, contributed: (resource: string) => number): ProjectStatus {
  return project.tasks.every((t) => contributed(t.resource) >= t.required) ? "listo" : "en-curso";
}
