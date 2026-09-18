import { getSessionUser } from "@/lib/auth";
import { envAiApiKey } from "@/lib/ai-client";
import { database, unseal } from "@/lib/server-store";
import {
  assistantRequestSchema,
  canAskAssistant,
  generateAssistantReply,
} from "@/lib/assistant-chat";
import { z } from "zod";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function clientKey(req: Request, owner?: string | null) {
  if (owner) return "assistant-guard:user:" + owner;
  const fwd =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for") ||
    "";
  const ip = fwd.split(",")[0]?.trim() || "anon";
  return "assistant-guard:ip:" + ip.slice(0, 80);
}

async function loadOwnerProduct(
  owner: string,
): Promise<{ product?: string; apiKey?: string }> {
  const fromEnv = envAiApiKey() || undefined;
  try {
    const db = database();
    const config: any = await db
      .prepare("SELECT * FROM records WHERE owner=? AND kind=? LIMIT 1")
      .bind(owner, "settings")
      .first();
    if (!config) return { apiKey: fromEnv };
    const data = JSON.parse(config.data);
    const sealedKey = config.secret
      ? await unseal(config.secret, owner).catch(() => undefined)
      : undefined;
    return { product: data.product, apiKey: fromEnv || sealedKey };
  } catch {
    return { apiKey: fromEnv };
  }
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) {
      return reply({ error: "Недопустимый источник запроса" }, 403);
    }
    const bodyText = await req.text();
    if (bodyText.length > 20_000)
      return reply({ error: "Слишком большой запрос" }, 413);
    const parsed = assistantRequestSchema.parse(JSON.parse(bodyText));

    const user = await getSessionUser().catch(() => null);
    const owner = user?.userId || null;
    const guardId = clientKey(req, owner);
    const now = new Date();

    let db: ReturnType<typeof database> | null = null;
    try {
      db = database();
    } catch {
      db = null;
    }

    if (db) {
      const guardRow: any = await db
        .prepare("SELECT created FROM records WHERE id=?")
        .bind(guardId)
        .first();
      if (!canAskAssistant(guardRow?.created, now)) {
        return reply(
          { error: "Подождите несколько секунд перед следующим вопросом." },
          429,
        );
      }
      await db
        .prepare(
          "INSERT INTO records(id,owner,kind,data,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created=excluded.created",
        )
        .bind(guardId, owner || "public", "ai_guard", "{}", now.toISOString())
        .run();
    }

    const owned = owner
      ? await loadOwnerProduct(owner)
      : { apiKey: envAiApiKey() || undefined };
    const result = await generateAssistantReply(parsed, {
      apiKey: owned.apiKey ?? null,
      productContext: owned.product,
    });

    return reply({
      ok: true,
      reply: result.reply,
      source: result.source,
    });
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
    if (e instanceof SyntaxError)
      return reply({ error: "Некорректный запрос" }, 400);
    return reply(
      { error: "Ассистент временно недоступен. Попробуйте позже." },
      503,
    );
  }
}
