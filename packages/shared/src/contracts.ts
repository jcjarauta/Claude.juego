// Contratos de comunicación entre cliente y servidor.
// Cualquier cambio aquí debe compilar en ambos lados (npm.cmd run typecheck).

export const ROOM_NAME = "world";

export const MESSAGE = {
  move: "move",
  rejected: "rejected",
} as const;

export interface JoinOptions {
  name: string;
}

/** Un paso ortogonal de una casilla: exactamente uno de dx, dy vale -1 o 1. */
export interface MoveMessage {
  dx: number;
  dy: number;
}

export type RejectReason =
  | "movimiento-invalido"
  | "movimiento-demasiado-rapido"
  | "fuera-del-mapa"
  | "casilla-bloqueada"
  | "mensaje-desconocido";

export interface RejectedMessage {
  reason: RejectReason;
}

export const REJECT_TEXT: Record<RejectReason, string> = {
  "movimiento-invalido": "Movimiento no válido.",
  "movimiento-demasiado-rapido": "Más despacio.",
  "fuera-del-mapa": "Has llegado al borde del mundo.",
  "casilla-bloqueada": "Hay algo en el camino.",
  "mensaje-desconocido": "Acción desconocida.",
};

export const NAME_PATTERN = /^[\p{L}\p{N}_-]{1,20}$/u;

export function isValidName(name: unknown): name is string {
  return typeof name === "string" && NAME_PATTERN.test(name);
}
