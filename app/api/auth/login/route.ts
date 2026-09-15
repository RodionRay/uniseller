import { NextResponse } from "next/server";
import {
  createSessionToken,
  sessionCookieName,
  sessionCookieOptions,
  verifyAdminPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return reply({ error: "Недопустимый источник запроса" }, 403);
  }

  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

    if (!adminEmail || !process.env.ADMIN_PASSWORD_HASH || !process.env.SESSION_SECRET) {
      return reply({ error: "Авторизация не настроена на сервере" }, 503);
    }
    if (!email || !password || email !== adminEmail) {
      return reply({ error: "Неверный email или пароль" }, 401);
    }
    if (!(await verifyAdminPassword(password))) {
      return reply({ error: "Неверный email или пароль" }, 401);
    }

    const token = await createSessionToken(adminEmail);
    const response = reply({ ok: true });
    response.cookies.set(sessionCookieName(), token, sessionCookieOptions());
    return response;
  } catch {
    return reply({ error: "Не удалось выполнить вход" }, 503);
  }
}
