import { Room, type Client } from "@colyseus/core";
import {
  applyMove, checkBuild, checkCollect, checkCraft, checkTransfer, Contribution, ContributorTotals, isValidName,
  isValidRequestId, MAX_PANELS, MAX_PLAYERS, MESSAGE, MissionState, Player, ProjectState, regenerate,
  StructureState, TaskState, taskStatus, VIEWS, WorldState,
  type JoinOptions, type NewsMessage, type NodeView, type ProjectDef, type RejectedMessage, type RejectReason, type ReviewDecision,
  type StructureDef, type View,
} from "@juego/shared";
import type { Account } from "../accounts.ts";
import { log } from "../log.ts";
import {
  createProjectCore, RECENT_CONTRIBUTIONS, type MissionCompleted, type MissionEntry, type ProjectCore, type ProjectEntry,
} from "../projects/core.ts";
import { createRateLimiter } from "../rate-limit.ts";
import { COMMUNITY, playerScope, type Store } from "../store.ts";
import { getAccounts, getStore, getWorld, type World } from "../world.ts";

const POSITION_SAVE_MS = 5000;
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
  // Jugadores y paneles comparten la sala; el límite de jugadores se comprueba en onJoin.
  maxClients = MAX_PLAYERS + MAX_PANELS;
  autoDispose = false;
  state = new WorldState();

  private world!: World;
  private store!: Store;
  /** Núcleo de proyectos (M5b): la sala solo traduce mensajes y aplica sus resultados. */
  private core!: ProjectCore;
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
  /** Límite de frecuencia de las operaciones con efecto (M6, Q167). */
  private limiter = createRateLimiter();
  private lastLimitLog = new Map<string, number>();
  /** Paneles profesionales conectados (M5b): sessionId → nombre. No tienen personaje. */
  private panels = new Map<string, string>();
  /** Plazos de reconexión abiertos por sessionId, para poder cancelarlos. */
  private pendingReconnections = new Map<string, ReturnType<Room["allowReconnection"]>>();

  onCreate() {
    this.world = getWorld();
    this.store = getStore();
    this.core = createProjectCore(this.store, this.world.config);
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
    for (const entry of this.core.missionEntries()) this.loadMission(entry);
    for (const entry of this.core.projectEntries()) this.loadProject(entry);

    const tickMs = Math.max(50, Math.min(1000, Math.floor(config.regenIntervalMs / 4)));
    this.clock.setInterval(() => this.regenTick(), tickMs);
    this.clock.setInterval(() => this.savePositions(), POSITION_SAVE_MS);
  }

  /** M6 (RF-003): solo entra quien tiene una sesión válida; el nombre sale de la cuenta, no del cliente. */
  onAuth(_client: Client, options: JoinOptions): Account {
    const account = getAccounts().verify(options?.token);
    if (!account) {
      log("warn", "sesion-invalida");
      throw new Error("sesion-invalida");
    }
    return account;
  }

  onJoin(client: Client, options: JoinOptions) {
    const name = (client.auth as Account).name;
    if (!isValidName(name)) throw new Error("nombre-invalido");
    const view: View = options?.view ?? "mundo";
    if (!VIEWS.includes(view)) throw new Error("vista-invalida");
    if (view === "panel") {
      // Panel profesional: observador sin personaje; no ocupa plaza de jugador.
      if (this.panels.size >= MAX_PANELS) throw new Error("mundo-lleno");
      this.panels.set(client.sessionId, name);
      this.store.transaction(() => this.store.event("join", name, null, { view }));
      return;
    }
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
    if (this.state.players.size >= MAX_PLAYERS) throw new Error("mundo-lleno");
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
    if (player) {
      player.connected = false;
      this.savePlayer(client.sessionId);
      this.lastMoveAt.delete(client.sessionId);
    } else if (!this.panels.has(client.sessionId)) {
      return;
    }
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
    if (this.panels.has(client.sessionId)) return;
    if (!player) return client.leave();
    player.connected = true;
  }

  /** Salida definitiva: voluntaria o por plazo de reconexión vencido. */
  onLeave(client: Client) {
    if (this.panels.delete(client.sessionId)) {
      this.pendingReconnections.delete(client.sessionId);
      this.limiter.forget(client.sessionId);
      return;
    }
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
    this.limiter.forget(client.sessionId);
    this.lastLimitLog.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    for (const map of [this.lastMoveAt, this.lastCollectAt, this.facing]) map.delete(client.sessionId);
  }

  messages = {
    [MESSAGE.move]: (client: Client, payload: unknown) => {
      const player = this.characterOf(client);
      if (!player) return;
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
      const player = this.characterOf(client);
      if (!player) return;
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
      const player = this.characterOf(client);
      if (!player || !this.withinLimit(client)) return;
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
      const actor = this.actorOf(client);
      if (!actor || !this.withinLimit(client)) return;
      const outcome = this.safely(client, () => this.core.contribute(actor, payload));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);

      // Confirmado: origen, progreso, quién aportó, actividad, estado del proyecto y de sus tareas, y misiones.
      const done = outcome.value;
      if (done.from === "player") this.playerByName(actor)?.inventory.set(done.resource, done.sourceAmount);
      else this.state.community.set(done.resource, done.sourceAmount);
      const projectState = this.state.projects.get(done.project.id)!;
      projectState.progress.set(done.resource, done.projectAmount);
      let totals = projectState.contributors.get(actor);
      if (!totals) {
        totals = new ContributorTotals();
        projectState.contributors.set(actor, totals);
      }
      totals.totals.set(done.resource, (totals.totals.get(done.resource) ?? 0) + done.amount);
      projectState.recent.push(new Contribution({
        name: actor, taskId: done.taskId, resource: done.resource, amount: done.amount, at: Date.now(),
      }));
      while (projectState.recent.length > RECENT_CONTRIBUTIONS) projectState.recent.shift();
      this.refreshTasks(done.project, projectState);
      projectState.status = this.projectStatusOf(done.project, projectState);
      this.applyMissions(done.missions);
    },

    /** Revisar una tarea completada: solo coordinadores, desde el mundo o el panel (M5b, Q161). */
    [MESSAGE.review]: (client: Client, payload: unknown) => {
      const actor = this.actorOf(client);
      if (!actor || !this.withinLimit(client)) return;
      const outcome = this.safely(client, () => this.core.review(actor, payload));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);
      const done = outcome.value;
      const projectState = this.state.projects.get(done.project.id)!;
      const taskState = projectState.tasks.get(done.taskId)!;
      taskState.decision = done.decision;
      taskState.reviewedBy = done.reviewedBy;
      taskState.reviewedAt = done.reviewedAt;
      taskState.note = done.note;
      this.refreshTasks(done.project, projectState);
      projectState.status = this.projectStatusOf(done.project, projectState);
      this.applyMissions(done.missions);
    },

    /** Replanificar la fecha objetivo de un proyecto o tarea (F1b, Q177). */
    [MESSAGE.reschedule]: (client: Client, payload: unknown) => {
      const actor = this.actorOf(client);
      if (!actor || !this.withinLimit(client)) return;
      const outcome = this.safely(client, () => this.core.reschedule(actor, payload));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);
      const { project, taskId, dueDate, count } = outcome.value;
      const projectState = this.state.projects.get(project.id)!;
      const target = taskId === "" ? projectState : projectState.tasks.get(taskId)!;
      target.dueDate = dueDate;
      target.reschedules = count;
    },

    /** Crear un proyecto desde el panel (F1a, solo administración). */
    [MESSAGE.createProject]: (client: Client, payload: unknown) => {
      const actor = this.actorOf(client);
      if (!actor || !this.withinLimit(client)) return;
      const outcome = this.safely(client, () => this.core.createProject(actor, payload));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason, outcome.details);
      this.loadProject(outcome.value);
      log("info", "proyecto-creado", { project: outcome.value.def.id });
    },

    /** Cerrar un proyecto del panel (F1a, solo administración). */
    [MESSAGE.closeProject]: (client: Client, payload: unknown) => {
      const actor = this.actorOf(client);
      if (!actor || !this.withinLimit(client)) return;
      const outcome = this.safely(client, () => this.core.closeProject(actor, payload));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);
      const projectState = this.state.projects.get(outcome.value.def.id)!;
      projectState.phase = "cerrado";
      projectState.closedBy = outcome.value.closedBy;
    },

    /** Crear una misión desde el panel (F1a, Q174, solo administración). */
    [MESSAGE.createMission]: (client: Client, payload: unknown) => {
      const actor = this.actorOf(client);
      if (!actor || !this.withinLimit(client)) return;
      const outcome = this.safely(client, () => this.core.createMission(actor, payload));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason, outcome.details);
      this.loadMission(outcome.value.entry);
      this.applyMissions(outcome.value.completed);
    },

    /** El cliente pide sus novedades cuando está listo para mostrarlas (una vez por sesión). */
    [MESSAGE.news]: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.newsSent.has(client.sessionId)) return; // los paneles ven la actividad en el estado
      this.newsSent.add(client.sessionId);
      const since = this.store.getLastSeen(player.name);
      const news: NewsMessage = { since, items: since === null ? [] : this.store.contributionsSince(since, player.name, NEWS_LIMIT) };
      client.send(MESSAGE.news, news);
    },

    /** Construir la estructura de un proyecto listo (RF-007, Q156). */
    [MESSAGE.build]: (client: Client, payload: unknown) => {
      const player = this.characterOf(client);
      if (!player || !this.withinLimit(client)) return;
      const message = (payload ?? {}) as Record<string, unknown>;
      if (!isValidRequestId(message.requestId)) return this.reject(client, "solicitud-invalida");
      const requestId = message.requestId;
      const { config } = this.world;
      const structure = config.structures.find((s) => s.id === message.structureId);
      const now = Date.now();

      const outcome = this.safely(client, () => this.store.transaction(() => {
        if (this.store.hasRequest(player.name, requestId)) return { kind: "duplicate" as const };
        const project = structure && this.core.projectById(structure.projectId);
        const check = checkBuild({
          structure,
          built: Boolean(structure && this.store.getStructures().some((s) => s.id === structure.id)),
          projectReady: Boolean(project && this.core.isComplete(project)),
          approvalMissing: Boolean(project && this.core.approvalMissing(project)),
          position: player,
          others: [...this.state.players.entries()].filter(([id]) => id !== client.sessionId).map(([, p]) => ({ x: p.x, y: p.y })),
        });
        if (!check.ok || !project) return { kind: "rejected" as const, reason: check.ok ? "estructura-desconocida" as const : check.reason };
        const consumed = this.core.consumeForBuild(project);
        this.store.addStructure(check.structure.id, player.name, now);
        this.store.event("build", player.name, requestId, { structure: check.structure.id, project: project.id, consumed });
        // Una misión «proyecto completado» del taller se cumple al construirlo (Q174).
        return { kind: "done" as const, structure: check.structure, project, missions: this.core.completeMissions(player.name, now) };
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
      this.applyMissions(outcome.missions);
    },

    /** Fabricar en una estructura con materiales del almacén común; completa misiones (RF-008, Q157, Q158). */
    [MESSAGE.craft]: (client: Client, payload: unknown) => {
      const player = this.characterOf(client);
      if (!player || !this.withinLimit(client)) return;
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
        const missions = this.core.completeMissions(player.name, now);
        const touched = [...Object.keys(inputs), output.item];
        return { kind: "done" as const, community: touched.map((id) => [id, stock(id)] as const), missions };
      }));
      if (!outcome || outcome.kind === "duplicate") return;
      if (outcome.kind === "rejected") return this.reject(client, outcome.reason);

      for (const [id, amount] of outcome.community) this.state.community.set(id, amount);
      this.applyMissions(outcome.missions);
    },

    "*": (client: Client) => this.reject(client, "mensaje-desconocido"),
  };

  /** Q167: como máximo 8 operaciones con efecto por segundo y sesión; el exceso se rechaza sin efecto. */
  private withinLimit(client: Client): boolean {
    const now = Date.now();
    if (this.limiter.take(client.sessionId, now)) return true;
    this.reject(client, "demasiadas-solicitudes");
    // Un registro como mucho cada 10 s por sesión, para no inundar los logs.
    if (now - (this.lastLimitLog.get(client.sessionId) ?? 0) > 10_000) {
      this.lastLimitLog.set(client.sessionId, now);
      log("warn", "limite-frecuencia", { account: (client.auth as Account | undefined)?.id });
    }
    return false;
  }

  /** Nombre de quien actúa: jugador conectado o panel. */
  private actorOf(client: Client): string | undefined {
    const panel = this.panels.get(client.sessionId);
    if (panel) return panel;
    const player = this.state.players.get(client.sessionId);
    return player?.connected ? player.name : undefined;
  }

  /** Personaje conectado de quien actúa; desde un panel se rechaza con «sin personaje». */
  private characterOf(client: Client): Player | undefined {
    if (this.panels.has(client.sessionId)) {
      this.reject(client, "sin-personaje");
      return undefined;
    }
    const player = this.state.players.get(client.sessionId);
    return player?.connected ? player : undefined;
  }

  private playerByName(name: string): Player | undefined {
    for (const p of this.state.players.values()) if (p.name === name) return p;
    return undefined;
  }

  /** Recalcula el estado de cada tarea a partir del progreso y de su última revisión. */
  private refreshTasks(project: ProjectDef, projectState: ProjectState) {
    for (const task of project.tasks) {
      const taskState = projectState.tasks.get(task.id)!;
      taskState.status = taskStatus(task, projectState.progress.get(task.resource) ?? 0, taskState.decision as ReviewDecision | "");
    }
  }

  private blockFootprint(structure: StructureDef) {
    for (let x = structure.x; x < structure.x + structure.width; x++) {
      for (let y = structure.y; y < structure.y + structure.height; y++) this.builtCells.add(`${x},${y}`);
    }
  }

  /** «construido» si la estructura del proyecto existe; si no, «listo» o «en-curso» según lo aportado. */
  private projectStatusOf(project: ProjectDef, projectState: ProjectState): string {
    const structure = this.world.config.structures.find((s) => s.projectId === project.id);
    const built = Boolean(structure && this.state.structures.get(structure.id)?.built);
    return this.core.status(project, (r) => projectState.progress.get(r) ?? 0, built);
  }

  /** Misiones completadas confirmadas: pasan al estado sincronizado. */
  private applyMissions(completed: MissionCompleted[]) {
    for (const { mission, by, at } of completed) {
      const missionState = this.state.missions.get(mission.id);
      if (!missionState) continue;
      missionState.status = "completada";
      missionState.completedBy = by;
      missionState.completedAt = at;
    }
  }

  /** Estado sincronizado de una misión, con su definición (F1a). */
  private loadMission({ def, origin, createdBy }: MissionEntry) {
    const row = this.store.getMissions().find((m) => m.id === def.id);
    const o = def.objective;
    this.state.missions.set(def.id, new MissionState({
      name: def.name, description: def.description, objectiveKind: o.kind,
      objectiveTarget: o.kind === "project-completed" ? o.project : o.item,
      objectiveAmount: o.kind === "item-in-community" ? o.amount : 0,
      origin, createdBy,
      status: row ? "completada" : "pendiente", completedBy: row?.completedBy ?? "", completedAt: row?.completedAt ?? 0,
    }));
  }

  /** Estado sincronizado de un proyecto: definición y la instantánea del núcleo. */
  private loadProject({ def: project, origin, createdBy, createdAt, closedBy, closedAt }: ProjectEntry) {
    const snapshot = this.core.snapshot(project);
    const projectState = new ProjectState();
    Object.assign(projectState, {
      name: project.name, description: project.description, origin, createdBy, createdAt,
      phase: closedAt ? "cerrado" : "abierto", closedBy, requiresApproval: project.buildRequiresApproval,
    });
    const schedule = this.core.scheduleOf(project);
    projectState.dueDate = schedule.projectDue;
    projectState.reschedules = schedule.projectCount;
    for (const [resource, amount] of Object.entries(snapshot.progress)) projectState.progress.set(resource, amount);
    for (const [name, byResource] of Object.entries(snapshot.contributors)) {
      const totals = new ContributorTotals();
      for (const [resource, amount] of Object.entries(byResource)) totals.totals.set(resource, amount);
      projectState.contributors.set(name, totals);
    }
    for (const row of snapshot.recent) projectState.recent.push(new Contribution(row));
    projectState.reality = project.reality;
    for (const name of project.coordinators) projectState.coordinators.push(name);
    for (const task of project.tasks) {
      const review = snapshot.reviews[task.id];
      projectState.tasks.set(task.id, new TaskState({
        title: task.title, resource: task.resource, required: task.required, acceptance: task.acceptance,
        dueDate: schedule.tasks[task.id]?.due ?? "", reschedules: schedule.tasks[task.id]?.count ?? 0,
        status: "", decision: review?.decision ?? "", reviewedBy: review?.reviewedBy ?? "",
        reviewedAt: review?.reviewedAt ?? 0, note: review?.note ?? "",
      }));
    }
    this.refreshTasks(project, projectState);
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
      // Q067: error explícito; la transacción ya se ha deshecho y no se confirma nada.
      log("error", "error-operacion", { account: (client.auth as Account | undefined)?.id, message: (err as Error).message });
      this.reject(client, "solicitud-invalida");
      return undefined;
    }
  }

  private reject(client: Client, reason: RejectReason, details?: string[]) {
    const message: RejectedMessage = details?.length ? { reason, details } : { reason };
    client.send(MESSAGE.rejected, message);
  }
}
