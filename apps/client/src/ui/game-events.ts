// Fuente única de eventos de la interfaz (G3b, Q207). Todo el cliente EMITE aquí; los almacenes (historial y notificaciones
// pendientes) y el anunciador se SUSCRIBEN. Modelo puro: sin DOM, para poder probarlo con `node:test`.

export type EventKind =
  | "recoleccion" | "deposito" | "aporte" | "fabricacion" | "construccion" | "mision"
  | "habilidad" | "oferta" | "logro" | "mundo" | "conexion" | "aviso" | "error";

/** Importancia: decide dónde aparece (Q207). Crítica y relevante crean una notificación; normal solo va al historial. */
export type Importance = "critica" | "relevante" | "normal";

/** Prioridad de anuncio accesible (Q209): 0 inmediato y asertivo, 1 en cola y educado, 2 sin anuncio automático. */
export type Priority = 0 | 1 | 2;

export interface EventAction {
  id: string;
  label: string;
}

export interface GameEventInput {
  /** Identifica la operación o el asunto (p. ej. `oferta:<id>`, `conexion`, `error:<motivo>`): fusiona repetidas y permite resolverlas. */
  key?: string;
  kind: EventKind;
  importance: Importance;
  text: string;
  /** ¿Lo ha provocado o le concierne a la persona de esta sesión? Decide la prioridad por omisión. */
  own?: boolean;
  /** Prioridad explícita; si falta se deduce con `defaultPriority`. */
  priority?: Priority;
  /** Acciones disponibles sobre la notificación (p. ej. aceptar y rechazar una oferta). */
  actions?: EventAction[];
  /** Eventos iguales y seguidos que se anuncian juntos: «Has recogido 3 de madera». */
  group?: { key: string; amount: number; text: (total: number) => string };
}

export interface GameEvent extends GameEventInput {
  id: number;
  at: number;
  own: boolean;
  priority: Priority;
}

/** Prioridad por omisión según el tipo, la importancia y si concierne a la persona (tabla de Q209). */
export function defaultPriority(kind: EventKind, importance: Importance, own: boolean): Priority {
  if (importance === "critica" && (kind === "error" || kind === "conexion")) return 0;
  if (importance === "normal") return 2;
  return own ? 1 : 2;
}

export type Listener = (event: GameEvent) => void;

export interface GameEvents {
  emit(input: GameEventInput): GameEvent;
  subscribe(listener: Listener): () => void;
}

export function createGameEvents(now: () => number = Date.now): GameEvents {
  const listeners = new Set<Listener>();
  let counter = 0;
  return {
    emit(input) {
      const own = input.own ?? false;
      const event: GameEvent = { ...input, id: ++counter, at: now(), own, priority: input.priority ?? defaultPriority(input.kind, input.importance, own) };
      for (const listener of [...listeners]) listener(event);
      return event;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
