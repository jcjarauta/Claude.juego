import { el } from "./dom.ts";
import type { EventLog } from "./event-log-model.ts";
import type { EventKind } from "./game-events.ts";
import type { Notification, NotificationCenter } from "./notification-center-model.ts";

// Consola (G3b, Q201, Q207): dos vistas de la misma fuente de eventos.
//  - «Importantes»: notificaciones pendientes (críticas hasta resolverse o descartarse; relevantes unos segundos).
//    «Descartar» solo oculta el aviso; las acciones (p. ej. Aceptar/Rechazar una oferta) son operaciones del juego.
//  - «Historial»: cronológico, con filtros y «Limpiar». NO es región viva (se lee yendo a él con el atajo C); los anuncios
//    salen del anunciador, no de aquí.
// Replegada, muestra solo Importantes y los contadores.

export const KIND_GROUPS: { id: string; label: string; kinds: EventKind[] }[] = [
  { id: "recursos", label: "Recursos", kinds: ["recoleccion", "deposito"] },
  { id: "proyecto", label: "Proyecto", kinds: ["aporte", "construccion", "mision"] },
  { id: "fabricacion", label: "Fabricación", kinds: ["fabricacion"] },
  { id: "habilidades", label: "Habilidades", kinds: ["habilidad", "oferta"] },
  { id: "mundo", label: "Mundo", kinds: ["mundo", "conexion"] },
  { id: "avisos", label: "Avisos", kinds: ["aviso", "error"] },
];

const KIND_LABEL: Record<EventKind, string> = {
  recoleccion: "Recursos", deposito: "Recursos", aporte: "Proyecto", construccion: "Proyecto", mision: "Misión", habilidad: "Habilidad", oferta: "Oferta",
  fabricacion: "Fabricación", mundo: "Mundo", conexion: "Conexión", aviso: "Aviso", error: "Error",
};

const time = (at: number) => new Date(at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export interface ConsoleOptions {
  log: EventLog;
  center: NotificationCenter;
  /** Una acción de una notificación (operación del juego), p. ej. aceptar o rechazar una oferta. */
  onAction: (notificationKey: string, actionId: string) => void;
  expanded?: boolean;
  /** Prefijo de los ids (la consola puede aparecer más de una vez, p. ej. en la guía de estilo). */
  idPrefix?: string;
}

export function createConsole(options: ConsoleOptions) {
  const { log, center, onAction } = options;
  const p = options.idPrefix ?? "consola";
  let expanded = options.expanded ?? true;
  const shown = new Set<EventKind>(KIND_GROUPS.flatMap((g) => g.kinds));

  const toggle = el("button", { type: "button", id: `${p}-alternar` });
  toggle.setAttribute("aria-controls", `${p}-cuerpo`);
  const counters = el("span", { className: "ayuda", id: `${p}-contadores` });
  const header = el("div", { className: "consola-cabecera" }, el("h2", { id: `${p}-titulo` }, "Consola"), toggle, counters);

  const pendingList = el("ul", { className: "importantes", id: `${p}-importantes` });
  const pendingSection = el("section", {}, el("h3", { id: `${p}-importantes-titulo` }, "Importantes"), pendingList);
  pendingSection.setAttribute("aria-labelledby", `${p}-importantes-titulo`);

  const filters = el("fieldset", { className: "filtros" }, el("legend", {}, "Mostrar en el historial"));
  const clear = el("button", { type: "button" }, "Limpiar historial");
  for (const group of KIND_GROUPS) {
    const box = el("input", { type: "checkbox", id: `${p}-filtro-${group.id}`, checked: true });
    box.onchange = () => { for (const k of group.kinds) { if (box.checked) shown.add(k); else shown.delete(k); } renderHistory(); };
    filters.append(el("label", { className: "casilla" }, box, ` ${group.label}`));
  }
  const history = el("ol", { className: "historial", id: `${p}-historial`, tabIndex: 0 });
  history.setAttribute("role", "log");
  history.setAttribute("aria-live", "off");
  history.setAttribute("aria-label", "Historial de eventos, del más antiguo al más reciente");
  const historySection = el("section", {}, el("h3", { id: `${p}-historial-titulo` }, "Historial"), filters, clear, history);
  historySection.setAttribute("aria-labelledby", `${p}-historial-titulo`);

  const body = el("div", { id: `${p}-cuerpo`, className: "consola-cuerpo" }, pendingSection, historySection);
  const element = el("section", { className: "consola", id: p }, header, body);
  element.setAttribute("aria-labelledby", `${p}-titulo`);

  clear.onclick = () => { log.clear(); };

  /** Reconstruir listas sin perder el foco: se recuerda qué control lo tenía y se restaura. */
  function keepFocus(render: () => void) {
    const active = document.activeElement as HTMLElement | null;
    const mark = active && element.contains(active) ? active.dataset.foco : undefined;
    render();
    if (mark) element.querySelector<HTMLElement>(`[data-foco="${CSS.escape(mark)}"]`)?.focus();
  }

  function notificationItem(n: Notification): HTMLLIElement {
    const e = n.event;
    const text = `${e.text}${n.count > 1 ? ` (×${n.count})` : ""}`;
    const row = el("li", { className: `notificacion ${e.importance}` }, el("strong", {}, `${KIND_LABEL[e.kind]}: `), text, " ");
    for (const action of e.actions ?? []) {
      const b = el("button", { type: "button", className: "accion" }, action.label);
      b.dataset.foco = `${n.key}|${action.id}`;
      b.onclick = () => onAction(n.key, action.id);
      row.append(b, " ");
    }
    const dismiss = el("button", { type: "button", className: "descartar" }, "Descartar");
    dismiss.setAttribute("aria-label", `Descartar el aviso: ${e.text}. No cancela la operación.`);
    dismiss.dataset.foco = `${n.key}|descartar`;
    dismiss.onclick = () => { center.dismiss(n.key); };
    row.append(dismiss);
    return row;
  }

  let pendingSignature = "";
  function renderPending() {
    const pending = center.pending();
    const signature = pending.map((n) => `${n.key}:${n.count}:${n.event.text}:${(n.event.actions ?? []).map((a) => a.id).join(",")}`).join("|");
    if (signature === pendingSignature) return;
    pendingSignature = signature;
    keepFocus(() => pendingList.replaceChildren(...(pending.length ? pending.map(notificationItem) : [el("li", { className: "ayuda" }, "Nada pendiente.")])));
  }

  function renderHistory() {
    const atBottom = history.scrollTop + history.clientHeight >= history.scrollHeight - 8;
    const entries = log.list(shown);
    history.replaceChildren(...(entries.length ? entries.map((entry) => el("li", {}, el("time", {}, `${time(entry.event.at)} `),
      el("strong", {}, `${KIND_LABEL[entry.event.kind]}: `), `${entry.event.text}${entry.repeats > 1 ? ` (×${entry.repeats})` : ""}`)) : [el("li", { className: "ayuda" }, "Sin eventos que mostrar.")]));
    if (atBottom) history.scrollTop = history.scrollHeight;
  }

  function renderChrome() {
    const pendingCount = center.pending().length;
    toggle.textContent = expanded ? "Plegar consola" : "Desplegar consola";
    toggle.setAttribute("aria-expanded", String(expanded));
    historySection.hidden = !expanded;
    counters.textContent = `${pendingCount} ${pendingCount === 1 ? "pendiente" : "pendientes"}${expanded ? "" : `; ${log.unread()} nuevas en el historial`}`;
    element.classList.toggle("plegada", !expanded);
  }

  function render() { renderPending(); renderHistory(); renderChrome(); }
  toggle.onclick = () => { api.setExpanded(!expanded); };

  const api = {
    element,
    expanded: () => expanded,
    setExpanded(value: boolean) {
      expanded = value;
      if (expanded) log.markRead();
      render();
    },
    /** Atajo C: lleva el foco al historial (o al botón de desplegar si está plegada). */
    focusLog() {
      if (!expanded) api.setExpanded(true);
      history.focus();
    },
    render,
  };
  log.subscribe(() => { if (expanded && log.unread() > 0) { log.markRead(); return; } render(); });
  center.subscribe(render);
  render();
  return api;
}

export type GameConsole = ReturnType<typeof createConsole>;
