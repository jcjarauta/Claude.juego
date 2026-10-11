import type { MapLabels } from "./preferences-model.ts";

// Colocación de etiquetas del mapa (G3c, P2): modelo puro, sin Phaser ni DOM.

// ---------------------------------------------------------------- etiquetas

export type LabelGroup = "propia" | "destino" | "edificio" | "persona" | "cantidad";

/** Prioridad de colocación: lo de menor número gana si dos etiquetas chocan. */
const PRIORITY: Record<LabelGroup, number> = { propia: 0, destino: 1, edificio: 2, persona: 3, cantidad: 4 };

/** ¿Se muestra este grupo con la preferencia elegida? */
export function groupVisible(mode: MapLabels, group: LabelGroup): boolean {
  if (mode === "ninguna") return false;
  if (mode === "edificios") return group === "edificio" || group === "destino";
  return true;
}

export interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Decide qué etiquetas se ven: por prioridad, y una etiqueta que choca con otra ya colocada se oculta. Función pura (la prueba
 * unitaria no necesita Phaser). Devuelve, por índice, si se muestra; las ocultas siguen disponibles en «Qué hay cerca».
 */
export function layoutLabels(items: readonly { group: LabelGroup; rect: Rect }[], mode: MapLabels, pad = 2): boolean[] {
  const order = items.map((_, i) => i).sort((a, b) => PRIORITY[items[a]!.group] - PRIORITY[items[b]!.group] || a - b);
  const placed: Rect[] = [];
  const shown = new Array<boolean>(items.length).fill(false);
  for (const i of order) {
    const item = items[i]!;
    if (!groupVisible(mode, item.group)) continue;
    const r = { x: item.rect.x - pad, y: item.rect.y - pad, w: item.rect.w + 2 * pad, h: item.rect.h + 2 * pad };
    if (placed.some((p) => overlaps(p, r))) continue;
    placed.push(r);
    shown[i] = true;
  }
  return shown;
}
