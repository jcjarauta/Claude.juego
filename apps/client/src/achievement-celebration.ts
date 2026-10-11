import type { GameEventInput } from "./ui/game-events.ts";
import type { Celebrations } from "./ui/preferences-model.ts";

// Celebración de logros (G3d, P2, Q232). Modelo puro: decide QUÉ se emite según la preferencia. Una tanda de logros nuevos produce
// UN solo aviso (resumen), UNA tarjeta reutilizable y UN destello; cada logro queda además en el historial de la consola.
// Sin sonido, sin ventanas modales; nunca cambia foco, pestaña, objetivo ni cámara.

export interface CelebrationPlan {
  /** Eventos para el bus: el resumen (relevante, se anuncia una vez) y, si son varios, una línea por logro en el historial. */
  events: GameEventInput[];
  /** Se actualiza la tarjeta única de la zona Objetivo (solo con «Todas»). */
  card: boolean;
  /** Un destello corto sobre el personaje, uno por tanda (solo con «Todas»; el mapa lo omite con «menos movimiento»). */
  flash: boolean;
}

const NONE: CelebrationPlan = { events: [], card: false, flash: false };

const names = (list: readonly string[]) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} y ${list.at(-1)}`);

/** Resumen de la tanda: «¡Logro conseguido: X!» o «Has conseguido 3 logros nuevos: A, B y C.» (máximo tres nombres). */
export function celebrationText(achieved: readonly string[]): string {
  if (achieved.length === 1) return `¡Logro conseguido: ${achieved[0]}!`;
  const shown = achieved.slice(0, 3);
  const rest = achieved.length - shown.length;
  return `Has conseguido ${achieved.length} logros nuevos: ${names(shown)}${rest > 0 ? ` y ${rest} más` : ""}.`;
}

/**
 * Qué se emite para una tanda de logros nuevos (nombres en orden):
 *  - Todas: aviso + historial + tarjeta + destello.
 *  - Solo texto: aviso + historial (consola y anunciador).
 *  - Ninguna: nada; el logro queda en «Nuevos» de la pestaña sin avisar.
 */
export function planCelebration(achieved: readonly string[], mode: Celebrations): CelebrationPlan {
  if (achieved.length === 0 || mode === "ninguna") return NONE;
  const events: GameEventInput[] = [{ kind: "logro", importance: "relevante", own: true, priority: 1, text: celebrationText(achieved) }];
  // Varias a la vez: un resumen en el aviso y cada logro en el historial (sin anunciarse una por una).
  if (achieved.length > 1) for (const name of achieved) events.push({ kind: "logro", importance: "normal", own: true, text: `Logro conseguido: ${name}.` });
  return { events, card: mode === "todas", flash: mode === "todas" };
}

/** La tarjeta única: guarda el último logro y cuántos van desde que se cerró; nunca se apilan varias. */
export interface CardState {
  last: string;
  total: number;
}

export function nextCard(previous: CardState | null, achieved: readonly string[]): CardState | null {
  if (achieved.length === 0) return previous;
  return { last: achieved.at(-1)!, total: (previous?.total ?? 0) + achieved.length };
}

export function cardText(card: CardState): { text: string; more: string } {
  return { text: `Logro conseguido: ${card.last}`, more: card.total > 1 ? `y ${card.total - 1} más` : "" };
}
