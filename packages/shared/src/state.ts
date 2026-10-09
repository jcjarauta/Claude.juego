import { schema, t, type SchemaType } from "@colyseus/schema";

// Estado sincronizado: lo modifica solo el servidor; el cliente lo recibe tipado
// pasando WorldState a client.join(). De los nodos solo se sincronizan las
// unidades; posición, recurso y máximo están en la configuración.

export const Player = schema({
  name: t.string(),
  x: t.int16(),
  y: t.int16(),
  /** false durante el plazo de reconexión tras un corte inesperado. */
  connected: t.boolean(),
  /** Inventario individual: recurso → cantidad. */
  inventory: t.map("uint16"),
}, "Player");
export type Player = SchemaType<typeof Player>;

export const WorldState = schema({
  players: t.map(Player),
  /** Unidades disponibles por id de nodo. */
  nodes: t.map("uint16"),
  /** Inventario de la comunidad: recurso → cantidad. */
  community: t.map("uint16"),
}, "WorldState");
export type WorldState = SchemaType<typeof WorldState>;
