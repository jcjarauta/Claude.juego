import { Room } from "@colyseus/core";
import { Player, ResourceNode, WorldState } from "./state.js";
import { regenerate } from "./regen.js";
import { context } from "./context.js";

const NAME_PATTERN = /^[\p{L}\p{N}_-]{1,20}$/u;
const isStep = (v) => v === -1 || v === 0 || v === 1;

export class WorldRoom extends Room {
  maxClients = 4;
  // Un único mundo persistente: la sala se crea al arrancar y no se cierra al quedar vacía.
  autoDispose = false;
  state = new WorldState();

  onCreate() {
    const { config, store } = context;
    this.config = config;
    this.store = store;
    this.lastMoveAt = new Map();
    // Marca de la última regeneración por nodo; no se sincroniza con los clientes.
    this.lastRegenAt = new Map();

    const now = Date.now();
    for (const def of config.nodes) {
      const saved = store.getNode(def.id) ?? { units: def.max, last_regen_at: now };
      const regen = regenerate({ units: saved.units, max: def.max, lastRegenAt: saved.last_regen_at }, now, config.regenIntervalMs);
      store.putNode(def.id, regen.units, regen.lastRegenAt);
      const node = new ResourceNode({ id: def.id, resource: def.resource, x: def.x, y: def.y, units: regen.units, max: def.max });
      this.lastRegenAt.set(def.id, regen.lastRegenAt);
      this.state.nodes.set(def.id, node);
    }

    const tickMs = Math.max(50, Math.min(1000, Math.floor(config.regenIntervalMs / 4)));
    this.clock.setInterval(() => this.regenTick(), tickMs);
  }

  onJoin(client, options) {
    const name = options?.name;
    if (typeof name !== "string" || !NAME_PATTERN.test(name)) throw new Error("nombre-invalido");
    for (const p of this.state.players.values()) {
      if (p.name === name) throw new Error("nombre-en-uso");
    }
    const { spawn } = this.config;
    const saved = this.store.getPlayer(name);
    const player = new Player({ name, x: saved?.x ?? spawn.x, y: saved?.y ?? spawn.y, madera: saved?.madera ?? 0 });
    if (!saved) this.store.putPlayer(name, player.x, player.y, player.madera);
    this.state.players.set(client.sessionId, player);
    this.store.event("join", name, null);
  }

  onLeave(client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.store.putPlayer(player.name, player.x, player.y, player.madera);
    this.store.event("leave", player.name, null);
    this.state.players.delete(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
  }

  messages = {
    move: (client, payload) => {
      const player = this.state.players.get(client.sessionId);
      const dx = payload?.dx;
      const dy = payload?.dy;
      if (!player || !isStep(dx) || !isStep(dy) || (dx === 0 && dy === 0)) {
        return this.reject(client, "movimiento-invalido");
      }
      const now = Date.now();
      if (now - (this.lastMoveAt.get(client.sessionId) ?? 0) < this.config.moveCooldownMs) {
        return this.reject(client, "movimiento-demasiado-rapido");
      }
      const x = player.x + dx;
      const y = player.y + dy;
      const { width, height } = this.config.map;
      if (x < 0 || y < 0 || x >= width || y >= height || this.nodeAt(x, y)) {
        return this.reject(client, "casilla-bloqueada");
      }
      this.lastMoveAt.set(client.sessionId, now);
      player.x = x;
      player.y = y;
    },

    collect: (client, payload) => {
      const player = this.state.players.get(client.sessionId);
      const node = this.state.nodes.get(payload?.nodeId);
      if (!player || !node) return this.reject(client, "recoleccion-invalida");
      if (Math.max(Math.abs(player.x - node.x), Math.abs(player.y - node.y)) > 1) {
        return this.reject(client, "nodo-lejos");
      }
      if (node.units <= 0) return this.reject(client, "nodo-agotado");
      if (player.madera >= this.config.inventoryMax) return this.reject(client, "inventario-lleno");

      // Persistir primero; el estado visible solo cambia si la transacción se confirma.
      const units = node.units - 1;
      const madera = player.madera + 1;
      const lastRegenAt = node.units >= node.max ? Date.now() : this.lastRegenAt.get(node.id);
      this.store.transaction(() => {
        this.store.putNode(node.id, units, lastRegenAt);
        this.store.putPlayer(player.name, player.x, player.y, madera);
        this.store.event("collect", player.name, { node: node.id });
      });
      node.units = units;
      this.lastRegenAt.set(node.id, lastRegenAt);
      player.madera = madera;
    },

    "*": (client, type) => this.reject(client, "mensaje-desconocido", type),
  };

  regenTick() {
    const now = Date.now();
    for (const node of this.state.nodes.values()) {
      const regen = regenerate({ units: node.units, max: node.max, lastRegenAt: this.lastRegenAt.get(node.id) }, now, this.config.regenIntervalMs);
      if (!regen.changed) {
        this.lastRegenAt.set(node.id, regen.lastRegenAt);
        continue;
      }
      this.store.putNode(node.id, regen.units, regen.lastRegenAt);
      node.units = regen.units;
      this.lastRegenAt.set(node.id, regen.lastRegenAt);
    }
  }

  nodeAt(x, y) {
    for (const node of this.state.nodes.values()) {
      if (node.x === x && node.y === y) return node;
    }
    return null;
  }

  reject(client, reason, detail) {
    const player = this.state.players.get(client.sessionId);
    this.store.event("rejected", player?.name ?? null, { reason, detail });
    client.send("rejected", { reason });
  }
}
