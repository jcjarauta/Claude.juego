import { schema, t } from "@colyseus/schema";

// Estado sincronizado con los clientes. Solo el servidor lo modifica.
export const Player = schema({
  name: t.string(),
  x: t.int16(),
  y: t.int16(),
  madera: t.uint16(),
}, "Player");

export const ResourceNode = schema({
  id: t.string(),
  resource: t.string(),
  x: t.int16(),
  y: t.int16(),
  units: t.uint16(),
  max: t.uint16(),
}, "ResourceNode");

export const WorldState = schema({
  players: t.map(Player),
  nodes: t.map(ResourceNode),
}, "WorldState");
