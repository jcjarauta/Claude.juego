import { el } from "./dom.ts";

// Insignia numérica (G3b, Q203, Q210): cuenta de novedades sobre una pestaña o botón. El número visible no es lo único que
// llega a quien usa lector de pantalla: lleva un texto oculto («2 novedades»). Nunca mueve el foco.

export interface Badge {
  element: HTMLElement;
  update(count: number): void;
}

export function createBadge(singular = "novedad", plural = "novedades"): Badge {
  const visible = el("span", { className: "insignia-numero" });
  visible.setAttribute("aria-hidden", "true");
  const hidden = el("span", { className: "solo-lectores" });
  const element = el("span", { className: "insignia", hidden: true }, visible, hidden);
  return {
    element,
    update(count) {
      element.hidden = count <= 0;
      visible.textContent = String(count);
      hidden.textContent = ` ${count} ${count === 1 ? singular : plural}`;
    },
  };
}
