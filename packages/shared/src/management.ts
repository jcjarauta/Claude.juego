import { NOTE_MAX, type RejectReason } from "./contracts.ts";
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
  return { ok: true, project, taskId: taskId as string, dueDate, reason: text };
}
