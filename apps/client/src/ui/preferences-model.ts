import type { Verbosity } from "./announcer-model.ts";

// Preferencias de accesibilidad (G3b, Q210–Q211). Locales al navegador: no se envían al servidor.
// Lectura tolerante: un valor ausente, corrupto o desconocido vuelve al valor por omisión; nunca lanza.

export const TEXT_SIZES = [100, 125, 150, 200] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export type MotionPreference = "sistema" | "reducido" | "normal";
export type ConsoleDefault = "desplegada" | "plegada";
/** Etiquetas del mapa (G3c, Q221): todas, solo las de edificios o ninguna. */
export type MapLabels = "todas" | "edificios" | "ninguna";

export interface Preferences {
  /** Tamaño de texto en %. */
  textSize: TextSize;
  highContrast: boolean;
  /** «sistema» sigue `prefers-reduced-motion`. */
  motion: MotionPreference;
  announcements: Verbosity;
  /** Abrir pestañas sugeridas automáticamente (desactivado por omisión, Q210). */
  autoTabs: boolean;
  console: ConsoleDefault;
  mapLabels: MapLabels;
}

export const DEFAULT_PREFERENCES: Preferences = {
  textSize: 100, highContrast: false, motion: "sistema", announcements: "normales", autoTabs: false, console: "desplegada", mapLabels: "todas",
};

export const PREFERENCES_KEY = "engremiat.preferencias";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Convierte lo leído del almacenamiento (texto JSON u objeto) en preferencias válidas. */
export function parsePreferences(raw: unknown): Preferences {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch { return { ...DEFAULT_PREFERENCES }; }
  }
  if (!isRecord(data)) return { ...DEFAULT_PREFERENCES };
  const d = DEFAULT_PREFERENCES;
  return {
    textSize: (TEXT_SIZES as readonly unknown[]).includes(data.textSize) ? (data.textSize as TextSize) : d.textSize,
    highContrast: typeof data.highContrast === "boolean" ? data.highContrast : d.highContrast,
    motion: data.motion === "sistema" || data.motion === "reducido" || data.motion === "normal" ? data.motion : d.motion,
    announcements: data.announcements === "minimos" || data.announcements === "normales" || data.announcements === "completos" ? data.announcements : d.announcements,
    autoTabs: typeof data.autoTabs === "boolean" ? data.autoTabs : d.autoTabs,
    console: data.console === "plegada" || data.console === "desplegada" ? data.console : d.console,
    mapLabels: data.mapLabels === "todas" || data.mapLabels === "edificios" || data.mapLabels === "ninguna" ? data.mapLabels : d.mapLabels,
  };
}

export const serializePreferences = (p: Preferences): string => JSON.stringify(p);

/** Atributos que se ponen en `<html>` para que `tokens.css` y `base.css` apliquen las preferencias. */
export function preferenceAttributes(p: Preferences, systemReducedMotion: boolean): Record<string, string> {
  const reduced = p.motion === "reducido" || (p.motion === "sistema" && systemReducedMotion);
  return { "data-tamano": String(p.textSize), "data-contraste": p.highContrast ? "alto" : "normal", "data-movimiento": reduced ? "reducido" : "normal" };
}
