// Forma canónica (G2, Q249 y Q253): una cadena JSON determinista de un valor, con las claves de los objetos ordenadas y sin
// campos `undefined`. Sirve para comparar y para firmar (el servidor calcula el hash con node:crypto; aquí no se usa nada del
// navegador ni de Node, para que la misma función valga en el cliente, el servidor y las pruebas).

/** JSON con claves ordenadas: el mismo contenido da siempre la misma cadena, sea cual sea el orden de inserción. */
export function canonical(value: unknown): string {
  return JSON.stringify(sorted(value));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sorted(v)));
  if (value instanceof Set) return [...value].map(sorted).sort(compareCanonical);
  if (value instanceof Map) return sorted(Object.fromEntries([...value.entries()].map(([k, v]) => [String(k), v])));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sorted(v);
    }
    return out;
  }
  return value;
}

const compareCanonical = (a: unknown, b: unknown) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Función de hash que recibe una cadena canónica y devuelve una firma corta (el servidor pasa SHA-256; las pruebas, la identidad). */
export type HashFn = (canonicalText: string) => string;
export const identityHash: HashFn = (text) => text;
