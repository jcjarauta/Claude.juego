import type { EventKind, GameEvent } from "./game-events.ts";

// Historial (G3b, Q207): registro cronológico e informativo de TODOS los eventos. No tiene estado de resolución.
// Tope de 200: al superarlo se expulsa lo más antiguo. Expulsar del historial nunca afecta a una notificación pendiente
// (viven en otro almacén: notification-center-model.ts).

export const EVENT_LOG_LIMIT = 200;

export interface LogEntry {
  event: GameEvent;
  /** Repeticiones seguidas de un mismo evento con clave (p. ej. un error repetido): ×N. */
  repeats: number;
}

export interface EventLog {
  add(event: GameEvent): LogEntry;
  /** Entradas en orden cronológico, opcionalmente solo de los tipos indicados. */
  list(kinds?: ReadonlySet<EventKind>): LogEntry[];
  size(): number;
  clear(): void;
  /** Eventos añadidos desde la última lectura (para el contador de novedades de la consola replegada). */
  unread(): number;
  markRead(): void;
  subscribe(listener: () => void): () => void;
}

export function createEventLog(limit = EVENT_LOG_LIMIT): EventLog {
  let entries: LogEntry[] = [];
  let unread = 0;
  const listeners = new Set<() => void>();
  const notify = () => { for (const l of [...listeners]) l(); };
  return {
    add(event) {
      const last = entries.at(-1);
      // Un evento con clave que se repite justo después del anterior se cuenta (×N) en vez de duplicarse.
      if (event.key && last?.event.key === event.key && last.event.text === event.text) {
        last.repeats++;
        unread++;
        notify();
        return last;
      }
      const entry: LogEntry = { event, repeats: 1 };
      entries.push(entry);
      unread++;
      if (entries.length > limit) entries = entries.slice(entries.length - limit);
      notify();
      return entry;
    },
    list: (kinds) => (kinds ? entries.filter((e) => kinds.has(e.event.kind)) : [...entries]),
    size: () => entries.length,
    clear() { entries = []; unread = 0; notify(); },
    unread: () => unread,
    markRead() { if (unread === 0) return; unread = 0; notify(); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
