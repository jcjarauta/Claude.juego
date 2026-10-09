import {
  authorize, checkContribution, checkReview, isValidRequestId, projectStatus,
  type ContributionSource, type ProjectDef, type RejectReason, type ReviewDecision, type WorldConfig,
} from "@juego/shared";
import { COMMUNITY, playerScope, projectScope, type ContributionRow, type ReviewRow, type Store } from "../store.ts";

// Núcleo de proyectos (M5b, ADR-001): fuente de verdad de proyectos y tareas.
// No conoce Colyseus ni el mapa: recibe el actor y el mensaje, valida con las reglas
// puras de @juego/shared, escribe en una transacción junto con su evento y devuelve
// un resultado que cada interfaz (mundo o panel) aplica a su estado sincronizado.

export type Outcome<T> =
  | { kind: "done"; value: T }
  | { kind: "duplicate" }
  | { kind: "rejected"; reason: RejectReason };

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
}

export interface ReviewDone {
  project: ProjectDef;
  taskId: string;
  decision: ReviewDecision;
  note: string;
  reviewedBy: string;
  reviewedAt: number;
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
}

export const RECENT_CONTRIBUTIONS = 10;

export function createProjectCore(store: Store, config: WorldConfig) {
  const projectById = (id: unknown) => config.projects.find((p) => p.id === id);
  // Lo aportado sale del registro: no disminuye cuando la construcción consume los materiales.
  const contributed = (projectId: string, resource: string) => store.contributedAmount(projectId, resource);

  return {
    projectById,

    /** Aportar a una tarea desde el inventario propio o el de la comunidad (RF-006, Q152, Q153). */
    contribute(actor: string, payload: unknown): Outcome<ContributionDone> {
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return { kind: "rejected", reason: "solicitud-invalida" };
      const requestId = message.requestId;
      const project = projectById(message.projectId);
      if (project && !authorize(actor, "contribute", project)) return { kind: "rejected", reason: "sin-permiso" };
      const own = playerScope(actor);
      return store.transaction(() => {
        if (store.hasRequest(actor, requestId)) return { kind: "duplicate" as const };
        const check = checkContribution({
          projects: config.projects,
          projectId: message.projectId, taskId: message.taskId, from: message.from, amount: message.amount,
          contributed,
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
          projects: config.projects, actor,
          projectId: message.projectId, taskId: message.taskId, decision: message.decision, note: message.note,
          contributed,
        });
        if (!check.ok) return { kind: "rejected" as const, reason: check.reason };
        const { project, task, decision, note } = check;
        const evidence = store.taskEvidence(project.id, task.id);
        store.putReview(project.id, task.id, decision, actor, at, note);
        store.event("task-review", actor, requestId, { project: project.id, task: task.id, decision, note, evidence });
        return { kind: "done" as const, value: { project, taskId: task.id, decision, note, reviewedBy: actor, reviewedAt: at } };
      });
    },

    /** Con buildRequiresApproval (Q162), alguna tarea no está aprobada. */
    approvalMissing(project: ProjectDef): boolean {
      if (!project.buildRequiresApproval) return false;
      const decisions = new Map(store.getReviews(project.id).map((r) => [r.taskId, r.decision]));
      return project.tasks.some((t) => decisions.get(t.id) !== "aprobada");
    },

    /** Todas las tareas tienen lo requerido. */
    isComplete(project: ProjectDef): boolean {
      return project.tasks.every((t) => contributed(project.id, t.resource) >= t.required);
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

    /** «construido» si su estructura existe; si no, «listo» o «en-curso» según lo aportado. */
    status(project: ProjectDef, progress: (resource: string) => number, built: boolean): string {
      return built ? "construido" : projectStatus(project, progress);
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
      };
    },
  };
}

export type ProjectCore = ReturnType<typeof createProjectCore>;
