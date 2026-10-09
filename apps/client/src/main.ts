import * as Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { isValidName, joinErrorText, MAX_PLAYERS, ROOM_NAME, WorldState, type JoinOptions, type WorldConfig } from "@juego/shared";
import { createHud } from "./hud.ts";
import { WorldScene, type WorldRoom, type WorldSceneData } from "./WorldScene.ts";

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 576;
const NAME_KEY = "juego.nombre";

// Recordar el nombre es una comodidad: si el almacenamiento no está disponible, se ignora.
const storage = {
  get: () => { try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; } },
  set: (name: string) => { try { localStorage.setItem(NAME_KEY, name); } catch { /* sin almacenamiento */ } },
};

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function join(name: string): Promise<WorldRoom> {
  const options: JoinOptions = { name };
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

function showForm(config: WorldConfig, initialError = "") {
  const form = byId<HTMLFormElement>("entrada");
  const input = byId<HTMLInputElement>("nombre");
  const error = byId<HTMLElement>("nombre-error");
  form.hidden = false;
  input.value = storage.get();
  error.textContent = initialError;
  input.setAttribute("aria-invalid", String(Boolean(initialError)));
  input.focus();

  form.onsubmit = async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!isValidName(name)) {
      error.textContent = joinErrorText("nombre-invalido");
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    error.textContent = "Entrando…";
    try {
      const room = await join(name);
      storage.set(name);
      startGame(room, config);
    } catch (err) {
      error.textContent = joinErrorText((err as Error).message);
      input.setAttribute("aria-invalid", "true");
      input.focus();
    }
  };
}

async function start() {
  // La configuración llega ya validada por el servidor (content/world.json).
  const config = (await (await fetch("/config")).json()) as WorldConfig;
  // ?name= entra directamente (útil para pruebas); si falla, se muestra el formulario con el motivo.
  const fromUrl = new URLSearchParams(location.search).get("name");
  if (fromUrl) {
    // Tras una recarga, la salida de la página anterior puede llegar al servidor después
    // que esta entrada: se reintenta brevemente si el nombre o la plaza siguen ocupados.
    for (let attempt = 1; ; attempt++) {
      try {
        startGame(await join(fromUrl), config);
        return;
      } catch (err) {
        const message = (err as Error).message;
        const transient = message.includes("nombre-en-uso") || message.includes("no rooms found");
        if (!transient || attempt >= 3) return showForm(config, joinErrorText(message));
        await new Promise((r) => setTimeout(r, 700));
      }
    }
  }
  showForm(config);
}

start();
