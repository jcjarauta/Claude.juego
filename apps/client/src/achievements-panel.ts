import {
  achievedIds, CATALOG, communityReference, creditText, evaluateAchievements, summarize,
  type AchievementSnapshot, type AchievementState, type SkillBadgeInfo,
} from "@juego/shared";
import {
  achievementKey, addLocalRecognition, applyAchieved, badgeCount, emptyStore, loadStore, markConsulted, markStartingConsulted, newOnes, saveStore, startingOnes,
  type AchievementStore, type ParsedStore,
} from "./achievement-store.ts";
import { cardText, nextCard, planCelebration, type CardState } from "./achievement-celebration.ts";
import type { Feed } from "./feed.ts";
import { createBadge } from "./ui/badge.ts";
import { el } from "./ui/dom.ts";
import { loadPreferences } from "./ui/preferences.ts";
import type { Celebrations } from "./ui/preferences-model.ts";
import { progressCard } from "./ui/progress.ts";

// Pestaña «Logros» (G3d, P1). Los logros VERIFICABLES salen del estado sincronizado (iguales en cualquier navegador); lo que solo
// consta en este navegador va aparte como «registro de este navegador». Sin clasificaciones ni plazos; no es región viva; nunca
// cambia de pestaña por su cuenta.

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta #${id} en la página`);
  return node as T;
};

/** Verbo de la acción final en los reconocimientos de cada logro («Construido por…», «Completada por…»). */
const executedVerb = (id: string) => (id.startsWith("primera-mision") || id.startsWith("misiones-iniciales") ? "Completada" : "Construido");

const STATUS_TEXT = { conseguido: "✔ Conseguido", "en-progreso": "◐ En progreso", pendiente: "○ Pendiente" } as const;

export interface AchievementsHost {
  feed: Feed;
  /** Un destello corto sobre el personaje (el mapa lo omite con «menos movimiento»). */
  flash(): void;
  world: string;
  snapshot(): AchievementSnapshot | undefined;
  skillBadges(): SkillBadgeInfo[];
}

export function createAchievementsPanel(host: AchievementsHost) {
  const panel = byId("panel-logros");
  const summary = byId("logros-resumen");
  const newList = byId("logros-nuevos");
  const newEmpty = byId("logros-nuevos-vacio");
  const markNew = byId<HTMLButtonElement>("logros-marcar-nuevos");
  const startList = byId("logros-preexistentes");
  const startEmpty = byId("logros-preexistentes-vacio");
  const markStart = byId<HTMLButtonElement>("logros-marcar-preexistentes");
  const refText = byId("logros-referencia");
  const refNote = byId("logros-referencia-nota");
  const refGo = byId<HTMLButtonElement>("logros-ir-objetivo");
  const badgesList = byId("logros-insignias");
  const lists = { comunidad: byId("logros-comunidad"), personal: byId("logros-personal"), cooperacion: byId("logros-cooperacion") };
  const recordList = byId("logros-registro");
  const recordEmpty = byId("logros-registro-vacio");
  const localBook = byId("logros-libro");
  const refBar = progressCard("Progreso de la referencia", "logros-referencia-barra");
  byId("logros-referencia-progreso").append(refBar.element);

  // Tarjeta única de celebración (zona Objetivo): se reutiliza, nunca se apilan varias.
  const card = byId("logro-tarjeta");
  const cardTextNode = byId("logro-tarjeta-texto");
  const cardMore = byId("logro-tarjeta-mas");
  let cardState: CardState | null = null;
  let mode: Celebrations = loadPreferences().celebrations;
  document.addEventListener("preferencias-cambiadas", (event) => { mode = (event as CustomEvent<{ celebrations: Celebrations }>).detail.celebrations; });
  const renderCard = () => {
    card.hidden = cardState === null;
    if (!cardState) return;
    const t = cardText(cardState);
    cardTextNode.textContent = t.text;
    cardMore.textContent = t.more;
  };
  const closeCard = () => {
    const hadFocus = card.contains(document.activeElement);
    cardState = null;
    renderCard();
    if (hadFocus) byId("objetivo-elegir").focus(); // el foco no se pierde al desaparecer la tarjeta
  };
  byId("logro-tarjeta-cerrar").onclick = closeCard;
  byId("logro-tarjeta-ver").onclick = () => {
    cardState = null;
    renderCard();
    // Acción explícita de la persona: abre la pestaña «Logros» (nunca se abre sola).
    document.dispatchEvent(new CustomEvent("mostrar-pestana", { detail: "logros" }));
    byId("tab-logros").focus();
  };

  /** Una tanda de logros nuevos: un aviso (resumen), historial, una tarjeta y un destello, según la preferencia. */
  function celebrate(ids: readonly string[]) {
    const names = ids.map((id) => CATALOG.find((d) => d.id === id)?.name).filter((n): n is string => Boolean(n));
    const plan = planCelebration(names, mode);
    for (const event of plan.events) host.feed.emit(event);
    if (plan.card) { cardState = nextCard(cardState, names); renderCard(); }
    if (plan.flash) host.flash();
  }

  const tabBadge = createBadge("logro nuevo", "logros nuevos");
  byId("tab-logros").append(tabBadge.element);

  let account: string | undefined;
  let parsed: ParsedStore = { store: emptyStore(), readOnly: false };
  let states: AchievementState[] = [];
  const last = new Map<string, string>();

  const key = () => achievementKey(host.world, account ?? "");
  const persist = () => { saveStore(key(), parsed); };
  const change = (store: AchievementStore) => { parsed = { ...parsed, store }; persist(); render(); };

  const replaceIfChanged = (id: string, node: HTMLElement, children: Node[]) => {
    const signature = children.map((c) => (c as HTMLElement).outerHTML ?? c.textContent).join("");
    if (last.get(id) === signature) return;
    last.set(id, signature);
    node.replaceChildren(...children);
  };

  const item = (s: AchievementState, extra?: HTMLElement): HTMLLIElement => {
    const line = el("li", {},
      el("strong", {}, s.name), ` — ${STATUS_TEXT[s.status]}`,
      s.progress ? ` (${s.progress.done} de ${s.progress.total}${s.set ? `, ${s.set}` : ""})` : s.set ? ` (${s.set})` : "",
      s.type === "estado-actual" ? el("span", { className: "ayuda" }, " · Condición actual: puede dejar de cumplirse si cambia el mundo.") : "",
      el("br"), el("span", { className: "ayuda" }, s.description));
    for (const credit of s.credits) line.append(el("br"), el("span", {}, creditText(credit, executedVerb(s.id))));
    if (extra) line.append(" ", extra);
    return line;
  };

  function render() {
    const snap = host.snapshot();
    if (!snap) return;
    const total = summarize(states);
    summary.textContent = `${total.achieved} de ${total.total} logros verificables conseguidos. Se calculan con el estado del mundo; son de todas las personas.`;
    const byIdState = new Map(states.map((s) => [s.id, s]));

    // Nuevos y preexistentes
    const nuevos = newOnes(parsed.store).map((id) => byIdState.get(id)).filter((s): s is AchievementState => Boolean(s));
    replaceIfChanged("nuevos", newList, nuevos.map((s) => {
      const b = el("button", { type: "button" }, "Marcar como visto");
      b.setAttribute("aria-label", `Marcar «${s.name}» como visto`);
      b.onclick = () => change(markConsulted(parsed.store, [s.id]));
      return item(s, b);
    }));
    newEmpty.hidden = nuevos.length > 0;
    markNew.hidden = nuevos.length === 0;
    const starting = startingOnes(parsed.store).map((id) => byIdState.get(id)).filter((s): s is AchievementState => Boolean(s));
    replaceIfChanged("preexistentes", startList, starting.map((s) => item(s)));
    startEmpty.hidden = starting.length > 0;
    const pendingStart = starting.some((s) => !parsed.store.consultados.includes(s.id));
    markStart.hidden = !pendingStart;

    // Referencia orientativa (no sustituye el objetivo)
    const ref = communityReference(snap);
    refText.textContent = `${ref.label}. ${ref.text}`;
    refNote.textContent = ref.note;
    refBar.element.hidden = !ref.progress;
    if (ref.progress) refBar.update(ref.progress.done, ref.progress.total);

    // Insignias de nivel
    const badges = host.skillBadges();
    replaceIfChanged("insignias", badgesList, badges.length
      ? badges.map((b) => el("li", {}, el("strong", {}, `${b.name}: `), b.badge.label, b.next ? el("span", { className: "ayuda" }, ` · ${b.next}`) : ""))
      : [el("li", { className: "ayuda" }, "Este mundo no tiene habilidades todavía.")]);

    // Logros verificables por grupo
    for (const group of ["comunidad", "personal", "cooperacion"] as const) {
      replaceIfChanged(`grupo-${group}`, lists[group], states.filter((s) => s.group === group).map((s) => item(s)));
    }

    // Registro de este navegador (no son logros verificados)
    const local = states.filter((s) => s.localRecord);
    replaceIfChanged("registro", recordList, local.map((s) => el("li", {}, el("strong", {}, s.name), " — lo viste conseguido en este navegador; ya no consta en el estado del mundo.")));
    recordEmpty.hidden = local.length > 0;
    localBook.textContent = `Has enseñado a ${parsed.store.libro.ensenado} ${parsed.store.libro.ensenado === 1 ? "persona" : "personas"} y ${parsed.store.libro.aprendido} ${parsed.store.libro.aprendido === 1 ? "persona te ha enseñado" : "personas te han enseñado"} (contado desde que usas este navegador).`;
    tabBadge.update(badgeCount(parsed.store));
  }

  markNew.onclick = () => change(markConsulted(parsed.store, newOnes(parsed.store)));
  markStart.onclick = () => change(markStartingConsulted(parsed.store));
  refGo.onclick = () => document.dispatchEvent(new CustomEvent("enfocar-objetivo"));

  return {
    /** Recalcula con el estado actual; la primera evaluación de cada cuenta es la «primera visita». No cambia de pestaña. */
    update() {
      const snap = host.snapshot();
      if (!snap) return;
      if (account !== snap.me.name) {
        account = snap.me.name;
        parsed = loadStore(key());
        last.clear();
      }
      states = evaluateAchievements(snap, { vistos: new Set(parsed.store.vistos) });
      const applied = applyAchieved(parsed.store, achievedIds(states));
      const changed = JSON.stringify(applied.store) !== JSON.stringify(parsed.store);
      parsed = { ...parsed, store: applied.store };
      if (changed) persist();
      render();
      if (applied.nuevos.length) celebrate(applied.nuevos);
      return applied.nuevos;
    },
    /** El libro local (enseñar y aprender) lo alimenta la escena con los `teach-result` aceptados; no es un logro. */
    recordLocal(kind: "ensenado" | "aprendido") { change(addLocalRecognition(parsed.store, kind)); },
    panel,
  };
}

