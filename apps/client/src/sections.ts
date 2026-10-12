import { el } from "./ui/dom.ts";

// Navegación lateral del panel profesional (G2, Q248): una sección visible a la vez, con foco al título al cambiar y `#hash` para
// recargar donde estabas. A la izquierda en pantallas anchas y arriba, en fila, en las estrechas. Los enlaces son los de un
// índice de la página (`<nav>` + `aria-current`), no pestañas: cambian de sección, no de vista dentro de una.

export interface SectionSpec {
  /** Identificador estable; es el `#hash`. */
  id: string;
  label: string;
  element: HTMLElement;
}

export interface Sections {
  nav: HTMLElement;
  select(id: string, focus?: boolean): void;
  current(): string;
}

/** La sección que pide un `#hash`, o la primera si no existe o no está disponible. */
export function sectionFromHash(hash: string, ids: readonly string[]): string {
  const wanted = decodeURIComponent(hash.replace(/^#/, ""));
  return ids.includes(wanted) ? wanted : ids[0]!;
}

export function setupSections(host: HTMLElement, specs: readonly SectionSpec[]): Sections {
  if (!specs.length) throw new Error("setupSections(): hace falta al menos una sección");
  const ids = specs.map((s) => s.id);
  const links = new Map<string, HTMLAnchorElement>();
  const list = el("ul", {}, ...specs.map((spec) => {
    const link = el("a", { href: `#${spec.id}` }, spec.label);
    links.set(spec.id, link);
    return el("li", {}, link);
  }));
  const nav = el("nav", { id: "secciones" }, list);
  nav.setAttribute("aria-label", "Secciones");
  const content = el("div", { className: "secciones" }, ...specs.map((s) => s.element));
  host.replaceChildren(el("div", { className: "layout" }, nav, content));
  let current = ids[0]!;

  const select = (id: string, focus = true) => {
    current = ids.includes(id) ? id : ids[0]!;
    for (const spec of specs) {
      const active = spec.id === current;
      spec.element.hidden = !active;
      const link = links.get(spec.id)!;
      if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    if (focus) {
      const target = specs.find((s) => s.id === current)!.element;
      const heading = target.querySelector<HTMLElement>("h2") ?? target;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  };
  for (const [id, link] of links) {
    link.onclick = (event) => {
      event.preventDefault();
      history.replaceState(null, "", `#${id}`);
      select(id);
    };
  }
  window.addEventListener("hashchange", () => select(sectionFromHash(location.hash, ids)));
  select(sectionFromHash(location.hash, ids), false);
  return { nav, select, current: () => current };
}
