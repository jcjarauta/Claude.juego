import { chainsFromState } from "./views/cadenas.ts";
import * as Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import {
  createWorldIndex, MESSAGE, projectDefFromState, recipeDefFromState, REJECT_TEXT, structureDefFromState,
  type BuildMessage, type CollectMessage, type ContributeMessage, type ContributionSource, type CraftMessage, type MoveMessage,
  type NewsMessage, type Player, type RejectedMessage, type ResourceShape, type TransferMessage, type WorldConfig, type WorldIndex,
  type WorldState,
} from "@juego/shared";
import type { Hud } from "./hud.ts";
import { createProjectPanel, type PanelActions, type ProjectPanel } from "./project-panel.ts";
import { newRequestId } from "./request-id.ts";

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

const isTextInput = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/** Controles donde las flechas y las letras tienen su propio uso (lista desplegable, texto): no mueven al personaje. */
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

const isFormControl = (target: EventTarget | null) =>
  target instanceof HTMLButtonElement || isEditable(target);

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
  /** Proyecto que se ve en el panel (F1a: hay varios; por defecto, el primero de la configuración). */
  private selectedProject: string | undefined;
  private projectOptions = "";
  /** Dibujo de cada estructura: contorno del solar o edificio construido. */
  private structureViews = new Map<string, { graphics: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text; built: boolean | undefined }>();
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

    // Panel del proyecto: por defecto el primero de la configuración; el selector cambia de proyecto (F1a).
    this.selectedProject = this.config.projects[0]?.id ?? [...this.room.state.projects.keys()][0];
    const selector = document.getElementById("proyecto-selector") as HTMLSelectElement;
    selector.onchange = () => {
      this.selectedProject = selector.value;
      this.openProjectPanel();
      this.refreshResources();
    };
    this.openProjectPanel();
    // Las novedades se piden ahora que el manejador está registrado (RF-013).
    this.room.onMessage(MESSAGE.news, (news: NewsMessage) => this.projectPanel?.showNews(news));
    this.room.send(MESSAGE.news, {});

    // Nodos, inventarios y proyecto se refrescan con cada lote de cambios del servidor.
    this.room.onStateChange(() => this.refreshResources());
    this.refreshResources();

    this.room.onMessage(MESSAGE.rejected, ({ reason }: RejectedMessage) => {
      if (reason !== "movimiento-demasiado-rapido") this.hud.notify(REJECT_TEXT[reason]);
    });

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("Teclado no disponible");
    for (const [dir, codes] of Object.entries(KEY_CODES) as [Direction, string[]][]) {
      // Sin captura global: Phaser no debe impedir las flechas en listas desplegables ni campos (TP-11).
      this.keys.set(dir, codes.map((code) => keyboard.addKey(code, false)));
    }
    // Pulsaciones escuchadas directamente en la ventana: Phaser las agrupa por fotograma y, si
    // los fotogramas se ralentizan (pestaña o panel en segundo plano), se reordenarían o perderían.
    // Phaser se mantiene solo para la tecla mantenida (isDown en update).
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = isEditable(event.target) ? undefined : CODE_TO_DIRECTION[event.code];
      if (dir) event.preventDefault(); // que las flechas no desplacen la página
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
    };
    window.addEventListener("keydown", onKeyDown);
    this.events.once("shutdown", () => window.removeEventListener("keydown", onKeyDown));
  }

  update() {
    // Mismo reloj que en keydown (performance.now) para que el intervalo mínimo sea coherente.
    const time = performance.now();
    let dir = this.pending;
    if (!dir && !isEditable(document.activeElement)) {
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

  private refreshStructures() {
    const t = this.tile;
    // Solares y edificios del estado (F2a): también los creados desde el panel; los retirados desaparecen.
    for (const [id, view] of [...this.structureViews]) {
      if (this.room.state.structures.has(id)) continue;
      view.graphics.destroy();
      view.label.destroy();
      this.structureViews.delete(id);
    }
    for (const [id, structure] of this.room.state.structures) {
      const def = structureDefFromState(id, structure);
      let view = this.structureViews.get(def.id);
      if (!view) {
        view = { graphics: this.add.graphics(), label: this.add.text(0, 0, "", { fontSize: "12px", color: "#ffffff", backgroundColor: "#00000099", padding: { x: 3, y: 1 } }).setOrigin(0.5), built: undefined };
        this.structureViews.set(def.id, view);
      }
      const built = structure.built;
      if (view.built === built) continue;
      view.built = built;
      const { graphics, label } = view;
      const [x, y, w, h] = [def.x * t, def.y * t, def.width * t, def.height * t];
      graphics.clear();
      if (built) {
        graphics.fillStyle(Number.parseInt(def.color.slice(1), 16)).fillRect(x + 2, y + 2, w - 4, h - 4);
        graphics.lineStyle(3, 0x111111, 1).strokeRect(x + 2, y + 2, w - 4, h - 4);
        graphics.fillStyle(0x3b2414).fillTriangle(x, y + 4, x + w / 2, y - t / 2, x + w, y + 4); // tejado
        label.setText(def.name);
      } else {
        // Solar: contorno discontinuo.
        graphics.lineStyle(2, 0xffd166, 0.9);
        const dash = 6;
        for (let i = 0; i < w; i += dash * 2) {
          graphics.lineBetween(x + i, y, x + Math.min(i + dash, w), y);
          graphics.lineBetween(x + i, y + h, x + Math.min(i + dash, w), y + h);
        }
        for (let i = 0; i < h; i += dash * 2) {
          graphics.lineBetween(x, y + i, x, y + Math.min(i + dash, h));
          graphics.lineBetween(x + w, y + i, x + w, y + Math.min(i + dash, h));
        }
        label.setText(`Solar: ${def.name}`);
      }
      label.setPosition(x + w / 2, y + h / 2);
    }
  }

  private panelActions: PanelActions = {
    contribute: (projectId, taskId, from, amount) => this.contribute(projectId, taskId, from, amount),
    build: (structureId) => this.room.send(MESSAGE.build, { requestId: newRequestId(), structureId } satisfies BuildMessage),
    craft: (recipeId) => this.room.send(MESSAGE.craft, { requestId: newRequestId(), recipeId } satisfies CraftMessage),
  };

  /** Crea el panel del proyecto elegido a partir de su definición en el estado. */
  private openProjectPanel() {
    const id = this.selectedProject;
    const projectState = id ? this.room.state.projects.get(id) : undefined;
    this.projectPanel = id && projectState ? createProjectPanel(this.config, projectDefFromState(id, projectState), this.panelActions) : undefined;
  }

  /** Opciones del selector: proyectos abiertos y cerrados, en orden de creación. */
  private refreshProjectSelector() {
    const selector = document.getElementById("proyecto-selector") as HTMLSelectElement;
    const entries = [...this.room.state.projects.entries()].sort(([, a], [, b]) => a.createdAt - b.createdAt);
    const options = entries.map(([id, p]) => `${id}|${p.name}|${p.phase}|${p.status}`).join(";");
    if (options === this.projectOptions) return;
    this.projectOptions = options;
    selector.replaceChildren(...entries.map(([id, p]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = `${p.name}${p.phase === "cerrado" ? " (cerrado)" : p.status === "completado" || p.status === "construido" ? " (completado)" : ""}`;
      return option;
    }));
    if (this.selectedProject) selector.value = this.selectedProject;
    if (!this.projectPanel && this.selectedProject) this.openProjectPanel();
  }

  private refreshResources() {
    const { state } = this.room;
    this.refreshStructures();
    this.refreshProjectSelector();
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
    const communityRows = [...row((id) => state.community.get(id) ?? 0),
      ...[...state.items.entries()].map(([id, i]) => ({ id, name: i.name, amount: state.community.get(id) ?? 0 }))];
    this.hud.setCommunity(communityRows, state.communityName);

    const projectId = this.selectedProject;
    const projectState = projectId ? state.projects.get(projectId) : undefined;
    if (this.projectPanel && projectId && projectState) {
      const structureEntry = [...state.structures.entries()].find(([, s]) => s.projectId === projectId);
      const structureDef = structureEntry && structureDefFromState(structureEntry[0], structureEntry[1]);
      this.projectPanel.render({
        state: projectState,
        structureDef,
        recipes: structureDef ? [...state.recipes.entries()].filter(([, r]) => r.structureId === structureDef.id).map(([id, r]) => recipeDefFromState(id, r)) : [],
        itemName: (id) => state.items.get(id)?.name.toLowerCase() ?? id,
        building: (id) => { const s = state.structures.get(id); return s && { name: s.name, built: s.built }; },
        chains: chainsFromState(state, this.config, (id) => state.community.get(id) ?? 0),
        held: (resource) => me.inventory.get(resource) ?? 0,
        community: (resource) => state.community.get(resource) ?? 0,
        ownName: me.name,
        structure: structureEntry?.[1],
        missions: [...state.missions.entries()],
        projectName: (id) => state.projects.get(id)?.name ?? id,
        position: { x: me.x, y: me.y },
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
