import { solarProblems, structureDefFromState, type MapContext, type WorldConfig } from "@juego/shared";
import { el, type PanelRoom } from "./common.ts";

// Previsualización del solar de una construcción (F2a): minimapa SVG con nodos, solares, edificios,
// punto de aparición y el solar propuesto, más un texto que dice si cabe y por qué no. Usa la misma
// regla que el servidor (`solarProblems`), que sigue siendo quien decide.

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};

export interface Solar {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export function createMinimap(config: WorldConfig, room: PanelRoom) {
  const { width, height } = config.map;
  const cell = Math.max(6, Math.min(16, Math.floor(480 / Math.max(width, height))));
  const nodeColor = new Map(config.resources.map((r) => [r.id, r.color]));
  const nodeCells = new Set(config.nodes.map((n) => `${n.x},${n.y}`));
  const box = el("div", { className: "minimapa" });
  const status = el("p", { role: "status", className: "estado-solar" });
  const root = el("div", {}, box, status);
  let current: Solar | undefined;
  let lastSignature = "";

  function mapContext(): MapContext {
    return {
      width, height, nodeCells, spawn: config.spawn, side: config.buildLimits.side,
      structures: [...room.state.structures.entries()].map(([id, s]) => structureDefFromState(id, s)),
    };
  }

  function draw() {
    const structures = [...room.state.structures.entries()];
    const solar = current;
    const signature = JSON.stringify([structures.map(([id, s]) => [id, s.x, s.y, s.width, s.height, s.built]), solar]);
    if (signature === lastSignature) return;
    lastSignature = signature;

    const problems = solar ? solarProblems(solar, mapContext()) : [];
    const chart = svg("svg", {
      viewBox: `0 0 ${width * cell} ${height * cell}`, role: "img", class: "minimapa-svg",
      "aria-labelledby": "minimapa-titulo minimapa-desc",
    });
    chart.append(
      svg("title", { id: "minimapa-titulo" }, "Mapa del mundo con el solar propuesto"),
      svg("desc", { id: "minimapa-desc" }, `Mapa de ${width} por ${height} casillas con los recursos, el punto de aparición, los solares y edificios existentes y el solar propuesto. El texto de debajo dice si cabe.`),
      svg("rect", { x: 0, y: 0, width: width * cell, height: height * cell, class: "mapa-fondo" }),
    );
    for (const n of config.nodes) {
      chart.append(svg("rect", { x: n.x * cell + 1, y: n.y * cell + 1, width: cell - 2, height: cell - 2, fill: nodeColor.get(n.resource) ?? "#888888", class: "mapa-nodo" }));
    }
    chart.append(svg("circle", { cx: config.spawn.x * cell + cell / 2, cy: config.spawn.y * cell + cell / 2, r: cell / 2.2, class: "mapa-aparicion" }));
    for (const [, s] of structures) {
      chart.append(svg("rect", {
        x: s.x * cell, y: s.y * cell, width: s.width * cell, height: s.height * cell, fill: s.color,
        class: s.built ? "mapa-edificio" : "mapa-solar-existente",
      }));
    }
    if (solar && Number.isFinite(solar.x) && Number.isFinite(solar.y)) {
      chart.append(svg("rect", {
        x: solar.x * cell, y: solar.y * cell, width: Math.max(1, solar.width) * cell, height: Math.max(1, solar.height) * cell,
        class: problems.length ? "mapa-propuesto mal" : "mapa-propuesto bien",
      }));
    }
    box.replaceChildren(chart);

    status.textContent = !solar ? "Elige la posición y el tamaño del solar para ver si cabe."
      : problems.length ? `No cabe: ${problems.join("; ")}.`
        : `El solar de ${solar.width}×${solar.height} en (${solar.x}, ${solar.y}) cabe.`;
    status.className = `estado-solar ${!solar ? "" : problems.length ? "no-cabe" : "cabe"}`;
  }

  return {
    element: root,
    /** Actualiza el solar propuesto (o `undefined` si aún no hay) y devuelve sus problemas. */
    update(solar: Solar | undefined): string[] {
      current = solar;
      draw();
      return solar ? solarProblems(solar, mapContext()) : [];
    },
    /** Repinta si cambian los solares existentes. */
    render: draw,
  };
}
