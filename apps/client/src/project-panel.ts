import {
  isNextTo,
  type ContributionSource, type MissionState, type NewsMessage, type Position, type ProjectDef, type ProjectState,
  type StructureState, type WorldConfig,
} from "@juego/shared";

// Panel del proyecto (RF-006, RF-010, RF-013), fuera del canvas y accesible: barras <progress>
// con texto, botones que conservan el foco (aria-disabled) y avisos aria-live.

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

const time = (at: number) => new Date(at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

export type ContributeHandler = (projectId: string, taskId: string, from: ContributionSource, amount: number) => void;

export interface PanelInput {
  state: ProjectState;
  structure: StructureState | undefined;
  mission: MissionState | undefined;
  position: Position;
  /** Inventario propio y almacén de la comunidad, por recurso. */
  held: (resource: string) => number;
  community: (resource: string) => number;
  ownName: string;
}

export interface PanelActions {
  contribute: ContributeHandler;
  build: (structureId: string) => void;
  craft: (recipeId: string) => void;
}

export function createProjectPanel(config: WorldConfig, project: ProjectDef, actions: PanelActions) {
  const onContribute = actions.contribute;
  const structureDef = config.structures.find((s) => s.projectId === project.id);
  const recipeDef = structureDef && config.recipes.find((r) => r.structureId === structureDef.id);
  const missionDef = config.missions[0];
  const itemName = new Map(config.items.map((i) => [i.id, i.name.toLowerCase()]));
  const buildBox = byId("construir");
  const buildButton = byId<HTMLButtonElement>("construir-boton");
  const buildHelp = byId("construir-ayuda");
  const workshop = byId("taller");
  const workshopBuilt = byId("taller-construido");
  const recipeText = byId("taller-receta");
  const craftButton = byId<HTMLButtonElement>("taller-fabricar");
  const craftHelp = byId("taller-ayuda");
  const missionText = byId("mision-estado");
  if (structureDef) {
    buildButton.textContent = `Construir: ${structureDef.name}`;
    buildButton.onclick = () => { if (buildButton.getAttribute("aria-disabled") !== "true") actions.build(structureDef.id); };
    byId("taller-titulo").textContent = structureDef.name;
  }
  if (recipeDef) {
    craftButton.textContent = `Fabricar: ${recipeDef.name}`;
    craftButton.onclick = () => { if (craftButton.getAttribute("aria-disabled") !== "true") actions.craft(recipeDef.id); };
  }
  let lastBuilt: boolean | undefined;
  let lastMission: string | undefined;
  let lastTools: number | undefined;
  const heading = byId("proyecto-titulo");
  const status = byId("proyecto-estado");
  const tasks = byId<HTMLUListElement>("proyecto-tareas");
  const contributors = byId<HTMLUListElement>("proyecto-aportes");
  const activity = byId<HTMLOListElement>("proyecto-actividad");
  const news = byId("proyecto-novedades");
  const announcer = byId("proyecto-aviso");
  byId("proyecto-comunidad").textContent = config.community.name;
  byId("proyecto-descripcion").textContent = project.description;
  heading.textContent = `Proyecto: ${project.name}`;

  const resourceName = new Map(config.resources.map((r) => [r.id, r.name.toLowerCase()]));
  const rows = new Map<string, { li: HTMLLIElement; progress: HTMLProgressElement; text: HTMLElement; buttons: HTMLButtonElement[] }>();

  // Tareas: se crean una vez y luego solo cambian valores y estados (no se pierde el foco).
  for (const task of project.tasks) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "tarea-titulo";
    label.id = `tarea-${task.id}`;
    label.textContent = task.title;
    const progress = document.createElement("progress");
    progress.max = task.required;
    progress.setAttribute("aria-labelledby", label.id);
    const text = document.createElement("span");
    text.className = "tarea-progreso";
    const actions = document.createElement("span");
    actions.className = "tarea-acciones";
    const name = resourceName.get(task.resource) ?? task.resource;
    const buttons = ([
      ["Aportar 1", `Aportar 1 de ${name} desde tu inventario`, "player", "one"],
      ["Aportar todo", `Aportar toda tu ${name}`, "player", "all"],
      ["Desde la comunidad", `Aportar ${name} desde el almacén de la comunidad`, "community", "all"],
    ] as const).map(([text, label, from, how]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.setAttribute("aria-label", label);
      button.dataset.from = from;
      button.onclick = () => {
        if (button.getAttribute("aria-disabled") === "true") return;
        const available = Number(button.dataset.available ?? 0);
        onContribute(project.id, task.id, from, how === "one" ? 1 : available);
      };
      actions.append(button);
      return button;
    });
    li.append(label, progress, text, actions);
    tasks.append(li);
    rows.set(task.id, { li, progress, text, buttons });
  }

  let lastStatus = "";
  const completed = new Set<string>();
  /** Aportes ya mostrados; undefined hasta el primer pintado (lo que ya había no se anuncia). */
  let seenRecent: Set<string> | undefined;

  return {
    focus() {
      heading.scrollIntoView({ block: "nearest" });
      heading.focus();
    },

    render({ state, held, community, ownName, structure, mission, position }: PanelInput) {
      for (const task of project.tasks) {
        const row = rows.get(task.id)!;
        const done = state.progress.get(task.resource) ?? 0;
        const remaining = Math.max(0, task.required - done);
        const name = resourceName.get(task.resource) ?? task.resource;
        row.progress.value = done;
        row.text.textContent = remaining === 0 ? `${done}/${task.required} ${name} — completa` : `${done}/${task.required} ${name}`;
        for (const button of row.buttons) {
          const balance = button.dataset.from === "player" ? held(task.resource) : community(task.resource);
          const available = Math.min(balance, remaining);
          button.dataset.available = String(available);
          button.setAttribute("aria-disabled", String(available === 0));
        }
        if (remaining === 0 && !completed.has(task.id)) {
          if (lastStatus) announcer.textContent = `Tarea completa: ${task.title}.`;
          completed.add(task.id);
        }
      }

      const ready = state.status === "listo";
      const built = Boolean(structure?.built);
      status.textContent = built
        ? `Construido: ${structureDef?.name ?? ""} en pie.`
        : ready ? "Listo para construir: todas las tareas están completas." : "En curso.";
      if (lastStatus && lastStatus !== state.status && ready) announcer.textContent = `¡Proyecto ${project.name} listo para construir!`;
      lastStatus = state.status;

      // Construir (Q156): visible con el proyecto listo; el servidor decide.
      if (structureDef) {
        buildBox.hidden = !ready || built;
        const near = isNextTo(position, structureDef);
        buildButton.setAttribute("aria-disabled", String(!near));
        buildHelp.textContent = near
          ? "Estás junto al solar. Asegúrate de que no haya nadie dentro."
          : `Acércate al solar (contorno discontinuo en la aldea, casillas ${structureDef.x}–${structureDef.x + structureDef.width - 1}, ${structureDef.y}–${structureDef.y + structureDef.height - 1}).`;
      }
      if (lastBuilt === false && built) {
        announcer.textContent = `¡${structure!.builtBy} ha construido el ${structureDef?.name.toLowerCase() ?? "edificio"}!`;
        // El botón de construir desaparece: si tenía el foco, pasa a la sección del taller.
        if (document.activeElement === buildButton || document.activeElement === document.body) {
          workshop.hidden = false;
          byId("taller-titulo").focus();
        }
      }
      lastBuilt = built;

      // Taller y receta (Q157).
      workshop.hidden = !built;
      if (built && structureDef && recipeDef && structure) {
        workshopBuilt.textContent = `Construido por ${structure.builtBy} a las ${time(structure.builtAt)}.`;
        const parts = Object.entries(recipeDef.inputs).map(([r, n]) => `${n} de ${resourceName.get(r) ?? r} (hay ${community(r)})`);
        recipeText.textContent = `Receta: ${parts.join(", ")} del almacén de la comunidad → ${recipeDef.output.amount} ${itemName.get(recipeDef.output.item) ?? recipeDef.output.item}.`;
        const enough = Object.entries(recipeDef.inputs).every(([r, n]) => community(r) >= n);
        const near = isNextTo(position, structureDef);
        craftButton.setAttribute("aria-disabled", String(!enough || !near));
        craftHelp.textContent = !near ? `Acércate al ${structureDef.name.toLowerCase()} para fabricar.`
          : enough ? "Todo listo para fabricar." : "Faltan materiales en el almacén de la comunidad: depositad lo necesario.";
        const tools = community(recipeDef.output.item);
        if (lastTools !== undefined && tools > lastTools) announcer.textContent = `Se ha fabricado ${tools - lastTools} ${itemName.get(recipeDef.output.item) ?? ""}.`;
        lastTools = tools;
      }

      // Misión (Q158).
      if (missionDef && mission) {
        missionText.textContent = mission.status === "completada"
          ? `${missionDef.name}: completada por ${mission.completedBy} a las ${time(mission.completedAt)}. ¡Enhorabuena a toda la comunidad!`
          : `${missionDef.name}: pendiente. ${missionDef.description}`;
        if (lastMission === "pendiente" && mission.status === "completada") announcer.textContent = `¡Misión ${missionDef.name} completada por ${mission.completedBy}!`;
        lastMission = mission.status;
      }

      contributors.replaceChildren(...[...state.contributors.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([who, totals]) => {
          const li = document.createElement("li");
          const parts = [...totals.totals.entries()].map(([r, n]) => `${n} de ${resourceName.get(r) ?? r}`);
          li.textContent = `${who}${who === ownName ? " (tú)" : ""}: ${parts.join(", ")}`;
          return li;
        }));
      if (state.contributors.size === 0) {
        const li = document.createElement("li");
        li.textContent = "Todavía nadie.";
        contributors.append(li);
      }

      // Actividad: la más reciente primero. Los aportes nuevos se anuncian una vez.
      const recent = [...state.recent];
      const key = (c: (typeof recent)[number]) => `${c.at}|${c.name}|${c.resource}|${c.amount}`;
      if (seenRecent) {
        for (const c of recent.filter((c) => !seenRecent!.has(key(c)))) {
          const what = `${c.amount} de ${resourceName.get(c.resource) ?? c.resource}`;
          announcer.textContent = c.name === ownName ? `Has aportado ${what} al proyecto.` : `${c.name} ha aportado ${what} al proyecto.`;
        }
      }
      seenRecent = new Set(recent.map(key));
      activity.replaceChildren(...recent.reverse().map((c) => {
        const li = document.createElement("li");
        li.textContent = `${time(c.at)} — ${c.name} aportó ${c.amount} de ${resourceName.get(c.resource) ?? c.resource}`;
        return li;
      }));
    },

    showNews(message: NewsMessage) {
      if (message.since === null) {
        news.textContent = "Es tu primera visita a este mundo.";
        return;
      }
      if (message.items.length === 0) {
        news.textContent = `Sin aportes de otros desde tu última visita (${time(message.since)}).`;
        return;
      }
      const lines = message.items.map((n) => `${n.name} aportó ${n.amount} de ${resourceName.get(n.resource) ?? n.resource} (${time(n.at)})`);
      news.textContent = `Desde tu última visita: ${lines.join("; ")}.`;
    },
  };
}

export type ProjectPanel = ReturnType<typeof createProjectPanel>;
