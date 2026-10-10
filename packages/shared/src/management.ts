import { isValidName, NOTE_MAX, type RejectReason } from "./contracts.ts";
import type { ProjectDef } from "./world-config.ts";

// Gestión de proyectos (F1b): fechas objetivo, replanificación, tablero e indicadores.
// Reglas puras: el servidor valida con ellas y los clientes calculan las vistas con los
// mismos datos autoritativos (no hay otra fuente de verdad).

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Día de calendario «AAAA-MM-DD» que existe (2026-02-30 no vale). */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Día local de una marca de tiempo (cada navegador usa su zona; el servidor, la suya). */
export function localDay(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Días de `from` a `to` (positivo si `to` es posterior). */
export function daysBetween(from: string, to: string): number {
  const utc = (s: string) => { const [y, m, d] = s.split("-").map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d); };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Día `n` días antes o después. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Vencida: tiene fecha, ya pasó y no está terminada. */
export function isOverdue(dueDate: string | undefined, done: boolean, today: string): boolean {
  return Boolean(dueDate) && !done && dueDate! < today;
}

/** Columnas del tablero (Q178): una por estado de tarea. */
export const BOARD_COLUMNS = [
  { id: "pendiente", title: "Pendiente" },
  { id: "en-curso", title: "En curso" },
  { id: "completada", title: "Completada" },
  { id: "aprobada", title: "Aprobada" },
  { id: "rechazada", title: "Rechazada" },
] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number]["id"];

export function boardColumn(status: string): BoardColumn {
  return BOARD_COLUMNS.some((c) => c.id === status) ? status as BoardColumn : "pendiente";
}

/** Aportes de un día (historia de un proyecto). */
export interface DayAmount {
  day: string;
  amount: number;
}

/** Serie acumulada por día, en orden, para la gráfica de evolución. */
export function cumulativeSeries(days: readonly DayAmount[]): { day: string; total: number }[] {
  let total = 0;
  return [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).map(({ day, amount }) => ({ day, total: (total += amount) }));
}

export interface MetricsTask {
  resource: string;
  required: number;
  status: string;
}

export interface ProjectMetrics {
  required: number;
  contributed: number;
  /** 0–100, redondeado. */
  percent: number;
  byColumn: Record<BoardColumn, number>;
  /** Aportado en los últimos 7 días (hoy incluido); null sin historia. */
  last7: number | null;
  /** Días hasta la fecha objetivo (negativo: retraso); null sin fecha o terminado. */
  daysLeft: number | null;
  overdue: boolean;
}

/** Indicadores de un proyecto a partir del estado y, si se tiene, de su historia por día. */
export function projectMetrics(input: {
  tasks: readonly MetricsTask[];
  progress: (resource: string) => number;
  dueDate?: string;
  done: boolean;
  today: string;
  history?: readonly DayAmount[];
}): ProjectMetrics {
  const { tasks, progress, dueDate, done, today, history } = input;
  const required = tasks.reduce((n, t) => n + t.required, 0);
  const contributed = tasks.reduce((n, t) => n + Math.min(t.required, progress(t.resource)), 0);
  const byColumn = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, 0])) as Record<BoardColumn, number>;
  for (const t of tasks) byColumn[boardColumn(t.status)]++;
  const since = addDays(today, -6);
  const last7 = history ? history.filter((d) => d.day >= since && d.day <= today).reduce((n, d) => n + d.amount, 0) : null;
  return {
    required, contributed, percent: required ? Math.round((contributed / required) * 100) : 0, byColumn, last7,
    daysLeft: dueDate && !done ? daysBetween(today, dueDate) : null,
    overdue: isOverdue(dueDate, done, today),
  };
}

/** Errores de fechas de una definición de proyecto (Q176): formato y tareas que no vencen después del proyecto. */
export function dueDateErrors(p: { dueDate?: unknown; tasks?: unknown }, where: string): string[] {
  const errors: string[] = [];
  if (p.dueDate !== undefined && !isValidDate(p.dueDate)) errors.push(`${where}: dueDate debe ser una fecha AAAA-MM-DD`);
  if (Array.isArray(p.tasks)) {
    p.tasks.forEach((t, j) => {
      const due = (t as { dueDate?: unknown } | null)?.dueDate;
      if (due === undefined) return;
      if (!isValidDate(due)) errors.push(`${where}.tasks[${j}]: dueDate debe ser una fecha AAAA-MM-DD`);
      else if (isValidDate(p.dueDate) && due > p.dueDate) errors.push(`${where}.tasks[${j}]: dueDate no puede ser posterior a la del proyecto`);
    });
  }
  return errors;
}

export const REASON_MAX = NOTE_MAX;

export interface RescheduleInput {
  actor: string;
  admins: readonly string[];
  project: ProjectDef | undefined;
  closed: boolean;
  /** "" o ausente: el proyecto; si no, el id de la tarea. */
  taskId: unknown;
  dueDate: unknown;
  reason: unknown;
  /** Fechas vigentes (tras replanificaciones): la del proyecto y la de cada tarea. */
  projectDue: string;
  taskDues: Readonly<Record<string, string>>;
}

export type RescheduleResult =
  | { ok: true; project: ProjectDef; taskId: string; dueDate: string; reason: string }
  | { ok: false; reason: RejectReason };

/** Replanificar (Q177): coordinación o administración, fecha válida y coherente, y motivo de 1–500 caracteres. */
export function checkReschedule(input: RescheduleInput): RescheduleResult {
  const { actor, admins, project, closed, dueDate, projectDue, taskDues } = input;
  if (!project) return { ok: false, reason: "proyecto-desconocido" };
  const taskId = input.taskId === undefined || input.taskId === "" ? "" : input.taskId;
  if (taskId !== "" && !project.tasks.some((t) => t.id === taskId)) return { ok: false, reason: "tarea-desconocida" };
  if (!project.coordinators.includes(actor) && !admins.includes(actor)) return { ok: false, reason: "sin-permiso" };
  if (closed) return { ok: false, reason: "proyecto-cerrado" };
  if (!isValidDate(dueDate)) return { ok: false, reason: "fecha-invalida" };
  const text = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!text || text.length > REASON_MAX) return { ok: false, reason: "motivo-invalido" };
  if (taskId !== "" && projectDue && dueDate > projectDue) return { ok: false, reason: "fecha-invalida" };
  if (taskId === "" && Object.values(taskDues).some((d) => d && d > dueDate)) return { ok: false, reason: "fecha-invalida" };
  // Dependencias (F1c, Q182): una tarea no vence antes que sus requisitos ni después que las que dependen de ella.
  if (taskId !== "") {
    const task = project.tasks.find((t) => t.id === taskId)!;
    if ((task.dependsOn ?? []).some((dep) => taskDues[dep] && taskDues[dep]! > dueDate)) return { ok: false, reason: "fecha-invalida" };
    if (project.tasks.some((t) => (t.dependsOn ?? []).includes(taskId as string) && taskDues[t.id] && taskDues[t.id]! < dueDate)) {
      return { ok: false, reason: "fecha-invalida" };
    }
  }
  return { ok: true, project, taskId: taskId as string, dueDate, reason: text };
}

// --- F1c: dependencias, responsables y comentarios ---

/** Tarea terminada: aprobada, o completada si no se exige aprobación. */
export const isTaskDone = (status: string, requiresApproval: boolean) =>
  status === "aprobada" || (status === "completada" && !requiresApproval);

interface DepTask {
  id: string;
  dependsOn?: unknown;
  dueDate?: unknown;
}

/** Errores de dependencias de las tareas de un proyecto (Q182): ids conocidos, sin repetir, sin ciclos y fechas coherentes. */
export function dependencyErrors(tasks: readonly DepTask[], where: string): string[] {
  const errors: string[] = [];
  const ids = new Set(tasks.map((t) => t.id));
  const graph = new Map<string, string[]>();
  tasks.forEach((t, j) => {
    if (t.dependsOn === undefined) return graph.set(t.id, []);
    if (!Array.isArray(t.dependsOn) || !t.dependsOn.every((d) => typeof d === "string")) {
      errors.push(`${where}.tasks[${j}]: dependsOn debe ser una lista de ids de tareas`);
      return graph.set(t.id, []);
    }
    const deps = t.dependsOn as string[];
    if (new Set(deps).size !== deps.length) errors.push(`${where}.tasks[${j}]: dependsOn repite una tarea`);
    for (const d of deps) {
      if (d === t.id) errors.push(`${where}.tasks[${j}]: una tarea no puede depender de sí misma`);
      else if (!ids.has(d)) errors.push(`${where}.tasks[${j}]: depende de una tarea desconocida "${d}"`);
    }
    graph.set(t.id, deps.filter((d) => d !== t.id && ids.has(d)));
  });
  // Ciclos (búsqueda en profundidad con colores).
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    color.set(id, 1);
    for (const next of graph.get(id) ?? []) {
      if (color.get(next) === 1) return true;
      if (!color.get(next) && visit(next)) return true;
    }
    color.set(id, 2);
    return false;
  };
  if ([...graph.keys()].some((id) => !color.get(id) && visit(id))) errors.push(`${where}: las dependencias forman un ciclo`);
  // Fechas: una tarea no vence antes que aquellas de las que depende.
  const due = new Map(tasks.map((t) => [t.id, isValidDate(t.dueDate) ? t.dueDate : undefined]));
  tasks.forEach((t, j) => {
    const own = due.get(t.id);
    for (const d of graph.get(t.id) ?? []) {
      const dep = due.get(d);
      if (own && dep && own < dep) errors.push(`${where}.tasks[${j}]: no puede vencer antes que la tarea "${d}" de la que depende`);
    }
  });
  return errors;
}

/** Requisitos sin terminar de una tarea: si hay alguno, está bloqueada. */
export function blockedBy(task: { dependsOn?: readonly string[] }, done: (taskId: string) => boolean): string[] {
  return (task.dependsOn ?? []).filter((d) => !done(d));
}

/**
 * Cadena crítica (Q183): la cadena más larga de tareas pendientes encadenadas por dependencias,
 * en orden (primero el requisito). Sin duraciones, es una aproximación a la ruta crítica.
 */
export function criticalChain(tasks: readonly { id: string; dependsOn?: readonly string[] }[], done: (taskId: string) => boolean): string[] {
  const pending = new Map(tasks.filter((t) => !done(t.id)).map((t) => [t.id, (t.dependsOn ?? []).filter((d) => !done(d))]));
  const memo = new Map<string, string[]>();
  const longest = (id: string): string[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    let best: string[] = [];
    for (const dep of pending.get(id) ?? []) {
      if (!pending.has(dep)) continue;
      const chain = longest(dep);
      if (chain.length > best.length) best = chain;
    }
    const result = [...best, id];
    memo.set(id, result);
    return result;
  };
  let chain: string[] = [];
  for (const id of pending.keys()) {
    const c = longest(id);
    if (c.length > chain.length) chain = c;
  }
  return chain.length > 1 ? chain : [];
}

export const MAX_ASSIGNEES = 3;

export interface AssignInput {
  actor: string;
  admins: readonly string[];
  project: ProjectDef | undefined;
  closed: boolean;
  taskId: unknown;
  /** Cuenta que se asigna o se quita. */
  target: unknown;
  assign: boolean;
  assignees: readonly string[];
  taskDone: boolean;
}

export type AssignResult = { ok: true; project: ProjectDef; taskId: string; target: string; changed: boolean } | { ok: false; reason: RejectReason };

/** Responsables (Q181): la coordinación o la administración asignan a otros; cualquiera se apunta o se quita; máximo 3. */
export function checkAssign(input: AssignInput): AssignResult {
  const { actor, admins, project, closed, taskId, target, assign, assignees, taskDone } = input;
  if (!project) return { ok: false, reason: "proyecto-desconocido" };
  if (typeof taskId !== "string" || !project.tasks.some((t) => t.id === taskId)) return { ok: false, reason: "tarea-desconocida" };
  if (!isValidName(target)) return { ok: false, reason: "solicitud-invalida" };
  if (target !== actor && !project.coordinators.includes(actor) && !admins.includes(actor)) return { ok: false, reason: "sin-permiso" };
  if (closed) return { ok: false, reason: "proyecto-cerrado" };
  if (taskDone) return { ok: false, reason: "tarea-completa" };
  const present = assignees.includes(target);
  if (assign && !present && assignees.length >= MAX_ASSIGNEES) return { ok: false, reason: "demasiados-responsables" };
  return { ok: true, project, taskId, target, changed: assign !== present };
}

export const COMMENT_MAX = NOTE_MAX;

/** Comentario (Q184): 1–500 caracteres tras recortar. */
export function checkComment(text: unknown): { ok: true; text: string } | { ok: false; reason: RejectReason } {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value || value.length > COMMENT_MAX) return { ok: false, reason: "comentario-invalido" };
  return { ok: true, text: value };
}
