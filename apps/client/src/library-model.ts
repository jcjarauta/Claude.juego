// Modelo puro de la Biblioteca (G2, Q248): una fila por definición con su versión, origen y estado, y la tabla de su historial.
// No toca el DOM: se prueba con estados de mentira.

export type LibraryKind = "objeto" | "receta" | "habilidad" | "mision" | "construccion";

export const LIBRARY_KINDS: readonly { kind: LibraryKind; plural: string; singular: string }[] = [
  { kind: "objeto", plural: "Objetos", singular: "objeto" },
  { kind: "receta", plural: "Recetas", singular: "receta" },
  { kind: "habilidad", plural: "Habilidades", singular: "habilidad" },
  { kind: "mision", plural: "Misiones", singular: "misión" },
  { kind: "construccion", plural: "Construcciones", singular: "construcción" },
];

export interface LibraryRow {
  kind: LibraryKind;
  id: string;
  name: string;
  /** «Configuración» o «Panel». */
  origin: string;
  /** Versión de contenido («v3»). */
  version: string;
  /** Estado en texto (nunca solo color). */
  status: string;
  /** Revisión de concurrencia. */
  rev: number;
  /** ¿Tiene historial? Solo lo creado en el panel: lo de la configuración no se edita. */
  hasHistory: boolean;
  /** ¿Se puede editar ahora? (pista para la pantalla; el servidor decide siempre). */
  editable: boolean;
  /** Si no se puede editar, por qué. */
  whyNot: string;
}

interface Entry { name: string; origin: string; version: number; rev: number }
interface Archivable extends Entry { archived: boolean }
interface MissionLike extends Archivable { status: string }
interface StructureLike extends Entry { built: boolean; retired: boolean }

/** Lo mínimo del estado sincronizado que lee la Biblioteca. */
export interface LibraryState {
  items: ReadonlyMap<string, Archivable>;
  recipes: ReadonlyMap<string, Archivable>;
  skills: ReadonlyMap<string, Archivable>;
  missions: ReadonlyMap<string, MissionLike>;
  structures: ReadonlyMap<string, StructureLike>;
  projects: ReadonlyMap<string, { phase: string }>;
}

const originText = (origin: string) => (origin === "panel" ? "Panel" : "Configuración");
const collator = new Intl.Collator("es", { sensitivity: "base" });

function row(kind: LibraryKind, id: string, e: Entry, status: string, whyNot = ""): LibraryRow {
  const panel = e.origin === "panel";
  return { kind, id, name: e.name, origin: originText(e.origin), version: `v${e.version || 1}`, status, rev: e.rev || 1, hasHistory: panel, editable: panel && !whyNot, whyNot: panel ? whyNot : "viene de la configuración" };
}

/** La versión de contenido vigente de una definición (1 si aún no consta). */
export function currentVersion(state: LibraryState, kind: LibraryKind, id: string): number {
  const map = kind === "objeto" ? state.items : kind === "receta" ? state.recipes : kind === "habilidad" ? state.skills : kind === "mision" ? state.missions : state.structures;
  return map.get(id)?.version || 1;
}

/** Las filas de un tipo, por nombre. */
export function libraryRows(state: LibraryState, kind: LibraryKind): LibraryRow[] {
  const rows: LibraryRow[] = [];
  const archivable = (map: ReadonlyMap<string, Archivable>) => { for (const [id, e] of map) rows.push(row(kind, id, e, e.archived ? "Archivado" : "Activo", e.archived ? "restáurala antes en Diseño" : "")); };
  if (kind === "objeto") archivable(state.items);
  else if (kind === "receta") archivable(state.recipes);
  else if (kind === "habilidad") archivable(state.skills);
  else if (kind === "mision") for (const [id, e] of state.missions) rows.push(row(kind, id, e, e.archived ? "Archivada" : e.status === "completada" ? "Cumplida" : "Pendiente", e.archived ? "restáurala antes en Diseño" : e.status === "completada" ? "ya está cumplida" : ""));
  else for (const [id, e] of state.structures) rows.push(row(kind, id, e, e.retired ? "Retirado" : e.built ? "Construido" : "Sin construir", e.retired ? "está retirado" : e.built ? "ya está construido" : state.projects.get(id)?.phase === "cerrado" ? "su proyecto está cerrado" : ""));
  return rows.sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

/** El nombre que tenía una definición en cierta versión, si lo dice (los objetos, recetas… tienen `name`; las construcciones, `project.name`). */
export function nameInVersion(definition: unknown): string {
  const d = definition as { name?: unknown; project?: { name?: unknown } } | null;
  if (typeof d?.name === "string") return d.name;
  if (typeof d?.project?.name === "string") return d.project.name;
  return "—";
}

export interface HistoryLike {
  version: number;
  rev: number;
  versions: readonly { version: number; definition: unknown; changedBy: string; changedAt: number; note: string }[];
}

/** Filas de la tabla del historial: versión, nombre en esa versión, quién, cuándo y la nota; la vigente va marcada. */
export function historyRows(history: HistoryLike, formatDate: (at: number) => string): string[][] {
  return history.versions.map((v) => [
    `v${v.version}${v.version === history.version ? " (vigente)" : ""}`,
    nameInVersion(v.definition),
    v.changedBy || "—",
    v.changedAt ? formatDate(v.changedAt) : "—",
    v.note || "—",
  ]);
}
