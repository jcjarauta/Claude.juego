import {
  MESSAGE, type ArchiveDefMessage, type BuildLimits, type CascadePlanMessage, type CascadePreviewMessage, type DefinitionHistoryMessage, type DefSavedMessage, type HistoryMessage, type RejectedMessage, type RetireStructureMessage, type WorldConfig, type WorldState,
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
  type: "edit" | "restore" | "retire" | "restore-structure" | "cascade";
  /** Mensaje que se envía al servidor. */
  send: string;
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
    room.send(op.send, message);
  }

  const list = (title: string, items: string[]) => items.length ? el("div", {}, el("h3", {}, title), el("ul", {}, ...items.map((t) => el("li", {}, t)))) : el("span");

  /** El análisis previo: lo que cambia y lo que se conserva, con el botón para confirmar. */
  function showAnalysis(op: Operation, analysis: Analysis) {
    const retire = op.type === "retire";
    const confirm = el("button", { type: "button" }, retire ? "Confirmar la retirada" : op.type === "edit" ? "Confirmar el cambio" : "Confirmar y volver a esa versión");
    confirm.onclick = () => submit(analysis.basis);
    op.feedback.replaceChildren(
      el("div", { role: "status" },
        el("p", {}, el("strong", {}, "Revisa esto antes de confirmar.")),
        list(retire ? "Lo que cambia ahora (estado operativo)" : "Lo que cambia", analysis.avisos),
        list(retire ? "Lo que se conserva (resultados históricos)" : "Lo que se conserva", analysis.efectos)));
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
      op.feedback.replaceChildren(el("div", { role: "alert" }, el("p", {}, el("strong", {}, "Otra persona ha cambiado esto mientras lo mirabas.")), ...details.map((d) => el("p", {}, d)),
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
        type: "edit", send: MESSAGE.editDef, kind: row.kind, id: row.id, name: row.name, afterName: nameInVersion(read.def), dialog, feedback, buttons,
        body: { kind: row.kind, id: row.id, def: read.def, expectedRev: row.rev, ...(note.value.trim() ? { note: note.value.trim() } : {}) },
        reopen: () => { const fresh = libraryRows(room.state, row.kind).find((r) => r.id === row.id); if (fresh) openEdit(fresh); },
      };
      submit();
    };
    form.focus();
  }

  // ---------------------------------------------------------------------------------- retirar y restaurar edificios
  function openStructureDialog(row: LibraryRow, retire: boolean) {
    const feedback = el("div", { className: "analisis" });
    const send = el("button", { type: "button" }, retire ? "Revisar el impacto" : "Restaurar el edificio");
    const buttons = el("p", {}, send);
    const content = el("div", {},
      el("p", {}, retire
        ? `Retirar «${row.name}» lo quita del mapa y deja sin edificio las recetas que lo usan. No se borra ningún recurso, aporte, misión cumplida ni logro: se conserva todo lo ocurrido y podrás restaurarlo. Antes se explica el impacto.`
        : `Restaurar «${row.name}» lo devuelve al mapa si su solar sigue libre y su proyecto no está cerrado. Si no se puede, se explica el motivo.`),
      feedback, buttons);
    const dialog = openDialog({ title: `${retire ? "Retirar" : "Restaurar"} edificio «${row.name}»`, content, closeLabel: "Cancelar", onClose: () => { if (operation?.dialog === dialog) operation = undefined; } });
    send.onclick = () => {
      const body: Omit<RetireStructureMessage, "requestId" | "basis"> = { structureId: row.id, expectedRev: row.rev };
      operation = {
        type: retire ? "retire" : "restore-structure", send: retire ? MESSAGE.retireStructure : MESSAGE.restoreStructure, kind: row.kind, id: row.id, name: row.name, afterName: row.name, dialog, feedback, buttons,
        body: { ...body },
        reopen: () => { const fresh = libraryRows(room.state, "construccion").find((r) => r.id === row.id); if (fresh) openStructureDialog(fresh, retire); },
      };
      submit();
    };
    send.focus();
  }

  // ---------------------------------------------------------------------------------- archivar en cascada
  let pendingPlan: { kind: LibraryKind; id: string; name: string } | undefined;

  function requestPlan(row: LibraryRow) {
    pendingPlan = { kind: row.kind, id: row.id, name: row.name };
    const message: CascadePreviewMessage = { kind: row.kind as CascadePreviewMessage["kind"], id: row.id };
    room.send(MESSAGE.cascadePreview, message);
  }

  /** Pinta el plan (orden, bloqueos con su camino) y el botón «Archivar todo»; sirve para la vista previa y para un plan que cambió. */
  function renderPlan(op: Operation, plan: CascadePlanMessage, notice?: string) {
    const kindName = (k: string) => LIBRARY_KINDS.find((x) => x.kind === k)?.singular ?? k;
    const steps = plan.order.map((n) => `Archivar ${kindName(n.kind)} «${n.name}»`);
    op.feedback.replaceChildren(el("div", {},
      ...(notice ? [el("p", { role: "alert" }, el("strong", {}, notice))] : []),
      el("p", {}, plan.order.length === 1 ? "Solo se archiva este elemento: nada depende de él." : `Para archivar «${op.name}» hay que archivar antes lo que depende de él. Se hace todo de una vez, en este orden:`),
      el("ol", {}, ...steps.map((t) => el("li", {}, t))),
      ...(plan.blockers.length ? [el("div", { role: "alert" }, el("h3", {}, "Lo que lo impide"),
        el("ul", {}, ...plan.blockers.map((b) => el("li", {}, `${b.reason}. `, el("span", { className: "ayuda" }, `Camino: ${b.path.join(" → ")}.`)))),
        el("p", {}, "No se puede archivar todo mientras haya bloqueos. Resuélvelos (por ejemplo, gasta las existencias) o archiva lo que no dependa de ellos."))] : [])));
    const all = el("button", { type: "button" }, `Archivar todo (${plan.order.length})`);
    if (!plan.executable) { all.setAttribute("aria-disabled", "true"); all.onclick = () => announce("No se puede archivar todo: hay bloqueos. Lee lo que lo impide."); }
    else all.onclick = () => {
      op.body = { ...op.body, cascade: { planHash: plan.planHash } } as Record<string, unknown>;
      submit();
    };
    op.buttons.replaceChildren(all);
  }

  room.onMessage(MESSAGE.cascadePlan, (plan: CascadePlanMessage) => {
    const live = operation;
    // Un plan nuevo para la operación abierta (el anterior cambió): se repinta con el aviso.
    if (live?.type === "cascade" && live.id === plan.id) {
      renderPlan(live, plan, "El plan ha cambiado desde que lo previsualizaste: este es el plan actual. No se ha archivado nada.");
      announce("El plan de archivado ha cambiado: revisa el plan actual.");
      return;
    }
    if (!pendingPlan || pendingPlan.id !== plan.id) return;
    const { kind, id, name } = pendingPlan;
    pendingPlan = undefined;
    const row = libraryRows(room.state, kind).find((r) => r.id === id);
    const feedback = el("div", { className: "analisis" });
    const buttons = el("p", {});
    const dialog = openDialog({ title: `Archivar «${name}» con lo que depende de ello`, content: el("div", {}, feedback, buttons), closeLabel: "Cancelar", onClose: () => { if (operation?.dialog === dialog) operation = undefined; } });
    const op: Operation = {
      type: "cascade", send: MESSAGE.archiveDef, kind, id, name, afterName: name, dialog, feedback, buttons,
      body: { kind, id, expectedRev: row?.rev ?? 1 } as Omit<ArchiveDefMessage, "requestId" | "cascade"> as Record<string, unknown>,
      reopen: () => { if (row) requestPlan(row); },
    };
    operation = op;
    renderPlan(op, plan);
    (buttons.querySelector("button") as HTMLElement | null)?.focus();
    announce(`Plan de archivado de «${name}»: ${plan.order.length} ${plan.order.length === 1 ? "elemento" : "elementos"}${plan.executable ? "" : ", con bloqueos"}.`);
  });

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
        type: "restore", send: MESSAGE.restoreVersion, kind, id: history.id, name, afterName: nameInVersion(history.versions.find((v) => v.version === toVersion)?.definition), dialog, feedback, buttons,
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
    announce(op.type === "retire" ? `«${op.name}» retirado: ya no está en el mapa; su historia se conserva.`
      : op.type === "restore-structure" ? `«${op.name}» restaurado: vuelve al mapa.`
      : op.type === "cascade" ? `Archivado «${op.name}» con lo que dependía de ello.`
      : `«${name}» ${op.type === "edit" ? "actualizado" : "vuelve a una versión anterior"}: ahora es v${saved.version}.`);
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
      const archive = (r: LibraryRow) => {
        const b = Object.assign(el("button", { type: "button" }, "Archivar con lo que depende"), { onclick: () => requestPlan(r) });
        b.setAttribute("aria-label", `Archivar ${info.singular} «${r.name}» con lo que depende de ello`);
        return b;
      };
      const cells = rows.map((r) => {
        if (!r.hasHistory) return [r.name, r.version, r.origin, r.status, el("span", {}, "Solo lectura: viene de la configuración", ...(r.archivable ? [" ", archive(r)] : []))];
        const history = Object.assign(el("button", { type: "button" }, "Historial"), { onclick: () => requestHistory(r.kind, r.id, r.name) });
        history.setAttribute("aria-label", `Historial de ${info.singular} «${r.name}»`);
        const editable = r.editable;
        const edit = Object.assign(el("button", { type: "button" }, "Editar"), { onclick: () => openEdit(r) });
        edit.setAttribute("aria-label", `Editar ${info.singular} «${r.name}»`);
        if (!editable) { edit.setAttribute("aria-disabled", "true"); edit.title = r.whyNot; edit.onclick = () => announce(`No se puede editar «${r.name}»: ${r.whyNot}`); }
        const retire = Object.assign(el("button", { type: "button" }, "Retirar"), { onclick: () => openStructureDialog(r, true) });
        retire.setAttribute("aria-label", `Retirar edificio «${r.name}»`);
        const restore = Object.assign(el("button", { type: "button" }, "Restaurar"), { onclick: () => openStructureDialog(r, false) });
        restore.setAttribute("aria-label", `Restaurar edificio «${r.name}»`);
        const extra: (Node | string)[] = [];
        if (r.retirable) extra.push(" ", retire);
        if (r.restorable) extra.push(" ", restore);
        if (r.archivable) extra.push(" ", archive(r));
        return [r.name, r.version, r.origin, r.status, el("span", {}, edit, " ", history, ...extra, ...(editable ? [] : [el("span", { className: "ayuda" }, ` ${r.whyNot}`)]))];
      });
      return dataTable(`${info.plural} (${rows.length})`, ["Nombre", "Versión", "Origen", "Estado", "Acción"], cells);
    }));
  }

  return { element: section, render, showRejection };
}
