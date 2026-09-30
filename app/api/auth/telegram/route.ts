import { NextResponse } from "next/server";
import { requestOrigin } from "@/lib/env";
import {
  createSessionToken,
  safeRelativeReturnPath,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/auth";
import {
  RegistrationClosedError,
  signInOAuthUser,
  telegramEnabled,
  verifyTelegramAuth,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";

function payloadFromSearch(url: URL): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (k === "return_to") continue;
    data[k] = v;
  }
  return data;
}

async function finish(req: Request, data: Record<string, string>, returnTo: string) {
  if (!telegramEnabled()) {
    return NextResponse.redirect(new URL("/login?error=oauth", requestOrigin(req)));
  }
  const profile = await verifyTelegramAuth(data);
  const user = await signInOAuthUser({
    provider: "telegram",
    providerUserId: profile.id,
    email: null,
    emailVerified: false,
    name: profile.name,
  });
  const token = await createSessionToken({
    userId: user.id,
    email: user.email || "",
    displayName: user.name,
  });
  const res = NextResponse.redirect(
    new URL(safeRelativeReturnPath(returnTo), requestOrigin(req)),
  );
  res.cookies.set(sessionCookieName(), token, sessionCookieOptions());
  return res;
}

function failRedirect(req: Request, error: unknown) {
  const code = error instanceof RegistrationClosedError ? "closed" : "oauth";
  return NextResponse.redirect(new URL(`/login?error=${code}`, requestOrigin(req)));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    return await finish(
      req,
      payloadFromSearch(url),
      url.searchParams.get("return_to") || "/app",
    );
  } catch (error) {
    return failRedirect(req, error);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, string>;
    return await finish(req, body, body.return_to || "/app");
  } catch (error) {
    return failRedirect(req, error);
  }
}
