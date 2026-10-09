import { readFileSync } from "node:fs";
import { createWorldIndex, validateWorldConfig, type WorldConfig, type WorldIndex } from "@juego/shared";

export interface World {
  config: WorldConfig;
  index: WorldIndex;
}

let current: World | undefined;

/** Carga y valida la configuración; lanza un error con todos los motivos si no es válida. */
export function loadWorld(path: string): World {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const result = validateWorldConfig(raw);
  if (!result.ok) {
    throw new Error(`Configuración del mundo inválida (${path}):\n- ${result.errors.join("\n- ")}`);
  }
  current = { config: result.config, index: createWorldIndex(result.config) };
  return current;
}

/** Mundo cargado al arrancar; las salas lo leen de aquí. */
export function getWorld(): World {
  if (!current) throw new Error("El mundo no se ha cargado");
  return current;
}
