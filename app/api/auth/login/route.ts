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
import { LOGIN_EMAIL_RULE, LOGIN_FAILURE_RULE, clientIp, createRateLimiter } from "@/lib/rate-limit";

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

    // Count the attempt atomically BEFORE the slow PBKDF2: a check-then-hit let parallel
    // requests all pass the check while the first verification was still running.
    const limiter = createRateLimiter(getDatabase());
    const throttleKey = `login:${clientIp(req)}:${email}`;
    const emailKey = `login-email:${email}`;
    const attempts = await limiter.hit(throttleKey, LOGIN_FAILURE_RULE);
    const emailAttempts = await limiter.hit(emailKey, LOGIN_EMAIL_RULE);
    const blocked =
      attempts > LOGIN_FAILURE_RULE.max
        ? { key: throttleKey, rule: LOGIN_FAILURE_RULE }
        : emailAttempts > LOGIN_EMAIL_RULE.max
          ? { key: emailKey, rule: LOGIN_EMAIL_RULE }
          : null;
    if (blocked) {
      const retryAfter = await limiter.retryAfterSec(blocked.key, blocked.rule);
      return NextResponse.json(
        { error: "Слишком много попыток входа. Попробуйте позже." },
        {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, retryAfter)) },
        },
      );
    }
    const rejectCredentials = () => reply({ error: "Неверный email или пароль" }, 401);

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
