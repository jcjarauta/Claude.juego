import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createAccounts, LOCK_AFTER_FAILURES, LOCK_MS, SESSION_MS, tokenHash } from "../src/accounts.ts";
import { createRateLimiter } from "../src/rate-limit.ts";
import { MIGRATIONS, openStore, playerScope } from "../src/store.ts";
import { tempDb } from "./helpers.ts";

// Contraseña de prueba generada aquí; solo existe en bases temporales.
const PASSWORD = `prueba-${Math.random().toString(36).slice(2)}-clave`;

test("registro: valida nombre, contraseña y declaración de edad; el nombre es único sin distinguir mayúsculas", async () => {
  const store = openStore(tempDb());
  const accounts = createAccounts(store);
  assert.deepEqual(await accounts.register({ name: "con espacios", password: PASSWORD, adult: true }), { ok: false, error: "nombre-invalido" });
  assert.deepEqual(await accounts.register({ name: "ana", password: "corta", adult: true }), { ok: false, error: "contrasena-invalida" });
  assert.deepEqual(await accounts.register({ name: "ana", password: "x".repeat(129), adult: true }), { ok: false, error: "contrasena-invalida" });
  assert.deepEqual(await accounts.register({ name: "ana", password: PASSWORD, adult: false }), { ok: false, error: "edad-no-declarada" });
  assert.deepEqual(await accounts.register({ name: "ana", password: PASSWORD, adult: "sí" }), { ok: false, error: "edad-no-declarada" });

  const ana = await accounts.register({ name: "ana", password: PASSWORD, adult: true });
  assert.ok(ana.ok);
  assert.match(ana.account.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(accounts.verify(ana.token), ana.account);
  assert.deepEqual(await accounts.register({ name: "Ana", password: PASSWORD, adult: true }), { ok: false, error: "nombre-ocupado" });
  store.close();
});

test("inicio de sesión: credenciales, mensaje sin distinguir causa, bloqueo tras 5 fallos y cierre de sesión", async () => {
  let clock = 1_000_000;
  const store = openStore(tempDb());
  const accounts = createAccounts(store, () => clock);
  const registered = await accounts.register({ name: "bea", password: PASSWORD, adult: true });
  assert.ok(registered.ok);

  assert.deepEqual(await accounts.login({ name: "nadie", password: PASSWORD }), { ok: false, error: "credenciales-invalidas" });
  for (let i = 0; i < LOCK_AFTER_FAILURES; i++) {
    assert.deepEqual(await accounts.login({ name: "bea", password: "incorrecta" }), { ok: false, error: "credenciales-invalidas" });
  }
  assert.deepEqual(await accounts.login({ name: "bea", password: PASSWORD }), { ok: false, error: "demasiados-intentos" }, "bloqueado aunque la contraseña sea correcta");
  clock += LOCK_MS + 1;
  const login = await accounts.login({ name: "BEA", password: PASSWORD });
  assert.ok(login.ok, "tras el bloqueo entra (el nombre no distingue mayúsculas)");
  assert.equal(login.account.name, "bea");
  assert.notEqual(login.token, registered.token);

  accounts.logout(login.token);
  assert.equal(accounts.verify(login.token), undefined, "cerrar sesión invalida el token");
  assert.ok(accounts.verify(registered.token), "las demás sesiones siguen");
  clock += SESSION_MS;
  assert.equal(accounts.verify(registered.token), undefined, "la sesión caduca a los 30 días");
  assert.equal(accounts.verify("inventado-pero-largo-suficiente"), undefined);
  assert.equal(accounts.verify(undefined), undefined);
  store.close();
});

test("la contraseña y el token no se guardan en claro", async () => {
  const path = tempDb();
  const store = openStore(path);
  const accounts = createAccounts(store);
  const r = await accounts.register({ name: "eva", password: PASSWORD, adult: true });
  assert.ok(r.ok);
  store.close();
  for (const file of [path, `${path}-wal`].filter(existsSync)) {
    const raw = readFileSync(file).toString("latin1");
    assert.equal(raw.includes(PASSWORD), false, `contraseña en claro en ${file}`);
    assert.equal(raw.includes(r.token), false, `token en claro en ${file}`);
  }
  const db = new DatabaseSync(path, { readOnly: true });
  assert.deepEqual((db.prepare("SELECT token_hash AS h FROM session").all() as { h: string }[]).map((s) => s.h), [tokenHash(r.token)]);
  db.close();
});

test("migración v4 → v5: conserva los datos y crea cuentas y sesiones; los nombres antiguos se pueden reclamar (Q166)", async () => {
  const path = tempDb();
  const v4 = new DatabaseSync(path);
  for (const v of [1, 2, 3, 4]) v4.exec(MIGRATIONS[v]!);
  v4.exec("PRAGMA user_version = 4");
  v4.exec("INSERT INTO inventory VALUES ('player', 'ana', 'madera', 3)");
  v4.close();

  const store = openStore(path);
  assert.equal(store.schemaVersion(), 5);
  assert.ok(existsSync(`${path}.v4.bak`));
  const accounts = createAccounts(store);
  const ana = await accounts.register({ name: "ana", password: PASSWORD, adult: true });
  assert.ok(ana.ok);
  assert.equal(store.getAmount(playerScope(ana.account.name), "madera"), 3, "la cuenta nueva recupera el inventario de su nombre");
  store.close();
});

test("límite de frecuencia: 8 operaciones seguidas y luego 8 por segundo por sesión", () => {
  const limiter = createRateLimiter();
  const t0 = 10_000;
  const burst = Array.from({ length: 12 }, () => limiter.take("s1", t0));
  assert.equal(burst.filter(Boolean).length, 8);
  assert.equal(limiter.take("s2", t0), true, "cada sesión tiene su propio cubo");
  assert.equal(limiter.take("s1", t0 + 125), true, "a los 125 ms se repone una ficha");
  assert.equal(limiter.take("s1", t0 + 125), false);
  assert.equal(Array.from({ length: 8 }, () => limiter.take("s1", t0 + 5000)).every(Boolean), true, "nunca más de la capacidad");
  assert.equal(limiter.take("s1", t0 + 5000), false);
  limiter.forget("s1");
  assert.equal(limiter.take("s1", t0 + 5000), true);
});
