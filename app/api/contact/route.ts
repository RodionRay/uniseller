import { NextResponse } from "next/server";
import { database } from "@/lib/server-store";
import { getDatabase } from "@/lib/db";
import { isSameOriginRequest, readEnv } from "@/lib/env";
import { CONTACT_SUBMIT_RULE, clientIp, createRateLimiter } from "@/lib/rate-limit";
import { contactTasks } from "@/components/marketing/content";

export const dynamic = "force-dynamic";

const TELEGRAM_NOTIFY_TIMEOUT_MS = 5_000;

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function ensureTable() {
  const db = database();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS contact_messages (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        email text NOT NULL,
        telegram text,
        company text,
        task text,
        message text NOT NULL,
        created text NOT NULL
      )`,
    )
    .bind()
    .run();
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return reply({ error: "Недопустимый источник запроса" }, 403);
  }
  const limiter = createRateLimiter(getDatabase());
  if ((await limiter.hit(`contact:${clientIp(req)}`, CONTACT_SUBMIT_RULE)) > CONTACT_SUBMIT_RULE.max) {
    return reply({ error: "Слишком много заявок. Попробуйте через несколько минут." }, 429);
  }
  try {
    const body = (await req.json()) as Record<string, string>;
    const name = String(body.name ?? "").trim().slice(0, 80);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 120);
    const telegram = String(body.telegram ?? "").trim().slice(0, 64);
    const company = String(body.company ?? "").trim().slice(0, 120);
    const task = String(body.task ?? "").trim().slice(0, 40);
    const message = String(body.message ?? "").trim().slice(0, 4000);
    if (name.length < 2) return reply({ error: "Укажите имя" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply({ error: "Укажите корректный email" }, 400);
    }
    if (message.length < 10) {
      return reply({ error: "Опишите задачу чуть подробнее" }, 400);
    }
    const known = contactTasks.some((t) => t.id === task);
    await ensureTable();
    const id = crypto.randomUUID();
    const created = new Date().toISOString();
    await database()
      .prepare(
        `INSERT INTO contact_messages (id,name,email,telegram,company,task,message,created)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(id, name, email, telegram, company, known ? task : "other", message, created)
      .run();

    const bot = readEnv("CONTACT_BOT_TOKEN");
    const chat = readEnv("CONTACT_CHAT_ID");
    if (bot && chat) {
      const text = [
        "UniLab · заявка с сайта",
        `Имя: ${name}`,
        `Email: ${email}`,
        telegram ? `Telegram: ${telegram}` : "",
        company ? `Компания: ${company}` : "",
        `Задача: ${task}`,
        message,
      ]
        .filter(Boolean)
        .join("\n");
      await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text }),
        // The message is already stored; a slow Telegram API must not hang the form.
        signal: AbortSignal.timeout(TELEGRAM_NOTIFY_TIMEOUT_MS),
      }).catch((error: unknown) => {
        console.warn("[contact] Telegram notify failed:", (error as Error)?.message ?? error);
      });
    }

    return reply({ ok: true });
  } catch {
    return reply({ error: "Не удалось отправить заявку" }, 503);
  }
}
