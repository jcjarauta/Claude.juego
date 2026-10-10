import {
  checkTeach, practiceProgress, skillLevelName,
  type Position, type SkillDef, type TeachOfferedMessage,
} from "@juego/shared";

// Panel «Tus habilidades» del juego (F2c): tu nivel y tu progreso en cada habilidad, las ofertas de enseñanza
// que recibes (aceptar o rechazar) y a quién puedes enseñar. Fuera del canvas, accesible; los botones usan aria-disabled
// para no perder el foco y los cambios se anuncian en una región aria-live.

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

export interface NearbyPlayer {
  name: string;
  at: Position;
  connected: boolean;
  level: (skill: string) => number;
}

export interface SkillsInput {
  skills: SkillDef[];
  mine: (skill: string) => number;
  crafts: (recipe: string) => number;
  recipeName: (id: string) => string;
  me: { name: string; at: Position };
  others: NearbyPlayer[];
  offers: TeachOfferedMessage[];
}

export interface SkillsActions {
  offer: (to: string, skill: string) => void;
  respond: (offerId: string, accept: boolean) => void;
}

export function createSkillsPanel(actions: SkillsActions) {
  const section = byId("habilidades-seccion");
  const list = byId<HTMLUListElement>("habilidades-lista");
  const offersBox = byId("habilidades-ofertas");
  const teachSelect = byId<HTMLSelectElement>("ensenar-opciones");
  const teachButton = byId<HTMLButtonElement>("ensenar-boton");
  const teachHelp = byId("ensenar-ayuda");
  const live = byId("habilidades-aviso");
  let listSignature = "";
  let offersSignature = "";
  let teachSignature = "";
  const lastLevels = new Map<string, number>();

  teachButton.onclick = () => {
    if (teachButton.getAttribute("aria-disabled") === "true" || !teachSelect.value) return;
    const [skill, to] = teachSelect.value.split("|") as [string, string];
    actions.offer(to, skill);
    live.textContent = `Oferta enviada a ${to}. Espera a que la acepte.`;
  };

  return {
    say(text: string) { live.textContent = text; },
    render({ skills, mine, crafts, recipeName, me, others, offers }: SkillsInput) {
      section.hidden = skills.length === 0;
      if (!skills.length) return;

      // Tu nivel y tu progreso; se anuncian las subidas de nivel.
      const rows = skills.map((def) => {
        const level = mine(def.id);
        const before = lastLevels.get(def.id);
        if (before !== undefined && level > before) live.textContent = `¡Has subido a ${skillLevelName(def, level)} en ${def.name}!`;
        lastLevels.set(def.id, level);
        const next = practiceProgress(def, level, crafts);
        const status = level > 0 ? `${skillLevelName(def, level)} (nivel ${level} de ${def.levels.length})` : "no la tienes todavía";
        const goal = next ? ` Para ${next.name}: fabricar «${recipeName(next.recipe)}» (${next.done} de ${next.times}).` : " Tienes el último nivel.";
        return `${def.name}: ${status}.${goal}`;
      });
      const signature = rows.join("\n");
      if (signature !== listSignature) {
        listSignature = signature;
        list.replaceChildren(...rows.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
      }

      // Ofertas recibidas.
      const now = Date.now();
      const live_offers = offers.filter((o) => o.expiresAt > now);
      const defOf = (id: string) => skills.find((s) => s.id === id);
      const offerSignature = live_offers.map((o) => o.offerId).join(",");
      if (offerSignature !== offersSignature) {
        offersSignature = offerSignature;
        offersBox.replaceChildren(...live_offers.map((o) => {
          const def = defOf(o.skill);
          const row = document.createElement("div");
          row.className = "oferta";
          const text = document.createElement("span");
          text.textContent = `${o.from} te ofrece enseñarte ${def?.name ?? o.skill} (${def ? skillLevelName(def, o.level) : `nivel ${o.level}`}). `;
          const accept = Object.assign(document.createElement("button"), { type: "button", textContent: "Aceptar" });
          accept.setAttribute("aria-label", `Aceptar que ${o.from} te enseñe ${def?.name ?? o.skill}`);
          accept.onclick = () => actions.respond(o.offerId, true);
          const reject = Object.assign(document.createElement("button"), { type: "button", textContent: "Rechazar" });
          reject.setAttribute("aria-label", `Rechazar que ${o.from} te enseñe ${def?.name ?? o.skill}`);
          reject.onclick = () => actions.respond(o.offerId, false);
          row.append(text, accept, " ", reject);
          return row;
        }));
        if (live_offers.length) live.textContent = `${live_offers.at(-1)!.from} te ofrece enseñarte una habilidad.`;
      }

      // A quién puedes enseñar ahora: las mismas reglas que el servidor.
      const options: [string, string][] = [];
      for (const def of skills) {
        for (const other of others) {
          const check = checkTeach({
            teacher: me.name, learner: other.name, skill: def, teacherLevel: mine(def.id), learnerLevel: other.level(def.id),
            teacherAt: me.at, learnerAt: other.at, bothConnected: other.connected,
          });
          if (check.ok) options.push([`${def.id}|${other.name}`, `${def.name} (${skillLevelName(def, check.toLevel)}) a ${other.name}`]);
        }
      }
      const optionSignature = options.map(([v]) => v).join(";");
      if (optionSignature !== teachSignature) {
        teachSignature = optionSignature;
        const selected = teachSelect.value;
        teachSelect.replaceChildren(...options.map(([value, label]) => Object.assign(document.createElement("option"), { value, textContent: label })));
        if (options.some(([v]) => v === selected)) teachSelect.value = selected;
      }
      teachSelect.hidden = options.length === 0;
      teachButton.setAttribute("aria-disabled", String(options.length === 0));
      teachHelp.textContent = options.length ? "Elige qué enseñar y a quién (a 2 casillas o menos); tendrá que aceptar."
        : "Nadie cerca a quien puedas enseñar ahora: solo se enseña hasta un nivel por debajo del tuyo y a quien esté a 2 casillas o menos.";
    },
  };
}
export type SkillsPanel = ReturnType<typeof createSkillsPanel>;
