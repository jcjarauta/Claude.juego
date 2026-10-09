import * as Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { ROOM_NAME, WorldState, type JoinOptions, type WorldConfig } from "@juego/shared";
import { createHud } from "./hud.ts";
import { WorldScene, type WorldSceneData } from "./WorldScene.ts";

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 576;

async function start() {
  const hud = createHud();
  const name = new URLSearchParams(location.search).get("name") ?? `jugador-${Math.floor(Math.random() * 1000)}`;

  // La configuración llega ya validada por el servidor (content/world.json).
  const config = (await (await fetch("/config")).json()) as WorldConfig;

  const client = new Client(location.origin);
  let room;
  try {
    const options: JoinOptions = { name };
    room = await client.join(ROOM_NAME, options, WorldState);
  } catch (err) {
    hud.notify(`No se pudo entrar en el mundo: ${(err as Error).message}`);
    return;
  }
  room.onLeave(() => hud.notify("Desconectado del servidor."));

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

start();
