import {
  BOARD_COLUMNS, cumulativeSeries, localDay, projectMetrics,
  type DayAmount, type HistoryResponse,
} from "@juego/shared";
import { savedSession } from "../account.ts";
import { el, projectDone, readableDate, signatureOf, visibleProjects, type ViewContext } from "./common.ts";

// Indicadores (F1b): avance, tareas por estado, aportes por persona, ritmo de 7 días, plazo y
// evolución del aportado acumulado. La historia se pide por HTTP con el token en la cabecera (Q179).

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createMetrics(root: HTMLElement, ctx: ViewContext) {
  const global = el("dl", { className: "globales" });
  const projects = el("div", { className: "indicadores" });
  const chart = el("div", { className: "evolucion" });
  root.append(el("h3", {}, "Resumen"), global, projects, chart);

  // Historia por proyecto: se pide de una en una (límite de 1 por segundo) y se repite si cambian los aportes.
  const history = new Map<string, { key: string; days: DayAmount[] }>();
  const queue: { id: string; key: string }[] = [];
  let fetching = false;
  let lastSignature = "";
  let active = false;
  async function pump() {
    if (fetching) return;
    const next = queue.shift();
    if (!next) return;
    fetching = true;
    try {
      const token = savedSession()?.token;
      const res = await fetch(`/api/proyectos/${encodeURIComponent(next.id)}/historia`, { headers: { authorization: `Bearer ${token ?? ""}` } });
      if (res.ok) {
        const data = (await res.json()) as HistoryResponse;
        history.set(next.id, { key: next.key, days: data.days });
        lastSignature = "";
        render();
      } else if (res.status === 429) {
        queue.unshift(next);
      }
    } catch { /* sin red: se reintentará al siguiente cambio */ }
    await new Promise((r) => setTimeout(r, 1100));
    fetching = false;
    void pump();
  }
  function want(id: string, key: string) {
    if (history.get(id)?.key === key || queue.some((q) => q.id === id && q.key === key)) return;
    queue.push({ id, key });
    void pump();
  }

  function render() {
    if (!active) return;
    const today = localDay();
    const signature = signatureOf(ctx, today + [...history.entries()].map(([id, h]) => `${id}:${h.key}`).join(","));
    if (signature === lastSignature) return;
    lastSignature = signature;
    const all = [...ctx.room.state.projects.values()];
    const missions = [...ctx.room.state.missions.values()];
    global.replaceChildren(
      el("dt", {}, "Proyectos abiertos"), el("dd", {}, String(all.filter((p) => p.phase !== "cerrado" && !projectDone(p)).length)),
      el("dt", {}, "Proyectos terminados"), el("dd", {}, String(all.filter(projectDone).length)),
      el("dt", {}, "Proyectos cerrados"), el("dd", {}, String(all.filter((p) => p.phase === "cerrado").length)),
      el("dt", {}, "Misiones completadas"), el("dd", {}, `${missions.filter((m) => m.status === "completada").length} de ${missions.length}`),
    );

    const visible = visibleProjects(ctx);
    projects.replaceChildren(...visible.map(([id, p]) => {
      const progressKey = [...p.progress.values()].join("+");
      want(id, progressKey);
      const tasks = [...p.tasks.values()].map((t) => ({ resource: t.resource, required: t.required, status: t.status }));
      const m = projectMetrics({ tasks, progress: (r) => p.progress.get(r) ?? 0, dueDate: p.dueDate || undefined, done: projectDone(p), today, history: history.get(id)?.days });
      const bar = el("progress", { max: 100, value: m.percent });
      bar.setAttribute("aria-label", `Avance de ${p.name}`);
      const contributors = [...p.contributors.entries()].map(([who, c]) => `${who}: ${[...c.totals.values()].reduce((a, b) => a + b, 0)}`);
      const plazo = m.daysLeft === null ? (p.dueDate ? "Terminado" : "Sin fecha objetivo")
        : m.overdue ? `VENCIDO: ${-m.daysLeft} días de retraso (fecha ${readableDate(p.dueDate)})` : `Faltan ${m.daysLeft} días (fecha ${readableDate(p.dueDate)})`;
      return el("article", { className: "indicador" },
        el("h3", {}, p.name),
        el("p", {}, `Avance: ${m.percent} % (${m.contributed} de ${m.required})`), bar,
        el("p", {}, `Tareas: ${BOARD_COLUMNS.map((c) => `${c.title.toLowerCase()} ${m.byColumn[c.id]}`).join(", ")}.`),
        el("p", {}, `Ritmo: ${m.last7 === null ? "calculando…" : `${m.last7} aportados en los últimos 7 días`}.`),
        el("p", {}, `Plazo: ${plazo}.`),
        el("p", {}, `Aportes por persona: ${contributors.length ? contributors.join(", ") : "todavía nadie"}.`),
      );
    }));

    // Evolución: solo con un proyecto elegido.
    chart.replaceChildren();
    const selected = ctx.filter();
    if (!selected) {
      chart.append(el("p", { className: "ayuda" }, "Elige un proyecto en el selector para ver la evolución de lo aportado."));
      return;
    }
    const name = ctx.room.state.projects.get(selected)?.name ?? selected;
    const days = history.get(selected)?.days;
    chart.append(el("h3", { id: "evolucion-titulo" }, `Evolución de lo aportado: ${name}`));
    if (!days) { chart.append(el("p", {}, "Cargando la historia…")); return; }
    const series = cumulativeSeries(days);
    if (!series.length) { chart.append(el("p", {}, "Todavía no hay aportes.")); return; }
    const width = 640, height = 220, pad = 36;
    const max = Math.max(1, series.at(-1)!.total);
    const xs = (i: number) => pad + ((width - 2 * pad) * (series.length === 1 ? 0.5 : i / (series.length - 1)));
    const ys = (v: number) => height - pad - ((height - 2 * pad) * v) / max;
    const graph = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-labelledby": "evo-t evo-d", class: "evolucion-svg" });
    graph.append(svg("title", { id: "evo-t" }, `Aportado acumulado de ${name}`),
      svg("desc", { id: "evo-d" }, `De ${series[0]!.total} el ${readableDate(series[0]!.day)} a ${series.at(-1)!.total} el ${readableDate(series.at(-1)!.day)}. La tabla siguiente contiene los datos.`),
      svg("line", { x1: pad, y1: height - pad, x2: width - pad, y2: height - pad, class: "eje" }),
      svg("line", { x1: pad, y1: pad, x2: pad, y2: height - pad, class: "eje" }),
      svg("text", { x: 4, y: pad + 4, class: "crono-etiqueta" }, String(max)),
      svg("polyline", { points: series.map((s, i) => `${xs(i)},${ys(s.total)}`).join(" "), class: "linea" }));
    series.forEach((s, i) => graph.append(svg("circle", { cx: xs(i), cy: ys(s.total), r: 4, class: "punto" })));
    const body = el("tbody", {}, ...series.map((s) => el("tr", {}, el("td", {}, readableDate(s.day)), el("td", {}, String(days.find((d) => d.day === s.day)?.amount ?? 0)), el("td", {}, String(s.total)))));
    const table = el("table", {}, el("caption", {}, "Evolución en tabla"),
      el("thead", {}, el("tr", {}, ...["Día", "Aportado ese día", "Acumulado"].map((h) => { const th = el("th", {}, h); th.scope = "col"; return th; }))), body);
    chart.append(graph, el("div", { className: "tabla" }, table));
  }

  return {
    render,
    /** Solo se calcula (y se pide historia) con la pestaña visible. */
    setActive(value: boolean) {
      active = value;
      lastSignature = "";
      render();
    },
  };
}
