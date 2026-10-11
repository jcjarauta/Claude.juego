import { nearby, STATUS_HELP, tipsFor, type Snapshot, type Step, type StepStatus } from "@juego/shared";
import { el } from "./ui/dom.ts";

// Pestaña «Guía» (G3c, P3): explica el siguiente paso, los bloqueos y las alternativas, lista «Qué hay cerca» (alternativa textual
// del mapa, con el destino del objetivo siempre arriba) y da consejos por situación. Solo texto: sin conversación ni bots (F2d/F2e).
// Nada de esto es región viva: la información cambia sin interrumpir; se lee al visitar la pestaña.

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta #${id} en la página`);
  return node as T;
};

const STATUS_TEXT: Record<StepStatus, string> = {
  DISPONIBLE: "● Disponible", BLOQUEADO: "■ Bloqueado", NO_VERIFICADO: "◆ Sin verificar", COMPLETADO: "✔ Completado",
};

export interface GuideInput {
  snapshot: Snapshot;
  /** Nombre del objetivo activo, o undefined si no hay. */
  label: string | undefined;
  step: Step | undefined;
  target: { x: number; y: number; label: string } | undefined;
}

export function createGuidePanel() {
  const panel = byId("panel-guia");
  const objective = byId("guia-objetivo");
  const status = byId("guia-estado");
  const text = byId("guia-paso");
  const why = byId("guia-porque");
  const missing = byId("guia-bloqueos");
  const alternatives = byId("guia-alternativas");
  const destination = byId("guia-destino");
  const close = byId("guia-cerca");
  const tips = byId("guia-consejos");
  const legend = byId("guia-estados");
  legend.replaceChildren(...STATUS_HELP.map((t) => el("li", {}, t)));
  const last = new Map<string, string>();
  const replaceIfChanged = (key: string, node: HTMLElement, children: Node[]) => {
    const signature = children.map((c) => c.textContent).join("\u0001");
    if (last.get(key) === signature) return;
    last.set(key, signature);
    node.replaceChildren(...children);
  };
  let pending: GuideInput | undefined;

  function render(input: GuideInput) {
    const { snapshot, step, target, label } = input;
    objective.textContent = label ? `Objetivo: ${label}` : "Sin objetivo activo. Elígelo en la zona «Objetivo actual».";
    status.textContent = step ? STATUS_TEXT[step.status] : "";
    text.textContent = step ? ` ${step.text}` : "";
    why.textContent = step?.why ?? "";
    why.hidden = !step?.why;
    replaceIfChanged("falta", missing, (step?.requirements ?? []).map((r) => el("li", {}, el("strong", {}, "Falta: "), `${r.text} `, el("span", { className: "ayuda" }, `Cómo resolverlo: ${r.how}`))));
    byId("guia-bloqueos-vacio").hidden = !(step && step.requirements.length === 0);
    replaceIfChanged("alternativas", alternatives, (step?.alternatives ?? []).map((a) => el("li", {}, a)));
    byId("guia-alternativas-vacio").hidden = Boolean(step?.alternatives.length);

    const around = nearby(snapshot, target);
    destination.textContent = around.destination ? `Destino del objetivo: ${around.destination.text}` : "Sin destino en el mapa para este paso.";
    replaceIfChanged("cerca", close, around.entries.map((e) => el("li", {}, el("strong", {}, e.label), `: ${e.direction}${e.distance > 0 ? ` (${e.distance} ${e.distance === 1 ? "casilla" : "casillas"})` : ""}.`)));
    byId("guia-cerca-vacio").hidden = around.entries.length > 0;

    replaceIfChanged("consejos", tips, tipsFor(step, snapshot).map((t) => el("li", {}, t)));
  }

  document.addEventListener("pestana-guia", () => { if (pending && !panel.hidden) render(pending); });

  return {
    /** Se llama desde la zona C con cada recálculo; si la pestaña no se ve, solo se guarda y se pinta al abrirla. */
    update(input: GuideInput) {
      pending = input;
      if (!panel.hidden) render(input);
    },
    /** Al mostrar la pestaña (la llama el selector de pestañas). */
    refresh() { if (pending && !panel.hidden) render(pending); },
  };
}
