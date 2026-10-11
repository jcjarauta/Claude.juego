import { el } from "./dom.ts";

// Retroalimentación de los formularios y avisos (G3a, Q201, Q203).
// - El error se muestra junto al formulario con `role="alert"`; la confirmación, también junto a él, con `role="status"`
//   (no solo en la cabecera de la página, donde puede quedar fuera de la vista).
// - La región viva educada (`aria-live="polite"`) es el sitio de los avisos que no son errores.

export interface FormFeedback {
  /** Elementos a colocar en el formulario: primero el error, después de su botón la confirmación. */
  errors: HTMLElement;
  confirm: HTMLElement;
  clear(): void;
  showError(text: string, details?: string[]): void;
  showConfirm(text: string): void;
}

export function formFeedback(): FormFeedback {
  const errors = el("div", { className: "error", role: "alert" });
  const confirm = el("p", { className: "confirmacion", role: "status" });
  return {
    errors, confirm,
    clear() { errors.replaceChildren(); confirm.textContent = ""; },
    showError(text, details = []) {
      errors.replaceChildren(el("p", {}, text), ...(details.length ? [el("ul", {}, ...details.map((d) => el("li", {}, d)))] : []));
    },
    showConfirm(text) { confirm.textContent = text; },
  };
}

/** Región viva educada: anuncia un texto sin quitar el foco. Devuelve el elemento y la función para anunciar. */
export function liveRegion(className = "aviso") {
  const node = el("p", { className, role: "status" });
  node.setAttribute("aria-live", "polite");
  return { element: node, say: (text: string) => { node.textContent = text; } };
}
