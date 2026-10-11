import type { MissionObjective } from "./world-config.ts";

// Logros (G3d, Q227–Q236). Modelo puro: sin DOM, sin red y sin reloj. Los logros VERIFICABLES se derivan del estado sincronizado y
// son iguales en cualquier navegador. Lo que solo consta en el almacenamiento local es un «registro de este navegador» (nunca un
// logro histórico global verificado) y los reconocimientos de enseñar y aprender son locales y van aparte (no están aquí).
//
// Diseño sin presión (Q229): ninguna función de este módulo ordena personas por cantidad; las personas se listan en orden
// alfabético y sin cifras. No hay rachas, plazos ni cuentas atrás.

export type AchievementGroup = "comunidad" | "personal" | "cooperacion";

/**
 * `historico`: hecho que el estado conserva mientras exista su evidencia (nivel de habilidad, totales aportados, misión
 * completada, edificio construido). `estado-actual`: condición que puede dejar de cumplirse (todos los elementos de un conjunto
 * están hechos AHORA). Nunca se presupone monotonía: el estado puede cambiar al añadir o retirar elementos.
 */
export type AchievementType = "historico" | "estado-actual";

export type AchievementStatus = "conseguido" | "en-progreso" | "pendiente";

// ---------------------------------------------------------------- instantánea

export interface AchievementSnapshot {
  me: { name: string; skills: Readonly<Record<string, number>>; crafts: Readonly<Record<string, number>> };
  /** Existencias del almacén común. */
  stock: Readonly<Record<string, number>>;
  structures: readonly { id: string; name: string; origin: string; built: boolean; builtBy: string; projectId: string }[];
  missions: readonly { id: string; name: string; origin: string; createdBy: string; completed: boolean; completedBy: string; objective: MissionObjective }[];
  projects: readonly {
    id: string;
    name: string;
    origin: string;
    createdBy: string;
    closed: boolean;
    /** Aportado por persona (suma de todos sus recursos). */
    contributors: Readonly<Record<string, number>>;
    tasks: readonly { resource: string; required: number; contributed: number }[];
  }[];
  skills: readonly { id: string; name: string; levels: readonly string[] }[];
}

/** Origen de los elementos de la configuración inicial: el conjunto cerrado sobre el que se definen los «todos los…». */
export const INITIAL_ORIGIN = "configuracion";

// ---------------------------------------------------------------- reconocimiento por papeles (Q229)

/** Quién creó, quién ejecutó la acción final y quiénes aportaron: tres papeles distintos. */
export interface CreditLine {
  what: string;
  creadoPor?: string;
  ejecutadoPor?: string;
  /** Orden alfabético; sin cifras. */
  aportaron: string[];
  /** Límite de lo que el estado permite afirmar. */
  nota?: string;
}

const collator = new Intl.Collator("es");
/** Orden alfabético (nunca por cantidad). */
export const alphabetical = (names: Iterable<string>): string[] => [...new Set(names)].filter((n) => n !== "").sort(collator.compare);
const list = (names: readonly string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`);

/** Texto de un reconocimiento. La última acción nunca se presenta como el trabajo de una sola persona. */
export function creditText(line: CreditLine, executed: string): string {
  const parts: string[] = [];
  if (line.creadoPor) parts.push(`Creado por ${line.creadoPor}.`);
  const names = line.aportaron;
  if (line.ejecutadoPor && names.length) parts.push(`${executed} por ${line.ejecutadoPor} con la aportación de ${list(names)}.`);
  // Con una nota que ya dice que el estado no registra todas las aportaciones no se repite el mismo límite.
  else if (line.ejecutadoPor) parts.push(line.nota ? `${executed} por ${line.ejecutadoPor}.` : `${executed} por ${line.ejecutadoPor}; el estado no registra otras aportaciones.`);
  else if (names.length) parts.push(`Aportaron ${list(names)}.`);
  else parts.push("El estado no registra quiénes aportaron.");
  if (line.nota) parts.push(line.nota);
  return `${line.what}: ${parts.join(" ")}`;
}

// ---------------------------------------------------------------- catálogo versionado (Q236)

export const CATALOG_VERSION = 1;

export interface Evaluation {
  achieved: boolean;
  progress?: { done: number; total: number };
  credits?: CreditLine[];
  /** El conjunto sobre el que se define (p. ej. «del conjunto inicial»). */
  set?: string;
}

export interface AchievementDef {
  /** Id estable con la versión de su CONDICIÓN (`nombre@1`). Si la condición cambia se crea otro id; jamás se reutiliza. */
  id: string;
  name: string;
  description: string;
  group: AchievementGroup;
  type: AchievementType;
  /** Código estable de la condición: una prueba congela la tabla id → condición para detectar cambios sin cambiar de id. */
  condition: string;
  evaluate(s: AchievementSnapshot): Evaluation;
}

/** Ids retirados o reemplazados: `"x@1": "x@2"` (la condición cambió) o `null` (se eliminó). Un id retirado no vuelve a usarse. */
export const SUPERSEDED: Readonly<Record<string, string | null>> = {};

const ownTotal = (s: AchievementSnapshot) => s.projects.reduce((n, p) => n + (p.contributors[s.me.name] ?? 0), 0);
const projectOf = (s: AchievementSnapshot, id: string) => s.projects.find((p) => p.id === id);
const contributorsOf = (p: AchievementSnapshot["projects"][number] | undefined) => alphabetical(Object.entries(p?.contributors ?? {}).filter(([, n]) => n > 0).map(([name]) => name));
const maxLevel = (s: AchievementSnapshot) => Math.max(0, ...Object.values(s.me.skills));
const crafts = (s: AchievementSnapshot) => Object.values(s.me.crafts).reduce((n, c) => n + c, 0);
const atLeast = (done: number, total: number): Evaluation => ({ achieved: done >= total, progress: { done: Math.min(done, total), total } });

const builtLine = (s: AchievementSnapshot, st: AchievementSnapshot["structures"][number]): CreditLine => {
  const p = projectOf(s, st.projectId);
  return { what: st.name, ...(p?.createdBy ? { creadoPor: p.createdBy } : {}), ...(st.builtBy ? { ejecutadoPor: st.builtBy } : {}), aportaron: contributorsOf(p) };
};

const missionLine = (s: AchievementSnapshot, m: AchievementSnapshot["missions"][number]): CreditLine => {
  const project = m.objective.kind === "project-completed" ? projectOf(s, m.objective.project) : undefined;
  return {
    what: m.name, ...(m.createdBy ? { creadoPor: m.createdBy } : {}), ...(m.completedBy ? { ejecutadoPor: m.completedBy } : {}),
    aportaron: contributorsOf(project),
    // Una misión de objeto no guarda quién aportó cada unidad: se dice, no se atribuye a quien hizo la última acción.
    ...(m.objective.kind === "item-in-community" ? { nota: "El estado no registra todas las aportaciones de esta misión." } : {}),
  };
};

const byName = <T extends { name: string }>(items: readonly T[]) => [...items].sort((a, b) => collator.compare(a.name, b.name));

export const CATALOG: readonly AchievementDef[] = [
  // ---- comunidad
  {
    id: "primer-edificio@1", name: "Primer edificio", description: "La comunidad ha construido un edificio.", group: "comunidad", type: "historico", condition: "estructuras-construidas>=1",
    evaluate: (s) => { const built = byName(s.structures.filter((x) => x.built)); return { achieved: built.length >= 1, credits: built.map((x) => builtLine(s, x)) }; },
  },
  {
    id: "edificios-iniciales@1", name: "Edificios del conjunto inicial", description: "Todos los edificios de la configuración inicial están construidos ahora.", group: "comunidad", type: "estado-actual", condition: "estructuras-origen-configuracion-construidas=todas",
    evaluate: (s) => {
      const set = s.structures.filter((x) => x.origin === INITIAL_ORIGIN);
      const done = set.filter((x) => x.built);
      return { achieved: set.length > 0 && done.length === set.length, progress: { done: done.length, total: set.length }, set: "conjunto inicial", credits: byName(done).map((x) => builtLine(s, x)) };
    },
  },
  {
    id: "primera-mision@1", name: "Primera misión", description: "La comunidad ha completado una misión.", group: "comunidad", type: "historico", condition: "misiones-completadas>=1",
    evaluate: (s) => { const done = byName(s.missions.filter((m) => m.completed)); return { achieved: done.length >= 1, credits: done.map((m) => missionLine(s, m)) }; },
  },
  {
    id: "misiones-iniciales@1", name: "Misiones del conjunto inicial", description: "Todas las misiones de la configuración inicial están completadas ahora.", group: "comunidad", type: "estado-actual", condition: "misiones-origen-configuracion-completadas=todas",
    evaluate: (s) => {
      const set = s.missions.filter((m) => m.origin === INITIAL_ORIGIN);
      const done = set.filter((m) => m.completed);
      return { achieved: set.length > 0 && done.length === set.length, progress: { done: done.length, total: set.length }, set: "conjunto inicial", credits: byName(done).map((m) => missionLine(s, m)) };
    },
  },
  {
    id: "proyecto-colectivo@1", name: "Proyecto de muchas manos", description: "Tres o más personas han aportado a un mismo proyecto.", group: "comunidad", type: "historico", condition: "proyecto-con>=3-contribuyentes",
    evaluate: (s) => {
      const many = byName(s.projects.filter((p) => contributorsOf(p).length >= 3));
      const best = Math.max(0, ...s.projects.map((p) => contributorsOf(p).length));
      return { achieved: many.length >= 1, progress: { done: Math.min(best, 3), total: 3 }, credits: many.map((p) => ({ what: p.name, ...(p.createdBy ? { creadoPor: p.createdBy } : {}), aportaron: contributorsOf(p) })) };
    },
  },
  // ---- progreso personal
  { id: "primera-habilidad@1", name: "Primera habilidad", description: "Has conseguido el primer nivel de una habilidad.", group: "personal", type: "historico", condition: "nivel-habilidad-propio>=1", evaluate: (s) => atLeast(maxLevel(s), 1) },
  { id: "segundo-nivel@1", name: "Segundo nivel", description: "Has llegado al segundo nivel de una habilidad.", group: "personal", type: "historico", condition: "nivel-habilidad-propio>=2", evaluate: (s) => atLeast(maxLevel(s), 2) },
  {
    id: "nivel-maximo@1", name: "Nivel máximo", description: "Has llegado al último nivel de una habilidad.", group: "personal", type: "historico", condition: "nivel-habilidad-propio=ultimo",
    evaluate: (s) => {
      const top = s.skills.filter((k) => k.levels.length > 0 && (s.me.skills[k.id] ?? 0) >= k.levels.length);
      return { achieved: top.length > 0 };
    },
  },
  { id: "primer-aporte@1", name: "Primer aporte", description: "Has aportado a un proyecto.", group: "personal", type: "historico", condition: "unidades-aportadas-propias>=1", evaluate: (s) => atLeast(ownTotal(s), 1) },
  { id: "aportes-10@1", name: "10 unidades aportadas", description: "Has aportado 10 unidades a los proyectos.", group: "personal", type: "historico", condition: "unidades-aportadas-propias>=10", evaluate: (s) => atLeast(ownTotal(s), 10) },
  { id: "aportes-50@1", name: "50 unidades aportadas", description: "Has aportado 50 unidades a los proyectos.", group: "personal", type: "historico", condition: "unidades-aportadas-propias>=50", evaluate: (s) => atLeast(ownTotal(s), 50) },
  { id: "aportes-100@1", name: "100 unidades aportadas", description: "Has aportado 100 unidades a los proyectos.", group: "personal", type: "historico", condition: "unidades-aportadas-propias>=100", evaluate: (s) => atLeast(ownTotal(s), 100) },
  { id: "primera-practica@1", name: "Primera práctica", description: "Has fabricado una receta de práctica.", group: "personal", type: "historico", condition: "fabricaciones-de-practica-propias>=1", evaluate: (s) => atLeast(crafts(s), 1) },
  { id: "practicas-10@1", name: "10 prácticas", description: "Has fabricado 10 veces recetas de práctica.", group: "personal", type: "historico", condition: "fabricaciones-de-practica-propias>=10", evaluate: (s) => atLeast(crafts(s), 10) },
  // ---- cooperación
  {
    id: "aporte-ajeno@1", name: "Un proyecto de otra persona", description: "Has aportado a un proyecto que creó otra persona.", group: "cooperacion", type: "historico", condition: "aporte-propio-a-proyecto-de-panel-creado-por-otra-persona",
    evaluate: (s) => {
      const others = byName(s.projects.filter((p) => p.origin !== INITIAL_ORIGIN && p.createdBy !== "" && p.createdBy !== s.me.name && (p.contributors[s.me.name] ?? 0) > 0));
      return { achieved: others.length >= 1, credits: others.map((p) => ({ what: p.name, creadoPor: p.createdBy, aportaron: contributorsOf(p) })) };
    },
  },
];

// ---------------------------------------------------------------- evaluación

/** Lo que el almacén local recuerda: ids que se vieron conseguidos alguna vez en este navegador (nunca es un logro verificado). */
export interface LocalRegistry {
  vistos: ReadonlySet<string>;
}

export interface AchievementState {
  id: string;
  name: string;
  description: string;
  group: AchievementGroup;
  type: AchievementType;
  status: AchievementStatus;
  progress?: { done: number; total: number };
  credits: CreditLine[];
  set?: string;
  /**
   * Solo si NO hay evidencia ahora y este navegador lo vio conseguido: «Registro de este navegador». No es un logro histórico
   * global verificado, no cuenta en los totales y no se atribuye a nadie.
   */
  localRecord: boolean;
}

export function evaluateAchievements(s: AchievementSnapshot, local: LocalRegistry = { vistos: new Set() }): AchievementState[] {
  return CATALOG.map((def) => {
    const e = def.evaluate(s);
    const status: AchievementStatus = e.achieved ? "conseguido" : e.progress && e.progress.done > 0 ? "en-progreso" : "pendiente";
    return {
      id: def.id, name: def.name, description: def.description, group: def.group, type: def.type, status,
      ...(e.progress ? { progress: e.progress } : {}), credits: e.achieved ? e.credits ?? [] : [], ...(e.set ? { set: e.set } : {}),
      localRecord: !e.achieved && local.vistos.has(def.id),
    };
  });
}

/** Totales de los logros VERIFICABLES (el registro local no cuenta). */
export function summarize(states: readonly AchievementState[]): { achieved: number; total: number } {
  return { achieved: states.filter((x) => x.status === "conseguido").length, total: states.length };
}

/** Ids de los logros conseguidos ahora (lo que el almacén local anota como «visto»). */
export const achievedIds = (states: readonly AchievementState[]): string[] => states.filter((x) => x.status === "conseguido").map((x) => x.id);

// ---------------------------------------------------------------- referencia de la comunidad (Q231)

export const REFERENCE_NOTE = "Referencia orientativa, calculada automáticamente: no es una decisión del equipo ni sustituye tu objetivo.";

export interface CommunityReference {
  label: string;
  progress?: { done: number; total: number };
  text: string;
  note: string;
}

/** La primera misión sin completar y su progreso, solo como referencia. */
export function communityReference(s: AchievementSnapshot): CommunityReference {
  const m = s.missions.find((x) => !x.completed);
  if (!m) return { label: "Sin referencia pendiente", text: "No hay misiones pendientes en la comunidad.", note: REFERENCE_NOTE };
  if (m.objective.kind === "item-in-community") {
    const have = s.stock[m.objective.item] ?? 0;
    const total = m.objective.amount;
    return { label: `Misión: ${m.name}`, progress: { done: Math.min(have, total), total }, text: `${Math.min(have, total)} de ${total} en las existencias del almacén.`, note: REFERENCE_NOTE };
  }
  const p = projectOf(s, m.objective.project);
  if (!p) return { label: `Misión: ${m.name}`, text: "El proyecto de esta misión no está disponible.", note: REFERENCE_NOTE };
  const total = p.tasks.reduce((n, t) => n + t.required, 0);
  const done = p.tasks.reduce((n, t) => n + Math.min(t.contributed, t.required), 0);
  return { label: `Misión: ${m.name}`, progress: { done, total }, text: `${done} de ${total} unidades aportadas al proyecto «${p.name}».`, note: REFERENCE_NOTE };
}

// ---------------------------------------------------------------- insignia de nivel (Q230)

/** Formas por número de niveles: la primera es siempre ▲ y la última ★; entre medias se reparten por posición. */
const SHAPES_BY_COUNT: Readonly<Record<number, readonly string[]>> = { 2: ["▲", "★"], 3: ["▲", "◆", "★"], 4: ["▲", "◆", "■", "★"] };
const SHAPES_MANY = ["▲", "◆", "■", "⬟", "★"] as const;

export interface LevelBadge {
  /** Forma: la insignia no depende del color. */
  shape: string;
  label: string;
}

/** Insignia de un nivel con forma y texto; las formas se reparten por posición entre los niveles de la habilidad. */
export function levelBadge(level: number, names: readonly string[]): LevelBadge {
  if (level <= 0 || names.length === 0) return { shape: "○", label: "○ Sin nivel" };
  const n = names.length;
  const i = Math.min(level, n) - 1;
  const shape = n === 1 ? "★" : SHAPES_BY_COUNT[n]?.[i] ?? SHAPES_MANY[Math.round((i * (SHAPES_MANY.length - 1)) / (n - 1))]!;
  return { shape, label: `${shape} ${names[i] ?? `Nivel ${level}`}` };
}
