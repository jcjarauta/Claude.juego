// Funciones puras para analizar el DOM estático del cliente (G3b): usadas por scripts/dom.ts y scripts/dom-inventory.ts.

/** Ids de un HTML (atributo id="…"). */
export function idsOf(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
}

/** Ids literales que el código busca: byId("x"), getElementById("x"), querySelector("#x"). Los ids construidos con plantillas se ignoran. */
export function referencedIds(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/(?:byId|getElementById)(?:<[^>(]*>)?\(\s*"([^"$`]+)"\s*\)/g)) found.add(m[1]!);
  for (const m of source.matchAll(/querySelector(?:<[^>(]*>)?\(\s*["']#([\w-]+)["']/g)) found.add(m[1]!);
  return [...found];
}

/** Relaciones ARIA y de etiqueta del HTML: [atributo, id destino, texto de contexto]. */
export function relationsOf(html: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const m of html.matchAll(/<[^>]+>/g)) {
    const tag = m[0];
    for (const attr of ["for", "aria-labelledby", "aria-describedby", "aria-controls"]) {
      const value = new RegExp(`\\s${attr}="([^"]+)"`).exec(tag)?.[1];
      if (value) for (const id of value.split(/\s+/)) out.push([attr, id, tag.slice(0, 60)]);
    }
    const href = /\shref="#([^"]+)"/.exec(tag)?.[1];
    if (href) out.push(["href", href, tag.slice(0, 60)]);
  }
  return out;
}
