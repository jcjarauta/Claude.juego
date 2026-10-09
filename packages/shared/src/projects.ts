import {
  CONTRIBUTION_SOURCES, NOTE_MAX, REVIEW_DECISIONS, type ContributionSource, type RejectReason, type ReviewDecision,
} from "./contracts.ts";
import type { ProjectDef, TaskDef } from "./world-config.ts";

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
}

export type ContributionResult =
  | { ok: true; project: ProjectDef; task: TaskDef; from: ContributionSource; amount: number; requested: number }
  | { ok: false; reason: RejectReason };

export function checkContribution(input: ContributionInput): ContributionResult {
  const { projects, projectId, taskId, from, amount, contributed, balance } = input;
  const project = projects.find((p) => p.id === projectId);
  const task = project?.tasks.find((t) => t.id === taskId);
  if (!project || !task) return { ok: false, reason: "tarea-desconocida" };
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

/** Operaciones sobre proyectos sujetas a permiso. */
export type ProjectOperation = "contribute" | "review";

/**
 * Único punto de autorización del núcleo de proyectos (M5b). En el MVP hay una sola
 * comunidad y todos sus miembros aportan; solo los coordinadores revisan (Q161).
 * El actor es el nombre hasta que M6 introduzca cuentas (RF-003).
 */
export function authorize(actor: string, operation: ProjectOperation, project: ProjectDef): boolean {
  if (operation === "review") return project.coordinators.includes(actor);
  return true;
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
