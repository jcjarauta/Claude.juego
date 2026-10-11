// Comprobación ESTÁTICA del DOM del cliente (G3b, Q212). Se ejecuta con `npm.cmd run dom`.
// Detecta: ids duplicados en una página, ids que el código busca y no existen, y relaciones ARIA (for, aria-labelledby,
// aria-describedby, aria-controls, href="#…") que apuntan a un id inexistente.
// NO es una prueba de regresión funcional: no dice si una pestaña se ve, si un botón hace lo que debe, en qué orden se
// recorre con Tab ni si una regla CSS sigue aplicándose. Eso lo cubren las pruebas T1–T4 (scripts/ui-smoke.js).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { idsOf, referencedIds, relationsOf } from "./dom-lib.ts";

const ROOT = new URL("../apps/client/", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");

/** Qué archivos del cliente buscan elementos de qué página. */
const PAGES: Record<string, string[]> = {
  "public/index.html": ["src/main.ts", "src/hud.ts", "src/project-panel.ts", "src/skills-panel.ts", "src/WorldScene.ts", "src/account.ts"],
  "public/panel.html": ["src/panel.ts", "src/admin-forms.ts", "src/account.ts", ...readdirSync(new URL("src/views/", ROOT)).map((f) => `src/views/${f}`)],
  "public/estilo.html": ["src/estilo.ts"],
};

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  ERROR ${msg}`); };

for (const [page, files] of Object.entries(PAGES)) {
  const html = read(page);
  const ids = idsOf(html);
  const set = new Set(ids);
  console.log(`${page}: ${set.size} ids`);
  const seen = new Set<string>();
  for (const id of ids) { if (seen.has(id)) fail(`${page}: id duplicado «${id}»`); seen.add(id); }
  for (const file of files) {
    for (const id of referencedIds(read(file))) if (!set.has(id)) fail(`${file} busca #${id}, que no existe en ${page}`);
  }
  for (const [attr, id, ctx] of relationsOf(html)) if (!set.has(id)) fail(`${page}: ${attr}="${id}" apunta a un id inexistente (${ctx.trim()})`);
}

// Las páginas no deben tener `tabindex` positivo (rompe el orden natural del foco).
for (const page of Object.keys(PAGES)) if (/tabindex="[1-9]/.test(read(page))) fail(`${page}: tabindex positivo`);

// Los archivos referidos existen (por si se renombra alguno).
for (const files of Object.values(PAGES)) for (const f of files) { try { read(f); } catch { fail(`no existe ${join("apps/client", f)}`); } }

console.log(failures ? `\nRESULTADO: ${failures} fallo(s)` : "\nRESULTADO: ids únicos, referencias del código y relaciones ARIA correctas (comprobación estática; no sustituye a las pruebas T1–T4)");
process.exit(failures ? 1 : 0);
