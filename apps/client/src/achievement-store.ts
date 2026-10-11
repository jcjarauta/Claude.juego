import { CATALOG, CATALOG_VERSION, SUPERSEDED } from "@juego/shared";

// Almacén local de los logros (G3d, Q233, Q235, Q236). Por cuenta y mundo; nada se envía al servidor.
// Lectura tolerante (datos corruptos = almacén vacío, nunca una excepción), versionado (`schemaVersion` con migraciones
// explícitas) y sin sobrescribir una versión posterior a la conocida. Lo que guarda es un REGISTRO DE ESTE NAVEGADOR: no es un logro
// histórico global verificado.
//
// Cinco partes:
//  - vistos: ids que este navegador vio conseguidos alguna vez (base del «registro de este navegador»).
//  - notificados: ya se celebraron (evita repetir).
//  - consultados: la persona los marcó como vistos (abrir la pestaña NO los marca).
//  - preexistentes: ya estaban conseguidos en la primera visita (no se celebran y no cuentan en la insignia).
//  - libro: lo que el estado no guarda (enseñar y aprender), contado de los `teach-result` vistos aquí.

export const SCHEMA_VERSION = 1;

export interface AchievementStore {
  schemaVersion: number;
  catalogVersion: number;
  /** Falso hasta la primera evaluación (la «primera visita»). */
  initialized: boolean;
  vistos: string[];
  notificados: string[];
  consultados: string[];
  preexistentes: string[];
  /** Ids reemplazados o retirados que se encontraron en lo guardado: no heredan estado. */
  retirados: string[];
  libro: { ensenado: number; aprendido: number };
}

export interface ParsedStore {
  store: AchievementStore;
  /** La versión guardada es posterior a la conocida: se lee, pero no se escribe encima. */
  readOnly: boolean;
}

export const emptyStore = (): AchievementStore => ({
  schemaVersion: SCHEMA_VERSION, catalogVersion: CATALOG_VERSION, initialized: false,
  vistos: [], notificados: [], consultados: [], preexistentes: [], retirados: [], libro: { ensenado: 0, aprendido: 0 },
});

/** Migración de una versión a la siguiente, sobre el objeto leído (puro). */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export interface ParseOptions {
  schema?: number;
  migrations?: Readonly<Record<number, Migration>>;
  superseded?: Readonly<Record<string, string | null>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80))] : []);
const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000 ? (v as number) : 0);

/**
 * Convierte lo leído del almacenamiento en un almacén válido. Acepta cualquier versión conocida y la migra en memoria; los ids
 * desconocidos se conservan (sin mostrarse); un id reemplazado NO hereda el estado del anterior; una versión posterior se lee sin
 * permitir escribir.
 */
export function parseStore(raw: unknown, options: ParseOptions = {}): ParsedStore {
  const schema = options.schema ?? SCHEMA_VERSION;
  const superseded = options.superseded ?? SUPERSEDED;
  let data: unknown = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch { return { store: emptyStore(), readOnly: false }; }
  }
  if (!isRecord(data)) return { store: emptyStore(), readOnly: false };
  const stored = Number.isInteger(data.schemaVersion) ? (data.schemaVersion as number) : 1;
  const readOnly = stored > schema;
  let current: Record<string, unknown> = data;
  if (!readOnly) {
    for (let v = stored; v < schema; v++) {
      const step = options.migrations?.[v];
      if (step) { try { current = step(current); } catch { return { store: emptyStore(), readOnly: false }; } }
    }
  }
  const retired = new Set(Object.keys(superseded));
  const keep = (v: unknown) => strings(v).filter((id) => !retired.has(id));
  const dropped = [...new Set([...strings(current.vistos), ...strings(current.notificados), ...strings(current.consultados), ...strings(current.preexistentes), ...strings(current.retirados)].filter((id) => retired.has(id)))];
  const libro = isRecord(current.libro) ? current.libro : {};
  return {
    store: {
      schemaVersion: readOnly ? stored : schema,
      catalogVersion: Number.isInteger(current.catalogVersion) ? (current.catalogVersion as number) : CATALOG_VERSION,
      initialized: current.initialized === true,
      vistos: keep(current.vistos), notificados: keep(current.notificados), consultados: keep(current.consultados), preexistentes: keep(current.preexistentes),
      retirados: dropped, libro: { ensenado: count(libro.ensenado), aprendido: count(libro.aprendido) },
    },
    readOnly,
  };
}

export const serializeStore = (store: AchievementStore): string => JSON.stringify(store);
export const achievementKey = (world: string, account: string) => `engremiat.logros.${world}.${account}`;

export function loadStore(key: string, storage: Pick<Storage, "getItem"> | undefined = safe(), options?: ParseOptions): ParsedStore {
  try { return parseStore(storage?.getItem(key), options); } catch { return { store: emptyStore(), readOnly: false }; }
}

/** Guarda; devuelve false si es solo lectura (versión posterior) o el almacenamiento no está disponible. */
export function saveStore(key: string, parsed: ParsedStore, storage: Pick<Storage, "setItem"> | undefined = safe()): boolean {
  if (parsed.readOnly) return false;
  try {
    if (!storage) return false;
    storage.setItem(key, serializeStore(parsed.store));
    return true;
  } catch { return false; }
}

function safe(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

// ---------------------------------------------------------------- lógica pura sobre el almacén

const add = (list: readonly string[], ids: readonly string[]) => [...new Set([...list, ...ids])];

export interface Applied {
  store: AchievementStore;
  /** Logros que acaban de pasar a conseguidos y no son de la primera visita (P2 los celebra). */
  nuevos: string[];
}

/**
 * Aplica lo conseguido ahora (ids con evidencia en el estado). En la PRIMERA visita lo existente pasa a vistos, notificados y
 * preexistentes (sin celebrar y SIN marcar como consultado); después, lo que no estaba notificado es nuevo.
 */
export function applyAchieved(store: AchievementStore, achieved: readonly string[]): Applied {
  const live = achieved.filter((id) => !(id in SUPERSEDED));
  if (!store.initialized) {
    return { store: { ...store, initialized: true, vistos: add(store.vistos, live), notificados: add(store.notificados, live), preexistentes: add(store.preexistentes, live) }, nuevos: [] };
  }
  const nuevos = live.filter((id) => !store.notificados.includes(id));
  return { store: { ...store, vistos: add(store.vistos, live), notificados: add(store.notificados, nuevos) }, nuevos };
}

const catalogIds = () => new Set(CATALOG.map((d) => d.id));

/** «Nuevos»: notificados, no preexistentes y aún no consultados (solo ids del catálogo actual). */
export function newOnes(store: AchievementStore): string[] {
  const known = catalogIds();
  return store.notificados.filter((id) => known.has(id) && !store.preexistentes.includes(id) && !store.consultados.includes(id));
}

/** «Ya conseguidos al empezar»: preexistentes del catálogo actual, consultados o no. */
export function startingOnes(store: AchievementStore): string[] {
  const known = catalogIds();
  return store.preexistentes.filter((id) => known.has(id));
}

/** La insignia de la pestaña cuenta SOLO los nuevos no consultados; los preexistentes nunca. */
export const badgeCount = (store: AchievementStore): number => newOnes(store).length;

export const markConsulted = (store: AchievementStore, ids: readonly string[]): AchievementStore => ({ ...store, consultados: add(store.consultados, ids) });
export const markStartingConsulted = (store: AchievementStore): AchievementStore => markConsulted(store, startingOnes(store));

/** Un reconocimiento local: has enseñado o te han enseñado (de un `teach-result` aceptado). */
export const addLocalRecognition = (store: AchievementStore, kind: "ensenado" | "aprendido"): AchievementStore => ({ ...store, libro: { ...store.libro, [kind]: store.libro[kind] + 1 } });
