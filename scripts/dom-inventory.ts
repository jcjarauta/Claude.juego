// Genera docs/dependencias-dom.md: inventario de los ids de las páginas del cliente y de quién depende de ellos (G3b, Q212).
// Uso: node scripts/dom-inventory.ts            (reescribe el documento; las secciones manuales viven en docs/dependencias-dom.manual.md)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { idsOf, referencedIds, relationsOf } from "./dom-lib.ts";

const ROOT = new URL("../apps/client/", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");
const views = readdirSync(new URL("src/views/", ROOT)).map((f) => `src/views/${f}`);
const PAGES: [string, string[]][] = [
  ["public/index.html", ["src/main.ts", "src/hud.ts", "src/project-panel.ts", "src/skills-panel.ts", "src/WorldScene.ts", "src/account.ts"]],
  ["public/panel.html", ["src/panel.ts", "src/admin-forms.ts", "src/account.ts", ...views]],
];

const lines: string[] = [];
lines.push("# Dependencias del DOM del cliente", "");
lines.push("> Generado por `node scripts/dom-inventory.ts` (G3b, puerta P0, Q212). **No editar a mano**: las notas manuales están en `docs/dependencias-dom.manual.md`. La comprobación estática es `npm.cmd run dom`; la regresión funcional son las pruebas T1–T4 (`scripts/ui-smoke.js`).", "");
lines.push("Cada fila es un `id` de la página. «Código» son los archivos que lo buscan por `byId`/`getElementById`/`querySelector(\"#…\")`; «ARIA» son las relaciones del HTML que lo apuntan (`for`, `aria-labelledby`, `aria-describedby`, `aria-controls`, `href=\"#…\"`); «CSS» son las reglas de la hoja de la página que lo nombran. **Regla de movimiento:** un elemento se mueve entero, con su `id` y sus relaciones; ningún `id` se renombra.", "");

for (const [page, files] of PAGES) {
  const html = read(page);
  const css = (html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "").split("\n");
  const ids = [...new Set(idsOf(html))];
  const usedBy = new Map<string, string[]>();
  for (const f of files) for (const id of referencedIds(read(f))) usedBy.set(id, [...(usedBy.get(id) ?? []), f.replace(/^src\//, "")]);
  const pointers = new Map<string, string[]>();
  for (const [attr, id] of relationsOf(html)) pointers.set(id, [...(pointers.get(id) ?? []), attr]);
  lines.push(`## ${page.replace("public/", "")} (${ids.length} ids)`, "", "| id | Código | ARIA (quién lo apunta) | CSS |", "|---|---|---|---|");
  for (const id of ids) {
    const rules = css.filter((l) => new RegExp(`#${id}\\b`).test(l)).map((l) => l.trim().split("{")[0]!.trim());
    lines.push(`| \`${id}\` | ${(usedBy.get(id) ?? []).join(", ") || "—"} | ${[...new Set(pointers.get(id) ?? [])].join(", ") || "—"} | ${[...new Set(rules)].map((r) => `\`${r}\``).join(", ") || "—"} |`);
  }
  lines.push("");
}

const manual = new URL("../docs/dependencias-dom.manual.md", import.meta.url);
if (existsSync(manual)) lines.push(readFileSync(manual, "utf8").trimEnd(), "");
writeFileSync(new URL("../docs/dependencias-dom.md", import.meta.url), lines.join("\n"));
console.log(`docs/dependencias-dom.md: ${PAGES.map(([p]) => p).join(", ")}`);
