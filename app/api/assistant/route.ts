import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import {
  assistantRequestSchema,
  canAskAssistant,
  generateUnilabAssistantReply,
} from "@/lib/assistant-chat";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function clientKey(req: Request, userId?: string | null) {
  if (userId) return `user:${userId}`;
  const fwd =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for") ||
    "";
  const ip = fwd.split(",")[0]?.trim() || "anon";
  return `ip:${ip.slice(0, 80)}`;
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) {
      return reply({ error: "Недопустимый источник запроса" }, 403);
    }
    const bodyText = await req.text();
    if (bodyText.length > 20_000) {
      return reply({ error: "Слишком большой запрос" }, 413);
    }
    const parsed = assistantRequestSchema.parse(JSON.parse(bodyText));
    const user = await getSessionUser().catch(() => null);
    const key = clientKey(req, user?.userId);
    if (!canAskAssistant(key)) {
      return reply(
        { error: "Подождите несколько секунд перед следующим вопросом." },
        429,
      );
    }
    const result = await generateUnilabAssistantReply(parsed);
    return reply({ ok: true, reply: result.reply, source: result.source });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return reply(
        {
          error:
            "Проверьте сообщение: " +
            e.issues.map((i) => i.path.join(".")).join(", "),
        },
        400,
      );
    }
    if (e instanceof SyntaxError) {
      return reply({ error: "Некорректный запрос" }, 400);
    }
    return reply(
      { error: "Ассистент временно недоступен. Попробуйте позже." },
      503,
    );
  }
}
