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
    let start = this.world.config.spawn;
    for (const [sessionId, p] of this.state.players) {
      if (p.name !== options.name) continue;
      if (p.connected) throw new Error("nombre-en-uso");
      // Mismo nombre que un jugador en plazo de reconexión (p. ej. recarga de página):
      // recupera su personaje en lugar de quedar bloqueado. Sin cuentas hasta M6.
      start = { x: p.x, y: p.y };
      this.state.players.delete(sessionId);
    }
    this.state.players.set(client.sessionId, new Player({ name: options.name, x: start.x, y: start.y, connected: true }));
  }

  /** Corte inesperado: se conserva al jugador durante el plazo de reconexión. */
  onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    this.lastMoveAt.delete(client.sessionId);
    // Si el plazo vence, la promesa se rechaza y Colyseus llama a onLeave; el rechazo se
    // captura para que no termine el proceso como promesa sin gestionar.
    this.allowReconnection(client, this.world.config.session.reconnectSeconds).catch(() => {});
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    // Si otra sesión con el mismo nombre ya recuperó el personaje, esta sobra.
    if (!player) return client.leave();
    player.connected = true;
  }

  /** Salida definitiva: voluntaria o por plazo de reconexión vencido. */
  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
  }

  messages = {
    [MESSAGE.move]: (client: Client, payload: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.connected) return;
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
