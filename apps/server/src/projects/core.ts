import { randomBytes } from "node:crypto";
import {
  authorize, blockedBy, checkAssign, checkCloseProject, checkComment, checkContribution, checkCreateConstruction, checkCreateItem, checkCreateMission,
  checkCreateProject, checkCreateRecipe, checkCreateSkill, checkGrantSkill, checkReschedule, checkReview, isTaskDone, isValidRequestId, levelAfterCraft,
  checkArchive, checkRestore, checkUpdateLimits, HARD_BUILD_LIMITS, LIMIT_KEYS, missionSatisfied, projectStatus, taskStatus,
  cascadePlan, checkEditDef, checkRestoreStructure, checkRestoreVersion, checkRetireStructure, keyOf,
  type BuildLimits, type CascadePlan, type ConstructionDef, type ContributionSource, type DefinitionKind, type DefMeta, type DefVersion, type DesignView, type EditableDef, type EditableKind, type EditView,
  type ItemDef, type MissionDef, type PlayerFacts, type ProjectDef, type RecipeDef, type RejectedMessage, type RetireAnalysis, type RejectReason, type ReviewDecision, type SkillDef,
  type StructureDef, type WorldConfig,
} from "@juego/shared";
import { canonicalHash } from "./hash.ts";
import { COMMUNITY, playerScope, projectScope, type ContributionRow, type ReviewRow, type Store } from "../store.ts";

// Núcleo de proyectos (M5b, ADR-001): fuente de verdad de proyectos, tareas y misiones.
// No conoce Colyseus ni el mapa: recibe el actor y el mensaje, valida con las reglas
// puras de @juego/shared, escribe en una transacción junto con su evento y devuelve
// un resultado que cada interfaz (mundo o panel) aplica a su estado sincronizado.
// F1a: además de los de la configuración, hay proyectos y misiones creados desde el panel.

export type Outcome<T> =
  | { kind: "done"; value: T }
  | { kind: "duplicate" }
  | { kind: "rejected"; reason: RejectReason; details?: string[]; analysis?: RejectedMessage["analysis"] };

/** Misión completada en la misma transacción que la operación que la cumple (Q158, Q174). */
export interface MissionCompleted {
  mission: MissionDef;
  by: string;
  at: number;
}

export interface ContributionDone {
  project: ProjectDef;
  taskId: string;
  resource: string;
  from: ContributionSource;
  amount: number;
  /** Saldo del origen tras el aporte. */
  sourceAmount: number;
  /** Total aportado a la tarea según el registro. */
  projectAmount: number;
  missions: MissionCompleted[];
}

export interface ReviewDone {
  project: ProjectDef;
  taskId: string;
  decision: ReviewDecision;
  note: string;
  reviewedBy: string;
  reviewedAt: number;
  missions: MissionCompleted[];
}

/** Definición de proyecto con su origen y su fase (F1a). */
export interface ProjectEntry {
  def: ProjectDef;
  origin: "configuracion" | "panel";
  createdBy: string;
  createdAt: number;
  closedBy: string;
  closedAt: number;
}

/** Estructura con su origen y su retirada (F2a). */
export interface StructureEntry {
  def: StructureDef;
  origin: "configuracion" | "panel";
  createdBy: string;
  retiredAt: number;
}

export interface ItemEntry {
  def: ItemDef;
  origin: "configuracion" | "panel";
}

export interface RecipeEntry {
  def: RecipeDef;
  origin: "configuracion" | "panel";
}

export interface SkillEntry {
  def: SkillDef;
  origin: "configuracion" | "panel";
}

/** Un nivel ganado (por práctica, concesión o enseñanza) en una transacción. */
export interface SkillGained {
  player: string;
  skill: string;
  level: number;
  source: "practica" | "concesion" | "ensenanza";
}

export interface MissionEntry {
  def: MissionDef;
  origin: "configuracion" | "panel";
  createdBy: string;
  createdAt: number;
}

/** Fechas vigentes de un proyecto y de sus tareas (F1b): la última replanificación o la de la definición. */
export interface Schedule {
  projectDue: string;
  projectCount: number;
  tasks: Record<string, { due: string; count: number }>;
}

export interface RescheduleDone {
  project: ProjectDef;
  taskId: string;
  dueDate: string;
  count: number;
}

export interface AssignDone {
  project: ProjectDef;
  taskId: string;
  assignees: string[];
}

export interface CommentDone {
  project: ProjectDef;
  taskId: string;
  count: number;
  last: { by: string; at: number; text: string };
}

export interface ProjectSnapshot {
  /** Aportado por recurso. */
  progress: Record<string, number>;
  /** Quién aportó qué: nombre → recurso → total. */
  contributors: Record<string, Record<string, number>>;
  /** Últimos aportes, del más antiguo al más reciente. */
  recent: ContributionRow[];
  /** Última revisión de cada tarea revisada, por id de tarea. */
  reviews: Record<string, ReviewRow>;
  /** Responsables por tarea (F1c). */
  assignees: Record<string, string[]>;
  /** Número de comentarios y el último, por tarea (F1c). */
  comments: Record<string, { count: number; last: { by: string; at: number; text: string } }>;
}

/** Resultado de editar o volver a una versión (G2). */
export interface EditDone {
  kind: EditableKind;
  id: string;
  /** Versión de contenido nueva y revisión de concurrencia nueva. */
  version: number;
  rev: number;
  def: EditableDef;
}

export const RECENT_CONTRIBUTIONS = 10;

export function createProjectCore(store: Store, config: WorldConfig) {
  // Registro en memoria: la configuración y lo guardado en la base. Solo cambia tras confirmar.
  const projects = new Map<string, ProjectEntry>();
  for (const def of config.projects) projects.set(def.id, { def, origin: "configuracion", createdBy: "", createdAt: 0, closedBy: "", closedAt: 0 });
  for (const row of store.getProjectDefs()) projects.set(row.def.id, { ...row, origin: "panel" });
  const missions = new Map<string, MissionEntry>();
  for (const def of config.missions) missions.set(def.id, { def, origin: "configuracion", createdBy: "", createdAt: 0 });
  for (const row of store.getMissionDefs()) missions.set(row.def.id, { ...row, origin: "panel" });

  // Estructuras, objetos y recetas: configuración + lo creado desde el panel (F2a).
  const structures = new Map<string, StructureEntry>();
  for (const def of config.structures) structures.set(def.id, { def, origin: "configuracion", createdBy: "", retiredAt: 0 });
  for (const row of store.getStructureDefs()) structures.set(row.def.id, { def: row.def, origin: "panel", createdBy: row.createdBy, retiredAt: row.retiredAt });
  const items = new Map<string, ItemEntry>();
  for (const def of config.items) items.set(def.id, { def, origin: "configuracion" });
  for (const row of store.getItemDefs()) items.set(row.def.id, { def: row.def, origin: "panel" });
  const recipes = new Map<string, RecipeEntry>();
  for (const def of config.recipes) recipes.set(def.id, { def, origin: "configuracion" });
  for (const row of store.getRecipeDefs()) recipes.set(row.def.id, { def: row.def, origin: "panel" });
  const skills = new Map<string, SkillEntry>();
  for (const def of config.skills) skills.set(def.id, { def, origin: "configuracion" });
  for (const row of store.getSkillDefs()) skills.set(row.def.id, { def: row.def, origin: "panel" });

  // Versiones de contenido y revisiones de concurrencia (G2, Q243, Q249). La v1 de cada definición del panel queda guardada tal cual
  // (`originals`) y las siguientes se aplican encima; sin fila de revisión, la revisión vale 1.
  const vkey = (kind: EditableKind, id: string) => `${kind}:${id}`;
  const originals = new Map<string, { definition: unknown; by: string; at: number }>();
  for (const row of store.getItemDefs()) originals.set(vkey("objeto", row.def.id), { definition: row.def, by: row.createdBy, at: row.createdAt });
  for (const row of store.getRecipeDefs()) originals.set(vkey("receta", row.def.id), { definition: row.def, by: row.createdBy, at: row.createdAt });
  for (const row of store.getSkillDefs()) originals.set(vkey("habilidad", row.def.id), { definition: row.def, by: row.createdBy, at: row.createdAt });
  for (const row of store.getMissionDefs()) originals.set(vkey("mision", row.def.id), { definition: row.def, by: row.createdBy, at: row.createdAt });
  for (const entry of structures.values()) {
    const project = projects.get(entry.def.id);
    if (entry.origin === "panel" && project) originals.set(vkey("construccion", entry.def.id), { definition: { project: project.def, structure: entry.def } satisfies ConstructionDef, by: entry.createdBy, at: project.createdAt });
  }
  const versionOfMap = new Map<string, number>();
  const revInfo = new Map<string, { rev: number; change: string; by: string; at: number }>();
  function applyDefinition(kind: EditableKind, id: string, def: unknown) {
    if (kind === "objeto") items.get(id)!.def = def as ItemDef;
    else if (kind === "receta") recipes.get(id)!.def = def as RecipeDef;
    else if (kind === "habilidad") skills.get(id)!.def = def as SkillDef;
    else if (kind === "mision") missions.get(id)!.def = def as MissionDef;
    else {
      const c = def as ConstructionDef;
      projects.get(id)!.def = c.project;
      structures.get(id)!.def = c.structure;
    }
  }
  for (const row of store.getAllDefVersions()) {
    const kind = row.kind as EditableKind;
    applyDefinition(kind, row.id, row.definition);
    versionOfMap.set(vkey(kind, row.id), row.version);
  }
  for (const r of store.getDefRevs()) revInfo.set(vkey(r.kind as EditableKind, r.id), { rev: r.rev, change: r.change, by: r.changedBy, at: r.changedAt });
  const versionOf = (kind: EditableKind, id: string) => versionOfMap.get(vkey(kind, id)) ?? 1;
  const revOf = (kind: EditableKind, id: string) => revInfo.get(vkey(kind, id))?.rev ?? 1;
  const originOf = (kind: EditableKind, id: string) => (kind === "objeto" ? items : kind === "receta" ? recipes : kind === "habilidad" ? skills : kind === "mision" ? missions : structures).get(id)?.origin;
  const metaOf = (kind: EditableKind, id: string): DefMeta | undefined => {
    const origin = originOf(kind, id);
    return origin ? { origin, version: versionOf(kind, id), rev: revOf(kind, id) } : undefined;
  };
  const skillDefs = () => new Map(activeSkills().map((e) => [e.def.id, e.def]));
  const activeStructures = () => [...structures.values()].filter((e) => !e.retiredAt);

  const resourceIds = new Set(config.resources.map((r) => r.id));
  const resourceName = new Map(config.resources.map((r) => [r.id, r.name.toLowerCase()]));
  const nodeCells = new Set(config.nodes.map((n) => `${n.x},${n.y}`));
  // Límites de diseño vigentes (G1, Q237): los de la configuración con lo que la administración haya guardado desde el panel.
  const loadLimits = (): BuildLimits => {
    const merged: BuildLimits = { ...config.buildLimits };
    try {
      const saved = JSON.parse(store.getSetting("buildLimits") ?? "{}") as Record<string, unknown>;
      for (const key of LIMIT_KEYS) {
        const v = saved[key];
        if (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= HARD_BUILD_LIMITS[key]) merged[key] = v as number;
      }
    } catch { /* ajuste corrupto: se usan los de la configuración */ }
    return merged;
  };
  let limits: BuildLimits = loadLimits();

  // Archivo (G1, Q240): nada se borra; una definición archivada no se usa ni se muestra y conserva su historial.
  const archived = new Set(store.getArchived().map((a) => `${a.kind}:${a.id}`));
  const isArchived = (kind: DefinitionKind, id: string) => archived.has(`${kind}:${id}`);
  const activeItems = () => [...items.values()].filter((e) => !isArchived("objeto", e.def.id));
  const activeRecipes = () => [...recipes.values()].filter((e) => !isArchived("receta", e.def.id));
  const activeSkills = () => [...skills.values()].filter((e) => !isArchived("habilidad", e.def.id));
  const activeMissions = () => [...missions.values()].filter((e) => !isArchived("mision", e.def.id));
  const itemIds = () => new Set(activeItems().map((e) => e.def.id));
  const designView = (): DesignView => ({
    items: [...items.values()].map((e) => ({ def: e.def, archived: isArchived("objeto", e.def.id) })),
    recipes: [...recipes.values()].map((e) => ({ def: e.def, archived: isArchived("receta", e.def.id) })),
    skills: [...skills.values()].map((e) => ({ def: e.def, archived: isArchived("habilidad", e.def.id) })),
    missions: [...missions.values()].map((e) => ({ def: e.def, archived: isArchived("mision", e.def.id) })),
    resourceNames: config.resources.map((r) => r.name),
    stock: (id) => store.getAmount(COMMUNITY, id),
  });
  /** Personas con sus niveles y su práctica (para los análisis de edición, G2). */
  const playerFacts = (): PlayerFacts[] => {
    const byName = new Map<string, { skills: Record<string, number>; crafts: Record<string, number> }>();
    const of = (name: string) => byName.get(name) ?? byName.set(name, { skills: {}, crafts: {} }).get(name)!;
    for (const r of store.getAllPlayerSkills()) of(r.player).skills[r.skill] = r.level;
    for (const r of store.getAllCraftCounts()) of(r.player).crafts[r.recipe] = r.n;
    return [...byName.entries()].map(([name, v]) => ({ name, ...v }));
  };
  /** Todo lo que las reglas de edición, retirada y cascada necesitan, leído del estado actual (dentro de la transacción en curso). */
  const editView = (offers: readonly { skill: string; level: number }[] = []): EditView => {
    const built = new Set(store.getStructures().map((s) => s.id));
    return {
      ...designView(),
      structures: [...structures.values()].map((e) => ({ def: e.def, built: built.has(e.def.id), retired: Boolean(e.retiredAt) })),
      projects: [...projects.values()].map((e) => ({ def: e.def, closed: Boolean(e.closedAt) })),
      meta: metaOf,
      lastChange: (kind, id) => { const r = revInfo.get(vkey(kind, id)); return r ? `${r.change} (${r.by})` : undefined; },
      resourceIds, limits,
      map: { width: config.map.width, height: config.map.height, nodeCells, spawn: config.spawn },
      contributed: (projectId, resource) => store.contributedAmount(projectId, resource),
      players: playerFacts(), offers,
      completedMissions: new Set(store.getMissions().map((m) => m.id)),
    };
  };
  const entryName = (id: string) => items.get(id)?.def.name ?? config.resources.find((r) => r.id === id)?.name ?? id;
  const allProjects = () => [...projects.values()].map((e) => e.def);
  const projectById = (id: unknown) => (typeof id === "string" ? projects.get(id)?.def : undefined);
  const isClosed = (id: string) => Boolean(projects.get(id)?.closedAt);
  const structureOf = (projectId: string) => [...structures.values()].find((e) => e.def.projectId === projectId)?.def;
  // Lo aportado sale del registro: no disminuye cuando la construcción consume los materiales.
  const contributed = (projectId: string, resource: string) => store.contributedAmount(projectId, resource);
  const suffix = () => randomBytes(3).toString("hex");

  function scheduleOf(project: ProjectDef): Schedule {
    const schedule: Schedule = {
      projectDue: project.dueDate ?? "", projectCount: 0,
      tasks: Object.fromEntries(project.tasks.map((t) => [t.id, { due: t.dueDate ?? "", count: 0 }])),
    };
    for (const change of store.getScheduleChanges(project.id)) {
      if (change.taskId === "") {
        schedule.projectDue = change.dueDate;
        schedule.projectCount++;
      } else if (schedule.tasks[change.taskId]) {
        schedule.tasks[change.taskId]!.due = change.dueDate;
        schedule.tasks[change.taskId]!.count++;
      }
    }
    return schedule;
  }

  /** Tarea terminada ahora (F1c): completa por lo aportado y, si se exige, aprobada. */
  function taskDoneNow(project: ProjectDef, taskId: string): boolean {
    const task = project.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    const decision = store.getReviews(project.id).find((r) => r.taskId === taskId)?.decision as "aprobada" | "rechazada" | undefined;
    return isTaskDone(taskStatus(task, contributed(project.id, task.resource), decision ?? ""), project.buildRequiresApproval);
  }

  /** Bloqueada (Q182): alguna tarea de la que depende no está terminada. */
  function isBlocked(projectId: string, taskId: string): boolean {
    const project = projectById(projectId);
    const task = project?.tasks.find((t) => t.id === taskId);
    return Boolean(project && task && blockedBy(task, (dep) => taskDoneNow(project, dep)).length);
  }

  function assignment(actor: string, payload: unknown, assign: boolean): Outcome<AssignDone> {
    const message = (payload ?? {}) as Record<string, unknown>;
    if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
    const requestId = message.requestId;
    const at = Date.now();
    return store.transaction((): Outcome<AssignDone> => {
      if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
      const project = projectById(message.projectId);
      const taskId = typeof message.taskId === "string" ? message.taskId : "";
      // La persona asignada debe tener cuenta; se guarda su nombre tal como está registrado.
      const account = typeof message.name === "string" ? store.getAccountByName(message.name) : undefined;
      if (assign && typeof message.name === "string" && !account) return { kind: "rejected", reason: "solicitud-invalida" };
      const target = account?.name ?? message.name;
      const current = project ? store.getAssignees(project.id)[taskId] ?? [] : [];
      const check = checkAssign({
        actor, admins: config.admins, project, closed: Boolean(project && isClosed(project.id)), taskId, target, assign,
        assignees: current, taskDone: Boolean(project && taskDoneNow(project, taskId)),
      });
      if (!check.ok) return { kind: "rejected", reason: check.reason };
      if (check.changed) {
        if (assign) store.addAssignee(check.project.id, check.taskId, check.target, actor, at);
        else store.removeAssignee(check.project.id, check.taskId, check.target);
        store.event(assign ? "task-assigned" : "task-unassigned", actor, requestId, { project: check.project.id, task: check.taskId, name: check.target });
      }
      return { kind: "done", value: { project: check.project, taskId: check.taskId, assignees: store.getAssignees(check.project.id)[check.taskId] ?? [] } };
    });
  }

  const isComplete = (project: ProjectDef) => project.tasks.every((t) => contributed(project.id, t.resource) >= t.required);

  /** Con aprobación obligatoria (Q162), alguna tarea no está aprobada. */
  function approvalMissing(project: ProjectDef): boolean {
    if (!project.buildRequiresApproval) return false;
    const decisions = new Map(store.getReviews(project.id).map((r) => [r.taskId, r.decision]));
    return project.tasks.some((t) => decisions.get(t.id) !== "aprobada");
  }

  /** Completado: con estructura, construida; sin estructura, tareas completas y aprobadas si se exige (Q173). */
  function projectCompleted(projectId: string): boolean {
    const project = projectById(projectId);
    if (!project) return false;
    const structure = structureOf(projectId);
    if (structure) return store.getStructures().some((s) => s.id === structure.id);
    return isComplete(project) && !approvalMissing(project);
  }

  function changeArchive(actor: string, payload: unknown, archive: boolean): Outcome<{ kind: DefinitionKind; id: string; rev: number }> {
    const message = (payload ?? {}) as Record<string, unknown>;
    if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
    const requestId = message.requestId;
    const at = Date.now();
    const outcome = store.transaction((): Outcome<{ kind: DefinitionKind; id: string; rev: number }> => {
      if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
      const input = { actor, admins: config.admins, payload, view: designView() };
      const check = archive ? checkArchive(input) : checkRestore(input);
      if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
      const kind = message.kind as DefinitionKind;
      const id = message.id as string;
      // Revisión de concurrencia (G2, Q249): si la pantalla se abrió sobre un estado anterior, no se aplica.
      if (!Number.isInteger(message.expectedRev)) return { kind: "rejected", reason: "solicitud-invalida" };
      const currentRev = revOf(kind, id);
      if (message.expectedRev !== currentRev) {
        const last = revInfo.get(vkey(kind, id));
        return { kind: "rejected", reason: "version-obsoleta", details: [`La revisión vigente es la ${currentRev} y tú tenías la ${message.expectedRev}${last ? `: ${last.change} (${last.by})` : ""}.`] };
      }
      if (archive) store.addArchive(kind, id, actor, at); else store.removeArchive(kind, id);
      const rev = store.bumpDefRev(kind, id, actor, at, archive ? "archivada" : "restaurada");
      store.event(archive ? "def-archived" : "def-restored", actor, requestId, { kind, id });
      return { kind: "done", value: { kind, id, rev } };
    });
    if (outcome.kind === "done") {
      const key = `${outcome.value.kind}:${outcome.value.id}`;
      if (archive) archived.add(key); else archived.delete(key);
      revInfo.set(key, { rev: outcome.value.rev, change: archive ? "archivada" : "restaurada", by: actor, at });
    }
    return outcome;
  }

  const analysisOf = (a: { bloqueos: string[]; avisos: string[]; efectos: string[]; canonical: string }, extra: Record<string, unknown> = {}): RejectedMessage["analysis"] =>
    ({ bloqueos: a.bloqueos, avisos: a.avisos, efectos: a.efectos, basis: canonicalHash(a.canonical), ...extra });

  /** El análisis de una retirada con la forma común de los análisis: lo operativo como avisos y lo histórico como efectos que se conservan. */
  const retireAnalysisOf = (a: RetireAnalysis): RejectedMessage["analysis"] => analysisOf({
    bloqueos: a.bloqueos,
    avisos: [
      ...a.operativo.recetas.map((r) => `Receta que queda sin edificio: ${r}`),
      ...a.operativo.tareasPendientes.map((t) => `Tarea pendiente que ya no podrá cumplirse: ${t}`),
      ...a.operativo.misionesActivas.map((m) => `Misión activa afectada: ${m}`),
      ...a.operativo.objetivos, ...a.operativo.dependencias,
    ],
    efectos: [
      ...a.historico.misionesCompletadas.map((m) => `Misión completada, se conserva: ${m}`),
      ...a.historico.aportaciones.map((x) => `Aportación, se conserva: ${x}`),
      a.historico.construccion, ...a.historico.conservado.map((c) => `Se conserva: ${c}`),
    ].filter(Boolean),
    canonical: a.canonical,
  }, { operativo: a.operativo, historico: a.historico });

  function writeVersion(actor: string, payload: unknown, offers: readonly { skill: string; level: number }[], fromHistory: boolean): Outcome<EditDone> {
    const message = (payload ?? {}) as Record<string, unknown>;
    if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
    const requestId = message.requestId;
    const at = Date.now();
    const outcome = store.transaction((): Outcome<EditDone> => {
      if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
      const view = editView(offers);
      let check;
      if (fromHistory) {
        const history = typeof message.kind === "string" && typeof message.id === "string" ? this_history(message.kind as EditableKind, message.id) : undefined;
        check = checkRestoreVersion({ actor, admins: config.admins, payload, view, versions: history ?? [], hash: canonicalHash });
      } else {
        check = checkEditDef({ actor, admins: config.admins, payload, view, hash: canonicalHash });
      }
      if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details, ...(check.analysis ? { analysis: analysisOf(check.analysis) } : {}) };
      // Una construcción: los coordinadores deben tener cuenta (igual que al crearla).
      if (check.kind === "construccion") {
        const next = check.next as ConstructionDef;
        const unknown = next.project.coordinators.filter((name) => !store.getAccountByName(name));
        if (unknown.length) return { kind: "rejected", reason: "definicion-invalida", details: unknown.map((n) => `coordinador sin cuenta: "${n}"`) };
        next.project.coordinators = next.project.coordinators.map((n) => store.getAccountByName(n)!.name);
      }
      store.addDefVersion(check.kind, check.id, check.newVersion, check.next, actor, at, check.note);
      const rev = store.bumpDefRev(check.kind, check.id, actor, at, `${fromHistory ? "vuelve a una versión anterior" : "editada"} (v${check.newVersion})`);
      store.event(fromHistory ? "def-version-restored" : "def-edited", actor, requestId, { kind: check.kind, id: check.id, version: check.newVersion, note: check.note });
      return { kind: "done", value: { kind: check.kind, id: check.id, version: check.newVersion, rev, def: check.next } };
    });
    if (outcome.kind === "done") {
      const v = outcome.value;
      applyDefinition(v.kind, v.id, v.def);
      versionOfMap.set(vkey(v.kind, v.id), v.version);
      revInfo.set(vkey(v.kind, v.id), { rev: v.rev, change: `${fromHistory ? "vuelve a una versión anterior" : "editada"} (v${v.version})`, by: actor, at });
    }
    return outcome;
  }

  /** Historial completo de una definición como lista de versiones (la 1 desde su tabla original). */
  function this_history(kind: EditableKind, id: string): DefVersion[] | undefined {
    const original = originals.get(vkey(kind, id));
    if (!original) return undefined;
    return [{ version: 1, definition: original.definition, changedBy: original.by, changedAt: original.at, note: "Versión original" },
      ...store.getDefVersions(kind, id).map((v) => ({ version: v.version, definition: v.definition, changedBy: v.changedBy, changedAt: v.changedAt, note: v.note }))];
  }

  const retireAnalysis = (check: object): RetireAnalysis | undefined => (check as { analysis?: RetireAnalysis }).analysis;

  function changeStructure(actor: string, payload: unknown, offers: readonly { skill: string; level: number }[], retire: boolean): Outcome<{ structureId: string; rev: number }> {
    const message = (payload ?? {}) as Record<string, unknown>;
    if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
    const requestId = message.requestId;
    const at = Date.now();
    const outcome = store.transaction((): Outcome<{ structureId: string; rev: number }> => {
      if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
      const input = { actor, admins: config.admins, payload, view: editView(offers), hash: canonicalHash };
      const check = retire ? checkRetireStructure(input) : checkRestoreStructure(input);
      if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details, ...(retireAnalysis(check) ? { analysis: retireAnalysisOf(retireAnalysis(check)!) } : {}) };
      const structureId = message.structureId as string;
      if (retire) store.retireStructureDef(structureId, at); else store.unretireStructureDef(structureId);
      const rev = store.bumpDefRev("construccion", structureId, actor, at, retire ? "retirada" : "restaurada");
      store.event(retire ? "structure-retired" : "structure-restored", actor, requestId, { structure: structureId });
      return { kind: "done", value: { structureId, rev } };
    });
    if (outcome.kind === "done") {
      const entry = structures.get(outcome.value.structureId)!;
      structures.set(entry.def.id, { ...entry, retiredAt: retire ? at : 0 });
      revInfo.set(vkey("construccion", entry.def.id), { rev: outcome.value.rev, change: retire ? "retirada" : "restaurada", by: actor, at });
    }
    return outcome;
  }

  /**
   * Completa, dentro de la transacción en curso, las misiones cuyo objetivo se cumple por
   * primera vez. `extra` son misiones aún no registradas en memoria (la que se está creando).
   */
  function completeMissions(actor: string, at: number, extra: MissionDef[] = []): MissionCompleted[] {
    const done = new Set(store.getMissions().map((m) => m.id));
    const stock = (id: string) => store.getAmount(COMMUNITY, id);
    const completed: MissionCompleted[] = [];
    for (const mission of [...activeMissions().map((e) => e.def), ...extra]) {
      if (done.has(mission.id) || !missionSatisfied(mission, { stock, projectCompleted })) continue;
      const missionVersion = versionOf("mision", mission.id);
      store.completeMission(mission.id, actor, at, missionVersion);
      store.event("mission-complete", actor, null, { mission: mission.id, missionVersion });
      completed.push({ mission, by: actor, at });
    }
    return completed;
  }

  return {
    projectById,
    projects: allProjects,
    scheduleOf,
    isBlocked,
    structureOf,
    structureById: (id: unknown) => (typeof id === "string" ? structures.get(id)?.def : undefined),
    recipeById: (id: unknown) => (typeof id === "string" && !isArchived("receta", id) ? recipes.get(id)?.def : undefined),
    structureEntries: () => [...structures.values()],
    itemEntries: () => [...items.values()],
    recipeEntries: () => [...recipes.values()],
    skillEntries: () => [...skills.values()],
    skillById: (id: unknown) => (typeof id === "string" && !isArchived("habilidad", id) ? skills.get(id)?.def : undefined),
    /** Diseño (G1): límites vigentes y archivo. */
    limits: () => limits,
    isArchived,
    designView,
    skillDefs,

    /** Nivel de una persona en cada habilidad y veces que ha fabricado cada receta (F2c). */
    skillsOf: (player: string) => store.getPlayerSkills(player),
    craftCountsOf: (player: string) => store.getCraftCounts(player),

    /** Crear una habilidad desde el panel (F2c, Q195). */
    createSkill(actor: string, payload: unknown): Outcome<SkillEntry> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      const outcome = store.transaction((): Outcome<SkillEntry> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const check = checkCreateSkill({
          actor, admins: config.admins, payload, recipes: new Map(activeRecipes().map((e) => [e.def.id, e.def])), existingIds: new Set(skills.keys()),
          takenNames: activeSkills().map((e) => e.def.name), created: activeSkills().filter((e) => e.origin === "panel").length, limits, idSuffix: suffix(),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        store.addSkillDef(check.def, actor, at);
        store.event("skill-created", actor, requestId, { skill: check.def });
        return { kind: "done", value: { def: check.def, origin: "panel" } };
      });
      if (outcome.kind === "done") {
        skills.set(outcome.value.def.id, outcome.value);
        originals.set(vkey("habilidad", outcome.value.def.id), { definition: outcome.value.def, by: actor, at });
      }
      return outcome;
    },

    /** Conceder un nivel (administración, F2c, Q197): solo sube. */
    grantSkill(actor: string, payload: unknown): Outcome<SkillGained> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      return store.transaction((): Outcome<SkillGained> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const account = typeof message.name === "string" ? store.getAccountByName(message.name) : undefined;
        const skillId = typeof message.skill === "string" ? message.skill : "";
        const check = checkGrantSkill({
          actor, admins: config.admins, payload, skills: skillDefs(), account: account?.name,
          currentLevel: account ? store.getPlayerSkills(account.name)[skillId] ?? 0 : 0,
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        const { target, skill, level } = check.def;
        const skillVersion = versionOf("habilidad", skill);
        store.setPlayerSkill(target, skill, level, "concesion", at, skillVersion);
        store.event("skill-granted", actor, requestId, { player: target, skill, level, skillVersion });
        return { kind: "done", value: { player: target, skill, level, source: "concesion" } };
      });
    },

    /**
     * Enseñanza aceptada (F2c, Q198): sube a `learner` al nivel `toLevel` si el maestro sigue teniendo al menos uno más
     * y la persona aún está justo un nivel por debajo. La cercanía y la conexión las comprueba la sala (sin esperas entre medias).
     */
    teach(learner: string, requestId: string, teacher: string, skillId: string, toLevel: number, offeredVersion?: number): Outcome<SkillGained> {
      const at = Date.now();
      return store.transaction((): Outcome<SkillGained> => {
        if (store.hasRequest(learner, requestId)) return { kind: "duplicate" };
        const def = isArchived("habilidad", skillId) ? undefined : skills.get(skillId)?.def;
        const teacherLevel = store.getPlayerSkills(teacher)[skillId] ?? 0;
        const learnerLevel = store.getPlayerSkills(learner)[skillId] ?? 0;
        if (!def || learnerLevel + 1 !== toLevel || toLevel > def.levels.length || toLevel > teacherLevel - 1) {
          return { kind: "rejected", reason: "oferta-invalida", details: ["La oferta ya no es válida: han cambiado los niveles."] };
        }
        const skillVersion = versionOf("habilidad", skillId);
        store.setPlayerSkill(learner, skillId, toLevel, "ensenanza", at, skillVersion);
        store.event("skill-taught", learner, requestId, { teacher, skill: skillId, level: toLevel, skillVersion, ...(offeredVersion === undefined ? {} : { offeredVersion }) });
        return { kind: "done", value: { player: learner, skill: skillId, level: toLevel, source: "ensenanza" } };
      });
    },

    /**
     * Cuenta una fabricación para practicar (F2c, Q196) y devuelve los niveles ganados. Debe llamarse dentro de la
     * transacción de `craft`, para que cuente solo si la fabricación se confirma.
     */
    recordPractice(player: string, recipeId: string): SkillGained[] {
      store.incCraftCount(player, recipeId);
      const counts = store.getCraftCounts(player);
      const levels = store.getPlayerSkills(player);
      const gained: SkillGained[] = [];
      for (const { def } of activeSkills()) {
        const current = levels[def.id] ?? 0;
        const next = levelAfterCraft(def, current, recipeId, (r) => counts[r] ?? 0);
        if (next <= current) continue;
        const skillVersion = versionOf("habilidad", def.id);
        store.setPlayerSkill(player, def.id, next, "practica", Date.now(), skillVersion);
        store.event("skill-level", player, null, { skill: def.id, level: next, recipe: recipeId, skillVersion });
        gained.push({ player, skill: def.id, level: next, source: "practica" });
      }
      return gained;
    },

    /**
     * Crear una construcción desde el panel (F2a, Q186): un proyecto y su estructura con solar,
     * en una transacción. El solar aparece en el mapa al confirmarse.
     */
    createConstruction(actor: string, payload: unknown): Outcome<{ project: ProjectEntry; structure: StructureEntry }> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      const outcome = store.transaction((): Outcome<{ project: ProjectEntry; structure: StructureEntry }> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const check = checkCreateConstruction({
          actor, admins: config.admins, payload, resourceIds, resourceName,
          openProjects: [...projects.values()].filter((e) => !e.closedAt).length,
          existingProjectIds: new Set(projects.keys()),
          constructions: [...structures.values()].filter((e) => e.origin === "panel" && !e.retiredAt).length,
          map: { width: config.map.width, height: config.map.height, nodeCells, spawn: config.spawn, structures: activeStructures().map((e) => e.def), side: limits.side },
          limits,
          idSuffix: suffix(),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        const unknown = check.def.project.coordinators.filter((name) => !store.getAccountByName(name));
        if (unknown.length) return { kind: "rejected", reason: "definicion-invalida", details: unknown.map((n) => `coordinador sin cuenta: "${n}"`) };
        const projectDef = { ...check.def.project, coordinators: check.def.project.coordinators.map((n) => store.getAccountByName(n)!.name) };
        store.addProjectDef(projectDef, actor, at);
        store.addStructureDef(check.def.structure, actor, at);
        store.event("construction-created", actor, requestId, { project: projectDef, structure: check.def.structure });
        return {
          kind: "done",
          value: {
            project: { def: projectDef, origin: "panel", createdBy: actor, createdAt: at, closedBy: "", closedAt: 0 },
            structure: { def: check.def.structure, origin: "panel", createdBy: actor, retiredAt: 0 },
          },
        };
      });
      if (outcome.kind === "done") {
        projects.set(outcome.value.project.def.id, outcome.value.project);
        structures.set(outcome.value.structure.def.id, outcome.value.structure);
        originals.set(vkey("construccion", outcome.value.structure.def.id), { definition: { project: outcome.value.project.def, structure: outcome.value.structure.def } satisfies ConstructionDef, by: actor, at });
      }
      return outcome;
    },

    /** Crear un objeto fabricable (F2a). */
    createItem(actor: string, payload: unknown): Outcome<ItemEntry> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      const outcome = store.transaction((): Outcome<ItemEntry> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const check = checkCreateItem({
          actor, admins: config.admins, payload, resourceIds, itemIds: new Set(items.keys()), limits,
          takenNames: [...activeItems().map((e) => e.def.name), ...config.resources.map((r) => r.name)],
          created: activeItems().filter((e) => e.origin === "panel").length, idSuffix: suffix(),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        store.addItemDef(check.def, actor, at);
        store.event("item-created", actor, requestId, { item: check.def });
        return { kind: "done", value: { def: check.def, origin: "panel" } };
      });
      if (outcome.kind === "done") {
        items.set(outcome.value.def.id, outcome.value);
        originals.set(vkey("objeto", outcome.value.def.id), { definition: outcome.value.def, by: actor, at });
      }
      return outcome;
    },

    /** Crear una receta (F2a). */
    createRecipe(actor: string, payload: unknown): Outcome<RecipeEntry> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      const outcome = store.transaction((): Outcome<RecipeEntry> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const check = checkCreateRecipe({
          actor, admins: config.admins, payload, resourceIds, itemIds: itemIds(), structureIds: new Set(activeStructures().map((e) => e.def.id)),
          created: activeRecipes().filter((e) => e.origin === "panel").length, existingIds: new Set(recipes.keys()),
          takenNames: activeRecipes().map((e) => e.def.name), recipes: activeRecipes().map((e) => e.def), entryName, limits, skills: skillDefs(), idSuffix: suffix(),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        store.addRecipeDef(check.def, actor, at);
        store.event("recipe-created", actor, requestId, { recipe: check.def });
        return { kind: "done", value: { def: check.def, origin: "panel" } };
      });
      if (outcome.kind === "done") {
        recipes.set(outcome.value.def.id, outcome.value);
        originals.set(vkey("receta", outcome.value.def.id), { definition: outcome.value.def, by: actor, at });
      }
      return outcome;
    },

    /**
     * Cambiar los límites de diseño (G1, Q237): administración; se aplica sin reiniciar y se guarda. Bajar un límite por debajo de lo
     * ya creado no borra nada: solo impide crear más.
     */
    updateLimits(actor: string, payload: unknown): Outcome<BuildLimits> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      const outcome = store.transaction((): Outcome<BuildLimits> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const check = checkUpdateLimits({ actor, admins: config.admins, payload, current: limits, defaults: config.buildLimits });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        if (check.changed) {
          if (message.reset === true) store.deleteSetting("buildLimits");
          else store.putSetting("buildLimits", JSON.stringify(check.limits), actor, at);
          store.event("limits-updated", actor, requestId, { limits: check.limits, reset: message.reset === true });
        }
        return { kind: "done", value: check.limits };
      });
      if (outcome.kind === "done") limits = outcome.value;
      return outcome;
    },

    /** Archivar una definición (G1, Q240): no se borra; no se usa ni se muestra, pero conserva su historial. */
    archive(actor: string, payload: unknown): Outcome<{ kind: DefinitionKind; id: string }> {
      return changeArchive(actor, payload, true);
    },

    /** Restaurar una definición archivada: exige nombre libre y dependencias activas. */
    restore(actor: string, payload: unknown): Outcome<{ kind: DefinitionKind; id: string }> {
      return changeArchive(actor, payload, false);
    },

    // ------------------------------------------------------------ G2: versiones, retirada y cascada

    /** Versión de contenido y revisión de concurrencia vigentes de una definición. */
    versionOf,
    revOf,
    metaOf,

    /** Historial de una definición: todas sus versiones, de la 1 a la vigente (solo lectura). */
    definitionHistory(kind: EditableKind, id: string): { version: number; rev: number; versions: DefVersion[] } | undefined {
      const original = originals.get(vkey(kind, id));
      if (!original) return undefined;
      return {
        version: versionOf(kind, id), rev: revOf(kind, id),
        versions: [{ version: 1, definition: original.definition, changedBy: original.by, changedAt: original.at, note: "Versión original" },
          ...store.getDefVersions(kind, id).map((v) => ({ version: v.version, definition: v.definition, changedBy: v.changedBy, changedAt: v.changedAt, note: v.note }))],
      };
    },

    /**
     * Editar una definición creando una versión nueva (administración, G2, Q243–Q245): con `expectedRev`, análisis de compatibilidad
     * confirmado con su `basis` y todo en una transacción. Sin la `basis` devuelve el análisis en el rechazo.
     */
    editDef(actor: string, payload: unknown, offers: readonly { skill: string; level: number }[] = []): Outcome<EditDone> {
      return writeVersion(actor, payload, offers, false);
    },

    /** Volver a una versión anterior: crea una versión nueva con su contenido (nunca borra historial). */
    restoreVersion(actor: string, payload: unknown, offers: readonly { skill: string; level: number }[] = []): Outcome<EditDone> {
      return writeVersion(actor, payload, offers, true);
    },

    /** Plan de archivado en cascada con su firma (solo lectura; el servidor lo vuelve a calcular al ejecutar). */
    cascadePreview(kind: DefinitionKind, id: string, offers: readonly { skill: string; level: number }[] = []): { plan: CascadePlan; planHash: string } {
      const plan = cascadePlan(editView(offers), kind, id);
      return { plan, planHash: canonicalHash(plan.canonical) };
    },

    /**
     * Archivar en cascada (G2, Q247 y Q253). TODO dentro de una única transacción: permisos, estado actual, dependencias, existencias
     * y bloqueos se recalculan y se compara la firma del plan con la que previsualizó la persona; si algo cambió, no se aplica nada.
     */
    archiveCascade(actor: string, payload: unknown, offers: readonly { skill: string; level: number }[] = []): Outcome<{ nodes: { kind: DefinitionKind; id: string; rev: number }[] }> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      const cascade = (message.cascade ?? {}) as Record<string, unknown>;
      const outcome = store.transaction((): Outcome<{ nodes: { kind: DefinitionKind; id: string; rev: number }[] }> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        if (!authorize(actor, "create-project", { admins: config.admins })) return { kind: "rejected", reason: "sin-permiso" };
        const kind = message.kind as DefinitionKind, id = message.id;
        if (!["objeto", "receta", "habilidad", "mision"].includes(kind) || typeof id !== "string" || typeof cascade.planHash !== "string") return { kind: "rejected", reason: "solicitud-invalida" };
        if (message.expectedRev !== undefined && message.expectedRev !== revOf(kind, id)) {
          const last = revInfo.get(vkey(kind, id));
          return { kind: "rejected", reason: "version-obsoleta", details: [`La revisión vigente es la ${revOf(kind, id)} y tú tenías la ${String(message.expectedRev)}${last ? `: ${last.change} (${last.by})` : ""}.`] };
        }
        const plan = cascadePlan(editView(offers), kind, id);
        if (!plan.executable) return { kind: "rejected", reason: "definicion-en-uso", details: plan.blockers.map((b) => `${b.reason} (${b.path.join(" → ")})`) };
        if (canonicalHash(plan.canonical) !== cascade.planHash) return { kind: "rejected", reason: "plan-desactualizado", details: ["El plan ha cambiado desde que lo previsualizaste: revisa el plan nuevo."] };
        const nodes = plan.order.map((n) => {
          store.addArchive(n.kind, n.id, actor, at);
          return { kind: n.kind, id: n.id, rev: store.bumpDefRev(n.kind, n.id, actor, at, `archivada en cascada desde «${plan.root.name}»`) };
        });
        store.event("def-cascade-archived", actor, requestId, { root: { kind, id }, order: plan.order.map((n) => keyOf(n.kind, n.id)) });
        return { kind: "done", value: { nodes } };
      });
      if (outcome.kind === "done") {
        for (const n of outcome.value.nodes) {
          archived.add(`${n.kind}:${n.id}`);
          revInfo.set(vkey(n.kind, n.id), { rev: n.rev, change: "archivada en cascada", by: actor, at });
        }
      }
      return outcome;
    },

    /** Retirar un edificio del panel, también construido (administración, G2, Q246): con análisis previo confirmado y `expectedRev`. */
    retireStructure(actor: string, payload: unknown, offers: readonly { skill: string; level: number }[] = []): Outcome<{ structureId: string; rev: number }> {
      return changeStructure(actor, payload, offers, true);
    },

    /** Restaurar un edificio retirado: reglas propias (solar libre y proyecto abierto). */
    restoreStructure(actor: string, payload: unknown, offers: readonly { skill: string; level: number }[] = []): Outcome<{ structureId: string; rev: number }> {
      return changeStructure(actor, payload, offers, false);
    },

    isAdmin: (name: string) => authorize(name, "create-project", { admins: config.admins }),

    isRetired: (id: string) => Boolean(structures.get(id)?.retiredAt),

    /** Apuntar o asignar a un responsable (F1c, Q181). */
    assign: (actor: string, payload: unknown) => assignment(actor, payload, true),
    /** Quitar a un responsable (F1c, Q181). */
    unassign: (actor: string, payload: unknown) => assignment(actor, payload, false),

    /** Comentar una tarea (F1c, Q184): traza, no se edita ni se borra. */
    comment(actor: string, payload: unknown): Outcome<CommentDone> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      return store.transaction((): Outcome<CommentDone> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const project = projectById(message.projectId);
        if (!project) return { kind: "rejected", reason: "proyecto-desconocido" };
        const taskId = typeof message.taskId === "string" ? message.taskId : "";
        if (!project.tasks.some((t) => t.id === taskId)) return { kind: "rejected", reason: "tarea-desconocida" };
        const check = checkComment(message.text);
        if (!check.ok) return { kind: "rejected", reason: check.reason };
        store.addComment(project.id, taskId, actor, at, check.text);
        store.event("task-comment", actor, requestId, { project: project.id, task: taskId, text: check.text });
        const summary = store.commentSummary(project.id)[taskId]!;
        return { kind: "done", value: { project, taskId, count: summary.count, last: summary.last } };
      });
    },

    /** Hilo de comentarios de una tarea (para el endpoint HTTP). */
    comments(projectId: string, taskId: string) {
      const project = projectById(projectId);
      if (!project || !project.tasks.some((t) => t.id === taskId)) return undefined;
      return { projectId, taskId, comments: store.getComments(projectId, taskId) };
    },

    /** Replanificar la fecha objetivo de un proyecto o tarea (F1b, Q177): con motivo y trazado. */
    reschedule(actor: string, payload: unknown): Outcome<RescheduleDone> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      return store.transaction((): Outcome<RescheduleDone> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const project = projectById(message.projectId);
        const schedule = project ? scheduleOf(project) : undefined;
        const check = checkReschedule({
          actor, admins: config.admins, project, closed: Boolean(project && isClosed(project.id)),
          taskId: message.taskId, dueDate: message.dueDate, reason: message.reason,
          projectDue: schedule?.projectDue ?? "", taskDues: Object.fromEntries(Object.entries(schedule?.tasks ?? {}).map(([id, t]) => [id, t.due])),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason };
        store.addScheduleChange(check.project.id, check.taskId, check.dueDate, actor, at, check.reason);
        store.event("schedule-changed", actor, requestId, { project: check.project.id, task: check.taskId, dueDate: check.dueDate, reason: check.reason });
        const count = check.taskId === "" ? schedule!.projectCount + 1 : schedule!.tasks[check.taskId]!.count + 1;
        return { kind: "done", value: { project: check.project, taskId: check.taskId, dueDate: check.dueDate, count } };
      });
    },

    /** Historia para las gráficas: aportado por día y replanificaciones (F1b). */
    history(projectId: string) {
      if (!projects.has(projectId)) return undefined;
      return { projectId, days: store.contributionsByDay(projectId), schedule: store.getScheduleChanges(projectId) };
    },
    projectEntries: () => [...projects.values()],
    missionEntries: () => [...missions.values()],
    isClosed,
    isComplete,
    approvalMissing,
    completeMissions,

    /** Aportar a una tarea desde el inventario propio o el de la comunidad (RF-006, Q152, Q153). */
    contribute(actor: string, payload: unknown): Outcome<ContributionDone> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const project = projectById(message.projectId);
      if (project && !authorize(actor, "contribute", project)) return { kind: "rejected", reason: "sin-permiso" };
      const own = playerScope(actor);
      const at = Date.now();
      return store.transaction(() => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" as const };
        const check = checkContribution({
          projects: allProjects(),
          projectId: message.projectId, taskId: message.taskId, from: message.from, amount: message.amount,
          contributed, closed: isClosed, blocked: isBlocked,
          balance: (from, resource) => store.getAmount(from === "player" ? own : COMMUNITY, resource),
        });
        if (!check.ok) return { kind: "rejected" as const, reason: check.reason };
        const { task, from, amount, requested } = check;
        const source = from === "player" ? own : COMMUNITY;
        store.addAmount(source, task.resource, -amount);
        store.addAmount(projectScope(check.project.id), task.resource, amount);
        store.event("contribute", actor, requestId, { project: check.project.id, task: task.id, resource: task.resource, amount, from, requested });
        return {
          kind: "done" as const,
          value: {
            project: check.project, taskId: task.id, resource: task.resource, from, amount,
            sourceAmount: store.getAmount(source, task.resource),
            projectAmount: contributed(check.project.id, task.resource),
            missions: completeMissions(actor, at),
          },
        };
      });
    },

    /**
     * Revisar una tarea completada (M5b): solo coordinadores, con nota. Registra la decisión
     * y la evidencia en la que se basa (aportes y último evento de la tarea), sin mover recursos.
     */
    review(actor: string, payload: unknown): Outcome<ReviewDone> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      return store.transaction(() => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" as const };
        const check = checkReview({
          projects: allProjects(), actor,
          projectId: message.projectId, taskId: message.taskId, decision: message.decision, note: message.note,
          contributed,
        });
        if (!check.ok) return { kind: "rejected" as const, reason: check.reason };
        const { project, task, decision, note } = check;
        const evidence = store.taskEvidence(project.id, task.id);
        store.putReview(project.id, task.id, decision, actor, at, note);
        store.event("task-review", actor, requestId, { project: project.id, task: task.id, decision, note, evidence });
        return {
          kind: "done" as const,
          value: { project, taskId: task.id, decision, note, reviewedBy: actor, reviewedAt: at, missions: completeMissions(actor, at) },
        };
      });
    },

    /** Crear un proyecto desde el panel (F1a, Q171–Q173): queda publicado e inmutable. */
    createProject(actor: string, payload: unknown): Outcome<ProjectEntry> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      const outcome = store.transaction((): Outcome<ProjectEntry> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const check = checkCreateProject({
          actor, admins: config.admins, payload, resourceIds, resourceName,
          openProjects: [...projects.values()].filter((e) => !e.closedAt).length,
          existingIds: new Set(projects.keys()), idSuffix: suffix(),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        // Los coordinadores deben ser cuentas existentes; se guarda su nombre tal como está registrado.
        const unknown = check.def.coordinators.filter((name) => !store.getAccountByName(name));
        if (unknown.length) return { kind: "rejected", reason: "definicion-invalida", details: unknown.map((n) => `coordinador sin cuenta: "${n}"`) };
        const def = { ...check.def, coordinators: check.def.coordinators.map((n) => store.getAccountByName(n)!.name) };
        store.addProjectDef(def, actor, at);
        store.event("project-created", actor, requestId, { project: def });
        return { kind: "done", value: { def, origin: "panel", createdBy: actor, createdAt: at, closedBy: "", closedAt: 0 } };
      });
      if (outcome.kind === "done") projects.set(outcome.value.def.id, outcome.value);
      return outcome;
    },

    /** Cerrar un proyecto del panel: deja de admitir aportes y conserva su historial (F1a). */
    closeProject(actor: string, payload: unknown): Outcome<ProjectEntry & { retiredStructure?: string }> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      const outcome = store.transaction((): Outcome<ProjectEntry & { retiredStructure?: string }> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const entry = typeof message.projectId === "string" ? projects.get(message.projectId) : undefined;
        const check = checkCloseProject({
          actor, admins: config.admins, project: entry?.def, fromConfig: entry?.origin === "configuracion", closed: Boolean(entry?.closedAt),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason };
        store.closeProjectDef(entry!.def.id, actor, at);
        store.event("project-closed", actor, requestId, { project: entry!.def.id });
        // Un solar del panel sin construir se retira del mapa (Q187); un edificio construido se queda.
        const structure = [...structures.values()].find((e) => e.origin === "panel" && !e.retiredAt && e.def.projectId === entry!.def.id);
        const built = structure && store.getStructures().some((s) => s.id === structure.def.id);
        let retiredStructure: string | undefined;
        if (structure && !built) {
          store.retireStructureDef(structure.def.id, at);
          store.bumpDefRev("construccion", structure.def.id, actor, at, "retirada (proyecto cerrado)");
          retiredStructure = structure.def.id;
        }
        return { kind: "done", value: { ...entry!, closedBy: actor, closedAt: at, retiredStructure } };
      });
      if (outcome.kind === "done") {
        const { retiredStructure, ...entry } = outcome.value;
        projects.set(entry.def.id, entry);
        const retired = retiredStructure ? structures.get(retiredStructure) : undefined;
        if (retired) {
          structures.set(retired.def.id, { ...retired, retiredAt: entry.closedAt });
          revInfo.set(vkey("construccion", retired.def.id), { rev: revOf("construccion", retired.def.id) + 1, change: "retirada (proyecto cerrado)", by: actor, at: entry.closedAt });
        }
      }
      return outcome;
    },

    /** Crear una misión desde el panel (Q174); si su objetivo ya se cumple, queda completada en la misma transacción. */
    createMission(actor: string, payload: unknown): Outcome<{ entry: MissionEntry; completed: MissionCompleted[] }> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const at = Date.now();
      const outcome = store.transaction((): Outcome<{ entry: MissionEntry; completed: MissionCompleted[] }> => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" };
        const check = checkCreateMission({
          actor, admins: config.admins, payload, itemIds: itemIds(),
          openProjectIds: new Set([...projects.values()].filter((e) => !e.closedAt).map((e) => e.def.id)),
          missions: activeMissions().length, existingIds: new Set(missions.keys()), idSuffix: suffix(),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        store.addMissionDef(check.def, actor, at);
        store.event("mission-created", actor, requestId, { mission: check.def });
        const entry: MissionEntry = { def: check.def, origin: "panel", createdBy: actor, createdAt: at };
        return { kind: "done", value: { entry, completed: completeMissions(actor, at, [check.def]) } };
      });
      if (outcome.kind === "done") {
        missions.set(outcome.value.entry.def.id, outcome.value.entry);
        originals.set(vkey("mision", outcome.value.entry.def.id), { definition: outcome.value.entry.def, by: actor, at });
      }
      return outcome;
    },

    /**
     * Consume del inventario del proyecto exactamente lo requerido por cada tarea (Q156).
     * Debe llamarse dentro de la transacción de la construcción.
     */
    consumeForBuild(project: ProjectDef): Record<string, number> {
      const consumed: Record<string, number> = {};
      for (const task of project.tasks) {
        store.addAmount(projectScope(project.id), task.resource, -task.required);
        consumed[task.resource] = task.required;
      }
      return consumed;
    },

    /**
     * Estado del proyecto. Con estructura: «construido», «listo» o «en-curso» (M5).
     * Sin estructura (F1a, Q173): «completado», «en-revision» (falta aprobar) o «en-curso».
     */
    status(project: ProjectDef, progress: (resource: string) => number, built: boolean): string {
      if (structureOf(project.id)) return built ? "construido" : projectStatus(project, progress);
      if (projectStatus(project, progress) !== "listo") return "en-curso";
      return approvalMissing(project) ? "en-revision" : "completado";
    },

    /** Estado de un proyecto reconstruido desde la base de datos. */
    snapshot(project: ProjectDef): ProjectSnapshot {
      const contributors = store.contributionTotals(project.id);
      const progress: Record<string, number> = {};
      for (const byResource of Object.values(contributors)) {
        for (const [resource, amount] of Object.entries(byResource)) progress[resource] = (progress[resource] ?? 0) + amount;
      }
      return {
        progress, contributors,
        recent: store.recentContributions(project.id, RECENT_CONTRIBUTIONS).reverse(),
        reviews: Object.fromEntries(store.getReviews(project.id).map((r) => [r.taskId, r])),
        assignees: store.getAssignees(project.id),
        comments: store.commentSummary(project.id),
      };
    },
  };
}

export type ProjectCore = ReturnType<typeof createProjectCore>;
