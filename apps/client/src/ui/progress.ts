import { el } from "./dom.ts";

// Tarjeta de progreso (G3a, Q203): barra nativa `<progress>` con su etiqueta y el avance también en texto, de modo que
// el progreso no dependa solo del color ni de la barra.

export interface ProgressCard {
  element: HTMLElement;
  update(value: number, max: number, detail?: string): void;
}

export function progressCard(label: string, id: string): ProgressCard {
  if (!label) throw new Error("progressCard(): la etiqueta es obligatoria (accesibilidad)");
  const bar = el("progress", { id, max: 1, value: 0 });
  const text = el("span", { className: "ayuda" });
  const caption = el("label", { htmlFor: id }, label);
  return {
    element: el("div", { className: "progreso-tarjeta" }, caption, bar, text),
    update(value, max, detail = "") {
      bar.max = Math.max(1, max);
      bar.value = Math.min(value, bar.max);
      text.textContent = `${Math.min(value, max)} de ${max}${detail ? ` — ${detail}` : ""}`;
    },
  };
}
