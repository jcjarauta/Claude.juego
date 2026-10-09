import * as Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import {
  createWorldIndex, MESSAGE, REJECT_TEXT,
  type CollectMessage, type ContributeMessage, type ContributionSource, type MoveMessage, type NewsMessage, type Player,
  type RejectedMessage, type ResourceShape, type TransferMessage, type WorldConfig, type WorldIndex, type WorldState,
} from "@juego/shared";
import type { Hud } from "./hud.ts";
import { createProjectPanel, type ProjectPanel } from "./project-panel.ts";

export type WorldRoom = Room<unknown, WorldState>;

export interface WorldSceneData {
  room: WorldRoom;
  config: WorldConfig;
  hud: Hud;
}

interface PlayerView {
  body: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
}

type Direction = "up" | "down" | "left" | "right";
const STEPS: Record<Direction, MoveMessage> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const KEY_CODES: Record<Direction, string[]> = {
  up: ["UP", "W"],
  down: ["DOWN", "S"],
  left: ["LEFT", "A"],
  right: ["RIGHT", "D"],
};
const CODE_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};
// Margen sobre el intervalo del servidor para no provocar rechazos por ritmo.
const SEND_MARGIN_MS = 15;

const hex = (color: string) => Number.parseInt(color.slice(1), 16);

/**
 * Identificador de petición para que el servidor descarte duplicados. Se usa
 * getRandomValues porque crypto.randomUUID no existe en contextos no seguros
 * (por ejemplo http://192.168.x.x en red local).
 */
function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const isTextInput = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

const isFormControl = (target: EventTarget | null) =>
  target instanceof HTMLButtonElement || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

interface NodeViewObjects {
  shape: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

export class WorldScene extends Phaser.Scene {
  private room!: WorldRoom;
  private config!: WorldConfig;
  private hud!: Hud;
  private index!: WorldIndex;
  private tile = 32;
  private views = new Map<string, PlayerView>();
  private nodeViews = new Map<string, NodeViewObjects>();
  /** Inventario propio anterior, para anunciar lo recogido y lo depositado. */
  private lastInventory = new Map<string, number>();
  /** Última acción propia que reduce el inventario: decide cómo se anuncia la bajada. */
  private lastOwnAction: "deposit" | "contribute" | undefined;
  private projectPanel: ProjectPanel | undefined;
  private keys = new Map<Direction, Phaser.Input.Keyboard.Key[]>();
  private lastSentAt = -Infinity;
  /** Último toque recibido; se envía en cuanto el ritmo lo permite aunque la tecla ya se haya soltado. */
  private pending: Direction | undefined;
  /** Falso mientras llegan los jugadores ya presentes al entrar: solo se anuncian los cambios posteriores. */
  private announcing = false;

  constructor() {
    super("world");
  }

  init(data: WorldSceneData) {
    this.room = data.room;
    this.config = data.config;
    this.hud = data.hud;
    this.index = createWorldIndex(data.config);
    this.tile = data.config.map.tileSize;
  }

  create() {
    this.drawMap();
    const { width, height } = this.config.map;
    this.cameras.main.setBounds(0, 0, width * this.tile, height * this.tile);

    const callbacks = Callbacks.get(this.room);
    callbacks.onAdd("players", (player, sessionId) => this.addPlayer(callbacks, player, sessionId));
    callbacks.onRemove("players", (player, sessionId) => {
      const view = this.views.get(sessionId);
      view?.body.destroy();
      view?.label.destroy();
      this.views.delete(sessionId);
      if (this.announcing && sessionId !== this.room.sessionId) this.hud.announcePresence(`${player.name} ha salido del mundo.`);
      this.refreshPlayerList();
    });

    // Panel del proyecto (el primero de la configuración en el MVP).
    const project = this.config.projects[0];
    if (project) {
      this.projectPanel = createProjectPanel(this.config, project, (projectId, taskId, from, amount) => this.contribute(projectId, taskId, from, amount));
      // Las novedades se piden ahora que el manejador está registrado (RF-013).
      this.room.onMessage(MESSAGE.news, (news: NewsMessage) => this.projectPanel?.showNews(news));
      this.room.send(MESSAGE.news, {});
    }

    // Nodos, inventarios y proyecto se refrescan con cada lote de cambios del servidor.
    this.room.onStateChange(() => this.refreshResources());
    this.refreshResources();

    this.room.onMessage(MESSAGE.rejected, ({ reason }: RejectedMessage) => {
      if (reason !== "movimiento-demasiado-rapido") this.hud.notify(REJECT_TEXT[reason]);
    });

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("Teclado no disponible");
    for (const [dir, codes] of Object.entries(KEY_CODES) as [Direction, string[]][]) {
      this.keys.set(dir, codes.map((code) => keyboard.addKey(code)));
    }
    keyboard.on("keydown", (event: KeyboardEvent) => {
      const dir = CODE_TO_DIRECTION[event.code];
      // Un toque se envía al momento si el ritmo lo permite; si no, queda pendiente para el bucle.
      if (dir && !this.trySendMove(dir, performance.now())) this.pending = dir;
      // Con el foco en un botón, Espacio pulsa el botón y no recolecta.
      if ((event.code === "Space" || event.code === "KeyE") && !isFormControl(event.target)) {
        event.preventDefault();
        if (!event.repeat) this.sendCollect();
      }
      // Cambio de vista (RF-010): P al proyecto, M al mapa; el juego sigue y nada se pierde.
      if (event.code === "KeyP" && !isTextInput(event.target)) {
        event.preventDefault();
        this.projectPanel?.focus();
      }
      if (event.code === "KeyM" && !isTextInput(event.target)) {
        event.preventDefault();
        const map = document.getElementById("game");
        map?.scrollIntoView({ block: "nearest" });
        map?.focus();
      }
    });
  }

  update() {
    // Mismo reloj que en keydown (performance.now) para que el intervalo mínimo sea coherente.
    const time = performance.now();
    let dir = this.pending;
    if (!dir) {
      for (const [held, keys] of this.keys) {
        if (keys.some((k) => k.isDown)) { dir = held; break; }
      }
    }
    if (dir && this.trySendMove(dir, time)) this.pending = undefined;
  }

  /** Envía un paso si ha pasado el intervalo mínimo del servidor (más un margen). */
  private trySendMove(dir: Direction, now: number): boolean {
    if (now - this.lastSentAt < this.config.moveCooldownMs + SEND_MARGIN_MS) return false;
    this.room.send(MESSAGE.move, STEPS[dir]);
    this.lastSentAt = now;
    return true;
  }

  private sendCollect() {
    const message: CollectMessage = { requestId: newRequestId() };
    this.room.send(MESSAGE.collect, message);
  }

  private deposit(resource: string, amount: number) {
    this.lastOwnAction = "deposit";
    const message: TransferMessage = { requestId: newRequestId(), resource, amount, to: "community" };
    this.room.send(MESSAGE.transfer, message);
  }

  private contribute(projectId: string, taskId: string, from: ContributionSource, amount: number) {
    if (from === "player") this.lastOwnAction = "contribute";
    const message: ContributeMessage = { requestId: newRequestId(), projectId, taskId, from, amount };
    this.room.send(MESSAGE.contribute, message);
  }

  private refreshResources() {
    const { state } = this.room;
    for (const [id, view] of this.nodeViews) {
      const units = state.nodes.get(id) ?? 0;
      view.label.setText(String(units));
      view.shape.setAlpha(units > 0 ? 1 : 0.3);
      view.label.setAlpha(units > 0 ? 1 : 0.6);
    }

    const me = state.players.get(this.room.sessionId);
    if (!me) return;
    const names = new Map(this.config.resources.map((r) => [r.id, r.name.toLowerCase()]));
    for (const r of this.config.resources) {
      const now = me.inventory.get(r.id) ?? 0;
      const before = this.lastInventory.get(r.id);
      if (before !== undefined && now > before) {
        this.hud.announceAction(`Has recogido ${now - before} de ${names.get(r.id)} (${now}/${this.config.inventoryMax}).`);
      } else if (before !== undefined && now < before && this.lastOwnAction === "deposit") {
        this.hud.announceAction(`Has depositado ${before - now} de ${names.get(r.id)} en la comunidad.`);
      }
      // Los aportes al proyecto los anuncia el panel del proyecto.
      this.lastInventory.set(r.id, now);
    }
    const row = (amount: (id: string) => number) => this.config.resources.map((r) => ({ id: r.id, name: r.name, amount: amount(r.id) }));
    this.hud.setInventory(row((id) => me.inventory.get(id) ?? 0), this.config.inventoryMax, (resource, amount) => this.deposit(resource, amount));
    this.hud.setCommunity(row((id) => state.community.get(id) ?? 0), state.communityName);

    const project = this.config.projects[0];
    const projectState = project && state.projects.get(project.id);
    if (this.projectPanel && projectState) {
      this.projectPanel.render({
        state: projectState,
        held: (resource) => me.inventory.get(resource) ?? 0,
        community: (resource) => state.community.get(resource) ?? 0,
        ownName: me.name,
      });
    }
  }

  private refreshPlayerList() {
    this.hud.setPlayers([...this.room.state.players.entries()].map(([sessionId, p]) => ({
      name: p.name, connected: p.connected, own: sessionId === this.room.sessionId,
    })));
  }

  private center(cell: number) {
    return cell * this.tile + this.tile / 2;
  }

  private drawMap() {
    const { width, height, defaultColor } = this.config.map;
    const t = this.tile;
    const g = this.add.graphics();
    g.fillStyle(hex(defaultColor)).fillRect(0, 0, width * t, height * t);
    for (const zone of this.config.zones) {
      g.fillStyle(hex(zone.color)).fillRect(zone.x * t, zone.y * t, zone.width * t, zone.height * t);
      this.add.text(zone.x * t + 6, zone.y * t + 4, zone.name, { fontSize: "14px", color: "#ffffff" }).setAlpha(0.8);
    }
    g.lineStyle(1, 0x000000, 0.12);
    for (let x = 0; x <= width; x++) g.lineBetween(x * t, 0, x * t, height * t);
    for (let y = 0; y <= height; y++) g.lineBetween(0, y * t, width * t, y * t);

    const resources = new Map(this.config.resources.map((r) => [r.id, r]));
    for (const node of this.config.nodes) {
      const r = resources.get(node.resource);
      if (!r) continue;
      const cx = this.center(node.x);
      const cy = this.center(node.y);
      const shape = this.add.graphics();
      this.drawShape(shape, r.shape, hex(r.color), cx, cy);
      const label = this.add.text(cx + t / 2 - 2, cy - t / 2 + 2, "", {
        fontSize: "11px", color: "#ffffff", backgroundColor: "#000000aa", padding: { x: 2, y: 0 },
      }).setOrigin(1, 0);
      this.nodeViews.set(node.id, { shape, label });
    }
  }

  private drawShape(g: Phaser.GameObjects.Graphics, shape: ResourceShape, color: number, cx: number, cy: number) {
    const s = this.tile / 2 - 4;
    g.fillStyle(color).lineStyle(2, 0x111111, 1);
    if (shape === "triangle") {
      g.fillTriangle(cx, cy - s, cx - s, cy + s, cx + s, cy + s).strokeTriangle(cx, cy - s, cx - s, cy + s, cx + s, cy + s);
    } else if (shape === "square") {
      g.fillRect(cx - s, cy - s, 2 * s, 2 * s).strokeRect(cx - s, cy - s, 2 * s, 2 * s);
    } else if (shape === "diamond") {
      const points = [new Phaser.Math.Vector2(cx, cy - s), new Phaser.Math.Vector2(cx + s, cy), new Phaser.Math.Vector2(cx, cy + s), new Phaser.Math.Vector2(cx - s, cy)];
      g.fillPoints(points, true).strokePoints(points, true);
    } else {
      g.fillCircle(cx, cy, s).strokeCircle(cx, cy, s);
    }
  }

  private addPlayer(callbacks: ReturnType<typeof Callbacks.get<WorldState>>, player: Player, sessionId: string) {
    const own = sessionId === this.room.sessionId;
    const body = this.add.circle(this.center(player.x), this.center(player.y), this.tile / 2 - 5, own ? 0xffd166 : 0x4fc3f7)
      .setStrokeStyle(2, 0x111111);
    const label = this.add.text(this.center(player.x), this.center(player.y), player.name, {
      fontSize: "12px", color: "#ffffff", backgroundColor: "#00000088", padding: { x: 3, y: 1 },
    });
    // Nombre encima del personaje; debajo en la fila superior para que no quede fuera del mapa.
    const placeLabel = (row: number) => {
      const below = row === 0;
      label.setOrigin(0.5, below ? 0 : 1);
      return this.center(row) + (below ? 1 : -1) * (this.tile / 2);
    };
    label.setY(placeLabel(player.y));
    this.views.set(sessionId, { body, label });
    if (this.announcing && !own) this.hud.announcePresence(`${player.name} se ha unido al mundo.`);
    let wasConnected = player.connected;

    const render = () => {
      const x = this.center(player.x);
      const y = this.center(player.y);
      this.tweens.add({ targets: body, x, y, duration: 90 });
      this.tweens.add({ targets: label, x, y: placeLabel(player.y), duration: 90 });
      // Un jugador en plazo de reconexión se ve semitransparente.
      body.setAlpha(player.connected ? 1 : 0.4);
      label.setAlpha(player.connected ? 1 : 0.6);
      if (player.connected !== wasConnected) {
        wasConnected = player.connected;
        if (!own) this.hud.announcePresence(`${player.name} ${player.connected ? "ha vuelto" : "ha perdido la conexión"}.`);
        this.refreshPlayerList();
      }
      if (own) {
        this.hud.setZone(this.index.zoneNameAt(player.x, player.y));
        this.hud.setPosition(player.name, player.x, player.y);
      }
    };
    callbacks.onChange(player, render);
    render();
    this.refreshPlayerList();
    if (own) {
      this.cameras.main.startFollow(body, true, 0.2, 0.2);
      // El estado inicial trae a todos los presentes junto al jugador propio; después,
      // cualquier llegada o salida es nueva y se anuncia. Temporizador del navegador y no
      // de Phaser: el bucle de Phaser se detiene con la pestaña en segundo plano.
      window.setTimeout(() => { this.announcing = true; }, 0);
    }
  }
}
