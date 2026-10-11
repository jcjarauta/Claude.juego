import type { RejectReason } from "./contracts.ts";
import { canonical, identityHash, type HashFn } from "./canonical.ts";
import { solarProblems } from "./construction.ts";
import { authorize } from "./projects.ts";
import type { EditView } from "./versions.ts";

// Retirada de edificios (G2, Q246 y Q252). Un edificio de panel, también construido, se retira y se restaura. Retirar cambia lo que
// se puede hacer AHORA (estado operativo) y no toca lo que ya ocurrió (resultados históricos): ningún recurso, aporte, evento ni
// logro se elimina, y las misiones completadas siguen completadas. La restauración de construcciones tiene sus propias reglas
// (solar libre, proyecto no cerrado) y no se mezcla con restaurar un archivado.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface RetireAnalysis {
  /** Lo que cambia ahora. */
  operativo: {
    /** Recetas activas que lo usan como edificio o como extra y quedan «sin edificio». */
    recetas: string[];
    /** Tareas PENDIENTES de su proyecto que ya no podrán cumplirse. */
    tareasPendientes: string[];
    /** Misiones ACTIVAS (no cumplidas) que dependen de él. */
    misionesActivas: string[];
    /** Efecto sobre los objetivos (los guardados en cada navegador se avisan al recibir el cambio). */
    objetivos: string[];
    /** Otras dependencias. */
    dependencias: string[];
  };
  /** Lo que se conserva intacto, listado como tal. */
  historico: {
    misionesCompletadas: string[];
    aportaciones: string[];
    construccion: string;
    conservado: string[];
  };
  bloqueos: string[];
  /** Forma canónica de todo lo consultado (el servidor la firma: es la base del análisis). */
  canonical: string;
}

/** Texto fijo de lo que nunca se elimina al retirar. */
export const RETIRE_PRESERVES = [
  "Inventarios, existencias del almacén y objetos fabricados.",
  "Aportaciones del proyecto y quién las hizo.",
  "Eventos del registro y logros históricos.",
  "Misiones ya completadas (siguen completadas).",
] as const;

/** Qué pasaría si se retirara el edificio `structureId`. No cambia nada. */
export function analyzeRetire(view: EditView, structureId: string): RetireAnalysis {
  const structure = view.structures.find((s) => s.def.id === structureId);
  const project = view.projects.find((p) => p.def.id === structure?.def.projectId);
  const empty: RetireAnalysis = {
    operativo: { recetas: [], tareasPendientes: [], misionesActivas: [], objetivos: [], dependencias: [] },
    historico: { misionesCompletadas: [], aportaciones: [], construccion: "", conservado: [...RETIRE_PRESERVES] },
    bloqueos: [], canonical: "",
  };
  if (!structure) return { ...empty, bloqueos: ["No existe ese edificio."], canonical: canonical({ structureId, missing: true }) };
  const name = structure.def.name;
  const recipes = view.recipes.filter((r) => !r.archived && (r.def.structureId === structureId || r.def.alsoNeeds?.includes(structureId)));
  const out = empty.operativo;
  out.recetas = recipes.map((r) => `«${r.def.name}» (${r.def.structureId === structureId ? `se fabrica en «${name}»` : `exige «${name}»`})`);
  const pendingTasks = (project?.def.tasks ?? []).filter((t) => view.contributed(structureId, t.resource) < t.required);
  if (!structure.built) out.tareasPendientes = pendingTasks.map((t) => `«${t.title}» (${view.contributed(structureId, t.resource)} de ${t.required})`);
  const missionsOf = view.missions.filter((m) => m.def.objective.kind === "project-completed" && m.def.objective.project === structure.def.projectId);
  const completed = missionsOf.filter((m) => view.completedMissions.has(m.def.id));
  out.misionesActivas = missionsOf.filter((m) => !m.archived && !view.completedMissions.has(m.def.id)).map((m) => `«${m.def.name}» (pide completar «${project?.def.name ?? structure.def.projectId}»)`);
  // Misiones activas que piden un objeto que solo se fabrica en este edificio
  for (const m of view.missions) {
    if (m.archived || view.completedMissions.has(m.def.id) || m.def.objective.kind !== "item-in-community") continue;
    const item = m.def.objective.item;
    const producers = view.recipes.filter((r) => !r.archived && (r.def.output.item === item || r.def.byproducts?.some((b) => b.item === item)));
    if (producers.length && producers.every((r) => recipes.includes(r)) && view.stock(item) < m.def.objective.amount) out.misionesActivas.push(`«${m.def.name}» (solo se podía fabricar aquí «${view.items.find((i) => i.def.id === item)?.def.name ?? item}»)`);
  }
  out.objetivos = [
    ...(out.recetas.length ? [`Los objetivos que dependan de fabricar con ${recipes.map((r) => `«${r.def.name}»`).join(", ")} quedarán bloqueados.`] : []),
    ...(out.misionesActivas.length ? ["Los objetivos de esas misiones quedarán bloqueados."] : []),
    "Cada navegador avisa a su jugador si el objetivo que eligió deja de estar disponible.",
  ];
  for (const other of view.structures) {
    if (other.def.id === structureId || other.retired) continue;
    const dependents = recipes.filter((r) => r.def.structureId === other.def.id && r.def.alsoNeeds?.includes(structureId));
    if (dependents.length) out.dependencias.push(`«${other.def.name}» fabrica ${dependents.map((r) => `«${r.def.name}»`).join(", ")}, que además exige «${name}».`);
  }
  const h = empty.historico;
  h.misionesCompletadas = completed.map((m) => `«${m.def.name}»`);
  h.aportaciones = (project?.def.tasks ?? []).filter((t) => view.contributed(structureId, t.resource) > 0).map((t) => `${view.contributed(structureId, t.resource)} de ${t.resource}`);
  h.construccion = structure.built ? `Está construido: consta quién y cuándo lo construyó.` : "Aún no está construido.";
  const bloqueos: string[] = [];
  if (structure.retired) bloqueos.push(`«${name}» ya está retirado.`);
  const canonicalText = canonical({
    structureId, rev: view.meta("construccion", structureId)?.rev ?? 0, built: structure.built, retired: structure.retired,
    recetas: recipes.map((r) => [r.def.id, view.meta("receta", r.def.id)?.rev ?? 0]).sort(),
    pending: pendingTasks.map((t) => [t.resource, view.contributed(structureId, t.resource)]),
    misiones: missionsOf.map((m) => [m.def.id, view.completedMissions.has(m.def.id), m.archived]),
    dependencias: out.dependencias,
  });
  return { operativo: out, historico: h, bloqueos, canonical: canonicalText };
}

export type RetireResult =
  | { ok: true; analysis: RetireAnalysis }
  | { ok: false; reason: RejectReason; details?: string[]; analysis?: RetireAnalysis };

export interface RetireInput {
  actor: string;
  admins: readonly string[];
  /** `{ structureId, expectedRev, basis? }`. */
  payload: unknown;
  view: EditView;
  hash?: HashFn;
}

function parse(payload: unknown): { structureId: string; expectedRev: number; basis: string | undefined } | undefined {
  const raw = isRecord(payload) ? payload : {};
  if (typeof raw.structureId !== "string" || raw.structureId === "" || !Number.isInteger(raw.expectedRev) || (raw.expectedRev as number) < 0) return undefined;
  if (raw.basis !== undefined && typeof raw.basis !== "string") return undefined;
  return { structureId: raw.structureId, expectedRev: raw.expectedRev as number, basis: raw.basis as string | undefined };
}

function common(input: RetireInput, wantRetired: boolean): { ok: true; p: NonNullable<ReturnType<typeof parse>>; name: string } | { ok: false; reason: RejectReason; details?: string[] } {
  if (!authorize(input.actor, "create-project", { admins: input.admins })) return { ok: false, reason: "sin-permiso" };
  const p = parse(input.payload);
  if (!p) return { ok: false, reason: "solicitud-invalida" };
  const structure = input.view.structures.find((s) => s.def.id === p.structureId);
  const meta = input.view.meta("construccion", p.structureId);
  if (!structure || !meta) return { ok: false, reason: "definicion-invalida", details: ["No existe ese edificio."] };
  if (meta.origin !== "panel") return { ok: false, reason: "definicion-invalida", details: [`«${structure.def.name}» viene de la configuración y no se retira desde el panel.`] };
  if (meta.rev !== p.expectedRev) {
    const last = input.view.lastChange?.("construccion", p.structureId);
    return { ok: false, reason: "version-obsoleta", details: [`La revisión vigente es la ${meta.rev} y tú tenías la ${p.expectedRev}${last ? `: ${last}` : ""}.`] };
  }
  if (wantRetired && structure.retired) return { ok: false, reason: "definicion-invalida", details: [`«${structure.def.name}» ya está retirado.`] };
  if (!wantRetired && !structure.retired) return { ok: false, reason: "definicion-invalida", details: [`«${structure.def.name}» no está retirado.`] };
  return { ok: true, p, name: structure.def.name };
}

/** Retirar un edificio (administración): también construido. Siempre exige confirmar el análisis (`basis`); sin ella se devuelve. */
export function checkRetireStructure(input: RetireInput): RetireResult {
  const c = common(input, true);
  if (!c.ok) return c;
  const analysis = analyzeRetire(input.view, c.p.structureId);
  if (analysis.bloqueos.length) return { ok: false, reason: "definicion-en-uso", details: analysis.bloqueos, analysis };
  const basis = (input.hash ?? identityHash)(analysis.canonical);
  if (c.p.basis !== basis) return { ok: false, reason: "analisis-desactualizado", details: [c.p.basis === undefined ? "Revisa el análisis y confirma la retirada." : "Lo que depende de este edificio ha variado: revisa el análisis nuevo."], analysis };
  return { ok: true, analysis };
}

/**
 * Restaurar un edificio retirado (administración): reglas PROPIAS, distintas de restaurar un archivado — el solar debe seguir libre y
 * dentro del mapa, y su proyecto no puede estar cerrado.
 */
export function checkRestoreStructure(input: RetireInput): { ok: true } | { ok: false; reason: RejectReason; details?: string[] } {
  const c = common(input, false);
  if (!c.ok) return c;
  const view = input.view;
  const structure = view.structures.find((s) => s.def.id === c.p.structureId)!;
  const details: string[] = [];
  if (view.projects.find((p) => p.def.id === structure.def.projectId)?.closed) details.push(`El proyecto de «${c.name}» está cerrado: no se puede restaurar el edificio.`);
  const problems = solarProblems(structure.def, { ...view.map, structures: view.structures.filter((s) => !s.retired && s.def.id !== c.p.structureId).map((s) => s.def), side: view.limits.side });
  for (const problem of problems) details.push(`El solar de «${c.name}» ya no está libre: ${problem}.`);
  return details.length ? { ok: false, reason: "definicion-en-uso", details } : { ok: true };
}
