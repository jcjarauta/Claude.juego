// Regla de actividad de las pestañas (G3b, Q210): el panel contextual NUNCA cambia de pestaña por sí solo mientras la persona
// actúa. Lo contextual se señala con insignias y sugerencias; abrir pestañas sugeridas automáticamente es una preferencia
// desactivada por omisión y, aun activada, no actúa si la persona está haciendo algo. Modelo puro.

export const MANUAL_CHOICE_WINDOW_MS = 30_000;

export interface ActivityState {
  /** Preferencia «Abrir pestañas sugeridas automáticamente». */
  autoTabs: boolean;
  /** El foco está dentro del panel contextual (campo, selector o botón en uso). */
  focusInsidePanel: boolean;
  /** Última vez que la persona eligió una pestaña a mano (ms desde 1970), o null. */
  lastManualAt: number | null;
  now: number;
  dialogOpen: boolean;
  /** El personaje se está moviendo en este instante. */
  moving: boolean;
}

export type AutoSwitchDecision = { allowed: true } | { allowed: false; reason: "preferencia-desactivada" | "foco-en-el-panel" | "eleccion-reciente" | "dialogo-abierto" | "personaje-en-movimiento" };

export function canAutoSwitch(state: ActivityState, windowMs = MANUAL_CHOICE_WINDOW_MS): AutoSwitchDecision {
  if (!state.autoTabs) return { allowed: false, reason: "preferencia-desactivada" };
  if (state.dialogOpen) return { allowed: false, reason: "dialogo-abierto" };
  if (state.focusInsidePanel) return { allowed: false, reason: "foco-en-el-panel" };
  if (state.lastManualAt !== null && state.now - state.lastManualAt < windowMs) return { allowed: false, reason: "eleccion-reciente" };
  if (state.moving) return { allowed: false, reason: "personaje-en-movimiento" };
  return { allowed: true };
}

/** Pestaña guardada válida, o la de reserva si el valor es desconocido o corrupto. */
export function rememberedTab(raw: unknown, valid: readonly string[], fallback: string): string {
  return typeof raw === "string" && valid.includes(raw) ? raw : fallback;
}
