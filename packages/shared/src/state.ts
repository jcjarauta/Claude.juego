import { schema, t, type SchemaType } from "@colyseus/schema";

// Estado sincronizado: lo modifica solo el servidor; el cliente lo recibe tipado
// pasando WorldState a client.join(). Los nodos son estáticos hasta M3 y el
// cliente los lee de la configuración.

export const Player = schema({
  name: t.string(),
  x: t.int16(),
  y: t.int16(),
  /** false durante el plazo de reconexión tras un corte inesperado. */
  connected: t.boolean(),
}, "Player");
export type Player = SchemaType<typeof Player>;

export const WorldState = schema({
  players: t.map(Player),
}, "WorldState");
export type WorldState = SchemaType<typeof WorldState>;
