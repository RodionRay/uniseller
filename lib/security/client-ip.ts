const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Header that the proxy in front of the app sets and overwrites with the real
 * client IP, named by `TRUSTED_IP_HEADER` (e.g. `x-real-ip` behind Caddy).
 * Unset, empty or `none` means no such proxy is known, so no header is
 * trusted: without an overwriting proxy every header is client-controlled.
 */
function trustedIpHeader(): string | null {
  const name = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase() ?? "";
  return name === "" || name === "none" ? null : name;
}

/**
 * Client IP from the trusted proxy header, or null when unknown.
 * `x-forwarded-for` is never read implicitly: it is client-controlled.
 */
export function trustedClientIp(req: Request): string | null {
  const header = trustedIpHeader();
  if (!header) return null;
  const ip = req.headers.get(header)?.trim() || "";
  return IP_PATTERN.test(ip) ? ip : null;
}
