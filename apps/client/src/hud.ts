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

export interface ResourceRow {
  id: string;
  name: string;
  amount: number;
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
  const actions = byId("acciones");
  const inventory = byId<HTMLTableSectionElement>("inventario");
  const community = byId<HTMLTableSectionElement>("comunidad");
  const communityTitle = byId("comunidad-titulo");
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
    /** Resultado de las propias acciones (recolectar, depositar). */
    announceAction(text: string) {
      actions.textContent = text;
    },
    /**
     * Inventario propio con botones de depósito. Las filas se crean una vez y luego solo
     * cambian los textos, para no perder el foco del botón que se está usando.
     */
    setInventory(rows: ResourceRow[], max: number, onDeposit: (resource: string, amount: number) => void) {
      for (const row of rows) {
        let tr = inventory.querySelector<HTMLTableRowElement>(`tr[data-resource="${row.id}"]`);
        if (!tr) {
          tr = document.createElement("tr");
          tr.dataset.resource = row.id;
          const name = document.createElement("th");
          name.scope = "row";
          name.textContent = row.name;
          const amount = document.createElement("td");
          const buttons = document.createElement("td");
          for (const [label, all] of [["Depositar 1", false], ["Depositar todo", true]] as const) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.setAttribute("aria-label", `${label} de ${row.name.toLowerCase()}`);
            button.onclick = () => {
              const held = Number(tr!.dataset.amount ?? 0);
              if (held > 0) onDeposit(row.id, all ? held : 1);
            };
            buttons.append(button);
          }
          tr.append(name, amount, buttons);
          inventory.append(tr);
        }
        tr.dataset.amount = String(row.amount);
        const cell = tr.children[1] as HTMLTableCellElement;
        cell.textContent = `${row.amount}/${max}`;
        cell.className = row.amount >= max ? "lleno" : "";
        // aria-disabled (no disabled): el botón conserva el foco aunque el saldo llegue a 0.
        for (const button of tr.querySelectorAll("button")) button.setAttribute("aria-disabled", String(row.amount === 0));
      }
    },
    setCommunity(rows: ResourceRow[], communityName?: string) {
      if (communityName) communityTitle.textContent = `Almacén: ${communityName}`;
      community.replaceChildren(...rows.map((row) => {
        const tr = document.createElement("tr");
        const name = document.createElement("th");
        name.scope = "row";
        name.textContent = row.name;
        const amount = document.createElement("td");
        amount.textContent = String(row.amount);
        tr.append(name, amount);
        return tr;
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
