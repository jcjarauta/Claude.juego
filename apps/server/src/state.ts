import { schema, t, type SchemaType } from "@colyseus/schema";

// Estado sincronizado con los clientes; solo el servidor lo modifica.
// Los nodos son estáticos en M1 y el cliente los lee de la configuración;
// pasarán al estado en M3, cuando cambien con la recolección.

export const Player = schema({
  name: t.string(),
  x: t.int16(),
  y: t.int16(),
}, "Player");
export type Player = SchemaType<typeof Player>;

export const WorldState = schema({
  players: t.map(Player),
}, "WorldState");
export type WorldState = SchemaType<typeof WorldState>;
