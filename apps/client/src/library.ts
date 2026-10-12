import { MESSAGE, type DefinitionHistoryMessage, type HistoryMessage, type WorldState } from "@juego/shared";
import type { Room } from "@colyseus/sdk";
import { historyRows, LIBRARY_KINDS, libraryRows, type LibraryKind } from "./library-model.ts";
import { dataTable } from "./ui/data-table.ts";
import { openDialog } from "./ui/dialog.ts";
import { el } from "./ui/dom.ts";

// Biblioteca (G2, Q243 y Q248): todas las definiciones del mundo —objetos, recetas, habilidades, misiones y construcciones— con su
// versión, su origen y su estado, y el historial de cada una (quién y cuándo). Solo la administración la ve. En esta puerta es de
// lectura: editar, retirar y duplicar llegan en las siguientes.

const formatDate = (at: number) => new Date(at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });

export function createLibrary(room: Room<unknown, WorldState>, announce: (text: string) => void) {
  const tables = el("div", { id: "biblioteca-listas" });
  const section = el("section", { id: "biblioteca" },
    el("h2", { id: "biblioteca-titulo" }, "Biblioteca"),
    el("p", { className: "ayuda" }, "Todo lo que hay en el mundo, con su versión, de dónde viene y en qué estado está. Lo que viene de la configuración no se edita: se duplicará para tener una copia editable. El historial dice quién y cuándo cambió cada versión; nada se borra."),
    tables);
  section.setAttribute("aria-labelledby", "biblioteca-titulo");

  let pending: { kind: LibraryKind; id: string; name: string } | undefined;
  let signature = "";

  room.onMessage(MESSAGE.history, (message: HistoryMessage) => {
    if (!pending || pending.kind !== message.kind || pending.id !== message.id) return;
    const { name } = pending;
    pending = undefined;
    const content = el("div", {},
      el("p", {}, `Versión de contenido vigente: v${message.version} · revisión de concurrencia: ${message.rev}. La versión sube al editar o volver a una anterior; la revisión, con cualquier cambio (también archivar o retirar).`),
      dataTable(`Versiones de «${name}»`, ["Versión", "Nombre en esa versión", "Quién", "Cuándo", "Nota"], historyRows(message, formatDate)));
    openDialog({ title: `Historial de «${name}»`, content });
    announce(`Historial de «${name}»: ${message.versions.length} ${message.versions.length === 1 ? "versión" : "versiones"}.`);
  });

  function requestHistory(kind: LibraryKind, id: string, name: string) {
    pending = { kind, id, name };
    const message: DefinitionHistoryMessage = { kind, id };
    room.send(MESSAGE.definitionHistory, message);
  }

  function render() {
    const state = room.state;
    const sections = LIBRARY_KINDS.map((info) => ({ info, rows: libraryRows(state, info.kind) }));
    const next = JSON.stringify(sections.map((s) => s.rows));
    if (next === signature) return;
    signature = next;
    tables.replaceChildren(...sections.map(({ info, rows }) => {
      if (!rows.length) return el("div", {}, el("h3", {}, info.plural), el("p", { className: "vacia" }, `Todavía no hay ${info.plural.toLowerCase()}.`));
      const cells = rows.map((r) => {
        const action = r.hasHistory
          ? Object.assign(el("button", { type: "button" }, "Historial"), { onclick: () => requestHistory(r.kind, r.id, r.name) })
          : el("span", {}, "Sin historial (viene de la configuración)");
        if (action instanceof HTMLButtonElement) action.setAttribute("aria-label", `Historial de ${info.singular} «${r.name}»`);
        return [r.name, r.version, r.origin, r.status, action];
      });
      return dataTable(`${info.plural} (${rows.length})`, ["Nombre", "Versión", "Origen", "Estado", "Acción"], cells);
    }));
  }

  return { element: section, render };
}
