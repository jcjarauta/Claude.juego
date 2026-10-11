import { createAnnouncer, type Speaker, type Verbosity } from "./announcer-model.ts";
import { el } from "./dom.ts";
import type { GameEvents } from "./game-events.ts";

// Anunciador accesible (G3b, Q209): dos regiones ocultas visualmente, una asertiva (`role="alert"`) para P0 y otra educada
// (`aria-live="polite"`) para P1. El historial de la consola no es región viva. Las reglas están en announcer-model.ts.

/** Regiones vivas ocultas. Para repetir un texto idéntico se vacía primero la región (si no, el lector no lo repite). */
export function createLiveRegions(parent: HTMLElement): Speaker {
  const alert = el("p", { id: "anuncio-alerta", className: "solo-lectores" });
  alert.setAttribute("role", "alert");
  const polite = el("p", { id: "anuncio-educado", className: "solo-lectores" });
  polite.setAttribute("role", "status");
  polite.setAttribute("aria-live", "polite");
  parent.append(alert, polite);
  const set = (node: HTMLElement, text: string) => { node.textContent = ""; window.setTimeout(() => { node.textContent = text; }, 40); };
  return { alert: (t) => set(alert, t), polite: (t) => set(polite, t) };
}

export interface StartedAnnouncer {
  setVerbosity(v: Verbosity): void;
  stop(): void;
}

/** Conecta el bus de eventos con el anunciador y mueve su reloj. `speaker` permite mirar lo anunciado (guía de estilo). */
export function startAnnouncer(events: GameEvents, speaker: Speaker, verbosity: Verbosity = "normales", tickMs = 250): StartedAnnouncer {
  const model = createAnnouncer({ speaker, verbosity });
  const off = events.subscribe((e) => model.push(e, Date.now()));
  const timer = window.setInterval(() => model.tick(Date.now()), tickMs);
  return { setVerbosity: (v) => model.setVerbosity(v), stop() { off(); window.clearInterval(timer); } };
}
