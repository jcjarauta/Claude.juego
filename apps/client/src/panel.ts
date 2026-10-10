import { Client, type Room } from "@colyseus/sdk";
import {
  authorize, MESSAGE, NOTE_MAX, REJECT_TEXT, ROOM_NAME, WorldState,
  type ContributeMessage, type ContributionSource, type JoinOptions, type ProjectDef, type RejectedMessage, type ReviewDecision,
  type ReviewMessage, type TaskDef, type WorldConfig,
} from "@juego/shared";
import { enter, logout } from "./account.ts";
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
};

async function join(token: string): Promise<PanelRoom> {
  const options: JoinOptions = { token, view: "panel" };
  return new Client(location.origin).join(ROOM_NAME, options, WorldState);
}

/** Tabla de tareas y formulario de revisión de un proyecto. Los elementos se crean una vez (no se pierde el foco). */
function createProjectView(container: HTMLElement, config: WorldConfig, project: ProjectDef, room: PanelRoom, me: string, announce: (text: string) => void) {
  const resourceName = new Map(config.resources.map((r) => [r.id, r.name.toLowerCase()]));
  const coordinator = authorize(me, "review", project);
  const headingId = `proyecto-${project.id}`;
  const status = el("span");
  const coordinators = el("span");
  const section = el("section", { className: "proyecto" });
  section.setAttribute("aria-labelledby", headingId);
  section.append(
    el("h2", { id: headingId }, `Proyecto: ${project.name}`),
    el("p", {}, el("span", { className: "etiqueta", title: "Clasificación de realidad" }, project.reality),
      " ", el("code", {}, project.id), " · Comunidad: ", config.community.name),
    el("p", {}, project.description),
    el("p", {}, "Estado: ", status),
    el("p", { className: "ayuda" }, "Coordinación: ", coordinators,
      project.buildRequiresApproval ? ". Construir exige todas las tareas aprobadas." : ". La revisión deja constancia; no bloquea la construcción."),
  );

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

  const activity = el("ol", { id: "actividad" });
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
        row.status.textContent = STATUS_TEXT[st] ?? st;
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
          const available = Math.min(balance, remaining);
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

function startPanel(room: PanelRoom, config: WorldConfig, name: string) {
  byId("entrada").hidden = true;
  byId("panel").hidden = false;
  const notice = byId("aviso");
  const rejection = byId("rechazo");
  const connection = byId("conexion");
  const roles = config.projects.filter((p) => authorize(name, "review", p)).map((p) => p.name);
  byId("quien").textContent = `Conectado como ${name}${roles.length ? ` (coordinación de ${roles.join(", ")})` : " (participante)"}.`;

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

  let rejectionTimer: number | undefined;
  room.onMessage(MESSAGE.rejected, ({ reason }: RejectedMessage) => {
    rejection.textContent = REJECT_TEXT[reason];
    window.clearTimeout(rejectionTimer);
    rejectionTimer = window.setTimeout(() => { rejection.textContent = ""; }, 6000);
  });

  const container = byId("proyectos");
  const views = config.projects.map((p) => createProjectView(container, config, p, room, name, (text) => { notice.textContent = text; }));
  const render = () => { for (const view of views) view.render(); };
  room.onStateChange(render);
  container.addEventListener("change", render); // la tarea elegida para revisar cambia el aviso
  render();
  byId(`proyecto-${config.projects[0]?.id}`)?.setAttribute("tabindex", "-1");
  byId(`proyecto-${config.projects[0]?.id}`)?.focus();
}

async function start() {
  const config = (await (await fetch("/config")).json()) as WorldConfig;
  const { room, session } = await enter(join);
  startPanel(room, config, session.name);
}

start();
