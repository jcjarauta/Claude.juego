import * as Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { MAX_PLAYERS, ROOM_NAME, WorldState, type JoinOptions, type WorldConfig } from "@juego/shared";
import { enter, logout } from "./account.ts";
import { createFeed } from "./feed.ts";
import { createHud } from "./hud.ts";
import { createLiveRegions, startAnnouncer } from "./ui/announcer.ts";
import { setupFrame } from "./frame.ts";
import { createConsole } from "./ui/console-log.ts";
import { applyPreferences, loadPreferences } from "./ui/preferences.ts";
import { setupTabs } from "./ui/tabs.ts";
import { rememberedTab } from "./ui/tab-activity.ts";
import type { Preferences } from "./ui/preferences-model.ts";
import { WorldScene, type WorldRoom, type WorldSceneData } from "./WorldScene.ts";

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 576;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function join(token: string): Promise<WorldRoom> {
  const options: JoinOptions = { token };
  return new Client(location.origin).join(ROOM_NAME, options, WorldState);
}

function startGame(room: WorldRoom, config: WorldConfig, asked: boolean, prefs: Preferences) {
  byId<HTMLFormElement>("entrada").hidden = true;
  byId<HTMLElement>("partida").hidden = false;
  const hud = createHud(MAX_PLAYERS);

  // Fuente única de eventos (G3b, P3): consola (Importantes e Historial) y anunciador accesible cuelgan de ella.
  const feed = createFeed();
  let frame: ReturnType<typeof setupFrame> | undefined;
  const gameConsole = createConsole({
    log: feed.log, center: feed.center, expanded: prefs.console === "desplegada",
    onAction: (key, action) => { if (!frame?.handleAction(key, action)) feed.act(key, action); },
  });
  byId<HTMLElement>("zona-consola").append(gameConsole.element);
  const announcer = startAnnouncer(feed.events, createLiveRegions(byId<HTMLElement>("partida")), prefs.announcements);
  window.setInterval(() => feed.center.tick(Date.now()), 1000);

  // Panel contextual con pestañas (G3b, Q206): se recuerda la última pestaña elegida (con try/catch: el almacenamiento puede no estar disponible).
  const TAB_KEY = "engremiat.pestana";
  const TABS = ["proyecto", "taller", "habilidades", "cadenas", "comunidad", "guia"];
  const panelTabs = setupTabs(byId<HTMLElement>("proyecto"), (tab) => {
    try { localStorage.setItem(TAB_KEY, tab.id.replace("tab-", "")); } catch { /* sin almacenamiento: no se recuerda */ }
    frame?.onTabSelected(tab.id.replace("tab-", ""));
    if (tab.id === "tab-guia") document.dispatchEvent(new CustomEvent("pestana-guia"));
  });
  let saved: string | null = null;
  try { saved = localStorage.getItem(TAB_KEY); } catch { /* sin almacenamiento */ }
  const first = document.getElementById(`tab-${rememberedTab(saved, TABS, "proyecto")}`) as HTMLButtonElement | null;
  if (first) panelTabs.select(first, false);
  // Regla de actividad, diálogos de Ayuda y Accesibilidad y atajos ? y C (P4).
  frame = setupFrame({ feed, console: gameConsole, announcer, tabs: panelTabs, prefs });
  // Otras partes (la tecla P, construir un edificio) piden mostrar una pestaña con este evento; cambiar el foco es cosa de quien lo pide.
  document.addEventListener("mostrar-pestana", (event) => {
    const tab = document.getElementById(`tab-${(event as CustomEvent<string>).detail}`) as HTMLButtonElement | null;
    if (tab) panelTabs.select(tab, false);
  });

  // Reconexión automática del SDK también en los primeros segundos de sesión.
  room.reconnection.minUptime = 0;
  room.onDrop(() => {
    hud.setConnection("Conexión perdida, reconectando…");
    feed.emit({ kind: "conexion", importance: "critica", own: true, key: "conexion", text: "Conexión perdida, reconectando…" });
  });
  room.onReconnect(() => {
    hud.setConnection("Reconectado.");
    feed.resolve("conexion"); // la operación (reconectar) ha terminado: se resuelve el aviso
    feed.emit({ kind: "conexion", importance: "normal", own: true, priority: 1, text: "Reconectado." });
  });
  room.onLeave(() => {
    hud.setConnection("Desconectado del servidor.");
    feed.emit({ kind: "conexion", importance: "critica", own: true, key: "conexion", text: "Desconectado del servidor. Recarga la página para volver." });
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

  // Tras rellenar el formulario de entrada, el foco pasa al mapa: se puede jugar con el teclado sin buscarlo (TP-11).
  // Si la sesión ya estaba guardada no se mueve el foco: el primer Tab llega al enlace «Saltar al contenido» (WCAG 2.4.1).
  if (asked) byId<HTMLElement>("game").focus();

  const data: WorldSceneData = { room, config, hud, feed };
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
  const prefs = loadPreferences();
  applyPreferences(prefs);
  const { room, asked } = await enter(join);
  startGame(room, config, asked, prefs);
}

start();
