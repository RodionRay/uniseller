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
  telegramStateCookieCleared,
  telegramStateValid,
  verifyTelegramAuth,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";

function withStateCleared(req: Request, res: NextResponse): NextResponse {
  const cleared = telegramStateCookieCleared(req.url);
  res.cookies.set(cleared.name, cleared.value, cleared.options);
  return res;
}

function fail(req: Request, error?: unknown): NextResponse {
  const code = error instanceof RegistrationClosedError ? "closed" : "oauth";
  return withStateCleared(
    req,
    NextResponse.redirect(new URL(`/login?error=${code}`, requestOrigin(req))),
  );
}

/**
 * `state` must match the signed cookie issued by /api/auth/providers when the
 * login page rendered the widget; this blocks login CSRF with someone else's
 * Telegram payload. Replays are limited by the 5-minute auth_date window.
 */
async function finish(req: Request, data: Record<string, string>) {
  if (!telegramEnabled()) return fail(req);
  if (!(await telegramStateValid(req, data.state))) return fail(req);
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
    new URL(safeRelativeReturnPath(data.return_to || "/app"), requestOrigin(req)),
  );
  res.cookies.set(sessionCookieName(), token, sessionCookieOptions(undefined, req.url));
  return withStateCleared(req, res);
}

export async function GET(req: Request) {
  try {
    return await finish(
      req,
      Object.fromEntries(new URL(req.url).searchParams),
    );
  } catch (error) {
    return fail(req, error);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string" || typeof v === "number") data[k] = String(v);
    }
    return await finish(req, data);
  } catch (error) {
    return fail(req, error);
  }
}
