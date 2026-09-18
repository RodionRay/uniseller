import { z } from "zod";
import { aiChatMessages, envAiApiKey } from "@/lib/ai-client";
import {
  buildUnilabSystemPrompt,
  fallbackUnilabReply,
} from "@/lib/unilab-knowledge";

export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

export const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z.array(assistantMessageSchema).max(12).default([]),
  surface: z.enum(["admin", "site"]).default("site"),
});

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

export const ASSISTANT_RATE_WINDOW_MS = 15_000;

const rateMap = new Map<string, number>();

export function canAskAssistant(
  key: string,
  now = Date.now(),
  windowMs = ASSISTANT_RATE_WINDOW_MS,
): boolean {
  const prev = rateMap.get(key);
  if (prev && now - prev < windowMs) return false;
  rateMap.set(key, now);
  if (rateMap.size > 5000) {
    for (const [k, t] of rateMap) {
      if (now - t > windowMs * 4) rateMap.delete(k);
    }
  }
  return true;
}

export async function generateUnilabAssistantReply(
  input: AssistantRequest,
): Promise<{ reply: string; source: "ai" | "knowledge" }> {
  const apiKey = envAiApiKey();
  if (!apiKey) {
    return { reply: fallbackUnilabReply(input.message), source: "knowledge" };
  }
  try {
    const history = input.history.slice(-8);
    const reply = await aiChatMessages({
      apiKey,
      temperature: 0.35,
      maxTokens: 700,
      messages: [
        { role: "system", content: buildUnilabSystemPrompt() },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: input.message },
      ],
    });
    if (!reply) {
      return { reply: fallbackUnilabReply(input.message), source: "knowledge" };
    }
    return { reply, source: "ai" };
  } catch {
    return { reply: fallbackUnilabReply(input.message), source: "knowledge" };
  }
}
