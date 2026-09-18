import { NextResponse } from "next/server";
import {
  createSessionToken,
  safeRelativeReturnPath,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/auth";
import { telegramEnabled, verifyTelegramAuth } from "@/lib/oauth";
import { upsertOAuthUser } from "@/lib/users";

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
  const url = new URL(req.url);
  if (!telegramEnabled()) {
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }
  const profile = await verifyTelegramAuth(data);
  const user = await upsertOAuthUser({
    provider: "telegram",
    providerUserId: profile.id,
    email: null,
    name: profile.name,
  });
  const token = await createSessionToken({
    userId: user.id,
    email: user.email || "",
    displayName: user.name,
  });
  const res = NextResponse.redirect(
    new URL(safeRelativeReturnPath(returnTo), url.origin),
  );
  res.cookies.set(sessionCookieName(), token, sessionCookieOptions());
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    return await finish(
      req,
      payloadFromSearch(url),
      url.searchParams.get("return_to") || "/app",
    );
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  try {
    const body = (await req.json()) as Record<string, string>;
    return await finish(req, body, body.return_to || "/app");
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }
}
