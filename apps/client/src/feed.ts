import { createEventLog, type EventLog } from "./ui/event-log-model.ts";
import { createGameEvents, type GameEvent, type GameEventInput, type GameEvents } from "./ui/game-events.ts";
import { createNotificationCenter, type NotificationCenter } from "./ui/notification-center-model.ts";

// Fuente única de eventos de la pantalla del juego (G3b, P3, Q207): el historial, las notificaciones pendientes y el anunciador
// cuelgan de este bus. Todo el cliente emite aquí; ya no hay avisos sueltos en la página.

export interface Feed {
  events: GameEvents;
  log: EventLog;
  center: NotificationCenter;
  emit(input: GameEventInput): GameEvent;
  /** La operación a la que se refería una notificación ha terminado o ha dejado de ser válida (no es descartar). */
  resolve(key: string): void;
  /** Marca una acción propia reciente (p. ej. pulsar «Fabricar»), para reconocer su resultado como «tuyo». */
  markOwn(kind: string): void;
  recentOwn(kind: string, ms?: number): boolean;
  /** Acción de una notificación (operación del juego): la registra quien sabe ejecutarla. */
  setActionHandler(handler: (notificationKey: string, actionId: string) => void): void;
  act(notificationKey: string, actionId: string): void;
}

export function createFeed(now: () => number = Date.now): Feed {
  const events = createGameEvents(now);
  const log = createEventLog();
  const center = createNotificationCenter();
  events.subscribe((e) => { log.add(e); center.add(e); });
  const own = new Map<string, number>();
  let handler: (key: string, action: string) => void = () => {};
  return {
    events, log, center,
    emit: (input) => events.emit(input),
    resolve: (key) => { center.resolve(key); },
    markOwn: (kind) => { own.set(kind, now()); },
    recentOwn: (kind, ms = 4000) => now() - (own.get(kind) ?? -Infinity) < ms,
    setActionHandler: (h) => { handler = h; },
    act: (key, action) => handler(key, action),
  };
}
