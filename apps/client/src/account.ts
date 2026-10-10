import {
  ACCOUNT_ERROR_TEXT, isValidName, isValidPassword, joinErrorText,
  type AccountError, type LoginRequest, type RegisterRequest, type SessionResponse,
} from "@juego/shared";

// Cuentas locales en el cliente (M6, RF-003): formulario accesible para entrar o crear cuenta,
// compartido por el mundo y el panel. El token de sesión se guarda en localStorage y viaja en
// las opciones de entrada a la sala (nunca en la URL).

export interface Session {
  token: string;
  name: string;
}

const SESSION_KEY = "engremiat.sesion";

const byId = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

export function savedSession(): Session | undefined {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Partial<Session> | null;
    return s && typeof s.token === "string" && typeof s.name === "string" ? { token: s.token, name: s.name } : undefined;
  } catch {
    return undefined;
  }
}

function saveSession(session: Session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* sin almacenamiento: habrá que volver a entrar */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* sin almacenamiento */ }
}

/** Cierra la sesión en el servidor y en este navegador. */
export async function logout() {
  const session = savedSession();
  clearSession();
  if (session) {
    await fetch("/api/salir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: session.token }) }).catch(() => {});
  }
}

async function request(path: string, body: LoginRequest | RegisterRequest): Promise<Session | AccountError> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json()) as Partial<SessionResponse> & { error?: AccountError };
    if (data.token && data.name) return { token: data.token, name: data.name };
    return data.error ?? "solicitud-invalida";
  } catch {
    return "solicitud-invalida";
  }
}

/** Muestra el formulario y resuelve cuando la persona entra o crea su cuenta. */
function askForSession(initialError: string): Promise<Session> {
  const form = byId<HTMLFormElement>("entrada");
  const name = byId<HTMLInputElement>("nombre");
  const password = byId<HTMLInputElement>("contrasena");
  const adultBox = byId("edad-bloque");
  const adult = byId<HTMLInputElement>("edad");
  const error = byId("nombre-error");
  const submit = byId<HTMLButtonElement>("entrada-boton");
  const mode = () => (form.querySelector<HTMLInputElement>('input[name="modo"]:checked')?.value === "registro" ? "registro" : "entrar");
  const applyMode = () => {
    const registering = mode() === "registro";
    adultBox.hidden = !registering;
    submit.textContent = registering ? "Crear cuenta y entrar" : "Entrar";
    password.autocomplete = registering ? "new-password" : "current-password";
  };
  form.onchange = applyMode;
  applyMode();
  form.hidden = false;
  name.value ||= savedSession()?.name ?? new URLSearchParams(location.search).get("name") ?? "";
  error.textContent = initialError;
  (name.value ? password : name).focus();

  return new Promise((resolve) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const fail = (text: string, field: HTMLInputElement) => {
        error.textContent = text;
        field.setAttribute("aria-invalid", "true");
        field.focus();
      };
      for (const field of [name, password, adult]) field.removeAttribute("aria-invalid");
      const registering = mode() === "registro";
      if (!isValidName(name.value.trim())) return fail(ACCOUNT_ERROR_TEXT["nombre-invalido"], name);
      if (registering && !isValidPassword(password.value)) return fail(ACCOUNT_ERROR_TEXT["contrasena-invalida"], password);
      if (registering && !adult.checked) return fail(ACCOUNT_ERROR_TEXT["edad-no-declarada"], adult);
      error.textContent = registering ? "Creando la cuenta…" : "Entrando…";
      const result = registering
        ? await request("/api/registro", { name: name.value.trim(), password: password.value, adult: adult.checked })
        : await request("/api/sesion", { name: name.value.trim(), password: password.value });
      if (typeof result === "string") return fail(ACCOUNT_ERROR_TEXT[result], result === "nombre-ocupado" ? name : password);
      password.value = "";
      saveSession(result);
      form.hidden = true;
      error.textContent = "";
      resolve(result);
    };
  });
}

/**
 * Entra en la sala con la sesión guardada o, si no la hay o no vale, pidiendo cuenta.
 * Tras recargar, la salida de la página anterior puede llegar al servidor después de esta
 * entrada: con la sesión guardada se reintenta brevemente si la cuenta o la plaza siguen ocupadas.
 */
export async function enter<R>(join: (token: string) => Promise<R>): Promise<{ room: R; session: Session }> {
  let session = savedSession();
  let error = "";
  for (let attempt = 1; ; attempt++) {
    if (!session) {
      session = await askForSession(error);
      attempt = 1;
    }
    try {
      return { room: await join(session.token), session };
    } catch (err) {
      const message = (err as Error).message;
      const transient = message.includes("nombre-en-uso") || message.includes("no rooms found") || message.includes("mundo-lleno");
      if (transient && attempt < 3) {
        await new Promise((r) => setTimeout(r, 700));
        continue;
      }
      if (message.includes("sesion-invalida")) clearSession();
      error = joinErrorText(message);
      session = undefined;
    }
  }
}
