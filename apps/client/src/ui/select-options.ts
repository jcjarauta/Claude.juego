import { el } from "./dom.ts";

// Opciones de un selector nativo (G3a, Q203): se rehacen solo si cambian y se conserva la elección, para no perder
// el foco ni la selección de quien está usando el selector.

export type Option = [value: string, label: string];
export interface OptionGroup {
  label: string;
  entries: Option[];
}

/** Opciones simples. `placeholder` añade una primera opción vacía («Elige…»). */
export function syncOptions(select: HTMLSelectElement, entries: Option[], placeholder?: string) {
  const signature = `${placeholder ?? ""}#${entries.map(([id, label]) => `${id}|${label}`).join(";")}`;
  if (select.dataset.options === signature) return;
  const selected = select.value;
  select.replaceChildren(...(placeholder === undefined ? [] : [el("option", { value: "", textContent: placeholder })]),
    ...entries.map(([id, label]) => el("option", { value: id, textContent: label })));
  if (entries.some(([id]) => id === selected)) select.value = selected;
  select.dataset.options = signature;
}

/** Opciones agrupadas con `<optgroup>` (p. ej. «Recursos» y «Objetos»); los grupos vacíos no se muestran. */
export function syncGroupedOptions(select: HTMLSelectElement, groups: OptionGroup[], placeholder: string) {
  const shown = groups.filter((g) => g.entries.length);
  const signature = `${placeholder}#${shown.map((g) => `${g.label}:${g.entries.map(([id, label]) => `${id}|${label}`).join(",")}`).join(";")}`;
  if (select.dataset.options === signature) return;
  const selected = select.value;
  select.replaceChildren(el("option", { value: "", textContent: placeholder }), ...shown.map((g) => {
    const node = el("optgroup", { label: g.label });
    node.append(...g.entries.map(([id, text]) => el("option", { value: id, textContent: text })));
    return node;
  }));
  if (shown.some((g) => g.entries.some(([id]) => id === selected))) select.value = selected;
  select.dataset.options = signature;
}
