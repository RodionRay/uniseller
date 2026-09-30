const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Client IP from `cf-connecting-ip`, which Cloudflare sets and overwrites at
 * the edge. `x-forwarded-for` is deliberately ignored: the app sits directly
 * behind Cloudflare and that header is client-controlled.
 */
export function trustedClientIp(req: Request): string | null {
  const ip = req.headers.get("cf-connecting-ip")?.trim() || "";
  return IP_PATTERN.test(ip) ? ip : null;
}
