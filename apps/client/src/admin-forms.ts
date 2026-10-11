import {
  MESSAGE, PANEL_LIMITS,
  skillDefFromState, skillLevelName,
  type CreateConstructionMessage, type CreateItemMessage, type CreateMissionMessage, type CreateProjectMessage, type CreateRecipeMessage,
  type CreateSkillMessage, type GrantSkillMessage, type NewTask, type SkillGrantedMessage, type WorldConfig, type WorldState,
} from "@juego/shared";
import type { Room } from "@colyseus/sdk";
import { newRequestId } from "./request-id.ts";
import { dynamicList } from "./ui/dynamic-list.ts";
import { el } from "./ui/dom.ts";
import { formFeedback } from "./ui/feedback.ts";
import { field } from "./ui/field.ts";
import { syncGroupedOptions, syncOptions, type Option } from "./ui/select-options.ts";
import { createMinimap } from "./views/minimap.ts";

// Formularios de administración del panel (F1a, FUT-05, Q171–Q174): crear proyectos y misiones
// sin programar. El servidor valida todo; aquí solo se ayuda a rellenar y se muestran sus motivos.

/** Mensajes de validación del servidor en lenguaje del formulario (sin ids internos ni nombres de campo en inglés). */
function readable(detail: string): string {
  return detail
    .replace(/^(proyecto|misión|construcción|objeto|receta|habilidad) "[^"]*": /, "")
    .replace(/^(proyecto|misión|construcción)\.tasks\[(\d+)\]: /, (_m, _w, n: string) => `Tarea ${Number(n) + 1}: `)
    .replace(/\bname\b/g, "nombre").replace(/\bdescription\b/g, "descripción").replace(/\btitle\b/g, "título")
    .replace(/\brequired\b/g, "cantidad").replace(/\bacceptance\b/g, "criterio de aceptación")
    .replace(/\bcoordinators\b/g, "coordinación").replace(/\btasks\b/g, "tareas").replace(/\bobjective\b/g, "objetivo")
    .replace(/\binputs\b/g, "entradas").replace(/\boutput\.amount\b/g, "cantidad de salida")
    .replace(/\bbyproducts\b/g, "subproductos").replace(/\bverb\b/g, "acción").replace(/\balsoNeeds\b/g, "edificios extra").replace(/\brequiresSkills\b/g, "habilidades necesarias").replace(/\blevels\b/g, "niveles").replace(/\bpractice\.times\b/g, "veces").replace(/\bcolor\b/g, "color")
    .replace(/^./, (c) => c.toUpperCase());
}

export function createAdminForms(container: HTMLElement, config: WorldConfig, room: Room<unknown, WorldState>, announce: (text: string) => void) {
  const resources = config.resources;
  const section = el("section", { className: "admin" });
  section.setAttribute("aria-labelledby", "admin-titulo");
  section.append(el("h2", { id: "admin-titulo" }, "Administración"),
    el("p", { className: "ayuda" }, "Crea proyectos, construcciones, objetos, recetas y misiones sin programar. Todo queda publicado al crearlo y no se puede modificar: para corregir un proyecto, ciérralo y crea otro."));

  // --- Nuevo proyecto ---
  const name = el("input", { maxLength: PANEL_LIMITS.name, required: true, autocomplete: "off" });
  const description = el("textarea", { maxLength: PANEL_LIMITS.description });
  const coordinators = el("input", { autocomplete: "off" });
  const approval = el("input", { type: "checkbox", id: "nuevo-aprobacion" });
  const projectDue = el("input", { type: "date" });
  const kindPlain = el("input", { type: "radio", name: "tipo-proyecto", value: "proyecto", checked: true });
  const kindBuild = el("input", { type: "radio", name: "tipo-proyecto", value: "construccion" });
  const solarX = el("input", { type: "number", min: "0", max: String(config.map.width - 1), value: "0", inputMode: "numeric" });
  const solarY = el("input", { type: "number", min: "0", max: String(config.map.height - 1), value: "0", inputMode: "numeric" });
  const solarW = el("input", { type: "number", min: "1", max: String(config.buildLimits.side), value: "2", inputMode: "numeric" });
  const solarH = el("input", { type: "number", min: "1", max: String(config.buildLimits.side), value: "2", inputMode: "numeric" });
  const solarColor = el("input", { type: "color", value: "#8b5a2b" });
  const minimap = createMinimap(config, room);
  const solarBox = el("fieldset", { className: "solar", hidden: true },
    el("legend", {}, "Solar del edificio en el mapa"),
    el("p", { className: "ayuda" }, `El solar tiene de 1 a ${config.buildLimits.side} casillas por lado. Las casillas se cuentan desde la esquina superior izquierda del mapa (0, 0).`),
    field("Casilla X (columna)", solarX), field("Casilla Y (fila)", solarY),
    field("Ancho en casillas", solarW), field("Alto en casillas", solarH), field("Color del edificio", solarColor),
    minimap.element);
  const solar = () => ({ x: Number(solarX.value), y: Number(solarY.value), width: Number(solarW.value), height: Number(solarH.value), color: solarColor.value });
  const refreshSolar = () => { solarBox.hidden = !kindBuild.checked; if (kindBuild.checked) minimap.update(solar()); };
  for (const input of [kindPlain, kindBuild, solarX, solarY, solarW, solarH, solarColor]) {
    input.addEventListener("input", refreshSolar);
    input.addEventListener("change", refreshSolar);
  }
  const taskList = el("ol", { className: "tareas-nuevas" });
  const addTask = el("button", { type: "button", textContent: "Añadir tarea" });
  const projectErrors = el("div", { className: "error", role: "alert" });
  const projectForm = el("form", { noValidate: true },
    el("h3", { id: "nuevo-proyecto-titulo" }, "Nuevo proyecto o construcción"),
    el("fieldset", {}, el("legend", {}, "Tipo"),
      el("label", {}, kindPlain, " Proyecto (se completa al aportar todo)"),
      el("label", {}, kindBuild, " Construcción (se construye en un solar del mapa)")),
    field("Nombre", name, `Obligatorio, hasta ${PANEL_LIMITS.name} caracteres. En una construcción es también el nombre del edificio.`),
    solarBox,
    field("Descripción", description, `Opcional, hasta ${PANEL_LIMITS.description} caracteres.`),
    el("fieldset", {}, el("legend", {}, "Tareas (una por recurso)"), taskList, addTask),
    field("Fecha objetivo del proyecto", projectDue, "Opcional (AAAA-MM-DD). Las tareas no pueden vencer después."),
    field("Coordinación", coordinators, "Nombres de cuenta separados por comas. Si lo dejas vacío, coordinas tú."),
    el("p", {}, el("label", {}, approval, " Completar exige que la coordinación apruebe todas las tareas")),
    projectErrors,
    el("button", { type: "submit", textContent: "Crear y publicar" }),
  );
  projectForm.setAttribute("aria-labelledby", "nuevo-proyecto-titulo");

  interface TaskRow {
    li: HTMLLIElement; resource: HTMLSelectElement; title: HTMLInputElement; required: HTMLInputElement; acceptance: HTMLInputElement; due: HTMLInputElement;
    /** «Depende de» (F1c): una casilla por cada otra tarea del formulario. */
    deps: HTMLFieldSetElement;
  }
  /** Rehace las casillas «Depende de» de cada fila según los recursos de las demás (conserva lo marcado). */
  function refreshDeps() {
    rows.forEach((row, i) => {
      const checked = new Set([...row.deps.querySelectorAll<HTMLInputElement>("input:checked")].map((c) => c.value));
      const others = rows.filter((r) => r !== row);
      row.deps.replaceChildren(el("legend", {}, `La tarea ${i + 1} depende de (opcional)`),
        ...(others.length ? others.map((o) => {
          const name = o.resource.selectedOptions[0]?.textContent ?? o.resource.value;
          return el("label", {}, el("input", { type: "checkbox", value: o.resource.value, checked: checked.has(o.resource.value) }), ` ${o.title.value.trim() || `Aportar ${name.toLowerCase()}`}`);
        }) : [el("span", { className: "ayuda" }, "Añade otra tarea para poder encadenarlas.")]));
    });
  }
  const rows: TaskRow[] = [];
  function addTaskRow() {
    if (rows.length >= Math.min(PANEL_LIMITS.tasks, resources.length)) return;
    const n = rows.length + 1;
    const resource = el("select");
    for (const r of resources) resource.append(el("option", { value: r.id, textContent: r.name }));
    const used = new Set(rows.map((r) => r.resource.value));
    resource.value = resources.find((r) => !used.has(r.id))?.id ?? resources[0]!.id;
    const title = el("input", { maxLength: PANEL_LIMITS.name, autocomplete: "off" });
    const required = el("input", { type: "number", min: "1", max: String(PANEL_LIMITS.required), value: "5", inputMode: "numeric" });
    const acceptance = el("input", { maxLength: PANEL_LIMITS.acceptance, autocomplete: "off" });
    const due = el("input", { type: "date" });
    const deps = el("fieldset", { className: "depende" });
    const remove = el("button", { type: "button", textContent: `Quitar la tarea ${n}` });
    const li = el("li", { className: "tarea-nueva" },
      field(`Recurso de la tarea ${n}`, resource), field(`Título de la tarea ${n}`, title),
      field(`Cantidad de la tarea ${n}`, required, `De 1 a ${PANEL_LIMITS.required}.`),
      field(`Criterio de aceptación de la tarea ${n}`, acceptance, "Opcional; por defecto «Aportar N de recurso»."),
      field(`Fecha objetivo de la tarea ${n}`, due, "Opcional."), deps, remove);
    const row = { li, resource, title, required, acceptance, due, deps };
    resource.addEventListener("change", refreshDeps);
    title.addEventListener("change", refreshDeps);
    remove.onclick = () => {
      rows.splice(rows.indexOf(row), 1);
      li.remove();
      refreshDeps();
      addTask.setAttribute("aria-disabled", "false");
      addTask.focus();
    };
    rows.push(row);
    taskList.append(li);
    refreshDeps();
    addTask.setAttribute("aria-disabled", String(rows.length >= Math.min(PANEL_LIMITS.tasks, resources.length)));
  }
  addTask.onclick = () => {
    if (addTask.getAttribute("aria-disabled") === "true") return;
    addTaskRow();
    rows.at(-1)?.resource.focus();
  };
  addTaskRow();

  /** Lo último enviado y aún sin confirmar: dónde mostrar un rechazo y qué esperar en el estado. */
  let pending: { kind: "proyecto" | "mision" | "objeto" | "receta" | "habilidad" | "concesion"; name: string } | undefined;
  projectForm.onsubmit = (event) => {
    event.preventDefault();
    projectErrors.replaceChildren();
    const tasks: NewTask[] = rows.map((r) => ({
      resource: r.resource.value,
      title: r.title.value.trim() || `Aportar ${r.resource.selectedOptions[0]?.textContent?.toLowerCase() ?? r.resource.value}`,
      required: Number(r.required.value),
      ...(r.acceptance.value.trim() ? { acceptance: r.acceptance.value.trim() } : {}),
      ...(r.due.value ? { dueDate: r.due.value } : {}),
      ...(() => {
        const deps = [...r.deps.querySelectorAll<HTMLInputElement>("input:checked")].map((c) => c.value);
        return deps.length ? { dependsOn: deps } : {};
      })(),
    }));
    const list = coordinators.value.split(",").map((s) => s.trim()).filter(Boolean);
    const message: CreateProjectMessage = {
      requestId: newRequestId(), name: name.value.trim(), description: description.value.trim(), tasks,
      ...(list.length ? { coordinators: list } : {}), requiresApproval: approval.checked,
      ...(projectDue.value ? { dueDate: projectDue.value } : {}),
    };
    pending = { kind: "proyecto", name: message.name };
    if (kindBuild.checked) {
      const construction: CreateConstructionMessage = { ...message, ...solar() };
      room.send(MESSAGE.createConstruction, construction);
    } else {
      room.send(MESSAGE.createProject, message);
    }
  };

  // --- Nueva misión ---
  const missionName = el("input", { maxLength: PANEL_LIMITS.name, autocomplete: "off" });
  const missionDescription = el("textarea", { maxLength: PANEL_LIMITS.description });
  const kindProject = el("input", { type: "radio", name: "objetivo", value: "project-completed", checked: true });
  const kindItem = el("input", { type: "radio", name: "objetivo", value: "item-in-community" });
  const projectSelect = el("select");
  const itemSelect = el("select");
  const amount = el("input", { type: "number", min: "1", max: "1000", value: "1", inputMode: "numeric" });
  const projectBox = field("Proyecto que hay que completar", projectSelect);
  const itemBox = el("div", {}, field("Objeto", itemSelect), field("Cantidad en el almacén de la comunidad", amount));
  const missionErrors = el("div", { className: "error", role: "alert" });
  const missionForm = el("form", { noValidate: true },
    el("h3", { id: "nueva-mision-titulo" }, "Nueva misión"),
    field("Nombre", missionName, `Obligatorio, hasta ${PANEL_LIMITS.name} caracteres.`),
    field("Descripción", missionDescription),
    el("fieldset", {}, el("legend", {}, "Objetivo"),
      el("label", {}, kindProject, " Completar un proyecto"), el("label", {}, kindItem, " Tener objetos en el almacén de la comunidad")),
    projectBox, itemBox, missionErrors,
    el("button", { type: "submit", textContent: "Crear la misión" }),
  );
  missionForm.setAttribute("aria-labelledby", "nueva-mision-titulo");
  const applyKind = () => {
    projectBox.hidden = !kindProject.checked;
    itemBox.hidden = kindProject.checked;
  };
  kindProject.onchange = applyKind;
  kindItem.onchange = applyKind;
  applyKind();

  let pendingMission: string | undefined;
  missionForm.onsubmit = (event) => {
    event.preventDefault();
    missionErrors.replaceChildren();
    const message: CreateMissionMessage = {
      requestId: newRequestId(), name: missionName.value.trim(), description: missionDescription.value.trim(),
      objective: kindProject.checked
        ? { kind: "project-completed", project: projectSelect.value }
        : { kind: "item-in-community", item: itemSelect.value, amount: Number(amount.value) },
    };
    pending = { kind: "mision", name: message.name };
    room.send(MESSAGE.createMission, message);
  };

  // --- Nuevo objeto (F2a) ---
  const itemName = el("input", { maxLength: PANEL_LIMITS.name, autocomplete: "off" });
  const itemFeedback = formFeedback();
  const itemErrors = itemFeedback.errors;
  const itemConfirm = itemFeedback.confirm;
  const itemList = el("div", { className: "lista-creados" });
  const itemForm = el("form", { noValidate: true },
    el("h3", { id: "nuevo-objeto-titulo" }, "Nuevo objeto"),
    el("p", { className: "ayuda" }, `Un objeto no es un recurso: no se recolecta ni se usa como entrada de receta; se obtiene fabricándolo con una receta y vive en el almacén de la comunidad. Máximo ${config.buildLimits.items} objetos creados aquí.`),
    field("Nombre del objeto", itemName, `Obligatorio, hasta ${PANEL_LIMITS.name} caracteres.`), itemErrors,
    el("button", { type: "submit", textContent: "Crear el objeto" }), itemConfirm, itemList);
  itemForm.setAttribute("aria-labelledby", "nuevo-objeto-titulo");
  itemForm.onsubmit = (event) => {
    event.preventDefault();
    itemErrors.replaceChildren();
    itemConfirm.textContent = "";
    const message: CreateItemMessage = { requestId: newRequestId(), name: itemName.value.trim() };
    pending = { kind: "objeto", name: message.name };
    room.send(MESSAGE.createItem, message);
  };

  // --- Nueva receta (F2a, F2b) ---
  const limits = config.buildLimits;
  const recipeName = el("input", { maxLength: PANEL_LIMITS.name, autocomplete: "off" });
  const recipeVerb = el("input", { maxLength: 20, autocomplete: "off", placeholder: "Fabricar" });
  const recipeStructure = el("select");
  const recipeOutput = el("select");
  const outputAmount = el("input", { type: "number", min: "1", max: String(limits.outputAmount), value: "1", inputMode: "numeric" });
  // Opciones vigentes de los selectores de las filas (se rellenan en render()).
  let itemEntries: [string, string][] = [];
  let buildingEntries: [string, string][] = [];
  let skillEntries: [string, string][] = [];

  // Entradas, subproductos y edificios extra: filas que se añaden y se quitan (F2b, Q190); el tope es el límite configurado.
  const inputList = dynamicList({
    legend: "Entradas (recursos u objetos del almacén común)", addLabel: "Añadir entrada (recurso u objeto)", noun: "entrada", min: 1, max: limits.recipeInputs, announce,
    onChange: () => syncRecipeSelects(),
    build: () => {
      const entry = el("select");
      const amount = el("input", { type: "number", min: "1", max: String(limits.inputAmount), value: "1", inputMode: "numeric" });
      const a = field("", entry, undefined, { deferredLabel: true }), b = field("", amount, undefined, { deferredLabel: true });
      return { entry, amount, controls: [a, b], labels: [a, b].map((w) => w.querySelector("label")!), first: entry,
        names: (i: number) => [`Entrada ${i + 1}: recurso u objeto`, `Cantidad de la entrada ${i + 1}`] };
    },
  });
  const byproductList = dynamicList({
    legend: "Subproductos (opcionales)", addLabel: "Añadir subproducto", noun: "subproducto", min: 0, max: limits.byproducts, announce,
    onChange: () => syncRecipeSelects(),
    build: () => {
      const item = el("select");
      const amount = el("input", { type: "number", min: "1", max: String(limits.outputAmount), value: "1", inputMode: "numeric" });
      const a = field("", item, undefined, { deferredLabel: true }), b = field("", amount, undefined, { deferredLabel: true });
      return { item, amount, controls: [a, b], labels: [a, b].map((w) => w.querySelector("label")!), first: item,
        names: (i: number) => [`Subproducto ${i + 1}: objeto`, `Cantidad del subproducto ${i + 1}`] };
    },
  });
  const extraList = dynamicList({
    legend: "Otros edificios necesarios (opcionales)", addLabel: "Añadir edificio necesario", noun: "edificio", min: 0, max: limits.alsoNeeds, announce,
    onChange: () => syncRecipeSelects(),
    build: () => {
      const building = el("select");
      const a = field("", building, undefined, { deferredLabel: true });
      return { building, controls: [a], labels: [a.querySelector("label")!], first: building,
        names: (i: number) => [`Edificio necesario ${i + 1} (debe estar construido, en cualquier lugar)`] };
    },
  });
  // Habilidades necesarias (F2c, Q199): habilidad y nivel mínimo; el selector de nivel depende de la habilidad elegida.
  const levelEntries = (skillId: string): [string, string][] => {
    const skill = room.state.skills.get(skillId);
    return skill ? skillDefFromState(skillId, skill).levels.map((l, i): [string, string] => [String(i + 1), `${i + 1}. ${l.name}`]) : [];
  };
  const skillList = dynamicList({
    legend: "Habilidades necesarias (opcionales)", addLabel: "Añadir habilidad", noun: "habilidad", min: 0, max: limits.recipeSkills, announce,
    onChange: () => syncRecipeSelects(),
    build: () => {
      const skill = el("select");
      const level = el("select");
      skill.onchange = () => syncRecipeSelects();
      const a = field("", skill, undefined, { deferredLabel: true }), b = field("", level, undefined, { deferredLabel: true });
      return { skill, level, controls: [a, b], labels: [a, b].map((w) => w.querySelector("label")!), first: skill,
        names: (i: number) => [`Habilidad necesaria ${i + 1}`, `Nivel mínimo de la habilidad ${i + 1}`] };
    },
  });
  function syncRecipeSelects() {
    for (const r of skillList.rows) {
      syncOptions(r.skill, skillEntries, "Elige una habilidad");
      syncOptions(r.level, levelEntries(r.skill.value), "Elige el nivel mínimo");
    }
    inputList.rows.forEach((r) => syncGroupedOptions(r.entry, [{ label: "Recursos", entries: resources.map((r): Option => [r.id, r.name]) }, { label: "Objetos", entries: itemEntries }], "Elige una entrada"));
    for (const r of byproductList.rows) syncOptions(r.item, itemEntries, "Elige un objeto");
    for (const r of extraList.rows) syncOptions(r.building, buildingEntries, "Elige un edificio");
  }

  const recipeFeedback = formFeedback();
  const recipeErrors = recipeFeedback.errors;
  const recipeConfirm = recipeFeedback.confirm;
  const recipeForm = el("form", { noValidate: true },
    el("h3", { id: "nueva-receta-titulo" }, "Nueva receta"),
    el("p", { className: "ayuda" }, `Una receta es una acción que se hace junto a un edificio construido: consume entradas del almacén de la comunidad (recursos u objetos; hasta ${limits.recipeInputs}) y deja un objeto, con hasta ${limits.byproducts} subproductos. Puede exigir hasta ${limits.alsoNeeds} edificios más construidos. Máximo ${limits.recipes} recetas creadas aquí.`),
    field("Nombre de la receta", recipeName, `Obligatorio, hasta ${PANEL_LIMITS.name} caracteres.`),
    field("Acción (verbo)", recipeVerb, "Opcional, hasta 20 caracteres: «moler», «hornear»… Si se deja vacío, «Fabricar»."),
    field("Se hace junto al edificio", recipeStructure),
    inputList.element,
    field("Objeto que se obtiene", recipeOutput), field("Cantidad que se obtiene", outputAmount),
    byproductList.element,
    extraList.element,
    skillList.element,
    recipeErrors,
    el("button", { type: "submit", textContent: "Crear la receta" }), recipeConfirm);
  recipeForm.setAttribute("aria-labelledby", "nueva-receta-titulo");
  recipeForm.onsubmit = (event) => {
    event.preventDefault();
    recipeErrors.replaceChildren();
    recipeConfirm.textContent = "";
    const used = inputList.rows.filter((r) => r.entry.value);
    if (new Set(used.map((r) => r.entry.value)).size !== used.length) {
      recipeErrors.append(el("p", {}, "No repitas una entrada en dos filas."));
      return;
    }
    const byproducts = byproductList.rows.filter((r) => r.item.value).map((r) => ({ item: r.item.value, amount: Number(r.amount.value) }));
    const alsoNeeds = [...new Set(extraList.rows.map((r) => r.building.value).filter(Boolean))];
    const verb = recipeVerb.value.trim();
    const requiresSkills = skillList.rows.filter((r) => r.skill.value && r.level.value).map((r) => ({ skill: r.skill.value, level: Number(r.level.value) }));
    if (skillList.rows.some((r) => r.skill.value && !r.level.value)) {
      recipeErrors.append(el("p", {}, "Elige el nivel mínimo de cada habilidad necesaria."));
      return;
    }
    const message: CreateRecipeMessage = {
      requestId: newRequestId(), name: recipeName.value.trim(), structureId: recipeStructure.value,
      inputs: Object.fromEntries(used.map((r) => [r.entry.value, Number(r.amount.value)])),
      output: { item: recipeOutput.value, amount: Number(outputAmount.value) },
      ...(verb ? { verb } : {}), ...(alsoNeeds.length ? { alsoNeeds } : {}), ...(byproducts.length ? { byproducts } : {}),
      ...(requiresSkills.length ? { requiresSkills } : {}),
    };
    pending = { kind: "receta", name: message.name };
    room.send(MESSAGE.createRecipe, message);
  };

  // --- Nueva habilidad (F2c, Q195) ---
  let practiceEntries: [string, string][] = [];
  const skillName = el("input", { maxLength: PANEL_LIMITS.name, autocomplete: "off" });
  const skillDescription = el("input", { maxLength: 200, autocomplete: "off" });
  const levelList = dynamicList({
    legend: "Niveles, de menor a mayor", addLabel: "Añadir nivel", noun: "nivel", min: 1, max: limits.skillLevels, announce,
    onChange: () => syncSkillSelects(),
    build: () => {
      const levelName = el("input", { maxLength: 30, autocomplete: "off" });
      const recipe = el("select");
      const times = el("input", { type: "number", min: "1", max: "1000", value: "3", inputMode: "numeric" });
      const a = field("", levelName, undefined, { deferredLabel: true }), b = field("", recipe, undefined, { deferredLabel: true }), c = field("", times, undefined, { deferredLabel: true });
      return { levelName, recipe, times, controls: [a, b, c], labels: [a, b, c].map((w) => w.querySelector("label")!), first: levelName,
        names: (i: number) => [`Nivel ${i + 1}: nombre`, `Nivel ${i + 1}: receta que se practica`, `Nivel ${i + 1}: veces que hay que fabricarla`] };
    },
  });
  function syncSkillSelects() {
    for (const r of levelList.rows) syncOptions(r.recipe, practiceEntries, "Elige una receta");
  }
  const skillFeedback = formFeedback();
  const skillErrors = skillFeedback.errors;
  const skillConfirm = skillFeedback.confirm;
  const skillForm = el("form", { noValidate: true },
    el("h3", { id: "nueva-habilidad-titulo" }, "Nueva habilidad"),
    el("p", { className: "ayuda" }, `Una habilidad es permanente y tiene hasta ${limits.skillLevels} niveles. Cada nivel se gana fabricando varias veces una receta abierta (que no exija esta habilidad), o por concesión de la administración, o porque alguien con más nivel te lo enseñe. Máximo ${limits.skills} habilidades creadas aquí.`),
    field("Nombre de la habilidad", skillName, `Obligatorio, hasta ${PANEL_LIMITS.name} caracteres.`),
    field("Descripción", skillDescription, "Opcional, hasta 200 caracteres."),
    levelList.element,
    skillErrors,
    el("button", { type: "submit", textContent: "Crear la habilidad" }), skillConfirm);
  skillForm.setAttribute("aria-labelledby", "nueva-habilidad-titulo");
  skillForm.onsubmit = (event) => {
    event.preventDefault();
    skillErrors.replaceChildren();
    skillConfirm.textContent = "";
    const message: CreateSkillMessage = {
      requestId: newRequestId(), name: skillName.value.trim(), description: skillDescription.value.trim(),
      levels: levelList.rows.map((r) => ({ name: r.levelName.value.trim(), recipe: r.recipe.value, times: Number(r.times.value) })),
    };
    pending = { kind: "habilidad", name: message.name };
    room.send(MESSAGE.createSkill, message);
  };

  // --- Conceder una habilidad (F2c, Q197): solo sube de nivel ---
  const grantName = el("input", { maxLength: 20, autocomplete: "off" });
  const grantSkill = el("select");
  const grantLevel = el("select");
  const grantFeedback = formFeedback();
  const grantErrors = grantFeedback.errors;
  const grantConfirm = grantFeedback.confirm;
  grantSkill.onchange = () => syncGrant();
  const grantForm = el("form", { noValidate: true },
    el("h3", { id: "conceder-habilidad-titulo" }, "Conceder una habilidad"),
    el("p", { className: "ayuda" }, "Sube a una persona (con cuenta, esté o no conectada) a un nivel de una habilidad. Solo se puede subir de nivel, nunca bajar."),
    field("Cuenta de la persona", grantName), field("Habilidad", grantSkill), field("Nivel", grantLevel),
    grantErrors,
    el("button", { type: "submit", textContent: "Conceder" }), grantConfirm);
  grantForm.setAttribute("aria-labelledby", "conceder-habilidad-titulo");
  function syncGrant() {
    syncOptions(grantSkill, skillEntries, "Elige una habilidad");
    syncOptions(grantLevel, levelEntries(grantSkill.value), "Elige el nivel");
  }
  grantForm.onsubmit = (event) => {
    event.preventDefault();
    grantErrors.replaceChildren();
    grantConfirm.textContent = "";
    const message: GrantSkillMessage = { requestId: newRequestId(), name: grantName.value.trim(), skill: grantSkill.value, level: Number(grantLevel.value) };
    pending = { kind: "concesion", name: message.name };
    room.send(MESSAGE.grantSkill, message);
  };
  room.onMessage(MESSAGE.skillGranted, (m: SkillGrantedMessage) => {
    const skill = room.state.skills.get(m.skill);
    const text = `${m.player} tiene ahora ${skill ? skillLevelName(skillDefFromState(m.skill, skill), m.level) : `el nivel ${m.level}`} en ${skill?.name ?? m.skill}.`;
    grantConfirm.textContent = text;
    announce(text);
    pending = undefined;
  });

  section.append(projectForm, itemForm, recipeForm, skillForm, grantForm, missionForm);
  container.before(section); // antes de la lista de proyectos

  let knownProjects: Set<string> | undefined;
  let knownMissions: Set<string> | undefined;
  let knownItems: Set<string> | undefined;
  let knownRecipes: Set<string> | undefined;
  let knownSkills: Set<string> | undefined;
  const errorBox = { proyecto: projectErrors, mision: missionErrors, objeto: itemErrors, receta: recipeErrors, habilidad: skillErrors, concesion: grantErrors };
  refreshSolar();
  return {
    /** Motivo de rechazo del servidor junto al formulario que lo provocó. */
    showRejection(text: string, details: string[] = []) {
      // El nombre pedido puede ser vacío (y el servidor lo rechaza): lo que cuenta es que haya algo pendiente.
      const target = pending ? errorBox[pending.kind] : undefined;
      if (!target) return false;
      target.replaceChildren(el("p", {}, text), ...(details.length ? [el("ul", {}, ...details.map((d) => el("li", {}, readable(d))))] : []));
      pending = undefined;
      return true;
    },
    render() {
      const state = room.state;
      // Proyectos abiertos como posibles objetivos de misión.
      const open = [...state.projects.entries()].filter(([, p]) => p.phase !== "cerrado");
      syncOptions(projectSelect, open.map(([id, p]) => [id, p.name]));
      // Objetos y edificios del estado (F2a): también los creados desde el panel.
      syncOptions(itemSelect, [...state.items.entries()].map(([id, i]) => [id, i.name]));
      skillEntries = [...state.skills.entries()].map(([id, s]): [string, string] => [id, s.name]);
      practiceEntries = [...state.recipes.entries()].filter(([, r]) => r.requiresSkills.size === 0).map(([id, r]): [string, string] => [id, r.name]);
      syncSkillSelects();
      syncGrant();
      itemEntries = [...state.items.entries()].map(([id, i]): [string, string] => [id, i.name]);
      buildingEntries = [...state.structures.entries()].map(([id, s]): [string, string] => [id, `${s.name}${s.built ? "" : " (sin construir)"}`]);
      syncOptions(recipeOutput, itemEntries);
      syncOptions(recipeStructure, buildingEntries);
      syncRecipeSelects();
      minimap.render();
      // Objetos que ya existen (también los de la configuración), a la vista junto al formulario.
      const itemsText = [...state.items.values()].map((i) => i.name).join(", ");
      if (itemList.dataset.text !== itemsText) {
        itemList.dataset.text = itemsText;
        itemList.replaceChildren(el("p", { className: "ayuda" }, itemsText ? `Objetos existentes: ${itemsText}.` : "Todavía no hay objetos."));
      }
      // Confirmación: el proyecto o la misión pedidos aparecen en el estado.
      const projectIds = new Set(state.projects.keys());
      for (const id of projectIds) {
        if (knownProjects && !knownProjects.has(id) && pending?.kind === "proyecto" && state.projects.get(id)!.name === pending.name) {
          announce(kindBuild.checked ? `Construcción «${pending.name}» creada y publicada.` : `Proyecto «${pending.name}» creado y publicado.`);
          pending = undefined;
          projectForm.reset();
          for (const r of rows.splice(1)) r.li.remove();
          addTask.setAttribute("aria-disabled", "false");
          refreshSolar();
          name.focus();
        }
      }
      knownProjects = projectIds;
      const missionIds = new Set(state.missions.keys());
      for (const id of missionIds) {
        if (knownMissions && !knownMissions.has(id) && pending?.kind === "mision" && state.missions.get(id)!.name === pending.name) {
          announce(`Misión «${pending.name}» creada.`);
          pending = undefined;
          missionForm.reset();
          applyKind();
          missionName.focus();
        }
      }
      knownMissions = missionIds;
      const itemIds = new Set(state.items.keys());
      for (const id of itemIds) {
        if (knownItems && !knownItems.has(id) && pending?.kind === "objeto" && state.items.get(id)!.name === pending.name) {
          announce(`Objeto «${pending.name}» creado.`);
          itemConfirm.textContent = `Objeto «${pending.name}» creado. Ya puedes elegirlo como resultado de una receta y en las misiones de objetos en el almacén.`;
          pending = undefined;
          itemForm.reset();
          itemName.focus();
        }
      }
      knownItems = itemIds;
      const recipeIds = new Set(state.recipes.keys());
      for (const id of recipeIds) {
        if (knownRecipes && !knownRecipes.has(id) && pending?.kind === "receta" && state.recipes.get(id)!.name === pending.name) {
          announce(`Receta «${pending.name}» creada.`);
          recipeConfirm.textContent = `Receta «${pending.name}» creada. Se fabricará en el edificio elegido cuando esté construido.`;
          pending = undefined;
          recipeForm.reset();
          for (const list of [inputList, byproductList, extraList, skillList]) list.reset();
          recipeName.focus();
        }
      }
      knownRecipes = recipeIds;
      const skillIds = new Set(state.skills.keys());
      for (const id of skillIds) {
        if (knownSkills && !knownSkills.has(id) && pending?.kind === "habilidad" && state.skills.get(id)!.name === pending.name) {
          announce(`Habilidad «${pending.name}» creada.`);
          skillConfirm.textContent = `Habilidad «${pending.name}» creada. Ya puedes exigirla en las recetas y conceder sus niveles.`;
          pending = undefined;
          skillForm.reset();
          levelList.reset();
          skillName.focus();
        }
      }
      knownSkills = skillIds;
    },
  };
}
