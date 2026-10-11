import {
  createStabilizer, directionText, evaluateObjective, objectiveLabel, rejectionStillExplained, stepAfterRejection, suggestObjectives,
  type Objective, type RejectReason, type Snapshot, type Step, type StepAction, type StepStatus,
} from "@juego/shared";
import type { Feed } from "./feed.ts";
import { loadObjective, objectiveKey, saveObjective } from "./objective-store.ts";
import { dialogOpen, openDialog } from "./ui/dialog.ts";
import { el } from "./ui/dom.ts";
import { field } from "./ui/field.ts";
import { progressCard } from "./ui/progress.ts";

// Zona C: objetivo actual (G3c, P1). Muestra el OBJETIVO ACTIVO que eligió la persona, la SIGUIENTE ACCIÓN con su estado y los
// requisitos que faltan. No cambia de objetivo por sí sola, no mueve el foco y anuncia una vez por cambio de identidad.

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta #${id} en la página`);
  return node as T;
};

const STATUS_TEXT: Record<StepStatus, string> = {
  DISPONIBLE: "● Disponible",
  BLOQUEADO: "■ Bloqueado",
  NO_VERIFICADO: "◆ Sin verificar",
  COMPLETADO: "✔ Completado",
};

const ACTION_LABEL: Partial<Record<StepAction["type"], string>> = {
  contribute: "Aportar", deposit: "Depositar", craft: "Fabricar", build: "Construir", collect: "Recoger",
};

const MOVE_CODES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]);
const MOVING_MS = 600;
const REJECTION_WINDOW_MS = 15_000;

export interface ObjectiveHost {
  feed: Feed;
  /** Instantánea del estado; undefined mientras el personaje aún no está en la sala. */
  snapshot(): Snapshot | undefined;
  world: string;
  /** Envía la acción del paso al servidor (el servidor decide). */
  perform(action: StepAction): void;
  /** Marcador del mapa para el destino del paso mostrado (undefined = sin marcador). */
  setTarget(target: { x: number; y: number; label: string } | undefined): void;
  /** Lleva la cámara al destino (solo cuando la persona lo pide) y la devuelve a su personaje. */
  showTarget(): void;
  releaseCamera(): void;
  cameraDetached(): boolean;
}

export function createObjectivePanel(host: ObjectiveHost) {
  const root = byId("objetivo");
  const name = byId("objetivo-nombre");
  const state = byId("objetivo-estado");
  const text = byId("objetivo-texto");
  const why = byId("objetivo-porque");
  const requirements = byId("objetivo-requisitos");
  const alternatives = byId("objetivo-alternativas");
  const routes = byId("objetivo-rutas");
  const notices = byId("objetivo-avisos");
  const doButton = byId<HTMLButtonElement>("objetivo-accion");
  const chooseButton = byId<HTMLButtonElement>("objetivo-elegir");
  const noticesButton = byId<HTMLButtonElement>("objetivo-avisos-ir");
  const destination = byId("objetivo-destino");
  const showButton = byId<HTMLButtonElement>("objetivo-mostrar");
  const backButton = byId<HTMLButtonElement>("objetivo-volver");
  const bar = progressCard("Progreso del paso", "objetivo-barra");
  byId("objetivo-progreso").append(bar.element);

  let account: string | undefined;
  let objective: Objective | undefined;
  let loaded = false;
  let stabilizer = createStabilizer();
  let shownStep: Step | undefined;
  let lastRender = "";
  let lastRoutes = "";
  let lastTarget = "";
  let rejection: { reason: RejectReason; text: string; before: Step; at: number } | undefined;
  let lastMoveAt = -Infinity;
  let timer: number | undefined;
  let lastCandidates: ReturnType<typeof suggestObjectives> = [];

  window.addEventListener("keydown", (e) => { if (MOVE_CODES.has(e.code)) lastMoveAt = Date.now(); }, true);
  const busy = () => Date.now() - lastMoveAt < MOVING_MS || dialogOpen() || root.contains(document.activeElement);

  const storageKey = () => objectiveKey(host.world, account ?? "");
  const setObjective = (next: Objective | undefined) => {
    objective = next;
    saveObjective(storageKey(), next);
    stabilizer = createStabilizer();
    shownStep = undefined;
    rejection = undefined;
    lastRender = "";
    update(true);
  };

  function render(snap: Snapshot, step: Step | undefined) {
    const parts: string[] = [];
    if (!objective) {
      lastCandidates = suggestObjectives(snap);
      const first = lastCandidates[0];
      name.textContent = "Sin objetivo activo.";
      state.textContent = "";
      text.textContent = first ? `Sugerencia: ${first.label}. No se adopta sola: elige el tuyo.` : "No hay nada que sugerir ahora.";
      why.textContent = "";
      bar.element.hidden = true;
      requirements.replaceChildren();
      alternatives.replaceChildren();
      routes.replaceChildren();
      doButton.hidden = true;
      parts.push("sin");
    } else if (step) {
      name.textContent = `Objetivo: ${objectiveLabel(objective, snap)}`;
      state.textContent = STATUS_TEXT[step.status];
      text.textContent = step.status === "COMPLETADO" ? `${step.text} Objetivo completado: elige el siguiente.` : step.obsolete ? `${step.text} Este objetivo ya no existe: elige otro.` : step.text;
      why.textContent = step.why;
      why.hidden = !step.why;
      if (step.progress) { bar.element.hidden = false; bar.update(step.progress.done, step.progress.total); } else bar.element.hidden = true;
      const reqKey = JSON.stringify([step.requirements, step.alternatives]);
      if (reqKey !== lastRender) {
        lastRender = reqKey;
        requirements.replaceChildren(...step.requirements.map((r) => el("li", {}, el("strong", {}, "Falta: "), `${r.text} `, el("span", { className: "ayuda" }, r.how))));
        alternatives.replaceChildren(...step.alternatives.map((a) => el("li", {}, a)));
      }
      const label = step.action ? ACTION_LABEL[step.action.type] : undefined;
      doButton.hidden = !(label && step.status === "DISPONIBLE");
      if (label) doButton.textContent = label;
      const routeKey = JSON.stringify(step.routes?.map((r) => [r.id, r.viable]) ?? []);
      if (step.type === "choose-route" && step.routes && routeKey !== lastRoutes) {
        lastRoutes = routeKey;
        routes.replaceChildren(...step.routes.filter((r) => r.viable).map((r) => {
          const b = el("button", { type: "button" }, "Elegir esta ruta");
          b.onclick = () => { if (objective) setObjective({ ...objective, route: r.id }); };
          return el("li", {}, `${r.text} `, b);
        }));
      } else if (step.type !== "choose-route") { lastRoutes = ""; routes.replaceChildren(); }
      parts.push(step.key);
    }
    // Destino: marcador en el mapa y su alternativa textual (dirección y distancia), aunque esté lejos.
    const target = step?.target;
    const targetKey = target ? `${target.x},${target.y},${target.label}` : "";
    if (targetKey !== lastTarget) { lastTarget = targetKey; host.setTarget(target); }
    destination.textContent = target ? (target.x === snap.me.x && target.y === snap.me.y ? `Destino: ${target.label}. Estás en el destino.` : `Destino: ${target.label}, a ${directionText(snap.me, target)}.`) : "";
    showButton.hidden = !target;
    backButton.hidden = !host.cameraDetached();
    const pending = host.feed.center.pending().length;
    notices.textContent = pending ? `${pending} ${pending === 1 ? "aviso pendiente" : "avisos pendientes"} en la consola; no cambian tu objetivo.` : "";
    noticesButton.hidden = pending === 0;
  }

  function update(force = false) {
    const snap = host.snapshot();
    if (!snap) return;
    if (!loaded || account !== snap.me.name) {
      account = snap.me.name;
      loaded = true;
      objective = loadObjective(storageKey());
      stabilizer = createStabilizer();
      shownStep = undefined;
    }
    if (!objective) { render(snap, undefined); return; }
    let fresh = evaluateObjective(objective, snap);
    // Tras un rechazo del servidor: se espera a que el estado se sincronice y se clasifica (bloqueo, estado desactualizado, permisos, técnico).
    if (rejection) {
      const age = Date.now() - rejection.at;
      if (age > REJECTION_WINDOW_MS || (fresh.key !== rejection.before.key)) rejection = undefined;
      else if (age >= 300 || force) fresh = stepAfterRejection(fresh, rejection.reason, rejection.text, rejectionStillExplained(rejection.before, fresh));
    }
    const result = stabilizer.feed({ step: fresh, now: Date.now(), busy: busy() });
    shownStep = result.shown;
    render(snap, shownStep);
    if (result.announce) {
      const s = result.shown;
      const extra = s.status === "BLOQUEADO" && s.requirements[0] ? ` Bloqueado: ${s.requirements[0].text}` : "";
      host.feed.emit({ kind: "aviso", importance: "normal", own: true, priority: 1, text: `${STATUS_TEXT[s.status].slice(2)}: ${s.text}${extra}` });
    }
  }

  doButton.onclick = () => { if (shownStep?.action) host.perform(shownStep.action); };
  showButton.onclick = () => {
    host.showTarget();
    const snap = host.snapshot();
    const t = shownStep?.target;
    if (snap && t) host.feed.emit({ kind: "aviso", importance: "normal", own: true, priority: 1, text: `Mostrando ${t.label} en el mapa: ${directionText(snap.me, t)}. Pulsa Escape o «Volver a mi personaje» para regresar.` });
    update(true);
  };
  backButton.onclick = () => { host.releaseCamera(); update(true); byId("objetivo-mostrar").focus(); };
  noticesButton.onclick = () => document.dispatchEvent(new CustomEvent("enfocar-consola"));
  chooseButton.onclick = () => {
    const snap = host.snapshot();
    if (!snap || dialogOpen()) return;
    const candidates = suggestObjectives(snap);
    const select = el("select");
    select.append(el("option", { value: "", textContent: "Sin objetivo" }));
    candidates.forEach((c, i) => select.append(el("option", { value: String(i), textContent: c.label })));
    const current = objective ? JSON.stringify({ ...objective, route: undefined }) : "";
    const index = candidates.findIndex((c) => JSON.stringify(c.objective) === current);
    select.value = index >= 0 ? String(index) : "";
    const accept = el("button", { type: "button" }, "Fijar este objetivo");
    const dialog = openDialog({
      title: "Elegir objetivo",
      content: el("form", { noValidate: true, onsubmit: (e: Event) => e.preventDefault() },
        field("Objetivo activo", select, "El objetivo no cambia solo: ni por ofertas, ni por misiones nuevas, ni al completar uno. Se guarda en este navegador."),
        el("p", {}, accept)),
    });
    accept.onclick = () => {
      const picked = select.value === "" ? undefined : candidates[Number(select.value)]?.objective;
      dialog.close();
      setObjective(picked);
    };
  };

  const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => update(), 250); };
  window.setInterval(() => update(), 500);

  return {
    /** Pide recalcular (agrupa cambios de estado seguidos). */
    schedule,
    /** Un rechazo del servidor a una acción propia: se clasificará cuando llegue el siguiente estado. */
    noteRejection(reason: RejectReason, serverText: string) {
      if (!shownStep || reason === "movimiento-demasiado-rapido" || reason === "movimiento-invalido" || reason === "casilla-bloqueada" || reason === "fuera-del-mapa") return;
      rejection = { reason, text: serverText, before: shownStep, at: Date.now() };
      schedule();
    },
    focus() { byId("objetivo-nombre").focus(); },
  };
}
