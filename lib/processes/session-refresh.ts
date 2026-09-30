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

/** Keys that carry Telegram session or API credentials; `sessionRefreshed` (a flag) is safe. */
const SESSION_MATERIAL_KEYS = new Set(["refreshedSession", "zipBase64", "apiId", "apiHash", "twoFA"]);

function isSessionMaterialKey(key: string): boolean {
  return SESSION_MATERIAL_KEYS.has(key) || (/^session/i.test(key) && key !== "sessionRefreshed");
}

/**
 * A worker answer for any account action may carry the rebuilt tdata + session. Once it
 * is persisted it must never travel further (HTTP response → staff browser / XSS).
 */
export function stripSessionMaterial<T>(result: T): T {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (!isSessionMaterialKey(key)) out[key] = value;
  }
  return out as T;
}
