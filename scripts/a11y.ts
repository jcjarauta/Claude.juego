// Comprobación de accesibilidad de los tokens de diseño (G3a, Q202–Q203). Se ejecuta con `npm.cmd run a11y`.
//  1. Cada par texto/fondo declarado cumple 4,5:1 (texto) y cada par borde/fondo, 3:1 (componentes y foco; WCAG 1.4.3 y 1.4.11).
//  2. Los tamaños mínimos de objetivo cumplen WCAG 2.2 (2.5.8: 24 px) y el principal, 44 px.
//  3. Ningún otro archivo del cliente declara colores en hexadecimal: tokens.css es la única fuente.
//  4. Cada página tiene idioma, título, enlace de salto y un único `main`.
import { readFileSync } from "node:fs";

const PUBLIC = new URL("../apps/client/public/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, PUBLIC), "utf8");

const tokens = read("tokens.css");
// El tema de alto contraste es el bloque `:root[data-contraste="alto"]`; el normal, todo lo anterior.
const HIGH_MARK = ':root[data-contraste="alto"]';
const normalCss = tokens.slice(0, tokens.indexOf(HIGH_MARK));
const highCss = tokens.slice(tokens.indexOf(HIGH_MARK));
const parseColors = (css: string) => new Map([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!] as [string, string]));
const normalColors = parseColors(normalCss);
const highColors = new Map([...normalColors, ...parseColors(highCss)]); // el alto contraste hereda lo que no redefine
const size = (name: string) => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(tokens)?.[1] ?? 0);

const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** [primer plano, fondo, mínimo, para qué sirve] */
const TEXT = 4.5, GRAPHIC = 3;
const PAIRS: [string, string, number, string][] = [
  ["texto", "fondo", TEXT, "texto de la página"], ["texto", "superficie", TEXT, "texto en tarjetas y paneles"],
  ["texto", "campo", TEXT, "texto en campos y tablas"], ["texto", "boton", TEXT, "texto de los botones"],
  ["texto", "mapa", TEXT, "etiquetas de diagramas"], ["texto", "nodo-recurso", TEXT, "nodo de recurso"], ["texto", "nodo-objeto", TEXT, "nodo de objeto"],
  ["texto-suave", "fondo", TEXT, "ayudas"], ["texto-suave", "superficie", TEXT, "ayudas en paneles"], ["texto-suave", "campo", TEXT, "ayudas bajo campos"],
  ["texto-apagado", "fondo", TEXT, "personas desconectadas"], ["texto-nodo", "mapa", TEXT, "segunda línea de los nodos"],
  ["acento", "fondo", TEXT, "avisos"], ["acento", "superficie", TEXT, "avisos en paneles"],
  ["info", "fondo", TEXT, "enlaces"], ["info", "superficie", TEXT, "enlaces en paneles"], ["info", "campo", TEXT, "enlaces en campos"],
  ["error", "fondo", TEXT, "errores"], ["error", "superficie", TEXT, "errores en paneles"], ["error", "campo", TEXT, "errores en tablas"],
  ["exito", "fondo", TEXT, "confirmaciones"], ["exito", "superficie", TEXT, "confirmaciones en paneles"], ["exito", "campo", TEXT, "estados en tablas"],
  ["borde-campo", "campo", GRAPHIC, "borde de los campos"], ["borde-campo", "fondo", GRAPHIC, "borde de las ofertas y campos"],
  ["borde-fuerte", "fondo", GRAPHIC, "borde del lienzo"], ["acento", "boton", GRAPHIC, "borde y foco de los botones"],
  ["acento", "campo", GRAPHIC, "foco en campos"], ["flecha", "campo", GRAPHIC, "flechas del diagrama"], ["flecha", "mapa", GRAPHIC, "flechas del diagrama"],
];

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  ERROR ${msg}`); };

let lowest = Infinity;
/** Tema normal: 4,5:1 texto y 3:1 componentes. Alto contraste: 7:1 texto y 4,5:1 componentes. */
for (const [theme, colors, textMin, graphicMin] of [["normal", normalColors, TEXT, GRAPHIC], ["alto contraste", highColors, 7, 4.5]] as const) {
  console.log(`Pares de color, tema ${theme} (mínimo ${textMin}:1 texto, ${graphicMin}:1 componentes):`);
  for (const [fg, bg, min, why] of PAIRS) {
    const need = min === TEXT ? textMin : graphicMin;
    const a = colors.get(`color-${fg}`), b = colors.get(`color-${bg}`);
    if (!a || !b) { fail(`falta el token --color-${!a ? fg : bg}`); continue; }
    const r = ratio(a, b);
    lowest = Math.min(lowest, r / need);
    const ok = r >= need;
    console.log(`  ${ok ? "OK   " : "ERROR"} ${fg} sobre ${bg}: ${r.toFixed(2)}:1 (mín. ${need}) — ${why}`);
    if (!ok) failures++;
  }
}

console.log("Tamaños de objetivo:");
for (const [name, min] of [["objetivo-min", 24], ["objetivo-principal", 44]] as const) {
  const v = size(name);
  console.log(`  ${v >= min ? "OK   " : "ERROR"} --${name}: ${v}px (mín. ${min})`);
  if (v < min) failures++;
}
if (!/min-height:\s*var\(--objetivo-min\)/.test(read("base.css"))) fail("base.css no aplica --objetivo-min a los controles");

console.log("Colores fuera de tokens.css:");
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
for (const file of ["index.html", "panel.html", "estilo.html", "base.css"]) {
  const hexes = withoutComments(read(file)).match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  if (hexes.length) fail(`${file} declara colores propios: ${[...new Set(hexes)].join(", ")}`); else console.log(`  OK    ${file}`);
}

console.log("Estructura de las páginas:");
for (const file of ["index.html", "panel.html", "estilo.html"]) {
  const html = read(file);
  const checks: [boolean, string][] = [
    [/<html lang="es">/.test(html), "idioma"], [/<title>[^<]+<\/title>/.test(html), "título"],
    [/class="saltar" href="#contenido"/.test(html), "enlace de salto"], [(html.match(/<main\b/g) ?? []).length === 1, "un único main"],
    [/href="\/tokens\.css"/.test(html) && /href="\/base\.css"/.test(html), "enlaza tokens y base"],
  ];
  for (const [ok, what] of checks) if (!ok) fail(`${file}: falta ${what}`);
  if (checks.every(([ok]) => ok)) console.log(`  OK    ${file}`);
}

console.log(failures ? `\nRESULTADO: ${failures} fallo(s)` : `\nRESULTADO: todo correcto (${PAIRS.length} pares en dos temas; margen mínimo: ${lowest.toFixed(2)}× sobre el mínimo exigido)`);
process.exit(failures ? 1 : 0);
