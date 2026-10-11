import { el } from "./dom.ts";

// Tabla de datos (G3a, Q203): `<table>` nativa con `<caption>` y cabeceras de columna con `scope="col"`.
// Las tablas con muchas columnas se envuelven en un contenedor con desplazamiento para no obligar a desplazar la página.

export function dataTable(caption: string, headers: string[], rows: (string | Node)[][]): HTMLElement {
  if (!caption) throw new Error("dataTable(): la leyenda es obligatoria (accesibilidad)");
  const table = el("table", {},
    el("caption", {}, caption),
    el("thead", {}, el("tr", {}, ...headers.map((h) => Object.assign(el("th", {}, h), { scope: "col" })))),
    el("tbody", {}, ...rows.map((cells) => el("tr", {}, ...cells.map((c) => el("td", {}, c))))));
  return el("div", { className: "tabla" }, table);
}
