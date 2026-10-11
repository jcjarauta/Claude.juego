import type { EventKind, GameEvent } from "./game-events.ts";

// Anunciador accesible (G3b, Q209). Decide QUÉ se anuncia y CUÁNDO con tres prioridades; la información nunca se pierde
// por el ritmo: lo que se retrasa o se resume sigue visible en Importantes y en el historial.
//  - P0 (errores que impiden actuar, conexión perdida): inmediato y asertivo; el mismo mensaje no se repite dentro de 5 s.
//  - P1 (lo que te concierne): cola educada, de uno en uno y dosificada por duración de lectura; solo se agrupan eventos
//    iguales y seguidos; NUNCA se descarta en silencio: si se acumulan más de 4 se anuncia un resumen y se vacía la cola.
//  - P2 (rutina): sin anuncio automático; con «completos», un resumen periódico, nunca línea a línea.
// Modelo puro: el reloj lo mueve quien lo usa (`tick(now)`).

export type Verbosity = "minimos" | "normales" | "completos";

export interface Speaker {
  /** Asertivo (`role="alert"`): interrumpe. */
  alert(text: string): void;
  /** Educado (`aria-live="polite"`): no interrumpe. */
  polite(text: string): void;
}

export interface AnnouncerOptions {
  speaker: Speaker;
  verbosity?: Verbosity;
  dupWindowMs?: number;
  /** Con más elementos en cola que esto se anuncia un resumen. */
  summaryAfter?: number;
  p2SummaryMs?: number;
  /** Tiempo estimado de lectura de un texto (dosifica la cola). */
  readMs?: (text: string) => number;
}

export const defaultReadMs = (text: string) => 1000 + 40 * text.length;

const P2_LABEL: Partial<Record<EventKind, [string, string]>> = {
  recoleccion: ["recolección", "recolecciones"], deposito: ["depósito", "depósitos"], aporte: ["aporte", "aportes"],
  fabricacion: ["fabricación", "fabricaciones"], construccion: ["construcción", "construcciones"], mundo: ["novedad del mundo", "novedades del mundo"],
};

interface QueueItem {
  ids: number[];
  text: string;
  group?: { key: string; amount: number; text: (total: number) => string };
}

export interface AnnouncerStats {
  spoken: number;
  deduplicated: number;
  silenced: number;
  queued: number;
}

export function createAnnouncer(options: AnnouncerOptions) {
  const { speaker } = options;
  const dupWindow = options.dupWindowMs ?? 5000;
  const summaryAfter = options.summaryAfter ?? 4;
  const p2Every = options.p2SummaryMs ?? 10_000;
  const readMs = options.readMs ?? defaultReadMs;
  let verbosity: Verbosity = options.verbosity ?? "normales";

  const queue: QueueItem[] = [];
  const handled = new Set<number>();
  const lastAlert = new Map<string, number>();
  const p2 = new Map<EventKind, number>();
  let p2Since = 0;
  let nextFreeAt = 0;
  const stats: AnnouncerStats = { spoken: 0, deduplicated: 0, silenced: 0, queued: 0 };

  const say = (kind: "alert" | "polite", text: string, now: number, dwell = true) => {
    speaker[kind](text);
    stats.spoken++;
    if (dwell && kind === "polite") nextFreeAt = now + readMs(text);
  };

  return {
    setVerbosity(v: Verbosity) { verbosity = v; },
    verbosity: () => verbosity,

    push(event: GameEvent, now: number = event.at) {
      if (handled.has(event.id)) return; // nada se anuncia dos veces
      handled.add(event.id);
      if (event.priority === 0) {
        const key = event.key ?? event.text;
        const last = lastAlert.get(key);
        if (last !== undefined && now - last < dupWindow) { stats.deduplicated++; return; }
        lastAlert.set(key, now);
        say("alert", event.text, now, false);
        return;
      }
      if (event.priority === 1) {
        if (verbosity === "minimos") { stats.silenced++; return; }
        const tail = queue.at(-1);
        if (tail?.group && event.group && tail.group.key === event.group.key) {
          // Agrupación: solo de eventos iguales y seguidos que aún no se han anunciado.
          tail.group.amount += event.group.amount;
          tail.text = event.group.text(tail.group.amount);
          tail.ids.push(event.id);
        } else {
          queue.push({ ids: [event.id], text: event.group ? event.group.text(event.group.amount) : event.text, ...(event.group ? { group: { ...event.group } } : {}) });
        }
        stats.queued = queue.length;
        return;
      }
      if (verbosity === "completos") {
        if (p2.size === 0) p2Since = now;
        p2.set(event.kind, (p2.get(event.kind) ?? 0) + 1);
      } else stats.silenced++;
    },

    /** Avanza el reloj: anuncia el siguiente elemento de la cola si ya ha pasado el tiempo de lectura del anterior. */
    tick(now: number) {
      if (now < nextFreeAt) return;
      if (queue.length > summaryAfter) {
        const items = queue.splice(0, queue.length);
        const shown = items.slice(0, 3).map((i) => i.text).join("; ");
        const more = items.length - 3;
        say("polite", `Tienes ${items.length} novedades importantes: ${shown}${more > 0 ? ` y ${more} más` : ""}. Están en Importantes.`, now);
        stats.queued = 0;
        return;
      }
      const item = queue.shift();
      if (item) { say("polite", item.text, now); stats.queued = queue.length; return; }
      if (verbosity === "completos" && p2.size > 0 && now - p2Since >= p2Every) {
        const parts = [...p2.entries()].map(([kind, n]) => { const label = P2_LABEL[kind] ?? ["novedad", "novedades"]; return `${n} ${n === 1 ? label[0] : label[1]}`; });
        p2.clear();
        say("polite", `Mientras tanto: ${parts.join(", ")}.`, now);
      }
    },

    stats: (): AnnouncerStats => ({ ...stats, queued: queue.length }),
    queueLength: () => queue.length,
  };
}

export type Announcer = ReturnType<typeof createAnnouncer>;
