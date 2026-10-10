import {
  MESSAGE, PANEL_LIMITS,
  type CreateConstructionMessage, type CreateItemMessage, type CreateMissionMessage, type CreateProjectMessage, type CreateRecipeMessage,
  type NewTask, type WorldConfig, type WorldState,
} from "@juego/shared";
import type { Room } from "@colyseus/sdk";
import { newRequestId } from "./request-id.ts";
import { el } from "./views/common.ts";
import { createMinimap } from "./views/minimap.ts";

// Formularios de administración del panel (F1a, FUT-05, Q171–Q174): crear proyectos y misiones
// sin programar. El servidor valida todo; aquí solo se ayuda a rellenar y se muestran sus motivos.

let fieldCount = 0;
/** Campo con etiqueta asociada y ayuda opcional. */
function field<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(label: string, control: T, help?: string) {
  control.id ||= `campo-${++fieldCount}`;
  const wrapper = el("div", { className: "campo" }, el("label", { htmlFor: control.id }, label), control);
  if (help) {
    const p = el("p", { id: `${control.id}-ayuda`, className: "ayuda" }, help);
    control.setAttribute("aria-describedby", p.id);
    wrapper.append(p);
  }
  return wrapper;
}

/** Mensajes de validación del servidor en lenguaje del formulario (sin ids internos ni nombres de campo en inglés). */
function readable(detail: string): string {
  return detail
    .replace(/^(proyecto|misión|construcción|objeto|receta) "[^"]*": /, "")
    .replace(/^(proyecto|misión|construcción)\.tasks\[(\d+)\]: /, (_m, _w, n: string) => `Tarea ${Number(n) + 1}: `)
    .replace(/\bname\b/g, "nombre").replace(/\bdescription\b/g, "descripción").replace(/\btitle\b/g, "título")
    .replace(/\brequired\b/g, "cantidad").replace(/\bacceptance\b/g, "criterio de aceptación")
    .replace(/\bcoordinators\b/g, "coordinación").replace(/\btasks\b/g, "tareas").replace(/\bobjective\b/g, "objetivo")
    .replace(/\binputs\b/g, "entradas").replace(/\boutput\.amount\b/g, "cantidad de salida")
    .replace(/\bbyproducts\b/g, "subproductos").replace(/\bverb\b/g, "acción").replace(/\balsoNeeds\b/g, "edificios extra").replace(/\bcolor\b/g, "color")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Una fila de una lista dinámica: sus controles, las etiquetas a renumerar y el control que recibe el foco. */
interface DynamicRow {
  controls: HTMLElement[];
  labels: HTMLLabelElement[];
  first: HTMLElement;
  names: (index: number) => string[];
}

/**
 * Lista de filas que se añaden con «Añadir …» y se quitan con «Quitar» (F2b): mínimo y máximo, etiquetas renumeradas,
 * el foco pasa a la fila nueva o al botón de añadir, y cada cambio se anuncia (el botón se desactiva con aria-disabled
 * para no perder el foco).
 */
function dynamicList<R extends DynamicRow>(opts: {
  legend: string; addLabel: string; noun: string; min: number; max: number; announce: (text: string) => void;
  build: () => R; onChange: () => void;
}) {
  const rows: R[] = [];
  const boxes = new Map<R, HTMLElement>();
  const list = el("div", { className: "filas" });
  const add = el("button", { type: "button" });
  const element = el("fieldset", {}, el("legend", {}, opts.legend), list, add);

  function renumber() {
    rows.forEach((row, i) => {
      row.names(i).forEach((name, k) => { row.labels[k]!.textContent = name; });
      const remove = boxes.get(row)!.querySelector("button")!;
      remove.textContent = "Quitar";
      remove.setAttribute("aria-label", `Quitar ${opts.noun} ${i + 1}`);
      remove.setAttribute("aria-disabled", String(rows.length <= opts.min));
    });
    add.textContent = `${opts.addLabel} (${rows.length} de ${opts.max})`;
    add.setAttribute("aria-disabled", String(rows.length >= opts.max));
  }
  function addRow(focus: boolean, silent = false) {
    const row = opts.build();
    const remove = el("button", { type: "button" });
    remove.onclick = () => {
      if (remove.getAttribute("aria-disabled") === "true") return;
      const at = rows.indexOf(row);
      rows.splice(at, 1);
      boxes.get(row)!.remove();
      boxes.delete(row);
      renumber();
      (rows[Math.min(at, rows.length - 1)]?.first ?? add).focus();
      opts.announce(`${opts.noun[0]!.toUpperCase()}${opts.noun.slice(1)} quitada. Quedan ${rows.length}.`);
    };
    const box = el("div", { className: "entrada-receta" }, ...row.controls, remove);
    rows.push(row);
    boxes.set(row, box);
    list.append(box);
    renumber();
    if (!silent) opts.onChange();
    if (focus) {
      row.first.focus();
      opts.announce(`${opts.noun[0]!.toUpperCase()}${opts.noun.slice(1)} ${rows.length} añadida.`);
    }
  }
  add.onclick = () => {
    if (add.getAttribute("aria-disabled") === "true") { opts.announce(`No caben más: el máximo es ${opts.max}.`); return; }
    addRow(true);
  };
  // `silent`: al crearse, las listas que `onChange` consulta aún no existen; las opciones se rellenan en el primer render().
  const reset = (silent = false) => {
    for (const row of [...rows]) { boxes.get(row)!.remove(); boxes.delete(row); }
    rows.length = 0;
    for (let i = 0; i < opts.min; i++) addRow(false, silent);
    renumber();
  };
  reset(true);
  return { element, rows, reset };
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
  let pending: { kind: "proyecto" | "mision" | "objeto" | "receta"; name: string } | undefined;
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
  const itemErrors = el("div", { className: "error", role: "alert" });
  const itemConfirm = el("p", { className: "confirmacion", role: "status" });
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

  // Entradas, subproductos y edificios extra: filas que se añaden y se quitan (F2b, Q190); el tope es el límite configurado.
  const inputList = dynamicList({
    legend: "Entradas (recursos u objetos del almacén común)", addLabel: "Añadir entrada (recurso u objeto)", noun: "entrada", min: 1, max: limits.recipeInputs, announce,
    onChange: () => syncRecipeSelects(),
    build: () => {
      const entry = el("select");
      const amount = el("input", { type: "number", min: "1", max: String(limits.inputAmount), value: "1", inputMode: "numeric" });
      const a = field("", entry), b = field("", amount);
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
      const a = field("", item), b = field("", amount);
      return { item, amount, controls: [a, b], labels: [a, b].map((w) => w.querySelector("label")!), first: item,
        names: (i: number) => [`Subproducto ${i + 1}: objeto`, `Cantidad del subproducto ${i + 1}`] };
    },
  });
  const extraList = dynamicList({
    legend: "Otros edificios necesarios (opcionales)", addLabel: "Añadir edificio necesario", noun: "edificio", min: 0, max: limits.alsoNeeds, announce,
    onChange: () => syncRecipeSelects(),
    build: () => {
      const building = el("select");
      const a = field("", building);
      return { building, controls: [a], labels: [a.querySelector("label")!], first: building,
        names: (i: number) => [`Edificio necesario ${i + 1} (debe estar construido, en cualquier lugar)`] };
    },
  });
  function syncRecipeSelects() {
    inputList.rows.forEach((r, i) => syncEntries(r.entry, itemEntries, i === 0 ? "Elige una entrada" : "Elige una entrada"));
    for (const r of byproductList.rows) syncOptions(r.item, itemEntries, "Elige un objeto");
    for (const r of extraList.rows) syncOptions(r.building, buildingEntries, "Elige un edificio");
  }

  const recipeErrors = el("div", { className: "error", role: "alert" });
  const recipeConfirm = el("p", { className: "confirmacion", role: "status" });
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
    const message: CreateRecipeMessage = {
      requestId: newRequestId(), name: recipeName.value.trim(), structureId: recipeStructure.value,
      inputs: Object.fromEntries(used.map((r) => [r.entry.value, Number(r.amount.value)])),
      output: { item: recipeOutput.value, amount: Number(outputAmount.value) },
      ...(verb ? { verb } : {}), ...(alsoNeeds.length ? { alsoNeeds } : {}), ...(byproducts.length ? { byproducts } : {}),
    };
    pending = { kind: "receta", name: message.name };
    room.send(MESSAGE.createRecipe, message);
  };

  /** Opciones de un selector a partir del estado (se rehacen solo si cambian; se conserva la elección). */
  function syncOptions(select: HTMLSelectElement, entries: [string, string][], placeholder?: string) {
    const signature = `${placeholder ?? ""}#${entries.map(([id, label]) => `${id}|${label}`).join(";")}`;
    if (select.dataset.options === signature) return;
    const selected = select.value;
    select.replaceChildren(...(placeholder === undefined ? [] : [el("option", { value: "", textContent: placeholder })]),
      ...entries.map(([id, label]) => el("option", { value: id, textContent: label })));
    if (entries.some(([id]) => id === selected)) select.value = selected;
    select.dataset.options = signature;
  }

  /** Entradas de receta agrupadas en «Recursos» y «Objetos» (F2b, Q190). */
  function syncEntries(select: HTMLSelectElement, items: [string, string][], placeholder: string) {
    const signature = `${placeholder}#${items.map(([id, label]) => `${id}|${label}`).join(";")}`;
    if (select.dataset.options === signature) return;
    const selected = select.value;
    const group = (label: string, entries: [string, string][]) => {
      const node = el("optgroup", { label });
      node.append(...entries.map(([id, text]) => el("option", { value: id, textContent: text })));
      return node;
    };
    select.replaceChildren(el("option", { value: "", textContent: placeholder }),
      group("Recursos", resources.map((r) => [r.id, r.name])), ...(items.length ? [group("Objetos", items)] : []));
    if ([...resources.map((r) => r.id), ...items.map(([id]) => id)].includes(selected)) select.value = selected;
    select.dataset.options = signature;
  }

  section.append(projectForm, itemForm, recipeForm, missionForm);
  container.before(section); // antes de la lista de proyectos

  let knownProjects: Set<string> | undefined;
  let knownMissions: Set<string> | undefined;
  let knownItems: Set<string> | undefined;
  let knownRecipes: Set<string> | undefined;
  const errorBox = { proyecto: projectErrors, mision: missionErrors, objeto: itemErrors, receta: recipeErrors };
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
          for (const list of [inputList, byproductList, extraList]) list.reset();
          recipeName.focus();
        }
      }
      knownRecipes = recipeIds;
    },
  };
}
