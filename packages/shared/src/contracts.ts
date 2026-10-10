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
  createProject: "create-project",
  closeProject: "close-project",
  createMission: "create-mission",
  rejected: "rejected",
} as const;

/** Vistas desde las que se entra: el mundo (con personaje) o el panel profesional (sin personaje). */
export const VIEWS = ["mundo", "panel"] as const;
export type View = (typeof VIEWS)[number];

export interface JoinOptions {
  /** Token de sesión de la cuenta (M6). Va en las opciones, no en la URL; el nombre sale de la cuenta. */
  token: string;
  /** Por defecto "mundo". */
  view?: View;
}

/** Cuentas locales (M6, Q165): datos mínimos (nombre y contraseña) y declaración de mayoría de edad. */
export interface RegisterRequest {
  name: string;
  password: string;
  adult: boolean;
}

export interface LoginRequest {
  name: string;
  password: string;
}

/** Respuesta correcta de registro o inicio de sesión. */
export interface SessionResponse {
  token: string;
  name: string;
}

export type AccountError =
  | "nombre-invalido"
  | "contrasena-invalida"
  | "edad-no-declarada"
  | "nombre-ocupado"
  | "credenciales-invalidas"
  | "demasiados-intentos"
  | "solicitud-invalida";

export const ACCOUNT_ERROR_TEXT: Record<AccountError, string> = {
  "nombre-invalido": "Nombre no válido: usa de 1 a 20 letras, números, guion o guion bajo.",
  "contrasena-invalida": "La contraseña debe tener entre 8 y 128 caracteres.",
  "edad-no-declarada": "Para crear una cuenta debes declarar que eres mayor de edad.",
  "nombre-ocupado": "Ese nombre ya tiene cuenta. Elige otro o entra con tu contraseña.",
  "credenciales-invalidas": "Nombre o contraseña incorrectos.",
  "demasiados-intentos": "Demasiados intentos fallidos. Espera 30 segundos y vuelve a probar.",
  "solicitud-invalida": "Solicitud no válida.",
};

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function isValidPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;
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

/** Tarea de un proyecto creado desde el panel (F1a): una por recurso. */
export interface NewTask {
  title: string;
  resource: string;
  required: number;
  /** Criterio legible; por defecto «Aportar N de X». */
  acceptance?: string;
}

/** Crear un proyecto desde el panel (solo administración, Q171). Queda publicado e inmutable (Q172). */
export interface CreateProjectMessage {
  requestId: string;
  name: string;
  description: string;
  tasks: NewTask[];
  /** Por defecto, quien lo crea. */
  coordinators?: string[];
  /** Completar exige todas las tareas aprobadas. */
  requiresApproval?: boolean;
}

export interface CloseProjectMessage {
  requestId: string;
  projectId: string;
}

/** Crear una misión desde el panel (Q174). */
export interface CreateMissionMessage {
  requestId: string;
  name: string;
  description: string;
  objective: { kind: "project-completed"; project: string } | { kind: "item-in-community"; item: string; amount: number };
}

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
  | "tareas-sin-aprobar"
  | "demasiadas-solicitudes"
  | "proyecto-desconocido"
  | "proyecto-cerrado"
  | "proyecto-de-serie"
  | "demasiados-proyectos"
  | "demasiadas-misiones"
  | "definicion-invalida";

export interface RejectedMessage {
  reason: RejectReason;
  /** Detalle legible (p. ej. qué campos de una definición no son válidos). */
  details?: string[];
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
  "demasiadas-solicitudes": "Demasiadas acciones seguidas; espera un momento.",
  "proyecto-desconocido": "Ese proyecto no existe.",
  "proyecto-cerrado": "Ese proyecto está cerrado: ya no admite aportes.",
  "proyecto-de-serie": "Los proyectos de la configuración del mundo no se cierran desde el panel.",
  "demasiados-proyectos": "Hay demasiados proyectos abiertos (máximo 20). Cierra alguno antes de crear otro.",
  "demasiadas-misiones": "Hay demasiadas misiones (máximo 50).",
  "definicion-invalida": "La definición no es válida; revisa los campos indicados.",
};

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

export function isValidRequestId(id: unknown): id is string {
  return typeof id === "string" && REQUEST_ID.test(id);
}

export const NAME_PATTERN = /^[\p{L}\p{N}_-]{1,20}$/u;

/** Motivos de rechazo al entrar, traducidos para la persona. */
export function joinErrorText(message: string): string {
  if (message.includes("sesion-invalida")) return "Tu sesión no es válida o ha caducado. Vuelve a entrar.";
  if (message.includes("nombre-en-uso")) return "Ya estás dentro con esta cuenta en otra pestaña o equipo.";
  if (message.includes("nombre-invalido")) return "Nombre no válido: usa de 1 a 20 letras, números, guion o guion bajo.";
  if (message.includes("mundo-lleno") || message.includes("no rooms found")) return `El mundo está lleno (máximo ${MAX_PLAYERS} jugadores). Inténtalo más tarde.`;
  return `No se pudo entrar en el mundo (${message}).`;
}

export function isValidName(name: unknown): name is string {
  return typeof name === "string" && NAME_PATTERN.test(name);
}
