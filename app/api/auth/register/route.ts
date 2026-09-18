import { NextResponse } from "next/server";
import {
  authConfigured,
  createSessionToken,
  hashPassword,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/auth";
import { createUser, findUserByEmail } from "@/lib/users";

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
    if (!authConfigured()) {
      return reply({ error: "Авторизация не настроена на сервере" }, 503);
    }
    const body = (await req.json()) as {
      email?: string;
      password?: string;
      name?: string;
    };
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim() || email.split("@")[0] || "Пользователь";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply({ error: "Укажите корректный email" }, 400);
    }
    if (password.length < 8) {
      return reply({ error: "Пароль должен быть не короче 8 символов" }, 400);
    }
    if (await findUserByEmail(email)) {
      return reply({ error: "Этот email уже зарегистрирован" }, 409);
    }
    const user = await createUser({
      email,
      passwordHash: await hashPassword(password),
      name,
    });
    const token = await createSessionToken({
      userId: user.id,
      email,
      displayName: user.name,
    });
    const response = reply({ ok: true });
    response.cookies.set(sessionCookieName(), token, sessionCookieOptions());
    return response;
  } catch {
    return reply({ error: "Не удалось зарегистрироваться" }, 503);
  }
}
