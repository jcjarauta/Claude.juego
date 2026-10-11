// Comprobación de accesibilidad de los tokens de diseño (G3a, Q202–Q203). Se ejecuta con `npm.cmd run a11y`.
//  1. Cada par texto/fondo declarado cumple 4,5:1 (texto) y cada par borde/fondo, 3:1 (componentes y foco; WCAG 1.4.3 y 1.4.11).
//  2. Los tamaños mínimos de objetivo cumplen WCAG 2.2 (2.5.8: 24 px) y el principal, 44 px.
//  3. Ningún otro archivo del cliente declara colores en hexadecimal: tokens.css es la única fuente.
//  4. Cada página tiene idioma, título, enlace de salto y un único `main`.
import { readFileSync } from "node:fs";

const PUBLIC = new URL("../apps/client/public/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, PUBLIC), "utf8");

const tokens = read("tokens.css");
const colors = new Map<string, string>();
for (const m of tokens.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) colors.set(m[1]!, m[2]!);
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

console.log("Pares de color (mínimo 4,5:1 texto, 3:1 componentes):");
let lowest = Infinity;
for (const [fg, bg, min, why] of PAIRS) {
  const a = colors.get(`color-${fg}`), b = colors.get(`color-${bg}`);
  if (!a || !b) { fail(`falta el token --color-${!a ? fg : bg}`); continue; }
  const r = ratio(a, b);
  lowest = Math.min(lowest, r / min);
  const ok = r >= min;
  console.log(`  ${ok ? "OK   " : "ERROR"} ${fg} sobre ${bg}: ${r.toFixed(2)}:1 (mín. ${min}) — ${why}`);
  if (!ok) failures++;
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

console.log(failures ? `\nRESULTADO: ${failures} fallo(s)` : `\nRESULTADO: todo correcto (${PAIRS.length} pares; margen mínimo: ${lowest.toFixed(2)}× sobre el mínimo exigido)`);
process.exit(failures ? 1 : 0);
