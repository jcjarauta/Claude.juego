import { dataTable } from "./ui/data-table.ts";
import { el } from "./ui/dom.ts";
import { dynamicList } from "./ui/dynamic-list.ts";
import { field } from "./ui/field.ts";
import { formFeedback, liveRegion } from "./ui/feedback.ts";
import { progressCard } from "./ui/progress.ts";
import { syncGroupedOptions } from "./ui/select-options.ts";
import { setupTabs } from "./ui/tabs.ts";

// Guía de estilo viva (G3a, Q203): cada componente reutilizable con datos de ejemplo, sin conexión al servidor.
// Sirve de referencia y de banco de pruebas manual con teclado (Tab, flechas, Enter, Espacio, Escape).

const demo = document.getElementById("demo")!;
const index = document.getElementById("indice")!;
const notice = document.getElementById("estilo-aviso")!;
const announce = (text: string) => { notice.textContent = text; };

function section(id: string, title: string, intro: string, ...content: (Node | string)[]) {
  const heading = el("h2", { id: `${id}-titulo`, tabIndex: -1 }, title);
  const node = el("section", { id }, heading, el("p", { className: "ayuda" }, intro), ...content);
  node.setAttribute("aria-labelledby", heading.id);
  demo.append(node);
  index.append(el("li", {}, el("a", { href: `#${id}` }, title)));
}

// --- Paleta: nombre y valor en texto, no solo color ---
const tokenNames = ["fondo", "superficie", "campo", "boton", "texto", "texto-suave", "texto-apagado", "borde", "borde-campo", "borde-fuerte", "acento", "info", "error", "exito"];
const styles = getComputedStyle(document.documentElement);
section("paleta", "Paleta (tokens)", "Los colores salen de tokens.css; ninguna pantalla declara colores propios. Cada uno se identifica por su nombre y su valor, no solo por el color.",
  el("ul", { className: "muestras" }, ...tokenNames.map((name) => {
    const swatch = el("span", { className: "muestra" });
    swatch.style.background = `var(--color-${name})`;
    return el("li", {}, swatch, el("span", {}, `--color-${name} ${styles.getPropertyValue(`--color-${name}`).trim()}`));
  })));

// --- Botones ---
const normal = el("button", { type: "button" }, "Botón normal");
normal.onclick = () => announce("Has pulsado el botón normal.");
const off = el("button", { type: "button" }, "Botón no disponible");
off.setAttribute("aria-disabled", "true");
off.onclick = () => { if (off.getAttribute("aria-disabled") !== "true") announce("No debería llegar aquí."); else announce("Este botón no está disponible ahora: se desactiva con aria-disabled para seguir en el orden del foco y poder explicar el motivo."); };
section("botones", "Botones", "Siempre nativos (<button>). Los desactivados usan aria-disabled en vez de disabled: se pueden enfocar y leer, y la pantalla puede explicar por qué no están disponibles. Tamaño mínimo 24 px (principales 44 px).",
  el("p", {}, normal, " ", off));

// --- Campo con etiqueta y ayuda ---
const nombre = el("input", { autocomplete: "off", maxLength: 40 });
section("campo", "Campo con etiqueta y ayuda", "La etiqueta es visible y está asociada al campo; la ayuda se enlaza con aria-describedby. Nunca se sustituye la etiqueta por un placeholder.",
  field("Nombre de la receta", nombre, "Obligatorio, hasta 40 caracteres."));

// --- Selector agrupado ---
const grupo = el("select");
syncGroupedOptions(grupo, [
  { label: "Recursos", entries: [["madera", "Madera"], ["piedra", "Piedra"], ["fibra", "Fibra"]] },
  { label: "Objetos", entries: [["harina", "Harina"], ["pan", "Pan"]] },
], "Elige una entrada");
section("selector", "Selector con grupos", "Selector nativo con <optgroup>; las opciones se rehacen solo si cambian y se conserva la elección.",
  field("Entrada: recurso u objeto", grupo));

// --- Lista dinámica ---
const filas = dynamicList({
  legend: "Entradas de la receta", addLabel: "Añadir entrada", noun: "entrada", min: 1, max: 4, announce, onChange: () => {},
  build: () => {
    const entry = el("select");
    syncGroupedOptions(entry, [{ label: "Recursos", entries: [["madera", "Madera"], ["piedra", "Piedra"]] }], "Elige una entrada");
    const cantidad = el("input", { type: "number", min: "1", max: "100", value: "1", inputMode: "numeric" });
    const a = field("", entry, undefined, { deferredLabel: true }), b = field("", cantidad, undefined, { deferredLabel: true });
    return { controls: [a, b], labels: [a, b].map((w) => w.querySelector("label")!), first: entry,
      names: (i: number) => [`Entrada ${i + 1}: recurso u objeto`, `Cantidad de la entrada ${i + 1}`] };
  },
});
section("lista", "Lista dinámica", "«Añadir» y «Quitar» con mínimo y máximo. Las etiquetas se renumeran, el foco pasa a la fila nueva o a la siguiente, cada cambio se anuncia y el botón de añadir se desactiva (aria-disabled) al llegar al máximo.",
  el("form", { onsubmit: (e: Event) => e.preventDefault() }, filas.element));

// --- Retroalimentación de formulario ---
const feedback = formFeedback();
const titulo = el("input", { autocomplete: "off" });
const enviar = el("form", { noValidate: true },
  field("Nombre", titulo, "Obligatorio."), feedback.errors,
  el("button", { type: "submit" }, "Crear"), feedback.confirm);
enviar.onsubmit = (event) => {
  event.preventDefault();
  feedback.clear();
  if (!titulo.value.trim()) { feedback.showError("La definición no es válida; revisa los campos indicados.", ["Falta el nombre."]); titulo.focus(); return; }
  feedback.showConfirm(`«${titulo.value.trim()}» creado.`);
  announce(`«${titulo.value.trim()}» creado.`);
  titulo.value = "";
};
section("formulario", "Formulario con error y confirmación", "El error aparece junto al formulario (role=alert) y la confirmación también (role=status): no solo en la cabecera, donde puede quedar fuera de la vista. Prueba a enviarlo vacío.", enviar);

// --- Región viva ---
const viva = liveRegion();
const anunciar = el("button", { type: "button" }, "Anunciar algo");
let veces = 0;
anunciar.onclick = () => viva.say(`Aviso número ${++veces}: se anuncia sin quitarte el foco.`);
section("viva", "Región viva", "aria-live=polite: anuncia cambios sin interrumpir ni mover el foco. Es el canal de los avisos que no son errores.", anunciar, viva.element);

// --- Pestañas ---
const lista = el("div", { role: "tablist", className: "pestanas" });
lista.setAttribute("aria-label", "Ejemplo de pestañas");
const nombres = ["Proyecto", "Taller", "Habilidades"];
const paneles = nombres.map((n, i) => {
  const tab = el("button", { type: "button", id: `ej-tab-${i}`, role: "tab" }, n);
  tab.setAttribute("aria-controls", `ej-panel-${i}`);
  tab.setAttribute("aria-selected", String(i === 0));
  tab.tabIndex = i === 0 ? 0 : -1;
  lista.append(tab);
  const panel = el("div", { id: `ej-panel-${i}`, role: "tabpanel", tabIndex: 0, hidden: i !== 0 }, el("p", {}, `Contenido de «${n}».`));
  panel.setAttribute("aria-labelledby", tab.id);
  return panel;
});
const contenedorPestanas = el("div", {}, lista, ...paneles);
section("pestanas", "Pestañas", "Patrón Tabs de WAI-ARIA Authoring Practices: solo la pestaña activa está en el orden del foco; flechas izquierda/derecha, Inicio y Fin cambian de pestaña.", contenedorPestanas);
setupTabs(contenedorPestanas, (tab) => announce(`Pestaña «${tab.textContent}».`));

// --- Tarjeta de progreso ---
const progreso = progressCard("Moler a mano", "ej-progreso");
let hecho = 0;
progreso.update(hecho, 3, "para Aprendiz");
const sumar = el("button", { type: "button" }, "Fabricar una vez");
sumar.onclick = () => { hecho = Math.min(3, hecho + 1); progreso.update(hecho, 3, "para Aprendiz"); announce(`Progreso: ${hecho} de 3.`); };
section("progreso", "Tarjeta de progreso", "Barra nativa <progress> con etiqueta y el avance también en texto: no depende solo del color ni de la barra.", progreso.element, sumar);

// --- Tabla de datos ---
section("tabla", "Tabla de datos", "<table> nativa con <caption> y cabeceras scope=col.",
  dataTable("Habilidades de las personas conectadas", ["Persona", "Habilidad", "Nivel"], [["Ana", "Molinero", "Maestro"], ["Bea", "Molinero", "Aprendiz"], ["Bea", "Panadero", "Oficial"]]));

// --- Atajos ---
section("atajos", "Atajos de teclado globales", "Mismo método de entrada para el juego y la interfaz: todo se puede hacer con teclado.",
  dataTable("Atajos actuales", ["Tecla", "Acción"], [["Flechas o W A S D", "Moverse"], ["Espacio o E", "Recolectar"], ["P", "Ir al panel del proyecto"], ["M", "Volver al mapa"], ["Tab y Mayús+Tab", "Recorrer los controles"], ["Escape", "Cerrar o cancelar (diálogos y listas)"]]));
