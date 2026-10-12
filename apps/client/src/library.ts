import {
  MESSAGE, type BuildLimits, type DefinitionHistoryMessage, type DefSavedMessage, type EditDefMessage, type HistoryMessage, type RejectedMessage, type RestoreVersionMessage, type WorldConfig, type WorldState,
} from "@juego/shared";
import type { Room } from "@colyseus/sdk";
import { currentLimits } from "./admin-design.ts";
import { readable } from "./admin-forms.ts";
import { buildEditForm } from "./edit-forms.ts";
import { historyRows, LIBRARY_KINDS, libraryRows, nameInVersion, type LibraryKind, type LibraryRow } from "./library-model.ts";
import { newRequestId } from "./request-id.ts";
import { dataTable } from "./ui/data-table.ts";
import { openDialog, type OpenDialog } from "./ui/dialog.ts";
import { el } from "./ui/dom.ts";

// Biblioteca (G2, Q243–Q245 y Q248): todas las definiciones del mundo —objetos, recetas, habilidades, misiones y construcciones— con su
// versión, su origen y su estado; el historial de cada una (quién y cuándo) y, para lo creado en el panel, editar por versiones y
// volver a una versión anterior. Solo la administración la ve. El servidor decide siempre: aquí se rellena, se muestra su análisis
// («esto es lo que cambia») y se confirma; si otra persona cambió algo mientras tanto, el servidor lo rechaza y se vuelve a cargar.

const formatDate = (at: number) => new Date(at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });

type Analysis = NonNullable<RejectedMessage["analysis"]>;

/** Lo que se está enviando al servidor y puede necesitar confirmación o recarga. */
interface Operation {
  type: "edit" | "restore";
  kind: LibraryKind;
  id: string;
  name: string;
  /** Cómo se llamará tras el cambio (para el aviso). */
  afterName: string;
  /** El `requestId` del último envío: solo la confirmación del servidor para ESE envío cierra el diálogo. */
  sent?: string;
  /** Lo que se reenvía (sin `requestId` ni `basis`, que cambian en cada envío). */
  body: Record<string, unknown>;
  dialog: OpenDialog;
  feedback: HTMLElement;
  buttons: HTMLElement;
  /** Reabre la pantalla con lo vigente (tras `version-obsoleta`). */
  reopen: () => void;
}

export function createLibrary(room: Room<unknown, WorldState>, config: WorldConfig, announce: (text: string) => void) {
  const tables = el("div", { id: "biblioteca-listas" });
  const section = el("section", { id: "biblioteca" },
    el("h2", { id: "biblioteca-titulo" }, "Biblioteca"),
    el("p", { className: "ayuda" }, "Todo lo que hay en el mundo, con su versión, de dónde viene y en qué estado está. Lo creado en el panel se edita por versiones: cada cambio añade una versión nueva y nada se borra; antes de aplicarlo se explica qué cambia. Lo que viene de la configuración no se edita."),
    tables);
  section.setAttribute("aria-labelledby", "biblioteca-titulo");

  let historyDialog: OpenDialog | undefined;
  let pendingHistory: { kind: LibraryKind; id: string; name: string } | undefined;
  let operation: Operation | undefined;
  let signature = "";
  const limits = (): BuildLimits => currentLimits(room.state, config);

  // ---------------------------------------------------------------------------------- enviar, confirmar y recargar
  function submit(basis?: string) {
    const op = operation;
    if (!op) return;
    op.feedback.replaceChildren(el("p", { role: "status" }, "Enviando…"));
    const message = { requestId: newRequestId(), ...op.body, ...(basis ? { basis } : {}) };
    op.sent = message.requestId;
    room.send(op.type === "edit" ? MESSAGE.editDef : MESSAGE.restoreVersion, message as EditDefMessage | RestoreVersionMessage);
  }

  const list = (title: string, items: string[]) => items.length ? el("div", {}, el("h3", {}, title), el("ul", {}, ...items.map((t) => el("li", {}, t)))) : el("span");

  /** El análisis previo: lo que cambia y lo que se conserva, con el botón para confirmar. */
  function showAnalysis(op: Operation, analysis: Analysis) {
    const confirm = el("button", { type: "button" }, op.type === "edit" ? "Confirmar el cambio" : "Confirmar y volver a esa versión");
    confirm.onclick = () => submit(analysis.basis);
    op.feedback.replaceChildren(
      el("div", { role: "status" },
        el("p", {}, el("strong", {}, "Revisa esto antes de confirmar.")),
        list("Lo que cambia", analysis.avisos), list("Lo que se conserva", analysis.efectos)));
    op.buttons.replaceChildren(confirm);
    confirm.focus();
    announce("Revisa lo que cambia y confirma el cambio.");
  }

  /** Rechazo del servidor para la operación abierta; devuelve true si lo mostró aquí. */
  function showRejection(text: string, details: string[] = [], analysis?: Analysis, reason?: string): boolean {
    const op = operation;
    if (!op) return false;
    if (reason === "analisis-desactualizado" && analysis) { showAnalysis(op, analysis); return true; }
    if (reason === "version-obsoleta") {
      const reload = el("button", { type: "button" }, "Cargar lo vigente");
      reload.onclick = () => { op.dialog.close(); op.reopen(); };
      op.feedback.replaceChildren(el("div", { role: "alert" }, el("p", {}, el("strong", {}, "Otra persona ha cambiado esto mientras lo editabas.")), ...details.map((d) => el("p", {}, d)),
        el("p", {}, "No se ha aplicado nada. Carga lo vigente y vuelve a hacer tu cambio sobre ello.")));
      op.buttons.replaceChildren(reload);
      reload.focus();
      return true;
    }
    op.feedback.replaceChildren(el("div", { role: "alert" }, el("p", {}, text), ...(details.length ? [el("ul", {}, ...details.map((d) => el("li", {}, readable(d))))] : [])));
    return true;
  }

  // ---------------------------------------------------------------------------------- editar
  function openEdit(row: LibraryRow) {
    const info = LIBRARY_KINDS.find((k) => k.kind === row.kind)!;
    const form = buildEditForm(row.kind, row.id, { state: room.state, config, limits: limits(), announce });
    const note = el("input", { maxLength: 200, autocomplete: "off" });
    const feedback = el("div", { className: "analisis" });
    const send = el("button", { type: "button" }, "Revisar el cambio");
    const buttons = el("p", {}, send);
    const content = el("div", {},
      el("p", { className: "ayuda" }, `Versión actual: ${row.version} · revisión ${row.rev}. Al guardar se crea una versión nueva; la actual no se borra y se podrá volver a ella desde el historial.`),
      form.element,
      el("div", { className: "campo" }, el("label", { htmlFor: "edicion-nota" }, "Nota del cambio (opcional)"), Object.assign(note, { id: "edicion-nota" })),
      feedback, buttons);
    const dialog = openDialog({ title: `Editar ${info.singular} «${row.name}»`, content, closeLabel: "Cancelar", onClose: () => { if (operation?.dialog === dialog) operation = undefined; } });
    send.onclick = () => {
      const read = form.read();
      if ("errors" in read) { feedback.replaceChildren(el("div", { role: "alert" }, ...read.errors.map((e) => el("p", {}, e)))); return; }
      operation = {
        type: "edit", kind: row.kind, id: row.id, name: row.name, afterName: nameInVersion(read.def), dialog, feedback, buttons,
        body: { kind: row.kind, id: row.id, def: read.def, expectedRev: row.rev, ...(note.value.trim() ? { note: note.value.trim() } : {}) },
        reopen: () => { const fresh = libraryRows(room.state, row.kind).find((r) => r.id === row.id); if (fresh) openEdit(fresh); },
      };
      submit();
    };
    form.focus();
  }

  // ---------------------------------------------------------------------------------- historial y volver a una versión
  function openHistory(message: HistoryMessage, name: string, row: LibraryRow | undefined) {
    const kind = message.kind as LibraryKind;
    const rows = historyRows(message, formatDate);
    const cells = rows.map((cols, i) => {
      const v = message.versions[i]!;
      const back = v.version === message.version
        ? el("span", {}, "Es la vigente")
        : Object.assign(el("button", { type: "button" }, "Volver a esta versión"), { onclick: () => startRestore(message, v.version, name, kind) });
      if (back instanceof HTMLButtonElement) back.setAttribute("aria-label", `Volver a la versión ${v.version} de «${name}»`);
      return [...cols, back];
    });
    const content = el("div", {},
      el("p", {}, `Versión de contenido vigente: v${message.version} · revisión de concurrencia: ${message.rev}. La versión sube al editar o volver a una anterior; la revisión, con cualquier cambio (también archivar o retirar).`),
      dataTable(`Versiones de «${name}»`, ["Versión", "Nombre en esa versión", "Quién", "Cuándo", "Nota", "Acción"], cells));
    const dialog = openDialog({ title: `Historial de «${name}»`, content, onClose: () => { if (historyDialog === dialog) historyDialog = undefined; } });
    historyDialog = dialog;
    announce(`Historial de «${name}»: ${message.versions.length} ${message.versions.length === 1 ? "versión" : "versiones"}.`);
    void row;
  }

  function startRestore(history: HistoryMessage, toVersion: number, name: string, kind: LibraryKind) {
    const feedback = el("div", { className: "analisis" });
    const send = el("button", { type: "button" }, "Revisar la vuelta");
    const buttons = el("p", {}, send);
    const content = el("div", {},
      el("p", {}, `Volver a la versión ${toVersion} de «${name}» no borra nada: crea una versión nueva (v${history.version + 1}) con el contenido de la v${toVersion}. Antes se explica qué cambia.`),
      feedback, buttons);
    const dialog = openDialog({ title: `Volver a la versión ${toVersion} de «${name}»`, content, closeLabel: "Cancelar", onClose: () => { if (operation?.dialog === dialog) operation = undefined; } });
    send.onclick = () => {
      operation = {
        type: "restore", kind, id: history.id, name, afterName: nameInVersion(history.versions.find((v) => v.version === toVersion)?.definition), dialog, feedback, buttons,
        body: { kind, id: history.id, toVersion, expectedRev: history.rev },
        reopen: () => requestHistory(kind, history.id, name),
      };
      submit();
    };
    send.focus();
  }

  // El servidor confirma SU cambio: así no se cierra el diálogo porque otra persona haya cambiado lo mismo (eso lo rechaza el servidor).
  room.onMessage(MESSAGE.defSaved, (saved: DefSavedMessage) => {
    const op = operation;
    if (!op || op.sent !== saved.requestId) return;
    operation = undefined;
    op.dialog.close();
    historyDialog?.close(); // el historial que quedaba debajo ya no está al día
    const name = op.afterName === "—" ? op.name : op.afterName;
    announce(`«${name}» ${op.type === "edit" ? "actualizado" : "vuelve a una versión anterior"}: ahora es v${saved.version}.`);
  });

  room.onMessage(MESSAGE.history, (message: HistoryMessage) => {
    if (!pendingHistory || pendingHistory.kind !== message.kind || pendingHistory.id !== message.id) return;
    const { name } = pendingHistory;
    pendingHistory = undefined;
    openHistory(message, name, undefined);
  });

  function requestHistory(kind: LibraryKind, id: string, name: string) {
    pendingHistory = { kind, id, name };
    const message: DefinitionHistoryMessage = { kind, id };
    room.send(MESSAGE.definitionHistory, message);
  }

  // ---------------------------------------------------------------------------------- listas
  function render() {
    const state = room.state;
    const sections = LIBRARY_KINDS.map((info) => ({ info, rows: libraryRows(state, info.kind) }));
    const next = JSON.stringify(sections.map((s) => s.rows));
    if (next === signature) return;
    signature = next;
    tables.replaceChildren(...sections.map(({ info, rows }) => {
      if (!rows.length) return el("div", {}, el("h3", {}, info.plural), el("p", { className: "vacia" }, `Todavía no hay ${info.plural.toLowerCase()}.`));
      const cells = rows.map((r) => {
        if (!r.hasHistory) return [r.name, r.version, r.origin, r.status, el("span", {}, "Solo lectura: viene de la configuración")];
        const history = Object.assign(el("button", { type: "button" }, "Historial"), { onclick: () => requestHistory(r.kind, r.id, r.name) });
        history.setAttribute("aria-label", `Historial de ${info.singular} «${r.name}»`);
        const editable = r.editable;
        const edit = Object.assign(el("button", { type: "button" }, "Editar"), { onclick: () => openEdit(r) });
        edit.setAttribute("aria-label", `Editar ${info.singular} «${r.name}»`);
        if (!editable) { edit.setAttribute("aria-disabled", "true"); edit.title = r.whyNot; edit.onclick = () => announce(`No se puede editar «${r.name}»: ${r.whyNot}`); }
        return [r.name, r.version, r.origin, r.status, el("span", {}, edit, " ", history, ...(editable ? [] : [el("span", { className: "ayuda" }, ` ${r.whyNot}`)]))];
      });
      return dataTable(`${info.plural} (${rows.length})`, ["Nombre", "Versión", "Origen", "Estado", "Acción"], cells);
    }));
  }

  return { element: section, render, showRejection };
}
