import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildUnilabSystemPrompt,
  fallbackUnilabReply,
  matchUnilabFaq,
  PRODUCT_NAME,
} from "@/lib/unilab-knowledge";
import {
  assistantRequestSchema,
  canAskAssistant,
  generateUnilabAssistantReply,
} from "@/lib/assistant-chat";

describe("UniLab assistant knowledge", () => {
  it("строит system prompt про сервис", () => {
    const p = buildUnilabSystemPrompt();
    expect(p).toContain(PRODUCT_NAME);
    expect(p).toContain("антибан");
    expect(p).toMatch(/рассылк/i);
  });

  it("отвечает по FAQ без ключа", () => {
    expect(matchUnilabFaq("Что такое UniLab?")).toMatch(/Telegram/i);
    expect(fallbackUnilabReply("случайный xyz")).toMatch(/UniLab/);
  });
});

describe("UniLab assistant chat", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("валидирует запрос", () => {
    expect(
      assistantRequestSchema.parse({
        message: "Как запустить очередь вступлений?",
        surface: "admin",
      }).surface,
    ).toBe("admin");
  });

  it("режет частоту вопросов", () => {
    const key = "test-" + Math.random();
    expect(canAskAssistant(key, 1_000_000)).toBe(true);
    expect(canAskAssistant(key, 1_000_000 + 1000)).toBe(false);
    expect(canAskAssistant(key, 1_000_000 + 20_000)).toBe(true);
  });

  it("без AI_API_KEY использует knowledge", async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const r = await generateUnilabAssistantReply({
      message: "Что такое UniLab?",
      history: [],
      surface: "site",
    });
    expect(r.source).toBe("knowledge");
    expect(r.reply).toMatch(/UniLab|Telegram/i);
  });
});
