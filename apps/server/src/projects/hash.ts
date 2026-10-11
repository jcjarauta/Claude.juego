import { createHash } from "node:crypto";
import type { HashFn } from "@juego/shared";

// Firma de las formas canónicas (G2, Q249 y Q253): SHA-256 en hexadecimal, recortado a 32 caracteres. El servidor la usa para la
// base de los análisis (`basis`) y para el hash de los planes de cascada; el cliente solo la reenvía, nunca la calcula.

export const canonicalHash: HashFn = (canonicalText) => createHash("sha256").update(canonicalText, "utf8").digest("hex").slice(0, 32);
