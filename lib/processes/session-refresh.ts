/**
 * Worker results may carry `refreshedSession` (new session material after
 * CreateNewSession). It must replace the stored session, otherwise the next call
 * reuses the revoked key. Shape is not fixed yet, so accept a bare string (new
 * zipBase64) or an object with known string fields; anything else is ignored.
 */

const SESSION_FIELDS = ["zipBase64", "kind", "twoFA", "apiId", "apiHash"] as const;

export type StoredSession = Record<string, unknown>;

/** Returns the merged session JSON to seal, or null when nothing usable was sent. */
export function mergeRefreshedSession(
  stored: StoredSession,
  refreshed: unknown,
): StoredSession | null {
  if (typeof refreshed === "string") {
    return refreshed.trim() ? { ...stored, zipBase64: refreshed } : null;
  }
  if (!refreshed || typeof refreshed !== "object") return null;
  const src = refreshed as Record<string, unknown>;
  const patch: StoredSession = {};
  for (const key of SESSION_FIELDS) {
    const value = src[key];
    if ((typeof value === "string" && value.trim()) || typeof value === "number") {
      patch[key] = value;
    }
  }
  if (typeof src.format === "string" && src.format.trim() && !patch.kind) {
    patch.kind = src.format;
  }
  if (typeof patch.zipBase64 !== "string") return null;
  return { ...stored, ...patch };
}
