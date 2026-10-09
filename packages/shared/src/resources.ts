import { TRANSFER_TARGETS, type RejectReason, type TransferTarget } from "./contracts.ts";
import type { Position } from "./movement.ts";

// Reglas puras de recursos. El servidor las aplica y persiste el resultado;
// el cliente nunca decide.

export interface NodeView {
  id: string;
  resource: string;
  x: number;
  y: number;
  units: number;
}

export interface CollectInput {
  position: Position;
  /** Última dirección de movimiento: se prefiere el nodo hacia el que mira el jugador. */
  facing: { dx: number; dy: number } | undefined;
  /** En el orden de la configuración (orden fijo para desempatar). */
  nodes: readonly NodeView[];
  held: (resource: string) => number;
  inventoryMax: number;
  lastCollectAt: number | undefined;
  now: number;
  cooldownMs: number;
}

export type CollectResult = { ok: true; node: NodeView } | { ok: false; reason: RejectReason };

const isAdjacent = (p: Position, n: NodeView) => Math.max(Math.abs(p.x - n.x), Math.abs(p.y - n.y)) === 1;

export function checkCollect(input: CollectInput): CollectResult {
  const { position, facing, nodes, held, inventoryMax, lastCollectAt, now, cooldownMs } = input;
  if (lastCollectAt !== undefined && now - lastCollectAt < cooldownMs) {
    return { ok: false, reason: "recoleccion-demasiado-rapida" };
  }
  const adjacent = nodes.filter((n) => isAdjacent(position, n));
  if (adjacent.length === 0) return { ok: false, reason: "nodo-lejos" };

  const facingNode = facing
    ? adjacent.find((n) => n.x === position.x + facing.dx && n.y === position.y + facing.dy)
    : undefined;
  const node = facingNode && facingNode.units > 0 ? facingNode : adjacent.find((n) => n.units > 0);
  if (!node) return { ok: false, reason: "nodo-agotado" };
  if (held(node.resource) >= inventoryMax) return { ok: false, reason: "inventario-lleno" };
  return { ok: true, node };
}

export interface TransferInput {
  resource: unknown;
  amount: unknown;
  to: unknown;
  knownResources: ReadonlySet<string>;
  balance: (resource: string) => number;
}

export type TransferResult =
  | { ok: true; resource: string; amount: number; to: TransferTarget }
  | { ok: false; reason: RejectReason };

export function checkTransfer({ resource, amount, to, knownResources, balance }: TransferInput): TransferResult {
  if (typeof resource !== "string" || !knownResources.has(resource)) return { ok: false, reason: "solicitud-invalida" };
  if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > 1000) return { ok: false, reason: "solicitud-invalida" };
  if (!TRANSFER_TARGETS.includes(to as TransferTarget)) return { ok: false, reason: "destino-no-permitido" };
  if (balance(resource) < (amount as number)) return { ok: false, reason: "saldo-insuficiente" };
  return { ok: true, resource, amount: amount as number, to: to as TransferTarget };
}

export interface RegenState {
  units: number;
  max: number;
  lastRegenAt: number;
}

/**
 * Reloj del mundo: la regeneración se calcula desde la última marca persistida,
 * así que avanza también sin jugadores y con el servidor parado.
 */
export function regenerate({ units, max, lastRegenAt }: RegenState, now: number, intervalMs: number) {
  if (units >= max) return { units, lastRegenAt: now, changed: false };
  const steps = Math.floor((now - lastRegenAt) / intervalMs);
  if (steps <= 0) return { units, lastRegenAt, changed: false };
  const next = Math.min(max, units + steps);
  return { units: next, lastRegenAt: next >= max ? now : lastRegenAt + steps * intervalMs, changed: true };
}
