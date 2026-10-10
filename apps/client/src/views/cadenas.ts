import {
  chainDiagram, chainLine, chainMissing, describeChains, recipeDefFromState, structureDefFromState,
  type ChainEntry, type WorldConfig, type WorldState,
} from "@juego/shared";
import { el, type PanelRoom } from "./common.ts";

// «Cadenas de producción» (F2b, Q190–Q192): las recetas del mundo como lista de texto accesible y como diagrama
// de flechas (recursos → recetas → objetos). El diagrama es un complemento: la lista dice lo mismo.

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Recetas del estado sincronizado descritas para mostrarlas (con existencias si se pasa `stock`). */
export function chainsFromState(state: WorldState, config: WorldConfig, stock?: (id: string) => number): ChainEntry[] {
  const resourceName = new Map(config.resources.map((r) => [r.id, r.name]));
  const structures = new Map([...state.structures.entries()].map(([id, s]) => [id, { def: structureDefFromState(id, s), built: s.built }]));
  return describeChains({
    recipes: [...state.recipes.entries()].map(([id, r]) => recipeDefFromState(id, r)),
    building: (id) => { const s = structures.get(id); return s && { name: s.def.name, built: s.built }; },
    entryName: (id) => resourceName.get(id) ?? state.items.get(id)?.name ?? id,
    isItem: (id) => state.items.has(id),
    ...(stock ? { stock } : {}),
  });
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Diagrama SVG de las recetas; `role="img"` con título y descripción, y la lista de texto como alternativa. */
export function chainDiagramSvg(entries: readonly ChainEntry[]): SVGSVGElement | HTMLElement {
  if (!entries.length) return el("p", { className: "ayuda" }, "Todavía no hay recetas que dibujar.");
  const diagram = chainDiagram(entries);
  const W = 150, H = 46, GX = 44, GY = 14, PAD = 8;
  const x = (column: number) => PAD + column * (W + GX);
  const y = (row: number) => PAD + row * (H + GY);
  const width = PAD * 2 + diagram.columns * W + (diagram.columns - 1) * GX;
  const height = PAD * 2 + diagram.rows * H + (diagram.rows - 1) * GY;
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", class: "cadenas-svg", "aria-labelledby": "cadenas-svg-titulo cadenas-svg-desc" });
  chart.append(
    svg("title", { id: "cadenas-svg-titulo" }, "Diagrama de las cadenas de producción"),
    svg("desc", { id: "cadenas-svg-desc" }, `Recursos, recetas y objetos de izquierda a derecha, con ${diagram.nodes.length} elementos y ${diagram.edges.length} flechas. La lista de texto de debajo describe lo mismo.`),
    (() => {
      const defs = svg("defs");
      const marker = svg("marker", { id: "cadenas-flecha", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
      marker.append(svg("path", { d: "M0,0 L8,4 L0,8 z", class: "cadenas-punta" }));
      defs.append(marker);
      return defs;
    })(),
  );
  const at = new Map(diagram.nodes.map((n) => [n.key, n]));
  for (const edge of diagram.edges) {
    const from = at.get(edge.from)!, to = at.get(edge.to)!;
    const x1 = x(from.column) + W, y1 = y(from.row) + H / 2, x2 = x(to.column), y2 = y(to.row) + H / 2, mid = (x1 + x2) / 2;
    chart.append(svg("path", { d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2 - 2},${y2}`, class: "cadenas-flecha", "marker-end": "url(#cadenas-flecha)" }));
    if (edge.amount > 1) chart.append(svg("text", { x: mid, y: (y1 + y2) / 2 - 3, class: "cadenas-cantidad", "text-anchor": "middle" }, `×${edge.amount}`));
  }
  for (const node of diagram.nodes) {
    const group = svg("g", { class: `cadenas-nodo ${node.kind}${node.kind === "recipe" && !node.built ? " sin-construir" : ""}` });
    group.append(
      svg("title", {}, node.sub ? `${node.label}. ${node.sub}` : node.label),
      svg("rect", { x: x(node.column), y: y(node.row), width: W, height: H, rx: 6 }),
      svg("text", { x: x(node.column) + W / 2, y: y(node.row) + (node.sub ? 19 : 28), "text-anchor": "middle" }, truncate(node.label, 22)),
    );
    if (node.sub) group.append(svg("text", { x: x(node.column) + W / 2, y: y(node.row) + 35, "text-anchor": "middle", class: "sub" }, truncate(node.sub, 24)));
    chart.append(group);
  }
  return chart;
}

/** Sección del panel: lista de recetas (texto) y diagrama; se repinta solo si cambian recetas, objetos o edificios. */
export function createChains(room: PanelRoom, config: WorldConfig) {
  const list = el("ul", { className: "cadenas-lista" });
  const diagramBox = el("div", { className: "cadenas-diagrama" });
  const section = el("section", {},
    el("h2", { id: "cadenas-titulo" }, "Cadenas de producción"),
    el("p", { className: "ayuda" }, "Qué receta produce cada objeto, en qué edificio y con qué. Lo que está «sin construir» no se puede fabricar todavía."),
    list, diagramBox);
  section.setAttribute("aria-labelledby", "cadenas-titulo");
  let last = "";
  return {
    element: section,
    render() {
      const entries = chainsFromState(room.state, config);
      const signature = entries.map((e) => `${chainLine(e)}`).join("\n");
      if (signature === last) return;
      last = signature;
      list.replaceChildren(...(entries.length
        ? entries.map((e) => el("li", {}, chainLine(e)))
        : [el("li", {}, "Todavía no hay recetas.")]));
      diagramBox.replaceChildren(chainDiagramSvg(entries));
    },
  };
}

export { chainMissing };
