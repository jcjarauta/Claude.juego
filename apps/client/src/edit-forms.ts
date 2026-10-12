import {
  itemDefFromState, missionDefFromState, projectDefFromState, recipeDefFromState, skillDefFromState, structureDefFromState,
  type BuildLimits, type WorldConfig, type WorldState,
} from "@juego/shared";
import type { LibraryKind } from "./library-model.ts";
import { dynamicList } from "./ui/dynamic-list.ts";
import { el } from "./ui/dom.ts";
import { field } from "./ui/field.ts";
import { syncGroupedOptions, syncOptions, type Option } from "./ui/select-options.ts";

// Formularios de edición de la Biblioteca (G2, Q243, Q244): cada tipo se rellena con lo vigente y devuelve la DEFINICIÓN COMPLETA
// propuesta (el servidor la valida con las mismas reglas que al crear, analiza qué cambia y pide confirmar). Aquí solo se ayuda a
// rellenar; lo que no se puede cambiar (lo cumplido, lo construido, los niveles ocupados) lo dice el servidor con su motivo.

export interface EditContext {
  state: WorldState;
  config: WorldConfig;
  limits: BuildLimits;
  announce: (text: string) => void;
}

export interface EditForm {
  element: HTMLElement;
  /** La definición propuesta, o los errores que se pueden ver sin preguntar al servidor. */
  read(): { def: Record<string, unknown> } | { errors: string[] };
  focus(): void;
}

const num = (input: HTMLInputElement) => (input.value.trim() === "" ? Number.NaN : Number(input.value));

function text(label: string, value: string, maxLength: number, help?: string) {
  const input = el("input", { maxLength, autocomplete: "off", value });
  return { input, wrapper: field(label, input, help) };
}

function choose(label: string, entries: Option[], value: string, help?: string) {
  const select = el("select");
  syncOptions(select, entries, "Elige una opción");
  select.value = value;
  return { select, wrapper: field(label, select, help) };
}

/** Los objetos activos y, además, los que ya usa la definición aunque estén archivados (para no perder la elección). */
const itemOptions = (state: WorldState, keep: string[] = []): Option[] =>
  [...state.items.entries()].filter(([id, i]) => !i.archived || keep.includes(id)).map(([id, i]): Option => [id, i.archived ? `${i.name} (archivado)` : i.name]);
const structureOptions = (state: WorldState, keep: string[] = []): Option[] =>
  [...state.structures.entries()].filter(([id, s]) => !s.retired || keep.includes(id)).map(([id, s]): Option => [id, s.retired ? `${s.name} (retirado)` : s.name]);

// ---------------------------------------------------------------------------------------------- objeto

function objectForm(id: string, ctx: EditContext): EditForm {
  const current = itemDefFromState(id, ctx.state.items.get(id)!);
  const name = text("Nombre", current.name, 60, "Un objeto no es un recurso: su nombre no puede coincidir con el de otro objeto ni con el de un recurso. Las recetas y misiones que lo usan siguen apuntando al mismo objeto con el nombre nuevo.");
  return {
    element: el("div", {}, name.wrapper),
    read: () => ({ def: { name: name.input.value.trim() } }),
    focus: () => name.input.focus(),
  };
}

// ---------------------------------------------------------------------------------------------- misión

function missionForm(id: string, ctx: EditContext): EditForm {
  const current = missionDefFromState(id, ctx.state.missions.get(id)!);
  const name = text("Nombre", current.name, 60);
  const description = text("Descripción", current.description, 500, "Opcional.");
  const kind = choose("Objetivo", [["item-in-community", "Tener un objeto en el almacén de la comunidad"], ["project-completed", "Completar un proyecto"]], current.objective.kind);
  kind.select.options[0]?.remove(); // sin la opción vacía: siempre hay un tipo
  kind.select.value = current.objective.kind;
  const item = choose("Objeto", itemOptions(ctx.state, current.objective.kind === "item-in-community" ? [current.objective.item] : []), current.objective.kind === "item-in-community" ? current.objective.item : "");
  const amount = el("input", { type: "number", min: "1", max: "1000", inputMode: "numeric", value: String(current.objective.kind === "item-in-community" ? current.objective.amount : 1) });
  const amountField = field("Cantidad", amount);
  const projects: Option[] = [...ctx.state.projects.entries()].filter(([pid, p]) => p.phase !== "cerrado" || (current.objective.kind === "project-completed" && current.objective.project === pid)).map(([pid, p]): Option => [pid, p.name]);
  const project = choose("Proyecto", projects, current.objective.kind === "project-completed" ? current.objective.project : "");
  const refresh = () => {
    const isItem = kind.select.value === "item-in-community";
    item.wrapper.hidden = !isItem;
    amountField.hidden = !isItem;
    project.wrapper.hidden = isItem;
  };
  kind.select.onchange = refresh;
  refresh();
  return {
    element: el("div", {}, name.wrapper, description.wrapper, kind.wrapper, item.wrapper, amountField, project.wrapper),
    read: () => ({
      def: {
        name: name.input.value.trim(), description: description.input.value.trim(),
        objective: kind.select.value === "item-in-community" ? { kind: "item-in-community", item: item.select.value, amount: num(amount) } : { kind: "project-completed", project: project.select.value },
      },
    }),
    focus: () => name.input.focus(),
  };
}

// ---------------------------------------------------------------------------------------------- habilidad

function skillForm(id: string, ctx: EditContext): EditForm {
  const current = skillDefFromState(id, ctx.state.skills.get(id)!);
  const name = text("Nombre", current.name, 60);
  const description = text("Descripción", current.description, 200, "Opcional.");
  const practice: Option[] = [...ctx.state.recipes.entries()].filter(([rid, r]) => (r.requiresSkills.size === 0 && !r.archived) || current.levels.some((l) => l.practice.recipe === rid)).map(([rid, r]): Option => [rid, r.name]);
  const levels = dynamicList({
    legend: "Niveles, de menor a mayor (se pueden añadir al final; los niveles que alguien ya tiene no se pueden quitar ni cambiar de sitio)", addLabel: "Añadir nivel", noun: "nivel", min: 1, max: () => ctx.limits.skillLevels, announce: ctx.announce, onChange: () => {},
    build: () => {
      const levelName = el("input", { maxLength: 30, autocomplete: "off" });
      const recipe = el("select");
      syncOptions(recipe, practice, "Elige una receta");
      const times = el("input", { type: "number", min: "1", max: "1000", value: "3", inputMode: "numeric" });
      const a = field("", levelName, undefined, { deferredLabel: true }), b = field("", recipe, undefined, { deferredLabel: true }), c = field("", times, undefined, { deferredLabel: true });
      return { levelName, recipe, times, controls: [a, b, c], labels: [a, b, c].map((w) => w.querySelector("label")!), first: levelName,
        names: (i: number) => [`Nivel ${i + 1}: nombre`, `Nivel ${i + 1}: receta que se practica`, `Nivel ${i + 1}: veces que hay que fabricarla`] };
    },
  });
  const rows = levels.resize(current.levels.length);
  rows.forEach((row, i) => { const l = current.levels[i]!; row.levelName.value = l.name; row.recipe.value = l.practice.recipe; row.times.value = String(l.practice.times); });
  return {
    element: el("div", {}, name.wrapper, description.wrapper, levels.element),
    read: () => ({ def: { name: name.input.value.trim(), description: description.input.value.trim(), levels: levels.rows.map((r) => ({ name: r.levelName.value.trim(), practice: { recipe: r.recipe.value, times: num(r.times) } })) } }),
    focus: () => name.input.focus(),
  };
}

// ---------------------------------------------------------------------------------------------- receta

function recipeForm(id: string, ctx: EditContext): EditForm {
  const current = recipeDefFromState(id, ctx.state.recipes.get(id)!);
  const used = [...Object.keys(current.inputs), current.output.item, ...(current.byproducts ?? []).map((b) => b.item)];
  const items = itemOptions(ctx.state, used);
  const buildings = structureOptions(ctx.state, [current.structureId, ...(current.alsoNeeds ?? [])]);
  const skills: Option[] = [...ctx.state.skills.entries()].filter(([sid, s]) => !s.archived || (current.requiresSkills ?? []).some((q) => q.skill === sid)).map(([sid, s]): Option => [sid, s.name]);
  const levelOptions = (skillId: string): Option[] => { const s = ctx.state.skills.get(skillId); return s ? skillDefFromState(skillId, s).levels.map((l, i): Option => [String(i + 1), `${i + 1}. ${l.name}`]) : []; };
  const name = text("Nombre", current.name, 60);
  const where = choose("Edificio donde se fabrica", buildings, current.structureId);
  const verb = text("Acción", current.verb ?? "", 20, "Opcional: «moler», «hornear»… Por omisión, «Fabricar».");
  const inputs = dynamicList({
    legend: "Entradas (recursos u objetos del almacén común)", addLabel: "Añadir entrada (recurso u objeto)", noun: "entrada", min: 1, max: () => ctx.limits.recipeInputs, announce: ctx.announce, onChange: () => {},
    build: () => {
      const entry = el("select");
      syncGroupedOptions(entry, [{ label: "Recursos", entries: ctx.config.resources.map((r): Option => [r.id, r.name]) }, { label: "Objetos", entries: items }], "Elige una entrada");
      const amount = el("input", { type: "number", min: "1", max: String(ctx.limits.inputAmount), value: "1", inputMode: "numeric" });
      const a = field("", entry, undefined, { deferredLabel: true }), b = field("", amount, undefined, { deferredLabel: true });
      return { entry, amount, controls: [a, b], labels: [a, b].map((w) => w.querySelector("label")!), first: entry, names: (i: number) => [`Entrada ${i + 1}: recurso u objeto`, `Cantidad de la entrada ${i + 1}`] };
    },
  });
  const output = choose("Objeto que produce", items, current.output.item);
  const outputAmount = el("input", { type: "number", min: "1", max: String(ctx.limits.outputAmount), value: String(current.output.amount), inputMode: "numeric" });
  const outputField = field("Cantidad que produce", outputAmount);
  const byproducts = dynamicList({
    legend: "Subproductos (opcionales)", addLabel: "Añadir subproducto", noun: "subproducto", min: 0, max: () => ctx.limits.byproducts, announce: ctx.announce, onChange: () => {},
    build: () => {
      const item = el("select");
      syncOptions(item, items, "Elige un objeto");
      const amount = el("input", { type: "number", min: "1", max: String(ctx.limits.outputAmount), value: "1", inputMode: "numeric" });
      const a = field("", item, undefined, { deferredLabel: true }), b = field("", amount, undefined, { deferredLabel: true });
      return { item, amount, controls: [a, b], labels: [a, b].map((w) => w.querySelector("label")!), first: item, names: (i: number) => [`Subproducto ${i + 1}: objeto`, `Cantidad del subproducto ${i + 1}`] };
    },
  });
  const extras = dynamicList({
    legend: "Otros edificios necesarios (opcionales)", addLabel: "Añadir edificio necesario", noun: "edificio", min: 0, max: () => ctx.limits.alsoNeeds, announce: ctx.announce, onChange: () => {},
    build: () => {
      const building = el("select");
      syncOptions(building, buildings, "Elige un edificio");
      const a = field("", building, undefined, { deferredLabel: true });
      return { building, controls: [a], labels: [a.querySelector("label")!], first: building, names: (i: number) => [`Edificio necesario ${i + 1} (debe estar construido, en cualquier lugar)`] };
    },
  });
  const needs = dynamicList({
    legend: "Habilidades necesarias (opcionales)", addLabel: "Añadir habilidad", noun: "habilidad", min: 0, max: () => ctx.limits.recipeSkills, announce: ctx.announce, onChange: () => {},
    build: () => {
      const skill = el("select");
      syncOptions(skill, skills, "Elige una habilidad");
      const level = el("select");
      skill.onchange = () => syncOptions(level, levelOptions(skill.value), "Elige el nivel mínimo");
      const a = field("", skill, undefined, { deferredLabel: true }), b = field("", level, undefined, { deferredLabel: true });
      return { skill, level, controls: [a, b], labels: [a, b].map((w) => w.querySelector("label")!), first: skill, names: (i: number) => [`Habilidad necesaria ${i + 1}`, `Nivel mínimo de la habilidad ${i + 1}`] };
    },
  });
  const inputRows = inputs.resize(Math.max(1, Object.keys(current.inputs).length));
  Object.entries(current.inputs).forEach(([entry, amount], i) => { inputRows[i]!.entry.value = entry; inputRows[i]!.amount.value = String(amount); });
  const byRows = byproducts.resize((current.byproducts ?? []).length);
  (current.byproducts ?? []).forEach((b, i) => { byRows[i]!.item.value = b.item; byRows[i]!.amount.value = String(b.amount); });
  const extraRows = extras.resize((current.alsoNeeds ?? []).length);
  (current.alsoNeeds ?? []).forEach((s, i) => { extraRows[i]!.building.value = s; });
  const needRows = needs.resize((current.requiresSkills ?? []).length);
  (current.requiresSkills ?? []).forEach((q, i) => { needRows[i]!.skill.value = q.skill; syncOptions(needRows[i]!.level, levelOptions(q.skill), "Elige el nivel mínimo"); needRows[i]!.level.value = String(q.level); });
  return {
    element: el("div", {}, name.wrapper, where.wrapper, verb.wrapper, inputs.element, output.wrapper, outputField, byproducts.element, extras.element, needs.element),
    read: () => {
      const errors: string[] = [];
      const inMap: Record<string, number> = {};
      for (const r of inputs.rows) { if (r.entry.value in inMap) errors.push("Una entrada está repetida: súmalas en una sola."); inMap[r.entry.value] = num(r.amount); }
      if (errors.length) return { errors };
      const def: Record<string, unknown> = { name: name.input.value.trim(), structureId: where.select.value, inputs: inMap, output: { item: output.select.value, amount: num(outputAmount) } };
      if (verb.input.value.trim()) def.verb = verb.input.value.trim();
      if (extras.rows.length) def.alsoNeeds = extras.rows.map((r) => r.building.value);
      if (byproducts.rows.length) def.byproducts = byproducts.rows.map((r) => ({ item: r.item.value, amount: num(r.amount) }));
      if (needs.rows.length) def.requiresSkills = needs.rows.map((r) => ({ skill: r.skill.value, level: Number(r.level.value) }));
      return { def };
    },
    focus: () => name.input.focus(),
  };
}

// ---------------------------------------------------------------------------------------------- construcción

function constructionForm(id: string, ctx: EditContext): EditForm {
  const project = projectDefFromState(id, ctx.state.projects.get(id)!);
  const structure = structureDefFromState(id, ctx.state.structures.get(id)!);
  const name = text("Nombre", structure.name, 60, "Es el del proyecto y el del edificio.");
  const description = text("Descripción del proyecto", project.description, 500, "Opcional.");
  const side = (label: string, value: number, min: number, max: number) => { const input = el("input", { type: "number", min: String(min), max: String(max), value: String(value), inputMode: "numeric" }); return { input, wrapper: field(label, input) }; };
  const x = side("Solar: columna de la esquina superior izquierda", structure.x, 0, 200);
  const y = side("Solar: fila de la esquina superior izquierda", structure.y, 0, 200);
  const w = side("Solar: ancho en casillas", structure.width, 1, ctx.limits.side);
  const h = side("Solar: alto en casillas", structure.height, 1, ctx.limits.side);
  const color = text("Color del edificio", structure.color, 7, "Formato #rrggbb.");
  const approval = el("input", { type: "checkbox", checked: project.buildRequiresApproval });
  const resources: Option[] = ctx.config.resources.map((r): Option => [r.id, r.name]);
  const tasks = dynamicList({
    legend: "Tareas: qué hay que aportar (no se puede quitar una tarea con aportes ni pedir menos de lo aportado)", addLabel: "Añadir tarea", noun: "tarea", min: 1, max: () => 8, announce: ctx.announce, onChange: () => {},
    build: () => {
      const title = el("input", { maxLength: 60, autocomplete: "off" });
      const resource = el("select");
      syncOptions(resource, resources, "Elige un recurso");
      const required = el("input", { type: "number", min: "1", max: "1000", value: "1", inputMode: "numeric" });
      const a = field("", title, undefined, { deferredLabel: true }), b = field("", resource, undefined, { deferredLabel: true }), c = field("", required, undefined, { deferredLabel: true });
      return { title, resource, required, controls: [a, b, c], labels: [a, b, c].map((p) => p.querySelector("label")!), first: title,
        names: (i: number) => [`Tarea ${i + 1}: título`, `Tarea ${i + 1}: recurso`, `Tarea ${i + 1}: cantidad`] };
    },
  });
  const rows = tasks.resize(project.tasks.length);
  rows.forEach((row, i) => { const t = project.tasks[i]!; row.title.value = t.title; row.resource.value = t.resource; row.required.value = String(t.required); });
  const approvalField = el("p", {}, el("label", { className: "casilla" }, approval, " Construir exige que todas las tareas estén aprobadas"));
  return {
    element: el("div", {}, name.wrapper, description.wrapper, x.wrapper, y.wrapper, w.wrapper, h.wrapper, color.wrapper, tasks.element, approvalField),
    read: () => {
      const previous = new Map(project.tasks.map((t) => [t.resource, t]));
      const names = new Map(ctx.config.resources.map((r) => [r.id, r.name.toLowerCase()]));
      const newTasks = tasks.rows.map((r) => {
        const old = previous.get(r.resource.value);
        const required = num(r.required);
        // Lo que no se edita aquí (criterio, fecha, dependencias) se conserva; una tarea nueva toma el criterio por omisión.
        return old ? { ...old, title: r.title.value.trim(), required } : { id: r.resource.value, title: r.title.value.trim(), resource: r.resource.value, required, acceptance: `Aportar ${required} de ${names.get(r.resource.value) ?? r.resource.value}` };
      });
      return {
        def: {
          project: { ...project, name: name.input.value.trim(), description: description.input.value.trim(), tasks: newTasks, buildRequiresApproval: approval.checked },
          structure: { ...structure, name: name.input.value.trim(), x: num(x.input), y: num(y.input), width: num(w.input), height: num(h.input), color: color.input.value.trim() },
        },
      };
    },
    focus: () => name.input.focus(),
  };
}

export function buildEditForm(kind: LibraryKind, id: string, ctx: EditContext): EditForm {
  if (kind === "objeto") return objectForm(id, ctx);
  if (kind === "mision") return missionForm(id, ctx);
  if (kind === "habilidad") return skillForm(id, ctx);
  if (kind === "receta") return recipeForm(id, ctx);
  return constructionForm(id, ctx);
}
