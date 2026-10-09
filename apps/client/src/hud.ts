// Textos fuera del canvas: legibles por lectores de pantalla.
// La zona se anuncia solo al cambiar; la posición no se anuncia para no saturar.

const byId = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el;
};

export function createHud() {
  const zone = byId("zona");
  const position = byId("posicion");
  const notice = byId("aviso");
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
  };
}

export type Hud = ReturnType<typeof createHud>;
