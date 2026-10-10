import { randomBytes } from "node:crypto";
import {
  authorize, blockedBy, checkAssign, checkCloseProject, checkComment, checkContribution, checkCreateConstruction, checkCreateItem, checkCreateMission,
  checkCreateProject, checkCreateRecipe, checkReschedule, checkReview, isTaskDone, isValidRequestId, missionSatisfied, projectStatus, taskStatus,
  type ContributionSource, type ItemDef, type MissionDef, type ProjectDef, type RecipeDef, type RejectReason, type ReviewDecision, type StructureDef,
  type WorldConfig,
} from "@juego/shared";
import { COMMUNITY, playerScope, projectScope, type ContributionRow, type ReviewRow, type Store } from "../store.ts";

// Núcleo de proyectos (M5b, ADR-001): fuente de verdad de proyectos, tareas y misiones.
// No conoce Colyseus ni el mapa: recibe el actor y el mensaje, valida con las reglas
// puras de @juego/shared, escribe en una transacción junto con su evento y devuelve
// un resultado que cada interfaz (mundo o panel) aplica a su estado sincronizado.
// F1a: además de los de la configuración, hay proyectos y misiones creados desde el panel.

export type Outcome<T> =
  | { kind: "done"; value: T }
  | { kind: "duplicate" }
  | { kind: "rejected"; reason: RejectReason; details?: string[] };

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
  const activeStructures = () => [...structures.values()].filter((e) => !e.retiredAt);

  const resourceIds = new Set(config.resources.map((r) => r.id));
  const resourceName = new Map(config.resources.map((r) => [r.id, r.name.toLowerCase()]));
  const nodeCells = new Set(config.nodes.map((n) => `${n.x},${n.y}`));
  const itemIds = () => new Set(items.keys());
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

  /**
   * Completa, dentro de la transacción en curso, las misiones cuyo objetivo se cumple por
   * primera vez. `extra` son misiones aún no registradas en memoria (la que se está creando).
   */
  function completeMissions(actor: string, at: number, extra: MissionDef[] = []): MissionCompleted[] {
    const done = new Set(store.getMissions().map((m) => m.id));
    const stock = (id: string) => store.getAmount(COMMUNITY, id);
    const completed: MissionCompleted[] = [];
    for (const mission of [...[...missions.values()].map((e) => e.def), ...extra]) {
      if (done.has(mission.id) || !missionSatisfied(mission, { stock, projectCompleted })) continue;
      store.completeMission(mission.id, actor, at);
      store.event("mission-complete", actor, null, { mission: mission.id });
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
    recipeById: (id: unknown) => (typeof id === "string" ? recipes.get(id)?.def : undefined),
    structureEntries: () => [...structures.values()],
    itemEntries: () => [...items.values()],
    recipeEntries: () => [...recipes.values()],

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
          map: { width: config.map.width, height: config.map.height, nodeCells, spawn: config.spawn, structures: activeStructures().map((e) => e.def) },
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
          actor, admins: config.admins, payload, resourceIds, itemIds: itemIds(),
          created: [...items.values()].filter((e) => e.origin === "panel").length, idSuffix: suffix(),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        store.addItemDef(check.def, actor, at);
        store.event("item-created", actor, requestId, { item: check.def });
        return { kind: "done", value: { def: check.def, origin: "panel" } };
      });
      if (outcome.kind === "done") items.set(outcome.value.def.id, outcome.value);
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
          created: [...recipes.values()].filter((e) => e.origin === "panel").length, existingIds: new Set(recipes.keys()), idSuffix: suffix(),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        store.addRecipeDef(check.def, actor, at);
        store.event("recipe-created", actor, requestId, { recipe: check.def });
        return { kind: "done", value: { def: check.def, origin: "panel" } };
      });
      if (outcome.kind === "done") recipes.set(outcome.value.def.id, outcome.value);
      return outcome;
    },

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
          retiredStructure = structure.def.id;
        }
        return { kind: "done", value: { ...entry!, closedBy: actor, closedAt: at, retiredStructure } };
      });
      if (outcome.kind === "done") {
        const { retiredStructure, ...entry } = outcome.value;
        projects.set(entry.def.id, entry);
        const retired = retiredStructure ? structures.get(retiredStructure) : undefined;
        if (retired) structures.set(retired.def.id, { ...retired, retiredAt: entry.closedAt });
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
          missions: missions.size, existingIds: new Set(missions.keys()), idSuffix: suffix(),
        });
        if (!check.ok) return { kind: "rejected", reason: check.reason, details: check.details };
        store.addMissionDef(check.def, actor, at);
        store.event("mission-created", actor, requestId, { mission: check.def });
        const entry: MissionEntry = { def: check.def, origin: "panel", createdBy: actor, createdAt: at };
        return { kind: "done", value: { entry, completed: completeMissions(actor, at, [check.def]) } };
      });
      if (outcome.kind === "done") missions.set(outcome.value.entry.def.id, outcome.value.entry);
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
