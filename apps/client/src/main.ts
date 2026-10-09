import * as Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { MAX_PLAYERS, ROOM_NAME, WorldState, type JoinOptions, type WorldConfig } from "@juego/shared";
import { enter, logout } from "./account.ts";
import { createHud } from "./hud.ts";
import { WorldScene, type WorldRoom, type WorldSceneData } from "./WorldScene.ts";

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 576;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function join(token: string): Promise<WorldRoom> {
  const options: JoinOptions = { token };
  return new Client(location.origin).join(ROOM_NAME, options, WorldState);
}

function startGame(room: WorldRoom, config: WorldConfig) {
  byId<HTMLFormElement>("entrada").hidden = true;
  byId<HTMLElement>("partida").hidden = false;
  const hud = createHud(MAX_PLAYERS);

  // Reconexión automática del SDK también en los primeros segundos de sesión.
  room.reconnection.minUptime = 0;
  room.onDrop(() => hud.setConnection("Conexión perdida, reconectando…"));
  room.onReconnect(() => hud.setConnection("Reconectado."));
  room.onLeave(() => {
    hud.setConnection("Desconectado del servidor.");
    hud.offerRejoin(() => location.reload());
  });
  // Cerrar o recargar la pestaña es una salida voluntaria: libera la plaza al momento.
  // El plazo de reconexión queda para los cortes de red.
  window.addEventListener("pagehide", () => { void room.leave(true); });
  byId<HTMLButtonElement>("salir").onclick = async () => {
    await room.leave(true);
    await logout();
    location.reload();
  };

  // Al entrar, el foco pasa al mapa: se puede jugar con el teclado sin buscarlo (TP-11).
  byId<HTMLElement>("game").focus();

  const data: WorldSceneData = { room, config, hud };
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#15191e",
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY, width: VIEW_WIDTH, height: VIEW_HEIGHT },
    callbacks: {
      postBoot: (game) => { game.scene.add("world", WorldScene, true, data); },
    },
  });
}

async function start() {
  // La configuración llega ya validada por el servidor (content/world.json).
  const config = (await (await fetch("/config")).json()) as WorldConfig;
  const { room } = await enter(join);
  startGame(room, config);
}

start();
