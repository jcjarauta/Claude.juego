// Utilidad base de los componentes reutilizables (G3a, Q203): crea elementos nativos con sus propiedades.
// Regla: elementos HTML nativos primero; ARIA solo donde el HTML no basta (patrones de WAI-ARIA Authoring Practices).

/** Crea un elemento con propiedades (id, className, type, value…) e hijos. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  // Los valores iniciales también son los de `reset()` (si no, un formulario reiniciado dejaría los números vacíos).
  if (node instanceof HTMLInputElement) {
    if (typeof props.value === "string") node.defaultValue = props.value;
    if (typeof props.checked === "boolean") node.defaultChecked = props.checked;
  }
  node.append(...children);
  return node;
}
