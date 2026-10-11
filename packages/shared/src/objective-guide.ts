import { directionText, type Snapshot, type Step } from "./objective.ts";

// Guía (G3c, P3): «Qué hay cerca» (alternativa textual del mapa) y consejos por situación. Modelo puro, sin DOM.

export const NEARBY_RADIUS = 8;

export interface NearbyEntry {
  kind: "edificio" | "recurso" | "persona";
  label: string;
  /** Distancia en casillas (diagonales incluidas). */
  distance: number;
  /** «3 casillas al este y 1 al norte», «estás aquí» o «estás dentro». */
  direction: string;
}

export interface Nearby {
  /** Siempre presente si hay destino activo, aunque esté fuera del radio. */
  destination?: { label: string; text: string; distance: number; outsideRadius: boolean };
  entries: NearbyEntry[];
}

const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const KIND_ORDER = { edificio: 0, recurso: 1, persona: 2 } as const;

/** Lo que hay a `radius` casillas o menos, ordenado por cercanía (empates: edificios, recursos, personas, y por nombre). */
export function nearby(s: Snapshot, target?: { x: number; y: number; label: string }, radius = NEARBY_RADIUS): Nearby {
  const me = s.me;
  const entries: NearbyEntry[] = [];
  const add = (kind: NearbyEntry["kind"], label: string, point: { x: number; y: number }) => {
    const distance = chebyshev(me, point);
    if (distance > radius) return;
    entries.push({ kind, label, distance, direction: distance === 0 ? "estás aquí" : directionText(me, point) });
  };
  for (const st of s.structures) {
    // Punto del edificio más cercano a ti (una casilla de su huella).
    const point = { x: Math.min(Math.max(me.x, st.def.x), st.def.x + st.def.width - 1), y: Math.min(Math.max(me.y, st.def.y), st.def.y + st.def.height - 1) };
    const inside = point.x === me.x && point.y === me.y;
    const distance = chebyshev(me, point);
    if (distance > radius) continue;
    entries.push({ kind: "edificio", label: `${st.def.name}${st.built ? "" : " (solar sin construir)"}`, distance, direction: inside ? "estás dentro" : directionText(me, point) });
  }
  for (const n of s.nodes) if (n.units > 0) add("recurso", `${s.resources[n.resource] ?? n.resource} (${n.units} ${n.units === 1 ? "unidad" : "unidades"})`, n);
  for (const o of s.others) if (o.connected) add("persona", o.name, o);
  entries.sort((a, b) => a.distance - b.distance || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label, "es"));

  let destination: Nearby["destination"];
  if (target) {
    const distance = chebyshev(me, target);
    destination = {
      label: target.label,
      distance,
      outsideRadius: distance > radius,
      text: me.x === target.x && me.y === target.y ? `${target.label}: estás en el destino.` : `${target.label}, a ${directionText(me, target)}${distance > radius ? " (fuera del radio de la lista)" : ""}.`,
    };
  }
  return { ...(destination ? { destination } : {}), entries };
}

/** Resumen corto para anunciar bajo demanda (tecla L): el destino y lo más cercano, sin saturar. */
export function nearbySummary(n: Nearby, max = 3): string {
  const parts: string[] = [];
  if (n.destination) parts.push(`Destino del objetivo: ${n.destination.text}`);
  const first = n.entries.slice(0, max);
  if (first.length === 0) parts.push("No hay nada a 8 casillas o menos.");
  else parts.push(`Cerca: ${first.map((e) => `${e.label}, ${e.direction}`).join("; ")}.`);
  if (n.entries.length > max) parts.push(`Hay ${n.entries.length - max} más en la pestaña Guía.`);
  return parts.join(" ");
}

export const STATUS_HELP = [
  "Disponible: según el último estado, puedes hacerlo ahora; el servidor tiene siempre la última palabra.",
  "Bloqueado: te falta algo concreto; el requisito dice qué y cómo resolverlo.",
  "Sin verificar: el cliente no puede asegurarlo (datos incompletos, un rechazo reciente o una decisión de otra persona).",
  "Completado: el objetivo ya se cumple.",
];

const has = (step: Step, prefix: string) => step.requirements.some((r) => r.code.startsWith(prefix));

/** Consejos por situación derivados del paso mostrado (más los generales). */
export function tipsFor(step: Step | undefined, s: Snapshot): string[] {
  const tips: string[] = [];
  if (!step) {
    tips.push("Elige un objetivo en la zona «Objetivo actual» (botón «Elegir objetivo»): la Guía te dirá el siguiente paso, qué falta y qué alternativas hay.");
  } else {
    if (step.type === "choose-route") tips.push("Hay varias formas de conseguirlo. Elige una: el objetivo recuerda tu elección y no cambia solo.");
    if (has(step, "sin-construir:")) tips.push("Un edificio sin construir se desbloquea completando las tareas de su proyecto (pestaña Proyecto) y construyéndolo estando junto al solar.");
    if (has(step, "habilidad:")) tips.push("Una habilidad se gana practicando una receta varias veces, por concesión de la administración o porque alguien con más nivel te la enseña (a 2 casillas o menos y con tu aceptación).");
    if (has(step, "sin-unidades:")) tips.push("Los recursos se regeneran con el tiempo: espera un poco o prueba otro nodo.");
    if (has(step, "inventario-lleno") || step.type === "deposit") tips.push("Fabricar usa el almacén de la comunidad, no tu inventario: deposita lo que lleves. También puedes aportarlo directamente a una tarea.");
    if (has(step, "dependencia:")) tips.push("Una tarea bloqueada se desbloquea al terminar las tareas de las que depende.");
    if (has(step, "edificio-desconocido:")) tips.push("La receta usa un edificio que no existe: avisa a la administración.");
    if (step.status === "NO_VERIFICADO") tips.push("«Sin verificar» no es un fallo tuyo: el estado puede estar cambiando. Vuelve a intentarlo cuando se actualice.");
    if (step.status === "BLOQUEADO" && step.requirements.length === 0) tips.push("Si un paso está bloqueado, el servidor te ha explicado el motivo: léelo en el requisito.");
    if (step.type === "go") tips.push("«Mostrar en el mapa» señala el destino sin mover tu personaje; Escape devuelve la vista.");
  }
  if (s.offers.length) tips.push("Tienes ofertas de enseñanza pendientes en Importantes. Aceptarlas no cambia tu objetivo.");
  tips.push("Los avisos (ofertas, novedades, errores) están en la consola; pulsa C para ir a ella. No cambian tu objetivo.");
  tips.push("Atajos: O objetivo, L lo que hay cerca, P proyecto, M mapa, C consola, ? ayuda.");
  return tips;
}
