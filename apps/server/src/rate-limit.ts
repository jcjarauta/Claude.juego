// Límite de frecuencia por sesión (M6, Q167): cubo de fichas. Cada operación gasta una ficha;
// las fichas se reponen a ritmo constante hasta la capacidad. Sin fichas, la operación se rechaza.

export const OPERATIONS_PER_SECOND = 8;

export function createRateLimiter(capacity = OPERATIONS_PER_SECOND, refillPerSecond = OPERATIONS_PER_SECOND) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    /** true si la operación entra en el límite (y gasta una ficha). */
    take(key: string, now: number): boolean {
      const bucket = buckets.get(key) ?? { tokens: capacity, at: now };
      bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.at) / 1000) * refillPerSecond);
      bucket.at = now;
      const allowed = bucket.tokens >= 1;
      if (allowed) bucket.tokens -= 1;
      buckets.set(key, bucket);
      return allowed;
    },
    forget(key: string) {
      buckets.delete(key);
    },
  };
}
