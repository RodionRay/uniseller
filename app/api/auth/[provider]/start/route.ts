import { NextResponse } from "next/server";
import { requestOrigin } from "@/lib/env";
import {
  makeOAuthState,
  oauthAuthorizeUrl,
  oauthEnabled,
  oauthStateCookie,
  type OAuthProvider,
} from "@/lib/oauth";
import { safeRelativeReturnPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PROVIDERS = new Set<OAuthProvider>(["google", "yandex", "vk"]);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  if (!PROVIDERS.has(provider as OAuthProvider) || !oauthEnabled(provider as OAuthProvider)) {
    return NextResponse.redirect(new URL("/login?error=oauth", requestOrigin(req)));
  }
  const url = new URL(req.url);
  const returnTo = safeRelativeReturnPath(url.searchParams.get("return_to") || "/app");
  const { s, packed } = makeOAuthState(provider, returnTo);
  const dest = oauthAuthorizeUrl(requestOrigin(req), provider as OAuthProvider, s);
  const res = NextResponse.redirect(dest);
  const cookie = oauthStateCookie(packed, req.url);
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
