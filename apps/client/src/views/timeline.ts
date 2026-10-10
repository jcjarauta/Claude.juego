import { addDays, criticalChain, daysBetween, isOverdue, isValidDate, localDay, REASON_MAX, REJECT_TEXT } from "@juego/shared";
import { el, projectDone, readableDate, signatureOf, taskDone, visibleProjects, type ViewContext } from "./common.ts";

// Cronograma (F1b): barras desde el inicio hasta la fecha objetivo, marca de «hoy» y una tabla
// equivalente (Q179). Replanificar lo hacen la coordinación o la administración, con motivo (Q177).

const SVG = "http://www.w3.org/2000/svg";

/** Estados legibles de proyectos y tareas. */
const STATUS_TEXT: Record<string, string> = {
  pendiente: "Pendiente", "en-curso": "En curso", completada: "Completada", aprobada: "Aprobada", rechazada: "Rechazada",
  listo: "Listo para construir", construido: "Construido", "en-revision": "Falta aprobar", completado: "Completado", cerrado: "Cerrado",
};
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};

interface Row {
  projectId: string;
  taskId: string;
  label: string;
  start: string;
  due: string;
  done: boolean;
  overdue: boolean;
  status: string;
  reschedules: number;
  /** Títulos de las tareas de las que depende (F1c). */
  dependsOn: string[];
  /** Ids de requisitos (para las líneas del gráfico). */
  dependsOnIds: string[];
  critical: boolean;
  canReschedule: boolean;
}

export function createTimeline(root: HTMLElement, ctx: ViewContext) {
  const chartBox = el("div", { className: "cronograma-grafico" });
  const tableBody = el("tbody");
  const table = el("table", {},
    el("caption", {}, "Cronograma en tabla (misma información que el gráfico)"),
    el("thead", {}, el("tr", {}, ...["Elemento", "Inicio", "Fecha objetivo", "Estado", "Plazo", "Depende de", "Cadena crítica", "Replanificado", "Acción"].map((h) => { const th = el("th", {}, h); th.scope = "col"; return th; }))),
    tableBody);

  // Formulario de replanificación común (no se borra al repintar).
  let target: { projectId: string; taskId: string } | undefined;
  const legend = el("h3", { id: "replanificar-titulo" }, "Replanificar");
  const date = el("input", { type: "date", id: "replanificar-fecha", required: true });
  const reason = el("textarea", { id: "replanificar-motivo", maxLength: REASON_MAX });
  const error = el("p", { className: "error", role: "alert" });
  const cancel = el("button", { type: "button", textContent: "Cancelar" });
  const form = el("form", { className: "replanificar", hidden: true, noValidate: true },
    legend,
    el("label", { htmlFor: date.id }, "Nueva fecha objetivo"), date,
    el("label", { htmlFor: reason.id }, "Motivo"), reason,
    el("p", { className: "ayuda" }, `Obligatorio, de 1 a ${REASON_MAX} caracteres. Queda en el historial.`),
    error, el("p", {}, el("button", { type: "submit", textContent: "Guardar la nueva fecha" }), " ", cancel));
  form.setAttribute("aria-labelledby", legend.id);
  let returnFocus: HTMLElement | undefined;
  cancel.onclick = () => { form.hidden = true; target = undefined; returnFocus?.focus(); };
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!target) return;
    if (!isValidDate(date.value)) { error.textContent = REJECT_TEXT["fecha-invalida"]; date.focus(); return; }
    if (!reason.value.trim()) { error.textContent = REJECT_TEXT["motivo-invalido"]; reason.focus(); return; }
    ctx.reschedule(target.projectId, target.taskId, date.value, reason.value);
    ctx.announce("Replanificación enviada.");
    reason.value = "";
    form.hidden = true;
    target = undefined;
    root.focus(); // la tabla se repinta con la nueva fecha: el foco vuelve al panel del cronograma
  };

  root.append(chartBox, el("div", { className: "tabla" }, table), form);

  let lastSignature = "";
  return {
    render() {
      const today = localDay();
      const signature = signatureOf(ctx, today);
      if (signature === lastSignature) return;
      lastSignature = signature;
      const admin = ctx.config.admins.includes(ctx.me);
      const rows: Row[] = [];
      for (const [projectId, p] of visibleProjects(ctx)) {
        const start = p.createdAt ? localDay(p.createdAt) : today;
        const can = (admin || p.coordinators.includes(ctx.me)) && p.phase !== "cerrado";
        const pDone = projectDone(p);
        rows.push({ projectId, taskId: "", label: `Proyecto: ${p.name}`, start, due: p.dueDate, done: pDone, overdue: isOverdue(p.dueDate, pDone, today), status: p.phase === "cerrado" ? "cerrado" : p.status, reschedules: p.reschedules, canReschedule: can, dependsOn: [], dependsOnIds: [], critical: false });
        // Cadena crítica (Q183): la cadena más larga de tareas pendientes encadenadas.
        const chain = new Set(criticalChain([...p.tasks.entries()].map(([id, t]) => ({ id, dependsOn: [...t.dependsOn] })), (id) => taskDone(p, p.tasks.get(id)?.status ?? "")));
        for (const [taskId, t] of p.tasks) {
          const done = taskDone(p, t.status);
          const deps = [...t.dependsOn];
          rows.push({
            projectId, taskId, label: `  · ${t.title}`, start, due: t.dueDate, done, overdue: isOverdue(t.dueDate, done, today), status: t.status,
            reschedules: t.reschedules, canReschedule: can, dependsOn: deps.map((d) => p.tasks.get(d)?.title ?? d), dependsOnIds: deps, critical: chain.has(taskId),
          });
        }
      }

      // Tabla.
      tableBody.replaceChildren(...rows.map((r) => {
        const plazo = !r.due ? "—" : r.done ? "Terminado" : r.overdue ? `VENCIDO hace ${-daysBetween(today, r.due)} días` : `Faltan ${daysBetween(today, r.due)} días`;
        const action = el("td");
        if (r.canReschedule) {
          const button = el("button", { type: "button", textContent: "Replanificar…" });
          button.setAttribute("aria-label", `Replanificar ${r.label.replace("  · ", "la tarea ")}`);
          button.onclick = () => {
            target = { projectId: r.projectId, taskId: r.taskId };
            legend.textContent = `Replanificar: ${r.label.replace("  · ", "tarea ")}`;
            date.value = r.due || today;
            error.textContent = "";
            form.hidden = false;
            returnFocus = button;
            date.focus();
          };
          action.append(button);
        }
        const th = el("th", {}, r.label.trim());
        th.scope = "row";
        return el("tr", { className: r.overdue ? "vencida" : "" }, th, el("td", {}, readableDate(r.start)), el("td", {}, readableDate(r.due)),
          el("td", {}, STATUS_TEXT[r.status] ?? r.status), el("td", {}, plazo),
          ...[el("td", {}, r.dependsOn.length ? r.dependsOn.join(", ") : "—"), el("td", {}, r.critical ? "Sí" : "—")],
          el("td", {}, r.reschedules ? `${r.reschedules} ${r.reschedules === 1 ? "vez" : "veces"}` : "No"), action);
      }));

      // Gráfico de barras (decorativo-informativo; la tabla es la alternativa completa).
      const dated = rows.filter((r) => r.due);
      chartBox.replaceChildren();
      if (!dated.length) {
        chartBox.append(el("p", { className: "ayuda" }, "Ningún proyecto o tarea visible tiene fecha objetivo: no hay barras que dibujar."));
        return;
      }
      const first = [today, ...dated.map((r) => r.start)].sort()[0]!;
      const last = addDays([today, ...dated.map((r) => r.due)].sort().at(-1)!, 2);
      const span = Math.max(1, daysBetween(first, last));
      const labelW = 220, width = 900, rowH = 26;
      const x = (day: string) => labelW + ((width - labelW - 10) * daysBetween(first, day)) / span;
      const height = rowH * (dated.length + 1) + 10;
      const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-labelledby": "crono-titulo crono-desc", class: "cronograma-svg" });
      chart.append(svg("title", { id: "crono-titulo" }, "Cronograma de proyectos y tareas"),
        svg("desc", { id: "crono-desc" }, `Barras desde el inicio hasta la fecha objetivo, entre ${readableDate(first)} y ${readableDate(last)}. Hoy: ${readableDate(today)}. La tabla siguiente contiene los mismos datos.`));
      dated.forEach((r, i) => {
        const y = rowH * (i + 1);
        chart.append(svg("text", { x: 4, y: y + 16, class: "crono-etiqueta" }, `${r.label.trim()}${r.overdue ? " (vencida)" : r.done ? " (terminada)" : ""}`));
        const x0 = x(r.start < r.due ? r.start : r.due), x1 = Math.max(x(r.due), x0 + 4);
        chart.append(svg("rect", {
          x: x0, y: y + 4, width: x1 - x0, height: rowH - 10, rx: 3,
          class: `${r.overdue ? "barra vencida" : r.done ? "barra terminada" : "barra"}${r.critical ? " critica" : ""}`,
        }));
        if (r.critical) chart.append(svg("text", { x: x1 + 4, y: y + 16, class: "crono-etiqueta" }, "crítica"));
      });
      // Líneas de dependencia: del final del requisito al inicio de la tarea que depende de él.
      dated.forEach((r, i) => {
        for (const dep of r.dependsOnIds) {
          const j = dated.findIndex((d) => d.projectId === r.projectId && d.taskId === dep);
          if (j < 0) continue;
          const from = dated[j]!;
          const xFrom = Math.max(x(from.due), x(from.start) + 4), yFrom = rowH * (j + 1) + rowH / 2;
          const xTo = x(r.start < r.due ? r.start : r.due), yTo = rowH * (i + 1) + rowH / 2;
          chart.append(svg("path", { d: `M ${xFrom} ${yFrom} C ${xFrom + 20} ${yFrom}, ${xTo - 20} ${yTo}, ${xTo} ${yTo}`, class: "dependencia" }));
        }
      });
      const tx = x(today);
      chart.append(svg("line", { x1: tx, x2: tx, y1: 4, y2: height - 4, class: "hoy" }), svg("text", { x: tx + 4, y: 16, class: "crono-etiqueta" }, "hoy"));
      chartBox.append(chart, el("p", { className: "ayuda" }, "Leyenda: barra rellena = pendiente; con rayas = vencida; tenue = terminada; borde blanco y «crítica» = cadena crítica; líneas azules = dependencias. La línea vertical marca hoy."));
    },
  };
}
