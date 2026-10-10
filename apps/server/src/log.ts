// Logs estructurados (M6, Q066): una línea JSON por incidente. Nunca contraseñas, tokens
// ni datos personales: solo el id de cuenta cuando hace falta y el motivo.

export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, type: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), level, type, ...data });
  if (level === "error") console.error(line);
  else console.log(line);
}
