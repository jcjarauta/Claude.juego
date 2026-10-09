import * as Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import {
  createWorldIndex, MESSAGE, REJECT_TEXT,
  type MoveMessage, type Player, type RejectedMessage, type ResourceShape, type WorldConfig, type WorldIndex, type WorldState,
} from "@juego/shared";
import type { Hud } from "./hud.ts";

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

export class WorldScene extends Phaser.Scene {
  private room!: WorldRoom;
  private config!: WorldConfig;
  private hud!: Hud;
  private index!: WorldIndex;
  private tile = 32;
  private views = new Map<string, PlayerView>();
  private keys = new Map<Direction, Phaser.Input.Keyboard.Key[]>();
  private lastSentAt = -Infinity;
  /** Último toque recibido; se envía en cuanto el ritmo lo permite aunque la tecla ya se haya soltado. */
  private pending: Direction | undefined;

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
    callbacks.onRemove("players", (_player, sessionId) => {
      const view = this.views.get(sessionId);
      view?.body.destroy();
      view?.label.destroy();
      this.views.delete(sessionId);
    });

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
      if (dir) this.pending = dir;
    });
  }

  update(time: number) {
    if (time - this.lastSentAt < this.config.moveCooldownMs + SEND_MARGIN_MS) return;
    let dir = this.pending;
    this.pending = undefined;
    if (!dir) {
      for (const [held, keys] of this.keys) {
        if (keys.some((k) => k.isDown)) { dir = held; break; }
      }
    }
    if (!dir) return;
    this.room.send(MESSAGE.move, STEPS[dir]);
    this.lastSentAt = time;
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
      if (r) this.drawShape(g, r.shape, hex(r.color), this.center(node.x), this.center(node.y));
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

    const render = () => {
      const x = this.center(player.x);
      const y = this.center(player.y);
      this.tweens.add({ targets: body, x, y, duration: 90 });
      this.tweens.add({ targets: label, x, y: placeLabel(player.y), duration: 90 });
      if (own) {
        this.hud.setZone(this.index.zoneNameAt(player.x, player.y));
        this.hud.setPosition(player.name, player.x, player.y);
      }
    };
    callbacks.onChange(player, render);
    if (own) {
      this.cameras.main.startFollow(body, true, 0.2, 0.2);
      render();
    }
  }
}
