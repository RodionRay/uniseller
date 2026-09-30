import { NextResponse } from "next/server";
import { sessionCookieName, sessionCookieOptions } from "@/lib/auth";
import { isSameOriginRequest, requestOrigin } from "@/lib/env";

export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));
  const response = NextResponse.redirect(new URL(returnTo, requestOrigin(req)), 302);
  response.cookies.set(sessionCookieName(), "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: "Недопустимый источник запроса" },
      { status: 403 },
    );
  }
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(sessionCookieName(), "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}
