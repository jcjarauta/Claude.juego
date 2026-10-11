import { skillDefFromState, skillLevelName } from "@juego/shared";
import { el, type PanelRoom } from "./common.ts";

// «Habilidades» (F2c, Q195): qué habilidades hay, cómo se gana cada nivel y quién las tiene entre las personas conectadas.
// Solo lectura; crear y conceder se hace en los formularios de administración.

export function createSkillsView(room: PanelRoom) {
  const list = el("ul", { className: "habilidades-lista" });
  const holders = el("ul", { className: "habilidades-personas" });
  const section = el("section", {},
    el("h2", { id: "habilidades-vista-titulo" }, "Habilidades"),
    el("p", { className: "ayuda" }, "Cada habilidad es permanente y tiene niveles: se ganan fabricando una receta varias veces, por concesión de la administración o porque alguien con más nivel los enseña (un nivel por debajo del suyo)."),
    list,
    el("h3", {}, "Quién las tiene (personas conectadas)"),
    holders);
  section.setAttribute("aria-labelledby", "habilidades-vista-titulo");
  let last = "";
  return {
    element: section,
    render() {
      const { state } = room;
      const defs = [...state.skills.entries()].map(([id, s]) => skillDefFromState(id, s));
      const recipeName = (id: string) => state.recipes.get(id)?.name ?? id;
      const lines = defs.map((d) => `${d.name}${d.description ? ` — ${d.description}` : ""}. Niveles: ${d.levels
        .map((l, i) => `${i + 1}. ${l.name} (fabricar ${l.practice.times} ${l.practice.times === 1 ? "vez" : "veces"} «${recipeName(l.practice.recipe)}»)`).join("; ")}.`);
      const people = [...state.players.values()].filter((p) => p.skills.size > 0).map((p) => {
        const have = [...p.skills.entries()].map(([id, level]) => {
          const def = defs.find((d) => d.id === id);
          return def ? `${def.name} (${skillLevelName(def, level)})` : id;
        });
        return `${p.name}: ${have.join(", ")}.`;
      });
      const signature = [...lines, "#", ...people].join("\n");
      if (signature === last) return;
      last = signature;
      list.replaceChildren(...(lines.length ? lines.map((t) => el("li", {}, t)) : [el("li", {}, "Todavía no hay habilidades.")]));
      holders.replaceChildren(...(people.length ? people.map((t) => el("li", {}, t)) : [el("li", {}, "Nadie conectado tiene habilidades.")]));
    },
  };
}
