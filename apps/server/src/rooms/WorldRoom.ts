import { Room, type Client } from "@colyseus/core";
import {
  applyMove, checkBuild, checkCollect, checkContribution, checkCraft, checkTransfer, Contribution, ContributorTotals, isValidName,
  isValidRequestId, MAX_PLAYERS, MESSAGE, MissionState, missionSatisfied, Player, ProjectState, projectStatus, regenerate,
  StructureState, WorldState,
  type JoinOptions, type NewsMessage, type NodeView, type ProjectDef, type RejectedMessage, type RejectReason, type StructureDef,
} from "@juego/shared";
import { COMMUNITY, playerScope, projectScope, type Store } from "../store.ts";
import { getStore, getWorld, type World } from "../world.ts";

const POSITION_SAVE_MS = 5000;
const RECENT_CONTRIBUTIONS = 10;
const NEWS_LIMIT = 50;

/**
 * Sala única del mundo persistente (ADR-002): se crea al arrancar el servidor,
 * no se cierra al quedar vacía y los clientes entran con join(), nunca joinOrCreate().
 *
 * Recursos (M3): toda operación se valida contra la base de datos dentro de una
 * transacción que también registra su evento; el estado sincronizado solo cambia
 * después de confirmarla.
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = MAX_PLAYERS;
  autoDispose = false;
  state = new WorldState();

  private world!: World;
  private store!: Store;
  private lastMoveAt = new Map<string, number>();
  private lastCollectAt = new Map<string, number>();
  /** Última dirección intentada por jugador: decide qué nodo recolectar. */
  private facing = new Map<string, { dx: number; dy: number }>();
  /** Jugadores cuya posición ha cambiado desde el último guardado. */
  private moved = new Set<string>();
  private lastRegenAt = new Map<string, number>();
  /** Casillas ocupadas por estructuras construidas (bloquean el paso, CU-04). */
  private builtCells = new Set<string>();
  /** Bloqueo combinado: nodos de la configuración y estructuras construidas. */
  private isBlocked = (x: number, y: number) => this.world.index.isBlocked(x, y) || this.builtCells.has(`${x},${y}`);
  /** Sesiones que ya recibieron sus novedades (se envían una vez, cuando el cliente las pide). */
  private newsSent = new Set<string>();
  /** Plazos de reconexión abiertos por sessionId, para poder cancelarlos. */
  private pendingReconnections = new Map<string, ReturnType<Room["allowReconnection"]>>();

  onCreate() {
    this.world = getWorld();
    this.store = getStore();
    const { config } = this.world;

    // Puesta al día del reloj del mundo: lo transcurrido con el servidor parado también cuenta.
    const now = Date.now();
    this.store.transaction(() => {
      for (const def of config.nodes) {
        const saved = this.store.getNode(def.id) ?? { units: def.max, lastRegenAt: now };
        const r = regenerate({ units: Math.min(saved.units, def.max), max: def.max, lastRegenAt: saved.lastRegenAt }, now, config.regenIntervalMs);
        this.store.putNode(def.id, r.units, r.lastRegenAt);
        this.lastRegenAt.set(def.id, r.lastRegenAt);
        this.state.nodes.set(def.id, r.units);
      }
    });
    for (const [resource, amount] of Object.entries(this.store.getInventory(COMMUNITY))) {
      this.state.community.set(resource, amount);
    }
    this.state.communityName = config.community.name;
    // Estructuras y misiones antes que los proyectos: el estado del proyecto depende de si su estructura existe.
    const built = new Map(this.store.getStructures().map((s) => [s.id, s]));
    for (const def of config.structures) {
      const row = built.get(def.id);
      this.state.structures.set(def.id, new StructureState({ built: Boolean(row), builtBy: row?.builtBy ?? "", builtAt: row?.builtAt ?? 0 }));
      if (row) this.blockFootprint(def);
    }
    const completed = new Map(this.store.getMissions().map((m) => [m.id, m]));
    for (const def of config.missions) {
      const row = completed.get(def.id);
      this.state.missions.set(def.id, new MissionState({
        status: row ? "completada" : "pendiente", completedBy: row?.completedBy ?? "", completedAt: row?.completedAt ?? 0,
      }));
    }
    for (const project of config.projects) this.loadProject(project);

    const tickMs = Math.max(50, Math.min(1000, Math.floor(config.regenIntervalMs / 4)));
    this.clock.setInterval(() => this.regenTick(), tickMs);
    this.clock.setInterval(() => this.savePositions(), POSITION_SAVE_MS);
  }

  onJoin(client: Client, options: JoinOptions) {
    if (!isValidName(options?.name)) throw new Error("nombre-invalido");
    const name = options.name;
    let start = this.savedPosition(name);
    for (const [sessionId, p] of this.state.players) {
      if (p.name !== name) continue;
      if (p.connected) throw new Error("nombre-en-uso");
      // Mismo nombre que un jugador en plazo de reconexión (p. ej. recarga de página):
      // recupera su personaje en lugar de quedar bloqueado. Sin cuentas hasta M6 (Q151).
      start = { x: p.x, y: p.y };
      this.state.players.delete(sessionId);
      // Cancelar el plazo de la sesión antigua libera su plaza reservada al momento.
      this.pendingReconnections.get(sessionId)?.reject(new Error("personaje-recuperado"));
      this.pendingReconnections.delete(sessionId);
    }
    const player = new Player({ name, x: start.x, y: start.y, connected: true });
    for (const [resource, amount] of Object.entries(this.store.getInventory(playerScope(name)))) {
      player.inventory.set(resource, amount);
    }
    this.store.transaction(() => {
      this.store.putPlayer(name, player.x, player.y);
      this.store.event("join", name, null, null);
    });
    this.state.players.set(client.sessionId, player);
  }

  /** Corte inesperado: se conserva al jugador durante el plazo de reconexión. */
  onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    this.savePlayer(client.sessionId);
    this.lastMoveAt.delete(client.sessionId);
    // Si el plazo vence (o se cancela), la promesa se rechaza y Colyseus llama a onLeave;
    // el rechazo se captura para que no termine el proceso como promesa sin gestionar.
    const reconnection = this.allowReconnection(client, this.world.config.session.reconnectSeconds);
    this.pendingReconnections.set(client.sessionId, reconnection);
    reconnection.catch(() => {});
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    // Si otra sesión con el mismo nombre ya recuperó el personaje, esta sobra.
    this.pendingReconnections.delete(client.sessionId);
    if (!player) return client.leave();
    player.connected = true;
  }

  /** Salida definitiva: voluntaria o por plazo de reconexión vencido. */
  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.savePlayer(client.sessionId);
      this.store.transaction(() => {
        this.store.event("leave", player.name, null, null);
        this.store.setLastSeen(player.name, Date.now());
      });
    }
    this.newsSent.delete(client.sessionId);
    this.pendingReconnections.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    for (const map of [this.lastMoveAt, this.lastCollectAt, this.facing]) map.delete(client.sessionId);
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
        { width: index.width, height: index.height, isBlocked: this.isBlocked, cooldownMs: config.moveCooldownMs },
        this.lastMoveAt.get(client.sessionId),
        now,
      );
      // Intentar andar hacia un árbol también es mirarlo: así se elige qué recolectar.
      if (result.ok || result.reason === "casilla-bloqueada" || result.reason === "fuera-del-mapa") {
        const { dx, dy } = payload as { dx: number; dy: number };
        this.facing.set(client.sessionId, { dx, dy });
      }
      if (!result.ok) return this.reject(client, result.reason);
      this.lastMoveAt.set(client.sessionId, now);
      player.x = result.x;
      player.y = result.y;
      this.moved.add(client.sessionId);
    },

    [MESSAGE.collect]: (client: Client, payload: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.connected) return;
      const requestId = (payload as { requestId?: unknown } | null)?.requestId;
      if (!isValidRequestId(requestId)) return this.reject(client, "solicitud-invalida");
      const { config } = this.world;
      const scope = playerScope(player.name);
      const now = Date.now();

      const outcome = this.safely(client, () => this.store.transaction(() => {
        if (this.store.hasRequest(player.name, requestId)) return { kind: "duplicate" as const };
        // Unidades leídas de la base de datos, no de memoria.
        const nodes: NodeView[] = config.nodes.map((def) => ({ ...def, units: this.store.getNode(def.id)?.units ?? 0 }));
        const check = checkCollect({
          position: player, facing: this.facing.get(client.sessionId), nodes,
          held: (resource) => this.store.getAmount(scope, resource),
          inventoryMax: config.inventoryMax, lastCollectAt: this.lastCollectAt.get(client.sessionId),
          now, cooldownMs: config.collectCooldownMs,
        });
        if (!check.ok) return { kind: "rejected" as const, reason: check.reason };
        const { node } = check;
        const max = config.nodes.find((d) => d.id === node.id)!.max;
        // Si el nodo estaba lleno, su reloj de regeneración empieza ahora.
        const lastRegenAt = node.units >= max ? now : this.lastRegenAt.get(node.id) ?? now;
        this.store.putNode(node.id, node.units - 1, lastRegenAt);
        this.store.addAmount(scope, node.resource, 1);
        this.store.event("collect", player.name, requestId, { resource: node.resource, node: node.id });
        return { kind: "done" as const, node, lastRegenAt, held: this.store.getAmount(scope, node.resource) };
      }));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);

      // Confirmado en la base de datos: ahora sí cambia el estado sincronizado.
      this.lastCollectAt.set(client.sessionId, now);
      this.lastRegenAt.set(outcome.node.id, outcome.lastRegenAt);
      this.state.nodes.set(outcome.node.id, outcome.node.units - 1);
      player.inventory.set(outcome.node.resource, outcome.held);
    },

    [MESSAGE.transfer]: (client: Client, payload: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.connected) return;
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return this.reject(client, "solicitud-invalida");
      const requestId = message.requestId;
      const scope = playerScope(player.name);
      const knownResources = new Set(this.world.config.resources.map((r) => r.id));

      const outcome = this.safely(client, () => this.store.transaction(() => {
        if (this.store.hasRequest(player.name, requestId)) return { kind: "duplicate" as const };
        const check = checkTransfer({
          resource: message.resource, amount: message.amount, to: message.to, knownResources,
          balance: (resource) => this.store.getAmount(scope, resource),
        });
        if (!check.ok) return { kind: "rejected" as const, reason: check.reason };
        this.store.addAmount(scope, check.resource, -check.amount);
        this.store.addAmount(COMMUNITY, check.resource, check.amount);
        this.store.event("transfer", player.name, requestId, { resource: check.resource, amount: check.amount, to: check.to });
        return {
          kind: "done" as const,
          resource: check.resource,
          held: this.store.getAmount(scope, check.resource),
          community: this.store.getAmount(COMMUNITY, check.resource),
        };
      }));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);

      player.inventory.set(outcome.resource, outcome.held);
      this.state.community.set(outcome.resource, outcome.community);
    },

    [MESSAGE.contribute]: (client: Client, payload: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.connected) return;
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return this.reject(client, "solicitud-invalida");
      const requestId = message.requestId;
      const own = playerScope(player.name);

      const outcome = this.safely(client, () => this.store.transaction(() => {
        if (this.store.hasRequest(player.name, requestId)) return { kind: "duplicate" as const };
        const check = checkContribution({
          projects: this.world.config.projects,
          projectId: message.projectId, taskId: message.taskId, from: message.from, amount: message.amount,
          // Lo aportado sale del registro: no disminuye cuando la construcción consume los materiales.
          contributed: (projectId, resource) => this.store.contributedAmount(projectId, resource),
          balance: (from, resource) => this.store.getAmount(from === "player" ? own : COMMUNITY, resource),
        });
        if (!check.ok) return { kind: "rejected" as const, reason: check.reason };
        const { project, task, from, amount, requested } = check;
        const source = from === "player" ? own : COMMUNITY;
        this.store.addAmount(source, task.resource, -amount);
        this.store.addAmount(projectScope(project.id), task.resource, amount);
        this.store.event("contribute", player.name, requestId, { project: project.id, task: task.id, resource: task.resource, amount, from, requested });
        return {
          kind: "done" as const, project, taskId: task.id, resource: task.resource, from, amount,
          sourceAmount: this.store.getAmount(source, task.resource),
          projectAmount: this.store.contributedAmount(project.id, task.resource),
        };
      }));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);

      // Confirmado: origen, progreso, quién aportó, actividad y estado del proyecto.
      if (outcome.from === "player") player.inventory.set(outcome.resource, outcome.sourceAmount);
      else this.state.community.set(outcome.resource, outcome.sourceAmount);
      const projectState = this.state.projects.get(outcome.project.id)!;
      projectState.progress.set(outcome.resource, outcome.projectAmount);
      let totals = projectState.contributors.get(player.name);
      if (!totals) {
        totals = new ContributorTotals();
        projectState.contributors.set(player.name, totals);
      }
      totals.totals.set(outcome.resource, (totals.totals.get(outcome.resource) ?? 0) + outcome.amount);
      projectState.recent.push(new Contribution({
        name: player.name, taskId: outcome.taskId, resource: outcome.resource, amount: outcome.amount, at: Date.now(),
      }));
      while (projectState.recent.length > RECENT_CONTRIBUTIONS) projectState.recent.shift();
      projectState.status = this.projectStatusOf(outcome.project, projectState);
    },

    /** El cliente pide sus novedades cuando está listo para mostrarlas (una vez por sesión). */
    [MESSAGE.news]: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.newsSent.has(client.sessionId)) return;
      this.newsSent.add(client.sessionId);
      const since = this.store.getLastSeen(player.name);
      const news: NewsMessage = { since, items: since === null ? [] : this.store.contributionsSince(since, player.name, NEWS_LIMIT) };
      client.send(MESSAGE.news, news);
    },

    /** Construir la estructura de un proyecto listo (RF-007, Q156). */
    [MESSAGE.build]: (client: Client, payload: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.connected) return;
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return this.reject(client, "solicitud-invalida");
      const requestId = message.requestId;
      const { config } = this.world;
      const structure = config.structures.find((s) => s.id === message.structureId);
      const now = Date.now();

      const outcome = this.safely(client, () => this.store.transaction(() => {
        if (this.store.hasRequest(player.name, requestId)) return { kind: "duplicate" as const };
        const project = structure && config.projects.find((p) => p.id === structure.projectId);
        const check = checkBuild({
          structure,
          built: Boolean(structure && this.store.getStructures().some((s) => s.id === structure.id)),
          projectReady: Boolean(project && project.tasks.every((t) => this.store.contributedAmount(project.id, t.resource) >= t.required)),
          position: player,
          others: [...this.state.players.entries()].filter(([id]) => id !== client.sessionId).map(([, p]) => ({ x: p.x, y: p.y })),
        });
        if (!check.ok || !project) return { kind: "rejected" as const, reason: check.ok ? "estructura-desconocida" as const : check.reason };
        // Se consume exactamente lo requerido de los materiales aportados al proyecto.
        const consumed: Record<string, number> = {};
        for (const task of project.tasks) {
          this.store.addAmount(projectScope(project.id), task.resource, -task.required);
          consumed[task.resource] = task.required;
        }
        this.store.addStructure(check.structure.id, player.name, now);
        this.store.event("build", player.name, requestId, { structure: check.structure.id, project: project.id, consumed });
        return { kind: "done" as const, structure: check.structure, project };
      }));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);

      this.blockFootprint(outcome.structure);
      const structureState = this.state.structures.get(outcome.structure.id)!;
      structureState.built = true;
      structureState.builtBy = player.name;
      structureState.builtAt = now;
      const projectState = this.state.projects.get(outcome.project.id);
      if (projectState) projectState.status = this.projectStatusOf(outcome.project, projectState);
    },

    /** Fabricar en una estructura con materiales del almacén común; completa misiones (RF-008, Q157, Q158). */
    [MESSAGE.craft]: (client: Client, payload: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.connected) return;
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return this.reject(client, "solicitud-invalida");
      const requestId = message.requestId;
      const { config } = this.world;
      const recipe = config.recipes.find((r) => r.id === message.recipeId);
      const structure = recipe && config.structures.find((s) => s.id === recipe.structureId);
      const now = Date.now();

      const outcome = this.safely(client, () => this.store.transaction(() => {
        if (this.store.hasRequest(player.name, requestId)) return { kind: "duplicate" as const };
        const stock = (id: string) => this.store.getAmount(COMMUNITY, id);
        const check = checkCraft({
          recipe, structure, position: player, stock,
          structureBuilt: Boolean(structure && this.store.getStructures().some((s) => s.id === structure.id)),
        });
        if (!check.ok) return { kind: "rejected" as const, reason: check.reason };
        const { inputs, output } = check.recipe;
        for (const [resource, amount] of Object.entries(inputs)) this.store.addAmount(COMMUNITY, resource, -amount);
        this.store.addAmount(COMMUNITY, output.item, output.amount);
        this.store.event("craft", player.name, requestId, { recipe: check.recipe.id, consumed: inputs, produced: { [output.item]: output.amount } });
        // La misión se completa en la misma transacción que la fabricación que la cumple.
        const already = new Set(this.store.getMissions().map((m) => m.id));
        const completedNow = config.missions.filter((m) => !already.has(m.id) && missionSatisfied(m, stock));
        for (const mission of completedNow) {
          this.store.completeMission(mission.id, player.name, now);
          this.store.event("mission-complete", player.name, null, { mission: mission.id });
        }
        const touched = [...Object.keys(inputs), output.item];
        return { kind: "done" as const, community: touched.map((id) => [id, stock(id)] as const), completedNow };
      }));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);

      for (const [id, amount] of outcome.community) this.state.community.set(id, amount);
      for (const mission of outcome.completedNow) {
        const missionState = this.state.missions.get(mission.id)!;
        missionState.status = "completada";
        missionState.completedBy = player.name;
        missionState.completedAt = now;
      }
    },

    "*": (client: Client) => this.reject(client, "mensaje-desconocido"),
  };

  private blockFootprint(structure: StructureDef) {
    for (let x = structure.x; x < structure.x + structure.width; x++) {
      for (let y = structure.y; y < structure.y + structure.height; y++) this.builtCells.add(`${x},${y}`);
    }
  }

  /** «construido» si la estructura del proyecto existe; si no, «listo» o «en-curso» según lo aportado. */
  private projectStatusOf(project: ProjectDef, projectState: ProjectState): string {
    const structure = this.world.config.structures.find((s) => s.projectId === project.id);
    if (structure && this.state.structures.get(structure.id)?.built) return "construido";
    return projectStatus(project, (r) => projectState.progress.get(r) ?? 0);
  }

  /** Reconstruye el estado de un proyecto desde la base de datos (progreso, quién aportó, actividad). */
  private loadProject(project: ProjectDef) {
    const projectState = new ProjectState();
    // Progreso = suma de lo aportado según el registro (se conserva tras construir).
    for (const [name, byResource] of Object.entries(this.store.contributionTotals(project.id))) {
      const totals = new ContributorTotals();
      for (const [resource, amount] of Object.entries(byResource)) {
        totals.totals.set(resource, amount);
        projectState.progress.set(resource, (projectState.progress.get(resource) ?? 0) + amount);
      }
      projectState.contributors.set(name, totals);
    }
    for (const row of this.store.recentContributions(project.id, RECENT_CONTRIBUTIONS).reverse()) {
      projectState.recent.push(new Contribution(row));
    }
    projectState.status = this.projectStatusOf(project, projectState);
    this.state.projects.set(project.id, projectState);
  }

  private regenTick() {
    const { config } = this.world;
    const now = Date.now();
    const changes: { id: string; units: number; lastRegenAt: number }[] = [];
    for (const def of config.nodes) {
      const r = regenerate(
        { units: this.state.nodes.get(def.id) ?? 0, max: def.max, lastRegenAt: this.lastRegenAt.get(def.id) ?? now },
        now, config.regenIntervalMs,
      );
      if (r.changed) changes.push({ id: def.id, units: r.units, lastRegenAt: r.lastRegenAt });
      else this.lastRegenAt.set(def.id, r.lastRegenAt);
    }
    if (changes.length === 0) return;
    this.store.transaction(() => {
      for (const c of changes) this.store.putNode(c.id, c.units, c.lastRegenAt);
    });
    for (const c of changes) {
      this.lastRegenAt.set(c.id, c.lastRegenAt);
      this.state.nodes.set(c.id, c.units);
    }
  }

  /** La posición se guarda al salir y cada 5 s (Q149); los recursos, en cada transacción. */
  private savePositions() {
    if (this.moved.size === 0) return;
    this.store.transaction(() => {
      for (const sessionId of this.moved) this.savePlayer(sessionId);
    });
  }

  private savePlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (player) this.store.putPlayer(player.name, player.x, player.y);
    this.moved.delete(sessionId);
  }

  /** Posición guardada si sigue siendo válida en el mapa actual; si no, el punto de aparición. */
  private savedPosition(name: string) {
    const { index, config } = this.world;
    const saved = this.store.getPlayer(name);
    if (saved && saved.x >= 0 && saved.y >= 0 && saved.x < index.width && saved.y < index.height && !this.isBlocked(saved.x, saved.y)) {
      return saved;
    }
    return config.spawn;
  }

  /** Un error inesperado de la base de datos no debe tumbar la sala: se rechaza y se registra. */
  private safely<T>(client: Client, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (err) {
      console.error("Error en operación de recursos:", err);
      this.reject(client, "solicitud-invalida");
      return undefined;
    }
  }

  private reject(client: Client, reason: RejectReason) {
    const message: RejectedMessage = { reason };
    client.send(MESSAGE.rejected, message);
  }
}
