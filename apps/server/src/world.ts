import { readFileSync } from "node:fs";
import { createWorldIndex, validateWorldConfig, type WorldConfig, type WorldIndex } from "@juego/shared";
import type { Accounts } from "./accounts.ts";
import type { Store } from "./store.ts";

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

let currentStore: Store | undefined;

/** Almacén abierto al arrancar; las salas lo leen de aquí. */
export function setStore(store: Store) {
  currentStore = store;
}

export function getStore(): Store {
  if (!currentStore) throw new Error("El almacén no se ha abierto");
  return currentStore;
}

let currentAccounts: Accounts | undefined;

/** Cuentas locales (M6); las salas las usan para validar el token al entrar. */
export function setAccounts(accounts: Accounts) {
  currentAccounts = accounts;
}

export function getAccounts(): Accounts {
  if (!currentAccounts) throw new Error("Las cuentas no se han iniciado");
  return currentAccounts;
}
