import { el } from "./dom.ts";

// Lista dinámica de filas (G3a, Q203): «Añadir …» y «Quitar», con mínimo y máximo.
// Accesibilidad: las etiquetas se renumeran al quitar; el foco pasa a la fila nueva o a la siguiente (o al botón de añadir);
// cada cambio se anuncia; los botones se desactivan con `aria-disabled` (siguen en el orden del foco) y explican el motivo.

/** Una fila: sus controles, las etiquetas a renumerar y el control que recibe el foco. */
export interface DynamicRow {
  controls: HTMLElement[];
  labels: HTMLLabelElement[];
  first: HTMLElement;
  /** Nombres accesibles de las etiquetas para la fila `index` (empieza en 0). */
  names: (index: number) => string[];
}

export interface DynamicListOptions<R extends DynamicRow> {
  legend: string;
  addLabel: string;
  /** Sustantivo en singular y minúsculas para los avisos («entrada», «nivel»). */
  noun: string;
  min: number;
  max: number;
  announce: (text: string) => void;
  build: () => R;
  onChange: () => void;
}

export function dynamicList<R extends DynamicRow>(opts: DynamicListOptions<R>) {
  const rows: R[] = [];
  const boxes = new Map<R, HTMLElement>();
  const list = el("div", { className: "filas" });
  const add = el("button", { type: "button" });
  const element = el("fieldset", {}, el("legend", {}, opts.legend), list, add);
  const Noun = `${opts.noun[0]!.toUpperCase()}${opts.noun.slice(1)}`;

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
      opts.announce(`${Noun} quitada. Quedan ${rows.length}.`);
    };
    const box = el("div", { className: "entrada-receta" }, ...row.controls, remove);
    rows.push(row);
    boxes.set(row, box);
    list.append(box);
    renumber();
    if (!silent) opts.onChange();
    if (focus) {
      row.first.focus();
      opts.announce(`${Noun} ${rows.length} añadida.`);
    }
  }
  add.onclick = () => {
    if (add.getAttribute("aria-disabled") === "true") { opts.announce(`No caben más: el máximo es ${opts.max}.`); return; }
    addRow(true);
  };
  // `silent`: al crearse, las listas que `onChange` consulta aún pueden no existir; las opciones se rellenan en el primer render.
  const reset = (silent = false) => {
    for (const row of [...rows]) { boxes.get(row)!.remove(); boxes.delete(row); }
    rows.length = 0;
    for (let i = 0; i < opts.min; i++) addRow(false, silent);
    renumber();
  };
  reset(true);
  return { element, rows, reset };
}
