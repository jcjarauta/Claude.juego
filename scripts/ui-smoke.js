// Guion de humo de la interfaz (G3b, Q213): captura y comparación de las pruebas funcionales T1–T4.
// Se ejecuta DENTRO del navegador integrado, en la pantalla a comprobar y con el mundo de prueba sembrado
// (scripts/ui-seed.ts). Se pega entero en la herramienta de JavaScript del navegador: evalúa a { capture, compare }.
//   const s = <este archivo>;  const base = s.capture();   → T1–T4 de la pantalla actual
//   s.compare(baseline, s.capture())                       → diferencias (lista vacía = sin cambios)
// No sustituye a `npm.cmd run dom` (estático) ni al recorrido con teclado: los completa con lo que solo se ve en el navegador.
(() => {
  const visible = (e) => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return !e.hidden && cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0 && !e.closest("[hidden]");
  };
  const name = (e) => {
    const text = (e.getAttribute("aria-label") || e.textContent || e.value || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${text ? ` «${text}»` : ""}`;
  };
  const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"]), [role="tab"]';
  const handlerOf = (e) => ["onclick", "onchange", "oninput", "onkeydown", "onsubmit"].filter((h) => typeof e[h] === "function");

  /** T1. Visibilidad: de cada elemento con id, y de pestañas y paneles de pestañas. */
  const t1 = () => ({
    ids: Object.fromEntries([...document.querySelectorAll("[id]")].map((e) => [e.id, visible(e)])),
    tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => ({
      id: t.id, selected: t.getAttribute("aria-selected"), tabindex: t.tabIndex, controls: t.getAttribute("aria-controls"),
      panelVisible: (() => { const p = document.getElementById(t.getAttribute("aria-controls") || ""); return p ? visible(p) : null; })(),
    })),
    tabpanels: [...document.querySelectorAll('[role="tabpanel"]')].map((p) => ({ id: p.id, visible: visible(p), empty: p.textContent.trim() === "" })),
    sections: [...document.querySelectorAll("section, main, header, nav, aside, footer")].map((s) => ({ name: s.getAttribute("aria-label") || s.id || s.tagName.toLowerCase(), visible: visible(s) })),
  });

  /** T2. Controles interactivos: nombre, visibilidad, estado y manejadores. */
  const t2 = () => ({
    controls: [...document.querySelectorAll('button, a[href], input, select, textarea, [role="tab"]')].map((e) => ({
      name: name(e), visible: visible(e), ariaDisabled: e.getAttribute("aria-disabled"), disabled: Boolean(e.disabled), handlers: handlerOf(e),
      // un botón sin manejador propio puede depender de un manejador del formulario o de un enlace
      inForm: Boolean(e.form), isLink: e.tagName === "A",
    })),
  });

  /** T3. Orden del foco: elementos enfocables visibles en el orden del documento, y su posición en pantalla. */
  const t3 = () => ({
    order: [...document.querySelectorAll(FOCUSABLE)].filter(visible).map((e) => {
      const r = e.getBoundingClientRect();
      return { name: name(e), x: Math.round(r.left), y: Math.round(r.top), tabindex: e.getAttribute("tabindex") };
    }),
    positiveTabindex: [...document.querySelectorAll("[tabindex]")].filter((e) => e.tabIndex > 0).map(name),
  });

  /** T4. Dependencias CSS estructurales: coincidencias de cada selector con estructura y estilos calculados de muestra. */
  const STRUCTURAL = /[\s>+~#\[:]/;
  const SAMPLE_IDS = ["game", "proyecto", "proyecto-titulo", "inventario", "comunidad", "jugadores", "zona", "aviso", "taller", "habilidades-seccion"];
  const SAMPLE_SELECTORS = [".recursos th", ".recursos td", ".tareas li", ".tareas progress", ".selector select", "fieldset label", "h1", "h2", "h3"];
  const style = (e) => {
    const c = getComputedStyle(e);
    return { fontSize: c.fontSize, fontWeight: c.fontWeight, display: c.display, color: c.color, background: c.backgroundColor, marginTop: c.marginTop, paddingTop: c.paddingTop, border: c.borderTopWidth };
  };
  const t4 = () => {
    const selectors = {};
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      const walk = (list) => { for (const rule of list) {
        if (rule.selectorText) for (const sel of rule.selectorText.split(",").map((s) => s.trim())) {
          if (!STRUCTURAL.test(sel) || /:(hover|focus|focus-visible|active|root)/.test(sel)) continue;
          try { selectors[sel] = document.querySelectorAll(sel).length; } catch { /* selector no consultable */ }
        } else if (rule.cssRules) walk(rule.cssRules);
      } };
      walk(rules);
    }
    return {
      selectors,
      samples: {
        ...Object.fromEntries(SAMPLE_IDS.filter((id) => document.getElementById(id)).map((id) => [`#${id}`, style(document.getElementById(id))])),
        ...Object.fromEntries(SAMPLE_SELECTORS.map((s) => [s, document.querySelector(s) ? style(document.querySelector(s)) : null])),
      },
    };
  };

  const capture = () => ({
    page: location.pathname, width: innerWidth, fontScale: getComputedStyle(document.documentElement).fontSize,
    t1: t1(), t2: t2(), t3: t3(), t4: t4(),
  });

  /** Diferencias entre una línea base y una captura nueva. Lista vacía = sin cambios. */
  const compare = (base, now) => {
    const out = [];
    const diffObj = (label, a, b) => { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${label} ${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`); };
    // T1
    diffObj("T1 visibilidad id", base.t1.ids, now.t1.ids);
    if (JSON.stringify(base.t1.tabs) !== JSON.stringify(now.t1.tabs)) out.push("T1 pestañas distintas");
    if (JSON.stringify(base.t1.tabpanels) !== JSON.stringify(now.t1.tabpanels)) out.push("T1 paneles de pestañas distintos");
    // T2
    const key = (c) => c.name;
    const nowControls = new Map(now.t2.controls.map((c) => [key(c), c]));
    for (const c of base.t2.controls) {
      const n = nowControls.get(key(c));
      if (!n) out.push(`T2 falta el control ${key(c)}`);
      else if (c.handlers.length && !n.handlers.length) out.push(`T2 pierde manejadores ${key(c)}`);
      else if (c.visible !== n.visible) out.push(`T2 visibilidad ${key(c)}: ${c.visible} → ${n.visible}`);
    }
    // T3
    const orderA = base.t3.order.map((o) => o.name), orderB = now.t3.order.map((o) => o.name);
    if (JSON.stringify(orderA) !== JSON.stringify(orderB)) out.push(`T3 orden del foco distinto:\n  antes: ${orderA.join(" → ")}\n  ahora: ${orderB.join(" → ")}`);
    if (now.t3.positiveTabindex.length) out.push(`T3 tabindex positivo: ${now.t3.positiveTabindex.join(", ")}`);
    // T4
    for (const [sel, count] of Object.entries(base.t4.selectors)) {
      const n = now.t4.selectors[sel];
      if (n === undefined) out.push(`T4 selector desaparecido de las hojas: ${sel}`);
      else if (count > 0 && n === 0) out.push(`T4 selector huérfano (antes ${count}, ahora 0): ${sel}`);
    }
    for (const [sel, a] of Object.entries(base.t4.samples)) {
      const b = now.t4.samples[sel];
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`T4 estilo de ${sel}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
    return out;
  };

  return { capture, compare };
})()
