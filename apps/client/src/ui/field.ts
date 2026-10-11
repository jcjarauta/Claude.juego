import { el } from "./dom.ts";

// Campo con etiqueta (G3a, Q203). Patrón: etiqueta visible asociada con `for`/`id`; la ayuda se enlaza con
// `aria-describedby`. Nunca se sustituye la etiqueta por un `placeholder` (WCAG 3.3.2).

export type FieldControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

let fieldCount = 0;

/**
 * Envuelve un control con su etiqueta y, si se da, su ayuda.
 * `label` es obligatorio. Solo en las filas de una lista dinámica se admite dejarlo vacío (`deferredLabel`)
 * porque la lista lo rellena al numerar las filas; un campo sin etiqueta tras construirse es un error de uso.
 */
export function field<T extends FieldControl>(label: string, control: T, help?: string, options: { deferredLabel?: boolean } = {}) {
  if (!label && !options.deferredLabel) throw new Error("field(): la etiqueta es obligatoria (accesibilidad)");
  control.id ||= `campo-${++fieldCount}`;
  const wrapper = el("div", { className: "campo" }, el("label", { htmlFor: control.id }, label), control);
  if (help) {
    const p = el("p", { id: `${control.id}-ayuda`, className: "ayuda" }, help);
    control.setAttribute("aria-describedby", p.id);
    wrapper.append(p);
  }
  return wrapper;
}
