import { NextResponse } from "next/server";
import {
  ADMIN_USER_ID,
  adminAuthConfigured,
  authConfigured,
  createSessionToken,
  getAdminEmail,
  sessionCookieName,
  sessionCookieOptions,
  verifyAdminPassword,
  verifyPasswordHash,
} from "@/lib/auth";
import { findUserByEmail } from "@/lib/users";
import { getDatabase } from "@/lib/db";
import { isSameOriginRequest } from "@/lib/env";
import { LOGIN_FAILURE_RULE, clientIp, createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return reply({ error: "Недопустимый источник запроса" }, 403);
  }

  try {
    if (!authConfigured()) {
      return reply({ error: "Авторизация не настроена на сервере" }, 503);
    }

    const body = (await req.json()) as { email?: string; password?: string };
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) {
      return reply({ error: "Неверный email или пароль" }, 401);
    }

    const limiter = createRateLimiter(getDatabase());
    const throttleKey = `login:${clientIp(req)}:${email}`;
    if (await limiter.isLimited(throttleKey, LOGIN_FAILURE_RULE)) {
      const retryAfter = await limiter.retryAfterSec(throttleKey, LOGIN_FAILURE_RULE);
      return NextResponse.json(
        { error: "Слишком много попыток входа. Попробуйте позже." },
        {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) },
        },
      );
    }
    const rejectCredentials = async () => {
      await limiter.hit(throttleKey, LOGIN_FAILURE_RULE);
      return reply({ error: "Неверный email или пароль" }, 401);
    };

    const dbUser = await findUserByEmail(email);
    if (dbUser?.passwordHash) {
      if (!(await verifyPasswordHash(password, dbUser.passwordHash))) {
        return rejectCredentials();
      }
      await limiter.reset(throttleKey);
      const token = await createSessionToken({
        userId: dbUser.id,
        email: dbUser.email || email,
        displayName: dbUser.name,
      });
      const response = reply({ ok: true });
      response.cookies.set(sessionCookieName(), token, sessionCookieOptions());
      return response;
    }

    const expected = getAdminEmail();
    if (
      adminAuthConfigured() &&
      expected &&
      email === expected &&
      (await verifyAdminPassword(password))
    ) {
      const token = await createSessionToken({
        userId: ADMIN_USER_ID,
        email: expected,
        displayName: "Администратор",
      });
      await limiter.reset(throttleKey);
      const response = reply({ ok: true });
      response.cookies.set(sessionCookieName(), token, sessionCookieOptions());
      return response;
    }

    return rejectCredentials();
  } catch {
    return reply({ error: "Не удалось выполнить вход" }, 503);
  }
}
