import { el } from "./dom.ts";
import { field } from "./field.ts";
import {
  parsePreferences, preferenceAttributes, PREFERENCES_KEY, serializePreferences, TEXT_SIZES, type Preferences,
} from "./preferences-model.ts";

// Preferencias de accesibilidad (G3b, Q210): carga, guardado y aplicación al documento, y el formulario del diálogo.
// Locales al navegador; si no se puede guardar (modo privado, almacenamiento bloqueado) funcionan en la sesión.

export function loadPreferences(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): Preferences {
  try { return parsePreferences(storage?.getItem(PREFERENCES_KEY)); } catch { return parsePreferences(undefined); }
}

export function savePreferences(prefs: Preferences, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): boolean {
  try { storage?.setItem(PREFERENCES_KEY, serializePreferences(prefs)); return storage !== undefined; } catch { return false; }
}

function safeStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

/** Pone los atributos de las preferencias en <html>; `tokens.css` y `base.css` hacen el resto. */
export function applyPreferences(prefs: Preferences, root: HTMLElement = document.documentElement) {
  const systemReduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const [name, value] of Object.entries(preferenceAttributes(prefs, systemReduced))) root.setAttribute(name, value);
}

const radios = (name: string, legend: string, options: [string, string][], current: string, onPick: (value: string) => void) => {
  const set = el("fieldset", {}, el("legend", {}, legend));
  for (const [value, label] of options) {
    const input = el("input", { type: "radio", name, value, checked: value === current });
    input.onchange = () => { if (input.checked) onPick(value); };
    set.append(el("label", { className: "casilla" }, input, ` ${label}`));
  }
  return set;
};

const checkbox = (label: string, help: string, current: boolean, onChange: (v: boolean) => void) => {
  const input = el("input", { type: "checkbox", checked: current });
  input.onchange = () => onChange(input.checked);
  return el("div", { className: "campo" }, el("label", { className: "casilla" }, input, ` ${label}`), el("p", { className: "ayuda" }, help));
};

/** Formulario de preferencias: cada cambio se aplica y se guarda al instante. */
export function createPreferencesForm(initial: Preferences, onChange: (prefs: Preferences) => void): HTMLElement {
  let prefs = { ...initial };
  const change = (patch: Partial<Preferences>) => { prefs = { ...prefs, ...patch }; onChange(prefs); };
  const announcements = el("select");
  for (const [value, label] of [["minimos", "Mínimos: solo errores y conexión"], ["normales", "Normales: además lo que te concierne"], ["completos", "Completos: además un resumen de la rutina"]] as const) {
    announcements.append(el("option", { value, textContent: label }));
  }
  announcements.value = prefs.announcements;
  announcements.onchange = () => change({ announcements: announcements.value as Preferences["announcements"] });
  return el("form", { className: "preferencias", noValidate: true, onsubmit: (e: Event) => e.preventDefault() },
    radios("pref-tamano", "Tamaño del texto", TEXT_SIZES.map((s) => [String(s), `${s} %`] as [string, string]), String(prefs.textSize), (v) => change({ textSize: Number(v) as Preferences["textSize"] })),
    checkbox("Alto contraste", "Colores más contrastados (al menos 7:1).", prefs.highContrast, (v) => change({ highContrast: v })),
    radios("pref-movimiento", "Movimiento", [["sistema", "Seguir al sistema"], ["reducido", "Menos movimiento"], ["normal", "Normal"]], prefs.motion, (v) => change({ motion: v as Preferences["motion"] })),
    field("Anuncios por lector de pantalla", announcements, "Qué se anuncia en voz alta; todo queda siempre en la consola."),
    checkbox("Abrir pestañas sugeridas automáticamente", "Desactivado por omisión: las pestañas no cambian solas. Aun activado, no cambia mientras escribes, tienes el foco en el panel o hace menos de 30 s que elegiste una.", prefs.autoTabs, (v) => change({ autoTabs: v })),
    radios("pref-consola", "Consola al cargar", [["desplegada", "Desplegada"], ["plegada", "Plegada"]], prefs.console, (v) => change({ console: v as Preferences["console"] })));
}
