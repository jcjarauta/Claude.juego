import { Client, type Room } from "@colyseus/sdk";
import {
  authorize, MESSAGE, missionDefFromState, NOTE_MAX, projectDefFromState, REJECT_TEXT, ROOM_NAME, WorldState,
  type CloseProjectMessage, type ContributeMessage, type ContributionSource, type JoinOptions, type ProjectDef, type RejectedMessage,
  type ReviewDecision, type ReviewMessage, type TaskDef, type WorldConfig,
} from "@juego/shared";
import { enter, logout } from "./account.ts";
import { createAdminForms } from "./admin-forms.ts";
import { createBoard } from "./views/board.ts";
import type { ViewContext } from "./views/common.ts";
import { createMetrics } from "./views/metrics.ts";
import { createTimeline } from "./views/timeline.ts";
import { isOverdue, localDay, type RescheduleMessage } from "@juego/shared";
import { newRequestId } from "./request-id.ts";

// Panel profesional (M5b, RF-015): lista accesible de proyectos y tareas sobre el mismo
// estado autoritativo que el mundo. Entra como observador (sin personaje): puede aportar
// y, si es coordinador, revisar tareas. El servidor decide; aquí solo se pide.

type PanelRoom = Room<unknown, WorldState>;

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

/** Crea un elemento con propiedades (id, className, type, value…) e hijos. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

const time = (at: number) => new Date(at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

const STATUS_TEXT: Record<string, string> = {
  pendiente: "Pendiente",
  "en-curso": "En curso",
  completada: "Completada · pendiente de revisión",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
};

const PROJECT_STATUS_TEXT: Record<string, string> = {
  "en-curso": "En curso",
  listo: "Listo para construir",
  construido: "Construido",
  "en-revision": "Tareas completas · falta la aprobación de la coordinación",
  completado: "Completado",
};

async function join(token: string): Promise<PanelRoom> {
  const options: JoinOptions = { token, view: "panel" };
  return new Client(location.origin).join(ROOM_NAME, options, WorldState);
}

/** Tabla de tareas y formulario de revisión de un proyecto. Los elementos se crean una vez (no se pierde el foco). */
function createProjectView(container: HTMLElement, config: WorldConfig, project: ProjectDef, room: PanelRoom, me: string, announce: (text: string) => void) {
  const resourceName = new Map(config.resources.map((r) => [r.id, r.name.toLowerCase()]));
  const coordinator = authorize(me, "review", project);
  const admin = authorize(me, "close-project", { admins: config.admins });
  const hasStructure = config.structures.some((s) => s.projectId === project.id);
  const headingId = `proyecto-${project.id}`;
  const status = el("span");
  const phase = el("span");
  const dueText = el("span");
  const origin = el("span");
  const coordinators = el("span");
  const section = el("section", { className: "proyecto" });
  section.setAttribute("aria-labelledby", headingId);
  const close = el("button", { type: "button", textContent: `Cerrar el proyecto «${project.name}»` });
  close.onclick = () => {
    if (close.getAttribute("aria-disabled") === "true") return;
    if (!window.confirm(`¿Cerrar «${project.name}»? Dejará de admitir aportes; su historial se conserva.`)) return;
    const message: CloseProjectMessage = { requestId: newRequestId(), projectId: project.id };
    room.send(MESSAGE.closeProject, message);
  };
  const approvalText = hasStructure
    ? (project.buildRequiresApproval ? ". Construir exige todas las tareas aprobadas." : ". La revisión deja constancia; no bloquea la construcción.")
    : (project.buildRequiresApproval ? ". Completar exige todas las tareas aprobadas." : ". Se completa al aportar todo; la revisión deja constancia.");
  section.append(
    el("h2", { id: headingId, tabIndex: -1 }, `Proyecto: ${project.name}`),
    el("p", {}, el("span", { className: "etiqueta", title: "Clasificación de realidad" }, project.reality),
      " ", el("code", {}, project.id), " · Comunidad: ", config.community.name, " · ", origin),
    el("p", {}, project.description),
    el("p", {}, "Estado: ", status, " · ", phase),
    el("p", {}, "Fecha objetivo: ", dueText),
    el("p", { className: "ayuda" }, "Coordinación: ", coordinators, approvalText),
  );
  if (admin) section.append(el("p", {}, close));

  const tbody = el("tbody");
  const table = el("table", {},
    el("caption", {}, `Tareas de ${project.name}`),
    el("thead", {}, el("tr", {}, ...["Tarea", "Criterio de aceptación", "Progreso", "Estado", "Evidencias (aportes)", "Revisión", "Aportar"]
      .map((h) => { const th = el("th", {}, h); th.scope = "col"; return th; }))),
    tbody,
  );
  section.append(el("div", { className: "tabla" }, table));

  interface Row { progress: HTMLProgressElement; progressText: HTMLElement; status: HTMLElement; evidence: HTMLElement; review: HTMLElement; buttons: HTMLButtonElement[] }
  const rows = new Map<string, Row>();
  const contribute = (task: TaskDef, from: ContributionSource, amount: number) => {
    const message: ContributeMessage = { requestId: newRequestId(), projectId: project.id, taskId: task.id, from, amount };
    room.send(MESSAGE.contribute, message);
  };
  for (const task of project.tasks) {
    const name = resourceName.get(task.resource) ?? task.resource;
    const progress = el("progress", { max: task.required });
    progress.setAttribute("aria-label", `Progreso de ${task.title}`);
    const progressText = el("span");
    const buttons = ([["community", `Desde la comunidad`], ["player", `Desde tu inventario`]] as const).map(([from, label]) => {
      const button = el("button", { type: "button", textContent: label });
      button.dataset.from = from;
      button.dataset.label = `${label}: aportar ${name} a «${task.title}»`;
      button.onclick = () => {
        if (button.getAttribute("aria-disabled") === "true") return;
        contribute(task, from, Number(button.dataset.available ?? 0));
      };
      return button;
    });
    const row = { progress, progressText, status: el("span"), evidence: el("span"), review: el("span"), buttons };
    rows.set(task.id, row);
    const th = el("th", {}, task.title, el("br"), el("code", {}, task.id));
    th.scope = "row";
    tbody.append(el("tr", {}, th, el("td", {}, task.acceptance), el("td", {}, progress, el("br"), progressText),
      el("td", {}, row.status), el("td", {}, row.evidence), el("td", {}, row.review), el("td", {}, ...buttons)));
  }

  // Revisión (solo coordinadores, Q161).
  const reviewHeadingId = `revisar-${project.id}`;
  const taskSelect = el("select", { id: `revisar-tarea-${project.id}` });
  for (const task of project.tasks) taskSelect.append(el("option", { value: task.id, textContent: task.title }));
  const note = el("textarea", { id: `revisar-nota-${project.id}`, maxLength: NOTE_MAX });
  const noteHelp = el("p", { id: `revisar-nota-ayuda-${project.id}`, className: "ayuda" }, `Motivo o comentario, de 1 a ${NOTE_MAX} caracteres. Queda registrado con la evidencia.`);
  note.setAttribute("aria-describedby", noteHelp.id);
  const decisions = (["aprobada", "rechazada"] as const).map((decision, i) => {
    const input = el("input", { type: "radio", name: `decision-${project.id}`, value: decision, checked: i === 0 });
    return el("label", {}, input, decision === "aprobada" ? " Aprobar" : " Rechazar");
  });
  const reviewHelp = el("p", { className: "ayuda" });
  const submit = el("button", { type: "submit", textContent: "Enviar revisión" });
  const form = el("form", {},
    el("label", { htmlFor: taskSelect.id }, "Tarea"), taskSelect,
    el("fieldset", {}, el("legend", {}, "Decisión"), ...decisions),
    el("label", { htmlFor: note.id }, "Nota"), note, noteHelp, reviewHelp, submit);
  form.onsubmit = (event) => {
    event.preventDefault();
    if (submit.getAttribute("aria-disabled") === "true") return;
    const decision = (form.querySelector<HTMLInputElement>(`input[name="decision-${project.id}"]:checked`)?.value ?? "aprobada") as ReviewDecision;
    if (!note.value.trim()) {
      reviewHelp.textContent = REJECT_TEXT["nota-invalida"];
      note.focus();
      return;
    }
    const message: ReviewMessage = { requestId: newRequestId(), projectId: project.id, taskId: taskSelect.value, decision, note: note.value };
    room.send(MESSAGE.review, message);
    note.value = "";
  };
  section.append(el("h3", { id: reviewHeadingId }, "Revisar una tarea"));
  if (coordinator) {
    form.setAttribute("aria-labelledby", reviewHeadingId);
    section.append(form);
  } else {
    section.append(el("p", { className: "ayuda" }, "Solo la coordinación del proyecto puede aprobar o rechazar tareas."));
  }

  const activity = el("ol", { className: "actividad" });
  section.append(el("h3", {}, "Actividad reciente"), activity);
  container.append(section);

  let lastDecisions: Map<string, string> | undefined;
  let lastStatus = "";

  return {
    render() {
      const state = room.state.projects.get(project.id);
      if (!state) return;
      status.textContent = PROJECT_STATUS_TEXT[state.status] ?? state.status;
      if (lastStatus && lastStatus !== state.status) announce(`Proyecto ${project.name}: ${status.textContent}.`);
      lastStatus = state.status;
      const closed = state.phase === "cerrado";
      phase.textContent = closed ? `Cerrado por ${state.closedBy}: no admite aportes` : "Abierto";
      phase.className = closed ? "estado-rechazada" : "";
      origin.textContent = state.origin === "panel" ? `creado por ${state.createdBy} a las ${time(state.createdAt)}` : "de la configuración del mundo";
      const finished = state.status === "completado" || state.status === "construido";
      dueText.textContent = state.dueDate
        ? `${state.dueDate}${isOverdue(state.dueDate, finished, localDay()) ? " — VENCIDO" : ""}${state.reschedules ? ` (replanificado ${state.reschedules} ${state.reschedules === 1 ? "vez" : "veces"})` : ""}`
        : "sin fecha";
      dueText.className = isOverdue(state.dueDate, finished, localDay()) ? "estado-rechazada" : "";
      close.hidden = state.origin !== "panel" || closed;
      coordinators.textContent = state.coordinators.length ? [...state.coordinators].join(", ") : "nadie asignado";
      const own = [...room.state.players.values()].find((p) => p.name === me);
      const decisionsNow = new Map<string, string>();
      for (const task of project.tasks) {
        const row = rows.get(task.id)!;
        const taskState = state.tasks.get(task.id);
        const done = state.progress.get(task.resource) ?? 0;
        const remaining = Math.max(0, task.required - done);
        const name = resourceName.get(task.resource) ?? task.resource;
        row.progress.value = done;
        row.progressText.textContent = `${done}/${task.required} ${name}`;
        const st = taskState?.status ?? "pendiente";
        row.status.textContent = st === "completada" && !state.requiresApproval ? "Completada" : STATUS_TEXT[st] ?? st;
        row.status.className = `estado-${st}`;
        const evidence = [...state.contributors.entries()]
          .map(([who, totals]) => [who, totals.totals.get(task.resource) ?? 0] as const)
          .filter(([, n]) => n > 0)
          .map(([who, n]) => `${who}: ${n}`);
        row.evidence.textContent = evidence.length ? evidence.join(", ") : "Sin aportes";
        row.review.textContent = taskState?.decision
          ? `${taskState.decision === "aprobada" ? "Aprobada" : "Rechazada"} por ${taskState.reviewedBy} a las ${time(taskState.reviewedAt)}: «${taskState.note}»`
          : "Sin revisar";
        decisionsNow.set(task.id, `${taskState?.decision}|${taskState?.reviewedAt}`);
        if (lastDecisions && lastDecisions.get(task.id) !== decisionsNow.get(task.id) && taskState?.decision) {
          announce(`${task.title}: ${taskState.decision} por ${taskState.reviewedBy}.`);
        }
        for (const button of row.buttons) {
          const fromPlayer = button.dataset.from === "player";
          button.hidden = fromPlayer && !own; // el inventario propio solo se ve con el personaje en el mundo
          const balance = fromPlayer ? own?.inventory.get(task.resource) ?? 0 : room.state.community.get(task.resource) ?? 0;
          const available = closed ? 0 : Math.min(balance, remaining);
          button.dataset.available = String(available);
          button.setAttribute("aria-disabled", String(available === 0));
          button.textContent = `${fromPlayer ? "Desde tu inventario" : "Desde la comunidad"} (${available})`;
          button.setAttribute("aria-label", `${button.dataset.label} (${available} disponibles)`);
        }
      }
      lastDecisions = decisionsNow;

      if (coordinator) {
        const selected = project.tasks.find((t) => t.id === taskSelect.value)!;
        const complete = (state.progress.get(selected.resource) ?? 0) >= selected.required;
        submit.setAttribute("aria-disabled", String(!complete));
        reviewHelp.textContent = complete ? "" : "Esa tarea aún no está completa: solo se revisan tareas completadas.";
      }

      activity.replaceChildren(...[...state.recent].reverse().map((c) =>
        el("li", {}, `${time(c.at)} — ${c.name} aportó ${c.amount} de ${resourceName.get(c.resource) ?? c.resource} a «${c.taskId}»`)));
      if (state.recent.length === 0) activity.append(el("li", {}, "Todavía no hay aportes."));
    },
  };
}

const MISSION_KIND_TEXT = (m: { objectiveKind: string; objectiveTarget: string; objectiveAmount: number }, room: PanelRoom, config: WorldConfig) =>
  m.objectiveKind === "project-completed"
    ? `completar el proyecto «${room.state.projects.get(m.objectiveTarget)?.name ?? m.objectiveTarget}»`
    : `tener ${m.objectiveAmount} ${config.items.find((i) => i.id === m.objectiveTarget)?.name.toLowerCase() ?? m.objectiveTarget} en el almacén de la comunidad`;

function startPanel(room: PanelRoom, config: WorldConfig, name: string) {
  byId("entrada").hidden = true;
  byId("panel").hidden = false;
  const notice = byId("aviso");
  const rejection = byId("rechazo");
  const connection = byId("conexion");
  const admin = authorize(name, "create-project", { admins: config.admins });
  const announce = (text: string) => { notice.textContent = text; };

  room.reconnection.minUptime = 0;
  room.onDrop(() => { connection.textContent = "Conexión perdida, reconectando…"; });
  room.onReconnect(() => { connection.textContent = "Reconectado."; });
  room.onLeave(() => { connection.textContent = "Desconectado del servidor. Recarga la página para volver."; });
  window.addEventListener("pagehide", () => { void room.leave(true); });
  byId("salir").onclick = async () => {
    await room.leave(true);
    await logout();
    location.reload();
  };

  const container = byId("proyectos");
  const adminForms = admin ? createAdminForms(byId("vistas"), config, room, announce) : undefined;

  // Vistas de gestión (F1b): pestañas y selector de proyecto sobre los mismos datos.
  const projectFilter = byId<HTMLSelectElement>("vista-proyecto");
  const ctx: ViewContext = {
    room, config, me: name, announce, filter: () => projectFilter.value,
    review: (projectId, taskId, decision, note) => {
      const message: ReviewMessage = { requestId: newRequestId(), projectId, taskId, decision, note };
      room.send(MESSAGE.review, message);
    },
    reschedule: (projectId, taskId, dueDate, reason) => {
      const message: RescheduleMessage = { requestId: newRequestId(), projectId, ...(taskId ? { taskId } : {}), dueDate, reason };
      room.send(MESSAGE.reschedule, message);
    },
  };
  const board = createBoard(byId("vista-tablero"), ctx);
  const timeline = createTimeline(byId("vista-cronograma"), ctx);
  const metrics = createMetrics(byId("vista-indicadores"), ctx);
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const selectTab = (tab: HTMLButtonElement, focus = true) => {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      byId(t.getAttribute("aria-controls")!).hidden = !selected;
    }
    metrics.setActive(tab.id === "tab-indicadores");
    if (focus) tab.focus();
    render();
  };
  for (const tab of tabs) {
    tab.onclick = () => selectTab(tab);
    tab.onkeydown = (event) => {
      const i = tabs.indexOf(tab);
      const next = event.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length]
        : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : undefined;
      if (next) { event.preventDefault(); selectTab(next); }
    };
  }
  projectFilter.onchange = () => render();

  let rejectionTimer: number | undefined;
  room.onMessage(MESSAGE.rejected, ({ reason, details }: RejectedMessage) => {
    if (adminForms?.showRejection(REJECT_TEXT[reason], details)) return;
    rejection.textContent = REJECT_TEXT[reason];
    window.clearTimeout(rejectionTimer);
    rejectionTimer = window.setTimeout(() => { rejection.textContent = ""; }, 6000);
  });

  // Misiones (todas): nombre, objetivo y estado.
  const missions = el("ul", { className: "misiones" });
  const missionsSection = el("section", {}, el("h2", { id: "misiones-titulo" }, "Misiones"), missions);
  missionsSection.setAttribute("aria-labelledby", "misiones-titulo");
  container.after(missionsSection);
  const missionStatus = new Map<string, string>();

  // Una vista por proyecto, creada al aparecer en el estado (también los que se crean después).
  const views = new Map<string, ReturnType<typeof createProjectView>>();
  let focused = false;
  const render = () => {
    const quien = [...room.state.projects.values()].filter((p) => p.coordinators.includes(name)).map((p) => p.name);
    byId("quien").textContent = `Conectado como ${name}${admin ? " (administración)" : ""}${quien.length ? ` (coordinación de ${quien.join(", ")})` : admin ? "" : " (participante)"}.`;
    const ordered = [...room.state.projects.entries()].sort(([, a], [, b]) => a.createdAt - b.createdAt);
    for (const [id, projectState] of ordered) {
      if (!views.has(id) && projectState.tasks.size > 0) {
        views.set(id, createProjectView(container, config, projectDefFromState(id, projectState), room, name, announce));
      }
    }
    for (const view of views.values()) view.render();
    // Selector de proyecto de las vistas y filtro de la lista.
    const options = ordered.map(([id, p]) => `${id}|${p.name}|${p.phase}`).join(";");
    if (projectFilter.dataset.options !== options) {
      const selected = projectFilter.value;
      projectFilter.replaceChildren(el("option", { value: "", textContent: "Todos los proyectos" }),
        ...ordered.map(([id, p]) => el("option", { value: id, textContent: `${p.name}${p.phase === "cerrado" ? " (cerrado)" : ""}` })));
      projectFilter.value = ordered.some(([id]) => id === selected) ? selected : "";
      projectFilter.dataset.options = options;
    }
    for (const [id] of ordered) {
      const section = document.getElementById(`proyecto-${id}`)?.closest("section");
      if (section) section.hidden = Boolean(projectFilter.value) && projectFilter.value !== id;
    }
    board.render();
    timeline.render();
    metrics.render();
    // Al entrar, el foco va al primer proyecto en cuanto aparece (TP-11).
    if (!focused && views.size) {
      focused = true;
      container.querySelector<HTMLElement>("h2")?.focus();
    }
    const items = [...room.state.missions.entries()].map(([id, m]) => {
      const def = missionDefFromState(id, m);
      if (missionStatus.has(id) && missionStatus.get(id) !== m.status && m.status === "completada") {
        announce(`¡Misión «${def.name}» completada por ${m.completedBy}!`);
      }
      missionStatus.set(id, m.status);
      const done = m.status === "completada";
      return el("li", {}, el("strong", {}, def.name), `: ${MISSION_KIND_TEXT(m, room, config)}. `,
        el("span", { className: done ? "estado-aprobada" : "" }, done ? `Completada por ${m.completedBy} a las ${time(m.completedAt)}.` : "Pendiente."),
        def.description ? ` ${def.description}` : "");
    });
    missions.replaceChildren(...items);
    adminForms?.render();
  };
  room.onStateChange(render);
  container.addEventListener("change", render); // la tarea elegida para revisar cambia el aviso
  render();
}

async function start() {
  const config = (await (await fetch("/config")).json()) as WorldConfig;
  const { room, session } = await enter(join);
  startPanel(room, config, session.name);
}

start();
