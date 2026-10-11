import {
  HARD_BUILD_LIMITS, LIMIT_KEYS, LIMIT_LABELS, MESSAGE, similarNames,
  type ArchiveDefMessage, type BuildLimits, type DefinitionKind, type UpdateLimitsMessage, type WorldConfig, type WorldState,
} from "@juego/shared";
import type { Room } from "@colyseus/sdk";
import { newRequestId } from "./request-id.ts";
import { dataTable } from "./ui/data-table.ts";
import { openDialog } from "./ui/dialog.ts";
import { el } from "./ui/dom.ts";
import { formFeedback } from "./ui/feedback.ts";
import { field } from "./ui/field.ts";

// Diseño en el panel (G1, Q237–Q241): «Límites de diseño» (valores vigentes editables) y «Archivo de definiciones» (archivar y
// restaurar objetos, recetas, habilidades y misiones, con posibles duplicados). Solo la administración los ve. El servidor valida
// y decide siempre; aquí se ayuda a rellenar y se muestran sus motivos. Nada se borra.

const KIND_LABEL: Record<DefinitionKind, { plural: string; singular: string }> = {
  objeto: { plural: "Objetos", singular: "objeto" },
  receta: { plural: "Recetas", singular: "receta" },
  habilidad: { plural: "Habilidades", singular: "habilidad" },
  mision: { plural: "Misiones", singular: "misión" },
};

interface Entry {
  kind: DefinitionKind;
  id: string;
  name: string;
  origin: string;
  archived: boolean;
}

/** Los límites vigentes: lo que dice el estado y, si aún no ha llegado, los de la configuración. */
export function currentLimits(state: WorldState, config: WorldConfig): BuildLimits {
  const out = { ...config.buildLimits };
  for (const key of LIMIT_KEYS) {
    const v = state.limits.get(key);
    if (typeof v === "number" && v >= 1) out[key] = v;
  }
  return out;
}

export function createDesignSections(config: WorldConfig, room: Room<unknown, WorldState>, announce: (text: string) => void) {
  let pending: "limites" | "archivo" | undefined;

  // ---------------------------------------------------------------- límites de diseño
  const limitsFeedback = formFeedback();
  const inputs = new Map<keyof BuildLimits, HTMLInputElement>();
  const helps = new Map<keyof BuildLimits, HTMLElement>();
  const limitFields = LIMIT_KEYS.map((key) => {
    const input = el("input", { type: "number", min: "1", max: String(HARD_BUILD_LIMITS[key]), inputMode: "numeric", value: String(config.buildLimits[key]) });
    inputs.set(key, input);
    const wrapper = field(LIMIT_LABELS[key], input, `Por omisión ${config.buildLimits[key]} · techo ${HARD_BUILD_LIMITS[key]}.`);
    helps.set(key, wrapper.querySelector(".ayuda")!);
    return wrapper;
  });
  const saveLimits = el("button", { type: "submit" }, "Guardar límites");
  const resetLimits = el("button", { type: "button" }, "Restaurar por omisión");
  const limitsForm = el("form", { noValidate: true },
    el("h3", { id: "limites-titulo" }, "Límites de diseño"),
    el("p", { className: "ayuda" }, "Cuántas cosas pueden crearse desde el panel y hasta dónde llegan las recetas y las habilidades. Un cambio vale desde ya para lo que se cree después: no borra ni cambia nada de lo que ya existe. Cada valor va de 1 a su techo."),
    ...limitFields, limitsFeedback.errors,
    el("p", {}, saveLimits, " ", resetLimits), limitsFeedback.confirm);
  limitsForm.setAttribute("aria-labelledby", "limites-titulo");
  let sent: Partial<Record<keyof BuildLimits, number>> | "reset" | undefined;
  limitsForm.onsubmit = (event) => {
    event.preventDefault();
    limitsFeedback.errors.replaceChildren();
    limitsFeedback.confirm.textContent = "";
    const now = currentLimits(room.state, config);
    const changes: Partial<Record<keyof BuildLimits, number>> = {};
    for (const key of LIMIT_KEYS) {
      const raw = inputs.get(key)!.value.trim();
      if (raw === "") { limitsFeedback.errors.append(el("p", {}, `${LIMIT_LABELS[key]}: escribe un número.`)); continue; }
      if (Number(raw) !== now[key]) changes[key] = Number(raw);
    }
    if (limitsFeedback.errors.childElementCount) return;
    if (Object.keys(changes).length === 0) { limitsFeedback.confirm.textContent = "No hay cambios que guardar."; return; }
    sent = changes;
    pending = "limites";
    const message: UpdateLimitsMessage = { requestId: newRequestId(), limits: changes };
    room.send(MESSAGE.updateLimits, message);
  };
  resetLimits.onclick = () => {
    limitsFeedback.errors.replaceChildren();
    limitsFeedback.confirm.textContent = "";
    sent = "reset";
    pending = "limites";
    const message: UpdateLimitsMessage = { requestId: newRequestId(), reset: true };
    room.send(MESSAGE.updateLimits, message);
  };

  // ---------------------------------------------------------------- archivo de definiciones
  const archiveFeedback = formFeedback();
  const showArchived = el("input", { type: "checkbox", id: "archivo-mostrar" });
  const tables = el("div", { id: "archivo-listas" });
  const duplicates = el("div", { id: "archivo-duplicados" });
  const archiveSection = el("section", {},
    el("h3", { id: "archivo-titulo" }, "Archivo de definiciones"),
    el("p", { className: "ayuda" }, "Archivar no borra nada: lo archivado deja de usarse y de verse en el juego pero conserva su historial, y se puede restaurar. No se puede archivar algo que esté en uso (se dice qué lo usa). Al archivar queda libre su nombre."),
    el("p", {}, el("label", { className: "casilla" }, showArchived, " Mostrar archivados")),
    archiveFeedback.errors, archiveFeedback.confirm,
    duplicates, tables);
  archiveSection.setAttribute("aria-labelledby", "archivo-titulo");
  showArchived.onchange = () => { signature = ""; render(); };

  const entries = (state: WorldState): Entry[] => [
    ...[...state.items.entries()].map(([id, e]): Entry => ({ kind: "objeto", id, name: e.name, origin: e.origin, archived: e.archived })),
    ...[...state.recipes.entries()].map(([id, e]): Entry => ({ kind: "receta", id, name: e.name, origin: e.origin, archived: e.archived })),
    ...[...state.skills.entries()].map(([id, e]): Entry => ({ kind: "habilidad", id, name: e.name, origin: e.origin, archived: e.archived })),
    ...[...state.missions.entries()].map(([id, e]): Entry => ({ kind: "mision", id, name: e.name, origin: e.origin, archived: e.archived })),
  ];

  function confirmAction(entry: Entry, archive: boolean) {
    const verb = archive ? "Archivar" : "Restaurar";
    const accept = el("button", { type: "button" }, `${verb} «${entry.name}»`);
    const text = archive
      ? `«${entry.name}» dejará de usarse y de verse en el juego, pero no se borra: conserva su historial y podrás restaurarlo. Su nombre quedará libre.`
      : `«${entry.name}» volverá a usarse y a verse. Solo se puede si su nombre está libre y lo que necesita está activo.`;
    const dialog = openDialog({ title: `${verb} ${KIND_LABEL[entry.kind].singular}`, content: el("div", {}, el("p", {}, text), el("p", {}, accept)), closeLabel: "Cancelar" });
    accept.onclick = () => {
      archiveFeedback.errors.replaceChildren();
      archiveFeedback.confirm.textContent = "";
      pending = "archivo";
      const message: ArchiveDefMessage = { requestId: newRequestId(), kind: entry.kind, id: entry.id };
      room.send(archive ? MESSAGE.archiveDef : MESSAGE.restoreDef, message);
      dialog.close();
    };
  }

  const actionButton = (entry: Entry, label: string, archive: boolean, aria: string) => {
    const b = el("button", { type: "button" }, label);
    b.dataset.foco = `${entry.kind}:${entry.id}:${archive ? "a" : "r"}`;
    b.setAttribute("aria-label", aria);
    b.onclick = () => confirmAction(entry, archive);
    return b;
  };

  let signature = "";
  let known = new Map<string, boolean>();
  function render() {
    const state = room.state;
    // Límites vigentes en los campos y en su ayuda; no se pisa lo que se está escribiendo.
    const now = currentLimits(state, config);
    for (const key of LIMIT_KEYS) {
      const input = inputs.get(key)!;
      helps.get(key)!.textContent = `Vigente ${now[key]} · por omisión ${config.buildLimits[key]} · techo ${HARD_BUILD_LIMITS[key]}.`;
      if (document.activeElement !== input && input.value !== String(now[key]) && !(sent && sent !== "reset" && sent[key] !== undefined && input.value === String(sent[key]))) input.value = String(now[key]);
    }
    if (pending === "limites" && sent) {
      const done = sent === "reset" ? LIMIT_KEYS.every((k) => now[k] === config.buildLimits[k]) : Object.entries(sent).every(([k, v]) => now[k as keyof BuildLimits] === v);
      if (done) {
        const text = sent === "reset" ? "Límites restaurados a los de la configuración." : `Límites guardados: ${Object.entries(sent).map(([k, v]) => `${LIMIT_LABELS[k as keyof BuildLimits].toLowerCase()} = ${v}`).join("; ")}.`;
        limitsFeedback.confirm.textContent = text;
        announce(text);
        pending = undefined;
        sent = undefined;
      }
    }

    // Archivo: confirmación al cambiar la marca y listas.
    const all = entries(state);
    for (const e of all) {
      const key = `${e.kind}:${e.id}`;
      if (known.has(key) && known.get(key) !== e.archived && pending === "archivo") {
        const text = `«${e.name}» ${e.archived ? "archivado" : "restaurado"}.`;
        archiveFeedback.confirm.textContent = text;
        announce(text);
        pending = undefined;
      }
    }
    known = new Map(all.map((e) => [`${e.kind}:${e.id}`, e.archived]));
    const sig = JSON.stringify([showArchived.checked, all.map((e) => [e.kind, e.id, e.name, e.archived])]);
    if (sig === signature) return;
    signature = sig;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.foco;
    const visible = all.filter((e) => showArchived.checked || !e.archived);
    tables.replaceChildren(...(Object.keys(KIND_LABEL) as DefinitionKind[]).map((kind) => {
      const rows = visible.filter((e) => e.kind === kind).sort((a, b) => a.name.localeCompare(b.name, "es"));
      if (!rows.length) return el("p", { className: "ayuda" }, `${KIND_LABEL[kind].plural}: no hay ${showArchived.checked ? "ninguno" : "ninguno activo"}.`);
      return dataTable(`${KIND_LABEL[kind].plural} (${rows.length})`, ["Nombre", "Estado", "Origen", "Acción"], rows.map((e) => [
        e.name, e.archived ? "Archivado" : "Activo", e.origin === "configuracion" ? "Configuración" : "Panel",
        e.archived ? actionButton(e, "Restaurar", false, `Restaurar ${KIND_LABEL[kind].singular} «${e.name}»`) : actionButton(e, "Archivar", true, `Archivar ${KIND_LABEL[kind].singular} «${e.name}»`),
      ]));
    }));
    // Posibles duplicados (solo activos), con un clic para archivar cada uno.
    const groups = (Object.keys(KIND_LABEL) as DefinitionKind[]).flatMap((kind) => similarNames(kind, all.filter((e) => e.kind === kind)));
    const byId = new Map(all.map((e) => [`${e.kind}:${e.id}`, e]));
    duplicates.replaceChildren(...(groups.length
      ? [el("h4", {}, "Posibles duplicados"), el("p", { className: "ayuda" }, "Nombres que se parecen entre elementos activos. Archiva el que sobre."),
        el("ul", {}, ...groups.map((g) => {
          const [a, b] = g.entries.map((x) => byId.get(`${g.kind}:${x.id}`)!) as [Entry, Entry];
          return el("li", {}, `${KIND_LABEL[g.kind].singular[0]!.toUpperCase()}${KIND_LABEL[g.kind].singular.slice(1)}: «${a.name}» y «${b.name}» (${g.reason === "igual" ? "se escriben igual salvo tildes o mayúsculas" : "uno contiene al otro"}). `,
            actionButton(a, `Archivar «${a.name}»`, true, `Archivar ${KIND_LABEL[g.kind].singular} «${a.name}» (posible duplicado de «${b.name}»)`), " ",
            actionButton(b, `Archivar «${b.name}»`, true, `Archivar ${KIND_LABEL[g.kind].singular} «${b.name}» (posible duplicado de «${a.name}»)`));
        }))]
      : [el("p", { className: "ayuda" }, "No hay posibles duplicados entre lo activo.")]));
    if (focused) {
      const again = archiveSection.querySelector<HTMLElement>(`[data-foco="${CSS.escape(focused)}"]`);
      (again ?? showArchived).focus(); // el foco no se pierde cuando el botón desaparece (p. ej. al archivar)
    }
  }

  return {
    elements: [limitsForm, archiveSection],
    render,
    /** Motivo de rechazo del servidor junto a la sección que lo provocó. */
    showRejection(text: string, details: string[] = []): boolean {
      if (!pending) return false;
      const target = pending === "limites" ? limitsFeedback.errors : archiveFeedback.errors;
      target.replaceChildren(el("p", {}, text), ...(details.length ? [el("ul", {}, ...details.map((d) => el("li", {}, d)))] : []));
      pending = undefined;
      sent = undefined;
      return true;
    },
  };
}

