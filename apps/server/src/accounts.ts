import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { isValidName, isValidPassword, type AccountError } from "@juego/shared";
import type { Store } from "./store.ts";

// Cuentas locales (M6, RF-003, Q034, Q069, Q077, Q165): nombre, contraseña y declaración
// de mayoría de edad. La contraseña se guarda con scrypt y sal aleatoria; de la sesión solo
// se guarda el hash del token. No depende de Colyseus: lo usan los endpoints HTTP y la sala.

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const LOCK_AFTER_FAILURES = 5;
export const LOCK_MS = 30_000;
const KEY_LENGTH = 64;

export interface Account {
  id: string;
  name: string;
}

export type AccountResult = { ok: true; account: Account; token: string } | { ok: false; error: AccountError };

const hashPassword = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key))));

/** Hash del token de sesión: el token es aleatorio de 32 bytes, basta con SHA-256. */
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function createAccounts(store: Store, now: () => number = Date.now) {
  /** Intentos fallidos por nombre (en minúsculas), en memoria. */
  const failures = new Map<string, { count: number; until: number }>();
  // Sal fija para calcular un hash de relleno cuando el nombre no existe (mismo coste de tiempo).
  const dummySalt = randomBytes(16);

  function openSession(account: Account): AccountResult {
    const token = randomBytes(32).toString("base64url");
    const at = now();
    store.transaction(() => store.addSession(tokenHash(token), account.id, at, at + SESSION_MS));
    return { ok: true, account, token };
  }

  return {
    async register(input: { name: unknown; password: unknown; adult: unknown }): Promise<AccountResult> {
      const { name, password, adult } = input;
      if (!isValidName(name)) return { ok: false, error: "nombre-invalido" };
      if (!isValidPassword(password)) return { ok: false, error: "contrasena-invalida" };
      if (adult !== true) return { ok: false, error: "edad-no-declarada" };
      if (store.getAccountByName(name)) return { ok: false, error: "nombre-ocupado" };
      const salt = randomBytes(16);
      const hash = await hashPassword(password, salt);
      const account = { id: randomUUID(), name };
      try {
        store.transaction(() => store.addAccount({
          id: account.id, name, passwordHash: hash.toString("hex"), salt: salt.toString("hex"), createdAt: now(), adultDeclaredAt: now(),
        }));
      } catch {
        return { ok: false, error: "nombre-ocupado" }; // dos registros simultáneos con el mismo nombre
      }
      return openSession(account);
    },

    async login(input: { name: unknown; password: unknown }): Promise<AccountResult> {
      const { name, password } = input;
      if (typeof name !== "string" || typeof password !== "string") return { ok: false, error: "credenciales-invalidas" };
      const key = name.toLowerCase();
      const lock = failures.get(key);
      if (lock && lock.until > now()) return { ok: false, error: "demasiados-intentos" };
      const row = store.getAccountByName(name);
      const hash = await hashPassword(password.slice(0, 256), row ? Buffer.from(row.salt, "hex") : dummySalt);
      const valid = Boolean(row) && timingSafeEqual(hash, Buffer.from(row!.passwordHash, "hex"));
      if (!valid || !row) {
        // Tras un bloqueo ya vencido, la cuenta de fallos empieza de nuevo.
        const count = (lock && lock.until === 0 ? lock.count : 0) + 1;
        failures.set(key, { count, until: count >= LOCK_AFTER_FAILURES ? now() + LOCK_MS : 0 });
        // El mensaje no distingue entre nombre inexistente y contraseña incorrecta.
        return { ok: false, error: "credenciales-invalidas" };
      }
      failures.delete(key);
      return openSession({ id: row.id, name: row.name });
    },

    logout(token: unknown) {
      if (typeof token === "string" && token) store.transaction(() => store.deleteSession(tokenHash(token)));
    },

    /** Cuenta de un token vigente, o undefined. */
    verify(token: unknown): Account | undefined {
      if (typeof token !== "string" || token.length < 20 || token.length > 100) return undefined;
      const session = store.getSession(tokenHash(token));
      if (!session || session.expiresAt <= now()) return undefined;
      return { id: session.accountId, name: session.name };
    },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
