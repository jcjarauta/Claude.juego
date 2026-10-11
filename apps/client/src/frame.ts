import type { Feed } from "./feed.ts";
import type { StartedAnnouncer } from "./ui/announcer.ts";
import { createBadge, type Badge } from "./ui/badge.ts";
import type { GameConsole } from "./ui/console-log.ts";
import { dialogOpen, openDialog } from "./ui/dialog.ts";
import { el } from "./ui/dom.ts";
import { applyPreferences, createPreferencesForm, savePreferences } from "./ui/preferences.ts";
import type { Preferences } from "./ui/preferences-model.ts";
import { canAutoSwitch } from "./ui/tab-activity.ts";
import type { Tabs } from "./ui/tabs.ts";

// Marco de la pantalla (G3b, P4): regla de actividad de las pestañas, diálogos de Ayuda y Accesibilidad, y atajos `?` y `C`.
// Otras partes piden cosas con eventos del documento: «sugerir-pestana», «mostrar-ayuda» y «enfocar-consola».

export interface TabSuggestion {
  tab: string;
  text: string;
  /** Clave de la notificación (se resuelve al abrir la pestaña). */
  key: string;
}

const MOVE_CODES = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]);
const MOVING_MS = 600;

const SHORTCUTS: [string, string][] = [
  ["Flechas o W A S D", "Mover al personaje (mantener pulsado para seguir andando)"],
  ["Espacio o E", "Recolectar lo que tienes delante"],
  ["P", "Ir al panel del proyecto"],
  ["M", "Volver al mapa"],
  ["C", "Ir a la consola (Importantes e Historial)"],
  ["?", "Mostrar esta ayuda"],
  ["Flechas, Inicio y Fin (sobre una pestaña)", "Cambiar de pestaña sin mover al personaje"],
  ["Escape", "Cerrar un diálogo"],
];

export function setupFrame(options: { feed: Feed; console: GameConsole; announcer: StartedAnnouncer; tabs: Tabs; prefs: Preferences }) {
  const { feed, tabs } = options;
  let prefs = options.prefs;
  const panel = document.getElementById("proyecto")!;
  const tabId = (name: string) => `tab-${name}`;
  const tabByName = (name: string) => tabs.tabs.find((t) => t.id === tabId(name));
  let lastManualAt: number | null = null;
  let lastMoveAt = -Infinity;
  const badges = new Map<string, Badge>();
  const pending = new Map<string, Set<string>>();

  const manual = () => { lastManualAt = Date.now(); };
  // Elegir a mano: ratón o teclado sobre las pestañas, y los atajos de la persona (P).
  const tablist = panel.querySelector('[role="tablist"]')!;
  tablist.addEventListener("click", manual, true);
  tablist.addEventListener("keydown", manual, true);
  document.addEventListener("mostrar-pestana", manual);
  window.addEventListener("keydown", (e) => { if (MOVE_CODES.has(e.code)) lastMoveAt = Date.now(); }, true);

  const badgeFor = (name: string) => {
    let badge = badges.get(name);
    if (!badge) {
      badge = createBadge();
      tabByName(name)?.append(badge.element);
      badges.set(name, badge);
    }
    return badge;
  };
  /** Al abrir una pestaña (a mano o por una sugerencia) se retira su insignia y se resuelven sus sugerencias. */
  const clearSuggestions = (name: string) => {
    for (const key of pending.get(name) ?? []) feed.resolve(`sugerencia:${key}`);
    pending.delete(name);
    badges.get(name)?.update(0);
  };
  const selected = () => tabs.tabs.find((t) => t.getAttribute("aria-selected") === "true")?.id.replace("tab-", "");
  // Se llama desde el onSelect de las pestañas.
  const onTabSelected = (name: string) => clearSuggestions(name);

  document.addEventListener("sugerir-pestana", (event) => {
    const { tab, text, key } = (event as CustomEvent<TabSuggestion>).detail;
    const target = tabByName(tab);
    if (!target || selected() === tab) return;
    const decision = canAutoSwitch({
      autoTabs: prefs.autoTabs,
      focusInsidePanel: panel.contains(document.activeElement),
      lastManualAt, now: Date.now(), dialogOpen: dialogOpen(),
      moving: Date.now() - lastMoveAt < MOVING_MS,
    });
    if (decision.allowed) { tabs.select(target, false); return; }
    // No se cambia de pestaña: insignia en la pestaña y una sugerencia en Importantes (no mueve el foco).
    const set = pending.get(tab) ?? new Set<string>();
    set.add(key);
    pending.set(tab, set);
    badgeFor(tab).update(set.size);
    feed.emit({
      kind: "aviso", importance: "relevante", own: true, key: `sugerencia:${key}`, text,
      actions: [{ id: "abrir", label: `Abrir «${[...target.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim()}»` }],
    });
  });

  /** Acciones propias del marco en las notificaciones; devuelve true si la ha atendido. */
  const handleAction = (key: string, action: string): boolean => {
    if (!key.startsWith("sugerencia:") || action !== "abrir") return false;
    for (const [name, keys] of pending) {
      if ([...keys].some((k) => `sugerencia:${k}` === key)) {
        const tab = tabByName(name);
        manual();
        if (tab) tabs.select(tab, true);
        break;
      }
    }
    return true;
  };

  // Diálogos de la barra superior y atajos.
  const showHelp = () => {
    if (dialogOpen()) return;
    const list = el("dl", { className: "atajos" });
    for (const [keys, what] of SHORTCUTS) list.append(el("dt", {}, el("kbd", {}, keys)), el("dd", {}, what));
    openDialog({ title: "Ayuda: atajos de teclado", content: list });
  };
  const showPreferences = () => {
    if (dialogOpen()) return;
    openDialog({
      title: "Accesibilidad",
      content: createPreferencesForm(prefs, (next) => {
        prefs = next;
        applyPreferences(next);
        savePreferences(next);
        options.announcer.setVerbosity(next.announcements);
      }),
    });
  };
  document.getElementById("ayuda-boton")!.onclick = showHelp;
  document.getElementById("accesibilidad-boton")!.onclick = showPreferences;
  document.addEventListener("mostrar-ayuda", showHelp);
  document.addEventListener("enfocar-consola", () => { if (!dialogOpen()) options.console.focusLog(); });

  return { onTabSelected, handleAction };
}
