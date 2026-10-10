import { COMMENT_MAX, MESSAGE, REJECT_TEXT, type CommentMessage, type CommentsResponse } from "@juego/shared";
import { savedSession } from "../account.ts";
import { newRequestId } from "../request-id.ts";
import { el, type PanelRoom } from "./common.ts";

// Hilo de comentarios de una tarea (F1c, Q184). Un único hilo abierto a la vez, fuera de las vistas,
// para que repintarlas no borre lo escrito. El hilo completo se pide por HTTP con el token en la cabecera.

const time = (at: number) => new Date(at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function createComments(container: HTMLElement, room: PanelRoom, announce: (text: string) => void) {
  const heading = el("h2", { id: "comentarios-titulo", tabIndex: -1 }, "Comentarios");
  const list = el("ol", { className: "comentarios" });
  const text = el("textarea", { id: "comentario-texto", maxLength: COMMENT_MAX });
  const help = el("p", { id: "comentario-ayuda", className: "ayuda" }, `De 1 a ${COMMENT_MAX} caracteres. Los comentarios no se editan ni se borran.`);
  text.setAttribute("aria-describedby", help.id);
  const error = el("p", { className: "error", role: "alert" });
  const close = el("button", { type: "button", textContent: "Cerrar los comentarios" });
  const form = el("form", {}, el("label", { htmlFor: text.id }, "Nuevo comentario"), text, help, error,
    el("p", {}, el("button", { type: "submit", textContent: "Comentar" }), " ", close));
  const section = el("section", { className: "hilo", hidden: true }, heading, list, form);
  section.setAttribute("aria-labelledby", heading.id);
  container.append(section);

  let current: { projectId: string; taskId: string; title: string; count: number; opener?: HTMLElement } | undefined;

  async function load() {
    if (!current) return;
    const { projectId, taskId } = current;
    try {
      const res = await fetch(`/api/proyectos/${encodeURIComponent(projectId)}/tareas/${encodeURIComponent(taskId)}/comentarios`,
        { headers: { authorization: `Bearer ${savedSession()?.token ?? ""}` } });
      if (!res.ok || current?.taskId !== taskId || current.projectId !== projectId) return;
      const data = (await res.json()) as CommentsResponse;
      list.replaceChildren(...(data.comments.length
        ? data.comments.map((c) => el("li", {}, el("strong", {}, c.by), ` (${time(c.at)}): ${c.text}`))
        : [el("li", {}, "Todavía no hay comentarios.")]));
    } catch { /* sin red: se reintenta al siguiente cambio */ }
  }

  close.onclick = () => {
    section.hidden = true;
    current?.opener?.focus();
    current = undefined;
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!current) return;
    if (!text.value.trim()) { error.textContent = REJECT_TEXT["comentario-invalido"]; text.focus(); return; }
    const message: CommentMessage = { requestId: newRequestId(), projectId: current.projectId, taskId: current.taskId, text: text.value };
    room.send(MESSAGE.comment, message);
    text.value = "";
    error.textContent = "";
    announce("Comentario enviado.");
  };

  return {
    open(projectId: string, taskId: string, title: string, opener?: HTMLElement) {
      const count = room.state.projects.get(projectId)?.tasks.get(taskId)?.comments ?? 0;
      current = { projectId, taskId, title, count, opener };
      heading.textContent = `Comentarios: «${title}»`;
      list.replaceChildren(el("li", {}, "Cargando…"));
      error.textContent = "";
      section.hidden = false;
      section.scrollIntoView({ block: "nearest" });
      text.focus();
      void load();
    },
    /** Si llegan comentarios nuevos a la tarea abierta, se recarga el hilo. */
    render() {
      if (!current) return;
      const count = room.state.projects.get(current.projectId)?.tasks.get(current.taskId)?.comments ?? 0;
      if (count !== current.count) {
        current.count = count;
        void load();
      }
    },
  };
}
