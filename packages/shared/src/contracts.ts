// Contratos de comunicación entre cliente y servidor.
// Cualquier cambio aquí debe compilar en ambos lados (npm.cmd run typecheck).

export const ROOM_NAME = "world";

/** Jugadores simultáneos en el mundo del MVP (Q134). */
export const MAX_PLAYERS = 4;
/** Paneles profesionales conectados a la vez (observadores sin personaje, M5b). */
export const MAX_PANELS = 4;

export const MESSAGE = {
  move: "move",
  collect: "collect",
  transfer: "transfer",
  contribute: "contribute",
  news: "news",
  build: "build",
  craft: "craft",
  review: "review",
  rejected: "rejected",
} as const;

/** Vistas desde las que se entra: el mundo (con personaje) o el panel profesional (sin personaje). */
export const VIEWS = ["mundo", "panel"] as const;
export type View = (typeof VIEWS)[number];

export interface JoinOptions {
  name: string;
  /** Por defecto "mundo". */
  view?: View;
}

/** Un paso ortogonal de una casilla: exactamente uno de dx, dy vale -1 o 1. */
export interface MoveMessage {
  dx: number;
  dy: number;
}

/**
 * Recolectar junto al jugador. requestId lo genera el cliente: si el mismo
 * identificador llega dos veces (reintento, duplicado), solo cuenta una vez.
 */
export interface CollectMessage {
  requestId: string;
}

/** Ámbitos a los que un jugador puede transferir desde su inventario (M3: comunidad). */
export const TRANSFER_TARGETS = ["community"] as const;
export type TransferTarget = (typeof TRANSFER_TARGETS)[number];

export interface TransferMessage {
  requestId: string;
  resource: string;
  amount: number;
  to: TransferTarget;
}

/** Orígenes desde los que se puede aportar a un proyecto (Q152). */
export const CONTRIBUTION_SOURCES = ["player", "community"] as const;
export type ContributionSource = (typeof CONTRIBUTION_SOURCES)[number];

export interface ContributeMessage {
  requestId: string;
  projectId: string;
  taskId: string;
  from: ContributionSource;
  amount: number;
}

/** Aporte de otro jugador desde la última visita (colaboración asíncrona, RF-013). */
export interface NewsItem {
  name: string;
  projectId: string;
  taskId: string;
  resource: string;
  amount: number;
  at: number;
}

/** Mensaje privado al entrar: qué ha pasado mientras no estabas. */
export interface NewsMessage {
  /** Última salida del jugador; null si es su primera visita. */
  since: number | null;
  items: NewsItem[];
}

export interface BuildMessage {
  requestId: string;
  structureId: string;
}

export interface CraftMessage {
  requestId: string;
  recipeId: string;
}

/** Revisión de una tarea completada por un coordinador (M5b, Q161). */
export const REVIEW_DECISIONS = ["aprobada", "rechazada"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const NOTE_MAX = 500;

export interface ReviewMessage {
  requestId: string;
  projectId: string;
  taskId: string;
  decision: ReviewDecision;
  /** Motivo o comentario: 1–500 caracteres. */
  note: string;
}

export type RejectReason =
  | "movimiento-invalido"
  | "movimiento-demasiado-rapido"
  | "fuera-del-mapa"
  | "casilla-bloqueada"
  | "mensaje-desconocido"
  | "solicitud-invalida"
  | "recoleccion-demasiado-rapida"
  | "nodo-lejos"
  | "nodo-agotado"
  | "inventario-lleno"
  | "saldo-insuficiente"
  | "destino-no-permitido"
  | "tarea-desconocida"
  | "tarea-completa"
  | "origen-no-permitido"
  | "estructura-desconocida"
  | "receta-desconocida"
  | "proyecto-sin-terminar"
  | "ya-construido"
  | "lejos-del-solar"
  | "solar-ocupado"
  | "taller-sin-construir"
  | "lejos-del-taller"
  | "faltan-materiales"
  | "sin-permiso"
  | "tarea-sin-completar"
  | "nota-invalida"
  | "sin-personaje"
  | "tareas-sin-aprobar";

export interface RejectedMessage {
  reason: RejectReason;
}

export const REJECT_TEXT: Record<RejectReason, string> = {
  "movimiento-invalido": "Movimiento no válido.",
  "movimiento-demasiado-rapido": "Más despacio.",
  "fuera-del-mapa": "Has llegado al borde del mundo.",
  "casilla-bloqueada": "Hay algo en el camino.",
  "mensaje-desconocido": "Acción desconocida.",
  "solicitud-invalida": "Acción no válida.",
  "recoleccion-demasiado-rapida": "Espera un momento antes de volver a recolectar.",
  "nodo-lejos": "No hay ningún recurso a tu lado.",
  "nodo-agotado": "Este recurso está agotado; se regenerará con el tiempo.",
  "inventario-lleno": "No puedes llevar más de este recurso. Deposítalo en la comunidad.",
  "saldo-insuficiente": "No tienes suficiente cantidad.",
  "destino-no-permitido": "No se puede transferir ahí.",
  "tarea-desconocida": "Esa tarea no existe.",
  "tarea-completa": "Esa tarea ya está completa.",
  "origen-no-permitido": "No se puede aportar desde ahí.",
  "estructura-desconocida": "Esa construcción no existe.",
  "receta-desconocida": "Esa receta no existe.",
  "proyecto-sin-terminar": "Antes hay que completar todas las tareas del proyecto.",
  "ya-construido": "Ya está construido.",
  "lejos-del-solar": "Acércate al solar del taller para construir.",
  "solar-ocupado": "Hay alguien dentro del solar; que salga antes de construir.",
  "taller-sin-construir": "Primero hay que construir el taller.",
  "lejos-del-taller": "Acércate al taller para fabricar.",
  "faltan-materiales": "Faltan materiales en el almacén de la comunidad.",
  "sin-permiso": "No tienes permiso para esa acción en este proyecto.",
  "tarea-sin-completar": "Solo se puede revisar una tarea completada.",
  "nota-invalida": "Escribe una nota de 1 a 500 caracteres.",
  "sin-personaje": "Desde el panel no se puede actuar en el mundo; entra con tu personaje.",
  "tareas-sin-aprobar": "Un coordinador debe aprobar todas las tareas antes de construir.",
};

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

export function isValidRequestId(id: unknown): id is string {
  return typeof id === "string" && REQUEST_ID.test(id);
}

export const NAME_PATTERN = /^[\p{L}\p{N}_-]{1,20}$/u;

/** Motivos de rechazo al entrar, traducidos para la persona. */
export function joinErrorText(message: string): string {
  if (message.includes("nombre-en-uso")) return "Ese nombre ya está en uso en este mundo. Elige otro.";
  if (message.includes("nombre-invalido")) return "Nombre no válido: usa de 1 a 20 letras, números, guion o guion bajo.";
  if (message.includes("mundo-lleno") || message.includes("no rooms found")) return `El mundo está lleno (máximo ${MAX_PLAYERS} jugadores). Inténtalo más tarde.`;
  return `No se pudo entrar en el mundo (${message}).`;
}

export function isValidName(name: unknown): name is string {
  return typeof name === "string" && NAME_PATTERN.test(name);
}
