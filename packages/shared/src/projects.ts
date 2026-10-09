import { CONTRIBUTION_SOURCES, type ContributionSource, type RejectReason } from "./contracts.ts";
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

export type ProjectStatus = "en-curso" | "listo";

/** «listo» cuando todas las tareas tienen lo requerido (construir es M5). */
export function projectStatus(project: ProjectDef, contributed: (resource: string) => number): ProjectStatus {
  return project.tasks.every((t) => contributed(t.resource) >= t.required) ? "listo" : "en-curso";
}
