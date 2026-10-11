import { el } from "./dom.ts";

// Diálogo modal (G3b, Q203): `<dialog>` nativo con `showModal()`: el navegador atrapa el foco dentro, cierra con Escape y
// deja el resto de la página inerte. Al cerrar, el foco VUELVE al control que lo abrió (WCAG 2.4.3).

export interface OpenDialog {
  element: HTMLDialogElement;
  close(): void;
}

let counter = 0;

export function openDialog(options: { title: string; content: Node; closeLabel?: string; onClose?: () => void }): OpenDialog {
  if (!options.title) throw new Error("openDialog(): el título es obligatorio (accesibilidad)");
  const opener = document.activeElement as HTMLElement | null;
  const titleId = `dialogo-titulo-${++counter}`;
  const closeButton = el("button", { type: "button", className: "cerrar-dialogo" }, options.closeLabel ?? "Cerrar");
  const dialog = el("dialog", { className: "dialogo" }, el("h2", { id: titleId }, options.title), options.content, el("p", {}, closeButton));
  dialog.setAttribute("aria-labelledby", titleId);
  closeButton.onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    dialog.remove();
    opener?.focus();
    options.onClose?.();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { element: dialog, close: () => dialog.close() };
}

/** ¿Hay algún diálogo modal abierto? (la regla de actividad de las pestañas y los atajos de juego lo consultan) */
export const dialogOpen = () => document.querySelector("dialog[open]") !== null;
