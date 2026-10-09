import * as Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";

const statusEl = document.getElementById("status");
const setStatus = (text) => { statusEl.textContent = text; };

const params = new URLSearchParams(location.search);
const name = params.get("name") ?? `jugador-${Math.floor(Math.random() * 1000)}`;

const KEY_STEPS = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
};
const REASONS = {
  "nodo-lejos": "Acércate al árbol para recolectar.",
  "nodo-agotado": "El árbol está agotado; se regenerará con el tiempo.",
  "inventario-lleno": "Inventario lleno.",
  "casilla-bloqueada": "No puedes pasar por ahí.",
};

class WorldScene extends Phaser.Scene {
  constructor() { super("world"); }

  init(data) {
    this.room = data.room;
    this.config = data.config;
  }

  create() {
    const { width, height, tileSize } = this.config.map;
    this.tile = tileSize;
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x2f3b45, 1);
    for (let x = 0; x <= width; x++) grid.lineBetween(x * tileSize, 0, x * tileSize, height * tileSize);
    for (let y = 0; y <= height; y++) grid.lineBetween(0, y * tileSize, width * tileSize, y * tileSize);

    this.playerViews = new Map();
    this.nodeViews = new Map();
    const callbacks = Callbacks.get(this.room);

    callbacks.onAdd("nodes", (node, id) => {
      const rect = this.add.rectangle(0, 0, tileSize - 4, tileSize - 4, 0x2e7d32);
      const label = this.add.text(0, 0, "", { fontSize: "14px", color: "#ffffff" }).setOrigin(0.5);
      const view = { rect, label };
      this.nodeViews.set(id, view);
      const render = () => {
        rect.setPosition(this.center(node.x), this.center(node.y));
        rect.setAlpha(node.units > 0 ? 1 : 0.35);
        label.setPosition(this.center(node.x), this.center(node.y)).setText(String(node.units));
        this.updateHud();
      };
      callbacks.onChange(node, render);
      render();
    });

    callbacks.onAdd("players", (player, sessionId) => {
      const own = sessionId === this.room.sessionId;
      const body = this.add.circle(0, 0, tileSize / 2 - 4, own ? 0xffd166 : 0x4fc3f7);
      const label = this.add.text(0, 0, player.name, { fontSize: "11px", color: "#ffffff" }).setOrigin(0.5, 1.6);
      this.playerViews.set(sessionId, { body, label });
      const render = () => {
        body.setPosition(this.center(player.x), this.center(player.y));
        label.setPosition(this.center(player.x), this.center(player.y));
        if (own) this.updateHud();
      };
      callbacks.onChange(player, render);
      render();
    });

    callbacks.onRemove("players", (player, sessionId) => {
      const view = this.playerViews.get(sessionId);
      view?.body.destroy();
      view?.label.destroy();
      this.playerViews.delete(sessionId);
    });

    this.room.onMessage("rejected", ({ reason }) => {
      if (REASONS[reason]) setStatus(REASONS[reason]);
    });

    this.input.keyboard.on("keydown", (event) => {
      const step = KEY_STEPS[event.code];
      if (step) {
        event.preventDefault();
        this.room.send("move", { dx: step[0], dy: step[1] });
      } else if (event.code === "Space" || event.code === "KeyE") {
        event.preventDefault();
        const nodeId = this.config.nodes[0].id;
        this.room.send("collect", { nodeId });
      }
    });
  }

  center(cell) { return cell * this.tile + this.tile / 2; }

  updateHud() {
    const me = this.room.state.players.get(this.room.sessionId);
    const node = this.room.state.nodes.get(this.config.nodes[0].id);
    if (!me || !node) return;
    setStatus(`${me.name}: ${me.madera} de madera. Árbol: ${node.units}/${node.max}. Posición ${me.x},${me.y}.`);
  }
}

async function start() {
  const config = await (await fetch("/config")).json();
  const client = new Client(location.origin);
  let room;
  try {
    room = await client.join("world", { name });
  } catch (err) {
    setStatus(`No se pudo entrar: ${err.message}`);
    return;
  }
  room.onLeave(() => setStatus("Desconectado del servidor."));

  const { width, height, tileSize } = config.map;
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: width * tileSize,
    height: height * tileSize,
    backgroundColor: "#22303a",
    scene: [],
    callbacks: {
      postBoot: (game) => game.scene.add("world", WorldScene, true, { room, config }),
    },
  });
}

start();
