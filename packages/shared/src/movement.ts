import type { RejectReason } from "./contracts.ts";

export interface Position {
  x: number;
  y: number;
}

export interface MoveRules {
  width: number;
  height: number;
  isBlocked: (x: number, y: number) => boolean;
  cooldownMs: number;
}

export type MoveResult =
  | { ok: true; x: number; y: number }
  | { ok: false; reason: RejectReason };

const isUnit = (v: unknown) => v === -1 || v === 0 || v === 1;

/**
 * Regla autoritativa de movimiento: un paso ortogonal por mensaje.
 * Pura y determinista: el servidor la aplica; el cliente nunca decide.
 */
export function applyMove(
  from: Position,
  message: unknown,
  rules: MoveRules,
  lastMoveAt: number | undefined,
  now: number,
): MoveResult {
  if (typeof message !== "object" || message === null) return { ok: false, reason: "movimiento-invalido" };
  const { dx, dy } = message as Record<string, unknown>;
  if (!isUnit(dx) || !isUnit(dy) || Math.abs(dx as number) + Math.abs(dy as number) !== 1) {
    return { ok: false, reason: "movimiento-invalido" };
  }
  if (lastMoveAt !== undefined && now - lastMoveAt < rules.cooldownMs) {
    return { ok: false, reason: "movimiento-demasiado-rapido" };
  }
  const x = from.x + (dx as number);
  const y = from.y + (dy as number);
  if (x < 0 || y < 0 || x >= rules.width || y >= rules.height) return { ok: false, reason: "fuera-del-mapa" };
  if (rules.isBlocked(x, y)) return { ok: false, reason: "casilla-bloqueada" };
  return { ok: true, x, y };
}
