import type { Objective } from "@juego/shared";

// Objetivo activo guardado en el navegador (G3c, Q224): local a la cuenta y al mundo; no se envía al servidor.
// Lectura tolerante: un valor ausente, corrupto o de forma desconocida es «sin objetivo». Nunca lanza.

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;

export function parseObjective(raw: unknown): Objective | undefined {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch { return undefined; }
  }
  if (typeof data !== "object" || data === null) return undefined;
  const o = data as Record<string, unknown>;
  const route = str(o.route) ? { route: o.route } : {};
  if (o.kind === "mission" && str(o.id)) return { kind: "mission", id: o.id, ...route };
  if (o.kind === "task" && str(o.project) && str(o.task)) return { kind: "task", project: o.project, task: o.task, ...route };
  if (o.kind === "item" && str(o.item) && Number.isInteger(o.amount) && (o.amount as number) >= 1 && (o.amount as number) <= 1000) return { kind: "item", item: o.item, amount: o.amount as number, ...route };
  if (o.kind === "skill" && str(o.skill) && Number.isInteger(o.level) && (o.level as number) >= 1 && (o.level as number) <= 50) return { kind: "skill", skill: o.skill, level: o.level as number, ...route };
  return undefined;
}

export const objectiveKey = (world: string, account: string) => `engremiat.objetivo.${world}.${account}`;

export function loadObjective(key: string, storage: Pick<Storage, "getItem"> | undefined = safe()): Objective | undefined {
  try { return parseObjective(storage?.getItem(key)); } catch { return undefined; }
}

/** Guarda (o borra si `objective` es undefined). Devuelve false si el almacenamiento no está disponible. */
export function saveObjective(key: string, objective: Objective | undefined, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safe()): boolean {
  try {
    if (!storage) return false;
    if (objective) storage.setItem(key, JSON.stringify(objective)); else storage.removeItem(key);
    return true;
  } catch { return false; }
}

function safe(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}
