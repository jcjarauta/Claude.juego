/**
 * Identificador de petición para que el servidor descarte duplicados. Se usa
 * getRandomValues porque crypto.randomUUID no existe en contextos no seguros
 * (por ejemplo http://192.168.x.x en red local).
 */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
