import {
  MESSAGE, PANEL_LIMITS,
  type CreateMissionMessage, type CreateProjectMessage, type NewTask, type WorldConfig, type WorldState,
} from "@juego/shared";
import type { Room } from "@colyseus/sdk";
import { newRequestId } from "./request-id.ts";

// Formularios de administración del panel (F1a, FUT-05, Q171–Q174): crear proyectos y misiones
// sin programar. El servidor valida todo; aquí solo se ayuda a rellenar y se muestran sus motivos.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

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
    .replace(/^(proyecto|misión) "[^"]*": /, "")
    .replace(/^(proyecto|misión)\.tasks\[(\d+)\]: /, (_m, _w, n: string) => `Tarea ${Number(n) + 1}: `)
    .replace(/\bname\b/g, "nombre").replace(/\bdescription\b/g, "descripción").replace(/\btitle\b/g, "título")
    .replace(/\brequired\b/g, "cantidad").replace(/\bacceptance\b/g, "criterio de aceptación")
    .replace(/\bcoordinators\b/g, "coordinación").replace(/\btasks\b/g, "tareas").replace(/\bobjective\b/g, "objetivo")
    .replace(/^./, (c) => c.toUpperCase());
}

export function createAdminForms(container: HTMLElement, config: WorldConfig, room: Room<unknown, WorldState>, announce: (text: string) => void) {
  const resources = config.resources;
  const section = el("section", { className: "admin" });
  section.setAttribute("aria-labelledby", "admin-titulo");
  section.append(el("h2", { id: "admin-titulo" }, "Administración"),
    el("p", { className: "ayuda" }, "Crea proyectos y misiones sin programar. Un proyecto queda publicado al crearlo y no se puede modificar: para corregirlo, ciérralo y crea otro."));

  // --- Nuevo proyecto ---
  const name = el("input", { maxLength: PANEL_LIMITS.name, required: true, autocomplete: "off" });
  const description = el("textarea", { maxLength: PANEL_LIMITS.description });
  const coordinators = el("input", { autocomplete: "off" });
  const approval = el("input", { type: "checkbox", id: "nuevo-aprobacion" });
  const projectDue = el("input", { type: "date" });
  const taskList = el("ol", { className: "tareas-nuevas" });
  const addTask = el("button", { type: "button", textContent: "Añadir tarea" });
  const projectErrors = el("div", { className: "error", role: "alert" });
  const projectForm = el("form", { noValidate: true },
    el("h3", { id: "nuevo-proyecto-titulo" }, "Nuevo proyecto"),
    field("Nombre", name, `Obligatorio, hasta ${PANEL_LIMITS.name} caracteres.`),
    field("Descripción", description, `Opcional, hasta ${PANEL_LIMITS.description} caracteres.`),
    el("fieldset", {}, el("legend", {}, "Tareas (una por recurso)"), taskList, addTask),
    field("Fecha objetivo del proyecto", projectDue, "Opcional (AAAA-MM-DD). Las tareas no pueden vencer después."),
    field("Coordinación", coordinators, "Nombres de cuenta separados por comas. Si lo dejas vacío, coordinas tú."),
    el("p", {}, el("label", {}, approval, " Completar exige que la coordinación apruebe todas las tareas")),
    projectErrors,
    el("button", { type: "submit", textContent: "Crear y publicar el proyecto" }),
  );
  projectForm.setAttribute("aria-labelledby", "nuevo-proyecto-titulo");

  interface TaskRow { li: HTMLLIElement; resource: HTMLSelectElement; title: HTMLInputElement; required: HTMLInputElement; acceptance: HTMLInputElement; due: HTMLInputElement }
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
    const remove = el("button", { type: "button", textContent: `Quitar la tarea ${n}` });
    const li = el("li", { className: "tarea-nueva" },
      field(`Recurso de la tarea ${n}`, resource), field(`Título de la tarea ${n}`, title),
      field(`Cantidad de la tarea ${n}`, required, `De 1 a ${PANEL_LIMITS.required}.`),
      field(`Criterio de aceptación de la tarea ${n}`, acceptance, "Opcional; por defecto «Aportar N de recurso»."),
      field(`Fecha objetivo de la tarea ${n}`, due, "Opcional."), remove);
    const row = { li, resource, title, required, acceptance, due };
    remove.onclick = () => {
      rows.splice(rows.indexOf(row), 1);
      li.remove();
      addTask.setAttribute("aria-disabled", "false");
      addTask.focus();
    };
    rows.push(row);
    taskList.append(li);
    addTask.setAttribute("aria-disabled", String(rows.length >= Math.min(PANEL_LIMITS.tasks, resources.length)));
  }
  addTask.onclick = () => {
    if (addTask.getAttribute("aria-disabled") === "true") return;
    addTaskRow();
    rows.at(-1)?.resource.focus();
  };
  addTaskRow();

  let pendingProject: string | undefined;
  projectForm.onsubmit = (event) => {
    event.preventDefault();
    projectErrors.replaceChildren();
    const tasks: NewTask[] = rows.map((r) => ({
      resource: r.resource.value,
      title: r.title.value.trim() || `Aportar ${r.resource.selectedOptions[0]?.textContent?.toLowerCase() ?? r.resource.value}`,
      required: Number(r.required.value),
      ...(r.acceptance.value.trim() ? { acceptance: r.acceptance.value.trim() } : {}),
      ...(r.due.value ? { dueDate: r.due.value } : {}),
    }));
    const list = coordinators.value.split(",").map((s) => s.trim()).filter(Boolean);
    const message: CreateProjectMessage = {
      requestId: newRequestId(), name: name.value.trim(), description: description.value.trim(), tasks,
      ...(list.length ? { coordinators: list } : {}), requiresApproval: approval.checked,
      ...(projectDue.value ? { dueDate: projectDue.value } : {}),
    };
    pendingProject = message.name;
    room.send(MESSAGE.createProject, message);
  };

  // --- Nueva misión ---
  const missionName = el("input", { maxLength: PANEL_LIMITS.name, autocomplete: "off" });
  const missionDescription = el("textarea", { maxLength: PANEL_LIMITS.description });
  const kindProject = el("input", { type: "radio", name: "objetivo", value: "project-completed", checked: true });
  const kindItem = el("input", { type: "radio", name: "objetivo", value: "item-in-community" });
  const projectSelect = el("select");
  const itemSelect = el("select");
  for (const item of config.items) itemSelect.append(el("option", { value: item.id, textContent: item.name }));
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
    pendingMission = message.name;
    room.send(MESSAGE.createMission, message);
  };

  section.append(projectForm, missionForm);
  container.before(section); // antes de la lista de proyectos

  let knownProjects: Set<string> | undefined;
  let knownMissions: Set<string> | undefined;
  return {
    /** Motivo de rechazo del servidor junto al formulario que lo provocó. */
    showRejection(text: string, details: string[] = []) {
      // El nombre pedido puede ser vacío (y el servidor lo rechaza): lo que cuenta es que haya algo pendiente.
      const target = pendingMission !== undefined ? missionErrors : pendingProject !== undefined ? projectErrors : undefined;
      if (!target) return false;
      target.replaceChildren(el("p", {}, text), ...(details.length ? [el("ul", {}, ...details.map((d) => el("li", {}, readable(d))))] : []));
      pendingMission = pendingProject = undefined;
      return true;
    },
    render() {
      const state = room.state;
      // Proyectos abiertos como posibles objetivos de misión.
      const open = [...state.projects.entries()].filter(([, p]) => p.phase !== "cerrado");
      const options = open.map(([id, p]) => `${id}|${p.name}`).join(";");
      if (projectSelect.dataset.options !== options) {
        const selected = projectSelect.value;
        projectSelect.replaceChildren(...open.map(([id, p]) => el("option", { value: id, textContent: p.name })));
        if (open.some(([id]) => id === selected)) projectSelect.value = selected;
        projectSelect.dataset.options = options;
      }
      // Confirmación: el proyecto o la misión pedidos aparecen en el estado.
      const projectIds = new Set(state.projects.keys());
      for (const id of projectIds) {
        if (knownProjects && !knownProjects.has(id) && state.projects.get(id)!.name === pendingProject) {
          announce(`Proyecto «${pendingProject}» creado y publicado.`);
          pendingProject = undefined;
          projectForm.reset();
          for (const r of rows.splice(1)) r.li.remove();
          addTask.setAttribute("aria-disabled", "false");
          name.focus();
        }
      }
      knownProjects = projectIds;
      const missionIds = new Set(state.missions.keys());
      for (const id of missionIds) {
        if (knownMissions && !knownMissions.has(id) && state.missions.get(id)!.name === pendingMission) {
          announce(`Misión «${pendingMission}» creada.`);
          pendingMission = undefined;
          missionForm.reset();
          applyKind();
          missionName.focus();
        }
      }
      knownMissions = missionIds;
    },
  };
}
