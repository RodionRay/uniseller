/**
 * Worker contract: when a session was rebuilt (CreateNewSession) the result carries
 * `sessionRefreshed: true` and `refreshedSession: {zipBase64, apiId, apiHash}` where
 * zipBase64 is the original archive plus the refreshed .session file. Only zipBase64
 * replaces the stored one; kind/twoFA/api credentials stay as imported. Anything
 * malformed is ignored so an unexpected payload never corrupts the stored secret.
 */

export type StoredSession = Record<string, unknown>;

/** Returns the session JSON to re-seal, or null when nothing usable was sent. */
export function mergeRefreshedSession(
  stored: StoredSession,
  refreshed: unknown,
): StoredSession | null {
  if (!refreshed || typeof refreshed !== "object") return null;
  const zipBase64 = (refreshed as { zipBase64?: unknown }).zipBase64;
  if (typeof zipBase64 !== "string" || !zipBase64.trim()) return null;
  return { ...stored, zipBase64 };
}
