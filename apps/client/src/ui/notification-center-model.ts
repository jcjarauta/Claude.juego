import type { GameEvent } from "./game-events.ts";

// Notificaciones pendientes (G3b, Q207–Q208): lo que requiere atención y sigue vivo hasta que se resuelva o se descarte.
// Almacén distinto del historial: aquí NO hay expulsión por tope. Una crítica pendiente no se borra nunca por llegar más eventos.
//
// Tres acciones distintas (Q208):
//  - descartar(clave): quita el AVISO de «Importantes». No toca ninguna operación (una oferta cuyo aviso se descarta sigue pendiente).
//  - resolver(clave): la OPERACIÓN a la que se refería terminó o dejó de ser válida (oferta aceptada, rechazada, caducada o anulada;
//    conexión restablecida). Lo dispara el resultado de la operación, nunca el botón del aviso.
//  - rechazar una oferta es una OPERACIÓN del juego (envía `teach-respond`); no se modela aquí: su resultado llega como `resolver`.

export type NotificationState = "pendiente" | "descartada" | "resuelta" | "expirada";

export interface Notification {
  key: string;
  /** Último evento con esa clave. */
  event: GameEvent;
  state: NotificationState;
  /** Veces que se ha repetido (se fusionan por clave). */
  count: number;
  createdAt: number;
  /** Solo las relevantes caducan (pasan solas al historial); las críticas no. */
  expiresAt: number | null;
}

export const PENDING_LIMIT = 50;
export const RELEVANT_TTL_MS = 10_000;

export const SUMMARY_KEY = "resumen:relevantes";

export interface NotificationCenter {
  /** Crea o fusiona una notificación si el evento es crítico o relevante; devuelve undefined si es normal. */
  add(event: GameEvent): Notification | undefined;
  dismiss(key: string): boolean;
  resolve(key: string): boolean;
  /** Caduca las relevantes cuyo plazo ha pasado. Devuelve cuántas. */
  tick(now: number): number;
  /** Pendientes: críticas primero y, dentro de cada grupo, de más reciente a más antigua. */
  pending(): Notification[];
  get(key: string): Notification | undefined;
  all(): Notification[];
  subscribe(listener: () => void): () => void;
}

export function createNotificationCenter(options: { limit?: number; ttlMs?: number } = {}): NotificationCenter {
  const limit = options.limit ?? PENDING_LIMIT;
  const ttl = options.ttlMs ?? RELEVANT_TTL_MS;
  const items = new Map<string, Notification>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const l of [...listeners]) l(); };
  const isPending = (n: Notification) => n.state === "pendiente";

  /** Al superar el límite se agrupan las relevantes más antiguas en una sola línea; las críticas nunca se agrupan ni se pierden. */
  function enforceLimit(now: number) {
    const pending = [...items.values()].filter(isPending);
    if (pending.length <= limit) return;
    const relevant = pending.filter((n) => n.event.importance === "relevante" && n.key !== SUMMARY_KEY).sort((a, b) => a.createdAt - b.createdAt);
    const excess = pending.length - limit;
    // +1 porque la línea de resumen ocupa un sitio.
    const collapse = relevant.slice(0, Math.min(relevant.length, excess + 1));
    if (collapse.length < 2) return;
    let total = 0;
    for (const n of collapse) { total += n.count; items.delete(n.key); }
    const summary = items.get(SUMMARY_KEY);
    const event = { ...collapse.at(-1)!.event, key: SUMMARY_KEY, text: "", actions: undefined } as GameEvent;
    const count = total + (summary?.count ?? 0);
    event.text = `${count} avisos relevantes agrupados (están en el historial)`;
    items.set(SUMMARY_KEY, { key: SUMMARY_KEY, event, state: "pendiente", count, createdAt: summary?.createdAt ?? now, expiresAt: null });
  }

  return {
    add(event) {
      if (event.importance === "normal") return undefined;
      const key = event.key ?? `ev:${event.id}`;
      const existing = items.get(key);
      let note: Notification;
      if (existing && isPending(existing)) {
        // Misma clave y aún pendiente: se fusiona (×N) y se renueva el plazo de las relevantes.
        existing.count++;
        existing.event = event;
        existing.expiresAt = event.importance === "relevante" ? event.at + ttl : null;
        note = existing;
      } else {
        note = { key, event, state: "pendiente", count: 1, createdAt: event.at, expiresAt: event.importance === "relevante" ? event.at + ttl : null };
        items.set(key, note);
      }
      enforceLimit(event.at);
      notify();
      return note;
    },
    dismiss(key) {
      const n = items.get(key);
      if (!n || !isPending(n)) return false;
      n.state = "descartada";
      notify();
      return true;
    },
    resolve(key) {
      const n = items.get(key);
      if (!n || n.state === "resuelta") return false;
      n.state = "resuelta";
      notify();
      return true;
    },
    tick(now) {
      let expired = 0;
      for (const n of items.values()) {
        if (isPending(n) && n.expiresAt !== null && now >= n.expiresAt) { n.state = "expirada"; expired++; }
      }
      if (expired) notify();
      return expired;
    },
    pending() {
      const rank = (n: Notification) => (n.event.importance === "critica" ? 0 : 1);
      return [...items.values()].filter(isPending).sort((a, b) => rank(a) - rank(b) || b.event.at - a.event.at || b.event.id - a.event.id);
    },
    get: (key) => items.get(key),
    all: () => [...items.values()],
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
