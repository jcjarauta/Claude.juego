import type { Room } from "@colyseus/sdk";
import { blockedBy, isTaskDone, type ProjectState, type WorldConfig, type WorldState } from "@juego/shared";

// Utilidades compartidas por las vistas de gestión del panel (F1b).

export type PanelRoom = Room<unknown, WorldState>;

export interface ViewContext {
  room: PanelRoom;
  config: WorldConfig;
  me: string;
  /** Proyecto elegido en el selector ("" = todos). */
  filter: () => string;
  announce: (text: string) => void;
  /** Envía una revisión (aprobada o rechazada) con nota. */
  review: (projectId: string, taskId: string, decision: "aprobada" | "rechazada", note: string) => void;
  /** Envía una replanificación. */
  reschedule: (projectId: string, taskId: string, dueDate: string, reason: string) => void;
  /** Apunta o quita a un responsable (F1c). */
  assign: (projectId: string, taskId: string, name: string, assign: boolean) => void;
  /** Abre el hilo de comentarios de una tarea (F1c). */
  openComments: (projectId: string, taskId: string, title: string, opener?: HTMLElement) => void;
  /** «Mis tareas»: solo las tareas de las que soy responsable (F1c). */
  mine: () => boolean;
}

/** Tareas que bloquean a otra (F1c, Q182): títulos de sus requisitos sin terminar. */
export function blockers(p: ProjectState, taskId: string): string[] {
  const task = p.tasks.get(taskId);
  if (!task) return [];
  const done = (id: string) => isTaskDone(p.tasks.get(id)?.status ?? "", p.requiresApproval);
  return blockedBy({ dependsOn: [...task.dependsOn] }, done).map((id) => p.tasks.get(id)?.title ?? id);
}

/** «Mis tareas»: con el filtro activo, solo las tareas en las que soy responsable. */
export const visibleTask = (ctx: ViewContext, p: ProjectState, taskId: string) =>
  !ctx.mine() || [...(p.tasks.get(taskId)?.assignees ?? [])].includes(ctx.me);

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  // Los valores iniciales también son los de `reset()` (si no, un formulario reiniciado dejaría los números vacíos).
  if (node instanceof HTMLInputElement) {
    if (typeof props.value === "string") node.defaultValue = props.value;
    if (typeof props.checked === "boolean") node.defaultChecked = props.checked;
  }
  node.append(...children);
  return node;
}

/** Proyectos visibles según el filtro, en orden de creación. */
export function visibleProjects(ctx: ViewContext): [string, ProjectState][] {
  const filter = ctx.filter();
  return [...ctx.room.state.projects.entries()]
    .filter(([id]) => !filter || id === filter)
    .sort(([, a], [, b]) => a.createdAt - b.createdAt);
}

/** Proyecto terminado (sin estructura: completado; con estructura: construido). */
export const projectDone = (p: ProjectState) => p.status === "completado" || p.status === "construido";

/** Tarea terminada: completa y, si se exige, aprobada. */
export const taskDone = (p: ProjectState, status: string) => status === "aprobada" || (status === "completada" && !p.requiresApproval);

/** Fecha legible «15 nov 2026» a partir de «AAAA-MM-DD». */
export function readableDate(day: string): string {
  if (!day) return "sin fecha";
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

/** Firma de los datos que pintan una vista: solo se repinta si cambia (no se pierde el foco con cada movimiento). */
export function signatureOf(ctx: ViewContext, extra = ""): string {
  return visibleProjects(ctx).map(([id, p]) => [
    id, p.status, p.phase, p.dueDate, p.reschedules,
    [...p.tasks.entries()].map(([t, s]) => `${t}:${s.status}:${s.decision}:${s.dueDate}:${s.reschedules}:${p.progress.get(s.resource) ?? 0}:${[...s.assignees].join("+")}:${s.comments}`).join(","),
    [...p.contributors.entries()].map(([n, c]) => `${n}=${[...c.totals.values()].join("+")}`).join(","),
  ].join("|")).join(";") + `#${ctx.filter()}#${ctx.mine()}#${extra}`;
}
