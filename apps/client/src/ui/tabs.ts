// Pestañas (G3a, Q203): patrón «Tabs» de WAI-ARIA Authoring Practices con activación automática.
// El HTML ya trae `role="tablist"`, cada `role="tab"` con `aria-controls` y cada `role="tabpanel"`. Este módulo añade el
// comportamiento: solo la pestaña activa está en el orden del foco (roving tabindex); flechas izquierda/derecha, Inicio y Fin
// las recorren; el panel de las demás se oculta.

export interface Tabs {
  tabs: HTMLButtonElement[];
  select(tab: HTMLButtonElement, focus?: boolean): void;
}

export function setupTabs(root: ParentNode, onSelect: (tab: HTMLButtonElement) => void = () => {}): Tabs {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panelOf = (tab: HTMLButtonElement) => {
    const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
    if (!panel) throw new Error(`Falta el panel de la pestaña #${tab.id}`);
    return panel;
  };
  const select = (tab: HTMLButtonElement, focus = true) => {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      panelOf(t).hidden = !selected;
    }
    if (focus) tab.focus();
    onSelect(tab);
  };
  for (const tab of tabs) {
    tab.onclick = () => select(tab);
    tab.onkeydown = (event) => {
      const i = tabs.indexOf(tab);
      const next = event.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length]
        : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : undefined;
      if (next) { event.preventDefault(); select(next); }
    };
  }
  return { tabs, select };
}
