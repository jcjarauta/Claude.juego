import { Room, type Client } from "@colyseus/core";
import {
  applyMove, isValidName, MESSAGE, Player, WorldState,
  type JoinOptions, type RejectedMessage, type RejectReason,
} from "@juego/shared";
import { getWorld, type World } from "../world.ts";

/**
 * Sala única del mundo persistente (ADR-002): se crea al arrancar el servidor,
 * no se cierra al quedar vacía y los clientes entran con join(), nunca joinOrCreate().
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = 4;
  autoDispose = false;
  state = new WorldState();

  private world!: World;
  private lastMoveAt = new Map<string, number>();

  onCreate() {
    this.world = getWorld();
  }

  onJoin(client: Client, options: JoinOptions) {
    if (!isValidName(options?.name)) throw new Error("nombre-invalido");
    for (const p of this.state.players.values()) {
      if (p.name === options.name) throw new Error("nombre-en-uso");
    }
    const { spawn } = this.world.config;
    this.state.players.set(client.sessionId, new Player({ name: options.name, x: spawn.x, y: spawn.y, connected: true }));
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
  }

  messages = {
    [MESSAGE.move]: (client: Client, payload: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const { index, config } = this.world;
      const now = Date.now();
      const result = applyMove(
        player,
        payload,
        { width: index.width, height: index.height, isBlocked: index.isBlocked, cooldownMs: config.moveCooldownMs },
        this.lastMoveAt.get(client.sessionId),
        now,
      );
      if (!result.ok) return this.reject(client, result.reason);
      this.lastMoveAt.set(client.sessionId, now);
      player.x = result.x;
      player.y = result.y;
    },
    "*": (client: Client) => this.reject(client, "mensaje-desconocido"),
  };

  private reject(client: Client, reason: RejectReason) {
    const message: RejectedMessage = { reason };
    client.send(MESSAGE.rejected, message);
  }
}
