// Reloj del mundo: la regeneración se calcula a partir de marcas de tiempo
// persistidas, así que avanza también sin jugadores y con el servidor parado.
export function regenerate({ units, max, lastRegenAt }, now, intervalMs) {
  if (units >= max) return { units, lastRegenAt: now, changed: false };
  const steps = Math.floor((now - lastRegenAt) / intervalMs);
  if (steps <= 0) return { units, lastRegenAt, changed: false };
  const next = Math.min(max, units + steps);
  return {
    units: next,
    lastRegenAt: next >= max ? now : lastRegenAt + steps * intervalMs,
    changed: true,
  };
}
