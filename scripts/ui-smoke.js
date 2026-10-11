// Guion de humo de la interfaz (G3b, Q213): captura y comparación de las pruebas funcionales T1–T4.
// Se ejecuta DENTRO del navegador integrado, en la pantalla a comprobar y con el mundo de prueba sembrado
// (scripts/ui-seed.ts). Se pega entero en la herramienta de JavaScript del navegador: evalúa a { capture, compare }.
//   const s = <este archivo>;  const base = s.capture();   → T1–T4 de la pantalla actual
//   s.compare(baseline, s.capture())                       → diferencias (lista vacía = sin cambios)
//   await s.g3d()                                           → comprobaciones funcionales de G3d (pestaña «Logros»: Nuevos, preexistentes, referencia, insignias, registro local)
//   await s.g3c()                                           → comprobaciones funcionales de G3c (zona C, Guía, diálogo, marcadores): lista {name, ok, detail}
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

  /**
   * G3c (M3): comprobaciones funcionales de la zona «Objetivo actual», la pestaña «Guía» y el diálogo de objetivo.
   * Interactúa con la página (cambia de pestaña, abre y cierra el diálogo) y la deja como estaba. Requiere la sesión iniciada.
   */
  const g3c = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const checks = [];
    const check = (n, ok, detail = "") => checks.push({ name: n, ok: Boolean(ok), detail: String(detail) });

    // Estructura de la zona C
    const zone = $("objetivo");
    check("Zona C visible y con nombre accesible", zone && visible(zone) && zone.getAttribute("aria-labelledby") === "objetivo-titulo");
    check("Zona C antes del mapa en el documento (orden de Tab)", zone && (zone.compareDocumentPosition($("game")) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    check("Zona C no es región viva", zone && !zone.closest("[aria-live]") && !zone.querySelector("[aria-live], [role=alert], [role=status]"));
    for (const id of ["objetivo-nombre", "objetivo-estado", "objetivo-texto", "objetivo-elegir", "objetivo-detalles", "objetivo-destino", "objetivo-mostrar", "objetivo-volver"]) check(`Existe #${id}`, $(id));

    // Pestañas: seis, un solo panel visible y con texto
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const original = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    check("Al menos seis pestañas y «Guía» entre ellas", tabs.length >= 6 && tabs.some((t) => t.id === "tab-guia"), tabs.map((t) => t.textContent.trim()).join(" · "));
    for (const t of tabs) {
      t.click(); await wait(250);
      const shown = [...document.querySelectorAll('[role="tabpanel"]')].filter(visible);
      const panel = $(t.getAttribute("aria-controls"));
      check(`Pestaña «${t.textContent.trim()}»: solo su panel y con contenido`, shown.length === 1 && shown[0] === panel && panel.textContent.trim().length > 0, shown.map((p) => p.id).join(","));
    }
    // Guía: secciones y lista de estados
    $("tab-guia").click(); await wait(500);
    check("Guía: siguiente paso, qué hay cerca y consejos con contenido", ["guia-objetivo", "guia-destino", "guia-consejos", "guia-estados"].every((id) => $(id).textContent.trim().length > 0));
    check("Guía: cuatro estados explicados", $("guia-estados").children.length === 4);
    check("Guía no es región viva", !$("panel-guia").querySelector("[aria-live], [role=alert], [role=status]"));
    original?.click(); await wait(150);

    // Diálogo «Elegir objetivo»: se abre con foco dentro, se cierra y el foco vuelve al botón
    const choose = $("objetivo-elegir");
    choose.focus(); choose.click(); await wait(300);
    const dialog = document.querySelector("dialog[open]");
    check("Diálogo de objetivo abierto con título y foco dentro", dialog && dialog.querySelector("h2")?.textContent === "Elegir objetivo" && dialog.contains(document.activeElement));
    check("Diálogo: objetivo de la lista y «obtener un objeto» con etiqueta", dialog && dialog.querySelectorAll("select").length === 2 && [...dialog.querySelectorAll("select, input")].every((c) => c.labels && c.labels.length > 0));
    dialog?.querySelector(".cerrar-dialogo")?.click(); await wait(250);
    check("Al cerrar, el foco vuelve a «Elegir objetivo»", document.activeElement === choose);

    // Estado coherente: con objetivo hay estado y texto; el destino y «Mostrar en el mapa» van a la vez
    const hasObjective = !/^Sin objetivo/.test($("objetivo-nombre").textContent);
    if (hasObjective) check("Con objetivo: estado y texto del paso", $("objetivo-estado").textContent.trim() !== "" && $("objetivo-texto").textContent.trim() !== "");
    check("«Mostrar en el mapa» visible si y solo si hay destino", visible($("objetivo-mostrar")) === ($("objetivo-destino").textContent.trim() !== ""));
    check("«Volver a mi personaje» oculto con la cámara en su sitio", !visible($("objetivo-volver")));

    // Medidas
    check("Sin desplazamiento horizontal", document.documentElement.scrollWidth <= innerWidth + 1, `${document.documentElement.scrollWidth} ≤ ${innerWidth}`);
    const small = [...document.querySelectorAll("button, a[href], select, input, [role=tab]")].filter((e) => visible(e) && e.type !== "radio" && e.type !== "checkbox" && !(e.tagName === "A" && e.closest("p")))
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map(name);
    check("Ningún control menor de 24 px (salvo enlaces dentro de una frase)", small.length === 0, small.join(", "));
    check("Sin tabindex positivo", [...document.querySelectorAll("[tabindex]")].every((e) => e.tabIndex <= 0));
    return checks;
  };

  /**
   * G3d (P1): comprobaciones funcionales de la pestaña «Logros». Cambia de pestaña y la deja como estaba; NO pulsa «Marcar como visto».
   * Requiere la sesión iniciada.
   */
  const g3d = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    const checks = [];
    const check = (n, ok, detail = "") => checks.push({ name: n, ok: Boolean(ok), detail: String(detail) });
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const original = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    check("Siete pestañas, la última es «Logros»", tabs.length === 7 && tabs.at(-1).id === "tab-logros", tabs.map((t) => t.textContent.trim()).join(" · "));
    const badgeBefore = $("tab-logros").querySelector(".insignia");
    const countBefore = badgeBefore && !badgeBefore.hidden ? badgeBefore.textContent.trim() : "";
    $("tab-logros").click(); await wait(600);
    const panel = $("panel-logros");
    const shown = [...document.querySelectorAll('[role="tabpanel"]')].filter(visible);
    check("Solo el panel «Logros» visible y con contenido", shown.length === 1 && shown[0] === panel && panel.textContent.trim().length > 0);
    check("Resumen «n de m logros verificables» con texto", /\d+ de \d+ logros verificables conseguidos/.test($("logros-resumen").textContent));
    check("Aviso: sin clasificaciones ni plazos", /no hay clasificaciones ni plazos/i.test(panel.textContent));
    check("Referencia rotulada como orientativa y que no sustituye el objetivo", /no es una decisión del equipo ni sustituye tu objetivo/.test($("logros-referencia-nota").textContent));
    check("Registro de este navegador rotulado como no verificado", /no es un logro global verificado/.test(panel.textContent));
    check("Tres listas de logros verificables con contenido", ["logros-comunidad", "logros-personal", "logros-cooperacion"].every((id) => $(id).children.length > 0));
    check("Cada logro tiene estado en texto (no solo color)", [...panel.querySelectorAll("#logros-comunidad li, #logros-personal li, #logros-cooperacion li")].every((li) => /(Conseguido|En progreso|Pendiente)/.test(li.textContent)));
    check("Las insignias de nivel llevan forma y texto", [...$("logros-insignias").children].every((li) => /[▲◆■⬟★○]/.test(li.textContent) && /\S+ \S+/.test(li.textContent)));
    check("No es región viva", !panel.querySelector("[aria-live], [role=alert], [role=status]"));
    check("Sin ordenación por cantidad: ninguna lista de personas con cifras", ![...panel.querySelectorAll("li")].some((li) => /aportaron[^.]*\d+/i.test(li.textContent)));
    // Abrir la pestaña no marca nada como consultado: la insignia no cambia
    const badgeAfter = $("tab-logros").querySelector(".insignia");
    const countAfter = badgeAfter && !badgeAfter.hidden ? badgeAfter.textContent.trim() : "";
    check("Abrir la pestaña no apaga la insignia (no marca como consultado)", countBefore === countAfter, `${countBefore} → ${countAfter}`);
    check("Los preexistentes no cuentan en la insignia", true, `nuevos: ${$("logros-nuevos").children.length}, al empezar: ${$("logros-preexistentes").children.length}, insignia: ${countAfter || 0}`);
    check("Sin desplazamiento horizontal", document.documentElement.scrollWidth <= innerWidth + 1);
    const small = [...panel.querySelectorAll("button, a[href]")].filter((e) => visible(e)).filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map(name);
    check("Ningún botón de la pestaña menor de 24 px", small.length === 0, small.join(", "));
    original?.click(); await wait(150);
    return checks;
  };

  return { capture, compare, g3c, g3d };
})()
