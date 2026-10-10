import { BOARD_COLUMNS, boardColumn, isOverdue, localDay, NOTE_MAX, REJECT_TEXT } from "@juego/shared";
import { el, readableDate, signatureOf, taskDone, visibleProjects, type ViewContext } from "./common.ts";

// Tablero (F1b, Q178): una columna por estado de tarea. El estado lo deciden los aportes y las
// revisiones, así que no se arrastra: desde una tarjeta completada la coordinación aprueba o rechaza.

export function createBoard(root: HTMLElement, ctx: ViewContext) {
  const resourceName = new Map(ctx.config.resources.map((r) => [r.id, r.name.toLowerCase()]));
  const columns = el("div", { className: "tablero" });
  const lists = new Map<string, { heading: HTMLElement; list: HTMLUListElement }>();
  for (const column of BOARD_COLUMNS) {
    const heading = el("h3", { id: `columna-${column.id}` });
    const list = el("ul", { className: "tarjetas" });
    list.setAttribute("aria-labelledby", heading.id);
    columns.append(el("section", { className: "columna" }, heading, list));
    lists.set(column.id, { heading, list });
  }

  // Formulario de revisión común: fuera de las tarjetas, para que repintarlas no borre lo escrito.
  let target: { projectId: string; taskId: string; decision: "aprobada" | "rechazada" } | undefined;
  const legend = el("h3", { id: "tablero-revision-titulo" }, "Revisión");
  const note = el("textarea", { id: "tablero-nota", maxLength: NOTE_MAX });
  const help = el("p", { className: "ayuda", id: "tablero-nota-ayuda" }, `Nota obligatoria, de 1 a ${NOTE_MAX} caracteres. Queda registrada con la evidencia.`);
  note.setAttribute("aria-describedby", help.id);
  const error = el("p", { className: "error", role: "alert" });
  const confirm = el("button", { type: "submit", textContent: "Confirmar" });
  const cancel = el("button", { type: "button", textContent: "Cancelar" });
  const form = el("form", { className: "revision-tablero", hidden: true },
    legend, el("label", { htmlFor: note.id }, "Nota"), note, help, error, el("p", {}, confirm, " ", cancel));
  form.setAttribute("aria-labelledby", legend.id);
  let returnFocus: HTMLElement | undefined;
  cancel.onclick = () => {
    form.hidden = true;
    target = undefined;
    returnFocus?.focus();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!target) return;
    if (!note.value.trim()) {
      error.textContent = REJECT_TEXT["nota-invalida"];
      note.focus();
      return;
    }
    ctx.review(target.projectId, target.taskId, target.decision, note.value);
    ctx.announce(`Revisión enviada: ${target.decision === "aprobada" ? "aprobar" : "rechazar"}.`);
    note.value = "";
    form.hidden = true;
    target = undefined;
    root.focus(); // el panel del tablero es enfocable; la tarjeta ya cambió de columna
  };

  root.append(el("p", { className: "ayuda" }, "Las tareas cambian de columna solas al aportar y al revisar. Con una tarea completada, la coordinación puede aprobarla o rechazarla desde su tarjeta."), columns, form);

  let lastSignature = "";
  return {
    render() {
      const today = localDay();
      const signature = signatureOf(ctx, today);
      if (signature === lastSignature) return;
      lastSignature = signature;
      const cards = new Map<string, HTMLLIElement[]>(BOARD_COLUMNS.map((c) => [c.id, []]));
      for (const [projectId, project] of visibleProjects(ctx)) {
        const coordinator = project.coordinators.includes(ctx.me);
        for (const [taskId, task] of project.tasks) {
          const column = boardColumn(task.status);
          const done = project.progress.get(task.resource) ?? 0;
          const due = task.dueDate || project.dueDate;
          const overdue = isOverdue(due, taskDone(project, task.status), today);
          const card = el("li", { className: overdue ? "tarjeta vencida" : "tarjeta" },
            el("strong", {}, task.title),
            el("span", {}, `Proyecto: ${project.name}${project.phase === "cerrado" ? " (cerrado)" : ""}`),
            el("span", {}, `${done}/${task.required} ${resourceName.get(task.resource) ?? task.resource}`),
            el("span", {}, due ? `Fecha objetivo: ${readableDate(due)}${overdue ? " — VENCIDA" : ""}` : "Sin fecha objetivo"),
          );
          if (task.decision) card.append(el("span", {}, `${task.decision === "aprobada" ? "Aprobada" : "Rechazada"} por ${task.reviewedBy}: «${task.note}»`));
          if (coordinator && (column === "completada" || column === "rechazada" || column === "aprobada") && done >= task.required) {
            const actions = el("p", { className: "acciones" });
            for (const decision of ["aprobada", "rechazada"] as const) {
              if (task.decision === decision) continue;
              const button = el("button", { type: "button", textContent: decision === "aprobada" ? "Aprobar…" : "Rechazar…" });
              button.setAttribute("aria-label", `${decision === "aprobada" ? "Aprobar" : "Rechazar"} «${task.title}» de ${project.name}`);
              button.onclick = () => {
                target = { projectId, taskId, decision };
                legend.textContent = `${decision === "aprobada" ? "Aprobar" : "Rechazar"} «${task.title}» (${project.name})`;
                confirm.textContent = decision === "aprobada" ? "Confirmar la aprobación" : "Confirmar el rechazo";
                error.textContent = "";
                form.hidden = false;
                returnFocus = button;
                note.focus();
              };
              actions.append(button, " ");
            }
            card.append(actions);
          }
          cards.get(column)!.push(card);
        }
      }
      for (const column of BOARD_COLUMNS) {
        const { heading, list } = lists.get(column.id)!;
        const items = cards.get(column.id)!;
        heading.textContent = `${column.title} (${items.length})`;
        list.replaceChildren(...(items.length ? items : [el("li", { className: "vacia" }, "Ninguna tarea.")]));
      }
    },
  };
}
