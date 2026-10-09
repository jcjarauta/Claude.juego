// Textos fuera del canvas: legibles por lectores de pantalla.
// La zona se anuncia solo al cambiar; la posición no se anuncia para no saturar.

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

export interface PlayerListItem {
  name: string;
  connected: boolean;
  own: boolean;
}

export function createHud(maxPlayers: number) {
  const zone = byId("zona");
  const position = byId("posicion");
  const notice = byId("aviso");
  const connection = byId("conexion");
  const presence = byId("presencia");
  const title = byId("jugadores-titulo");
  const list = byId<HTMLUListElement>("jugadores");
  const rejoin = byId<HTMLButtonElement>("volver");
  let clearTimer: number | undefined;

  return {
    setZone(name: string) {
      if (zone.textContent !== name) zone.textContent = name;
    },
    setPosition(name: string, x: number, y: number) {
      position.textContent = `${name} en la casilla ${x}, ${y}`;
    },
    notify(text: string) {
      notice.textContent = text;
      window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => { notice.textContent = ""; }, 2500);
    },
    /** Llegadas y salidas de otros jugadores (anuncio cortés). */
    announcePresence(text: string) {
      presence.textContent = text;
    },
    setConnection(text: string) {
      connection.textContent = text;
    },
    setPlayers(players: PlayerListItem[]) {
      title.textContent = `Jugadores ${players.length}/${maxPlayers}`;
      list.replaceChildren(...players
        .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name))
        .map((p) => {
          const li = document.createElement("li");
          li.textContent = `${p.name}${p.own ? " (tú)" : ""}${p.connected ? "" : " — reconectando"}`;
          if (!p.connected) li.className = "desconectado";
          return li;
        }));
    },
    offerRejoin(onRejoin: () => void) {
      rejoin.hidden = false;
      rejoin.onclick = onRejoin;
      rejoin.focus();
    },
  };
}

export type Hud = ReturnType<typeof createHud>;
